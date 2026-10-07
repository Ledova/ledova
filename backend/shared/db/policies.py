from typing import NamedTuple


class MissingOwnerColumns(NamedTuple):
    columns: tuple[str, ...]
    reason: str


PRINCIPAL = "NULLIF(current_setting('app.user_id', true), '')::bigint"
ADMITTED = f"{PRINCIPAL} IS NOT NULL"

PRINCIPAL_ACCOUNTS = "app_principal_account_ids"
PRINCIPAL_PROFILES = "app_principal_profile_ids"
VISIBLE_COMPANIES = "app_visible_company_ids"
MANAGEABLE_COMPANIES = "app_manageable_company_ids"
PUBLIC_COMPANIES = "app_public_company_ids"
ADMINISTRABLE_COMPANIES = "app_company_administration_ids"
DISCOVERABLE_COMPANIES = "app_company_discovery_ids"
ELIGIBILITY_COMPANIES = "app_company_eligibility_ids"
OPEN_TO_INVESTORS = "status = 'active' AND is_open_to_investors"


def on_the_market(prefix: str = "") -> str:
    return f"{prefix}status = 'deployed' AND length({prefix}contract_address) > 0"


ON_THE_MARKET = on_the_market()
ISSUES_THE_OFFERING = (
    "offering_id IN (SELECT uuid FROM offerings_offering " f"WHERE company_id IN (SELECT {VISIBLE_COMPANIES}()))"
)

HAS_A_TOKEN_ON_THE_MARKET = (
    "EXISTS (SELECT 1 FROM tokens_sharetoken listed "
    f"WHERE listed.company_id = companies_company.uuid AND {on_the_market('listed.')})"
)

HELPERS = {
    PRINCIPAL_PROFILES: f"SELECT uuid FROM users_userprofile WHERE user_id = {PRINCIPAL}",
    PRINCIPAL_ACCOUNTS: f"""
        SELECT uuid
          FROM customer_accounts_account
         WHERE user_profile_id IN (SELECT {PRINCIPAL_PROFILES}())
    """,
    VISIBLE_COMPANIES: f"SELECT uuid FROM companies_company WHERE owner_id = {PRINCIPAL}",
    MANAGEABLE_COMPANIES: f"SELECT uuid FROM companies_company WHERE owner_id = {PRINCIPAL}",
    PUBLIC_COMPANIES: f"SELECT uuid FROM companies_company WHERE {OPEN_TO_INVESTORS}",
    DISCOVERABLE_COMPANIES: (
        f"SELECT uuid FROM companies_company WHERE {ADMITTED} "
        f"AND (({OPEN_TO_INVESTORS}) OR {HAS_A_TOKEN_ON_THE_MARKET})"
    ),
    ADMINISTRABLE_COMPANIES: f"""
        SELECT issuer.uuid FROM companies_company issuer
        JOIN authentication_customuser actor ON actor.id = {PRINCIPAL}
        WHERE actor.is_active AND actor.is_email_verified AND (
            (issuer.owner_id = actor.id AND issuer.status = 'draft'
                AND NOT EXISTS (SELECT 1 FROM companies_companylegacyownersource source
                    WHERE source.company_id = issuer.uuid)
                AND NOT EXISTS (SELECT 1 FROM companies_companyappointment root
                    WHERE root.company_id = issuer.uuid AND root.request_id IS NOT NULL))
            OR EXISTS (SELECT 1 FROM companies_companyappointment appointment
                JOIN users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
                WHERE appointment.company_id = issuer.uuid AND appointment.appointee_id = actor.id
                    AND profile.user_id = actor.id AND appointment.capabilities @> '["admin"]'::jsonb
                    AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
                    AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation revoked
                        WHERE revoked.appointment_id = appointment.uuid)
                    AND (NOT COALESCE((SELECT issuer_kyc_required FROM operators_operator WHERE id = 1), false)
                        OR profile.is_id_verified)))
    """,
    ELIGIBILITY_COMPANIES: f"""
        SELECT DISTINCT appointment.company_id FROM companies_companyappointment appointment
        JOIN authentication_customuser actor ON actor.id = appointment.appointee_id
        JOIN users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
        JOIN operators_operator configuration ON configuration.id = 1
        WHERE actor.id = {PRINCIPAL} AND actor.is_active AND actor.is_email_verified
            AND profile.user_id = actor.id
            AND (appointment.capabilities @> '["prepare"]'::jsonb
                OR appointment.capabilities @> '["approve"]'::jsonb)
            AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
            AND (NOT configuration.issuer_kyc_required OR profile.is_id_verified)
            AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation revoked
                WHERE revoked.appointment_id = appointment.uuid)
    """,
}

IDENTICAL_TODAY = (VISIBLE_COMPANIES, MANAGEABLE_COMPANIES)

BYPASSES_THE_POLICIES = (
    PRINCIPAL_PROFILES,
    PRINCIPAL_ACCOUNTS,
    ADMINISTRABLE_COMPANIES,
    DISCOVERABLE_COMPANIES,
    VISIBLE_COMPANIES,
    MANAGEABLE_COMPANIES,
    ELIGIBILITY_COMPANIES,
)

OWNS_THE_ACCOUNT = f"user_profile_id IN (SELECT {PRINCIPAL_PROFILES}())"

LEAF_TABLES = ("companies_company",)


def subscribed_to_my_offering(column, table):
    return (
        "EXISTS (SELECT 1 FROM offerings_subscription bid "
        "JOIN offerings_offering listed ON listed.uuid = bid.offering_id "
        f"WHERE listed.company_id IN (SELECT {VISIBLE_COMPANIES}()) AND bid.{column} = {table}.uuid)"
    )


A_SUBSCRIBING_ACCOUNT = subscribed_to_my_offering("user_account_id", "customer_accounts_account")
A_SUBSCRIBING_WALLET = subscribed_to_my_offering("wallet_id", "wallets")
A_SUBSCRIBING_HOLDER = (
    "EXISTS (SELECT 1 FROM customer_accounts_account holding "
    "JOIN offerings_subscription bid ON bid.user_account_id = holding.uuid "
    "JOIN offerings_offering listed ON listed.uuid = bid.offering_id "
    f"WHERE listed.company_id IN (SELECT {VISIBLE_COMPANIES}()) "
    "AND holding.user_profile_id = users_userprofile.uuid)"
)


def _owned_through_the_profile(table):
    return f"{table}.user_profile_id IN (SELECT {PRINCIPAL_PROFILES}())"


def _owned(column):
    return f"{column} IN (SELECT {PRINCIPAL_ACCOUNTS}())"


def _company(column, helper):
    return f"{column} IN (SELECT {helper}())"


def _company_or_public(column):
    return f"{_company(column, VISIBLE_COMPANIES)} OR {_company(column, PUBLIC_COMPANIES)}"


OWNERSHIP_BOUND = (
    "EXISTS (SELECT 1 FROM wallets held "
    "WHERE held.uuid = tokens_transferorder.wallet_id "
    "AND held.user_account_id = tokens_transferorder.owner_account_id "
    "AND lower(held.address) = lower(tokens_transferorder.wallet_address))"
)

THROUGH_ITS_WALLET = (
    "EXISTS (SELECT 1 FROM wallets held WHERE held.uuid = holdings.wallet_id "
    f"AND held.user_account_id IN (SELECT {PRINCIPAL_ACCOUNTS}()))"
)
THROUGH_ITS_DOCUMENT = (
    "EXISTS (SELECT 1 FROM documents carrying WHERE carrying.uuid = document_extractions.document_id "
    f"AND carrying.uploaded_by_id = {PRINCIPAL})"
)
THROUGH_THE_ORDER_IT_MODIFIED = (
    "EXISTS (SELECT 1 FROM tokens_transferorder modified "
    "WHERE modified.uuid = tokens_ordermodificationlog.order_id "
    f"AND modified.owner_account_id IN (SELECT {PRINCIPAL_ACCOUNTS}()))"
)
THROUGH_ITS_TOKEN = (
    "EXISTS (SELECT 1 FROM tokens_sharetoken issued "
    "WHERE issued.uuid = tokens_shareissuance.token_id "
    f"AND ({_company('issued.company_id', VISIBLE_COMPANIES)} OR {on_the_market('issued.')}))"
)


ADDRESSED_TO_ME = (
    "EXISTS (SELECT 1 FROM shareholders_publicationrecipient addressed "
    f"WHERE addressed.publication_id = shareholders_publication.uuid AND addressed.user_id = {PRINCIPAL})"
)
MY_OWN_BALLOT = (
    "kind = 'ballot' AND EXISTS (SELECT 1 FROM shareholders_publicationrecipient casting "
    f"WHERE casting.uuid = shareholders_publicationevent.recipient_id AND casting.user_id = {PRINCIPAL})"
)
A_CLOSE_ON_MY_ROLL = (
    "kind = 'close' AND EXISTS (SELECT 1 FROM shareholders_publicationrecipient addressed "
    "WHERE addressed.publication_id = shareholders_publicationevent.publication_id "
    f"AND addressed.user_id = {PRINCIPAL})"
)
A_CLOSE_OF_MY_COMPANY = f"kind = 'close' AND {_company('company_id', VISIBLE_COMPANIES)}"
MY_OWN_PAYMENT_RECORDS = (
    "kind IN ('payment', 'payment_void') AND EXISTS (SELECT 1 FROM shareholders_publicationrecipient owed "
    f"WHERE owed.uuid = shareholders_publicationevent.recipient_id AND owed.user_id = {PRINCIPAL})"
)
PAYMENT_RECORDS_OF_MY_COMPANY = f"kind IN ('payment', 'payment_void') AND {_company('company_id', VISIBLE_COMPANIES)}"


A_PARTY_TO_THE_SWAP = (
    "EXISTS (SELECT 1 FROM wallets party "
    "WHERE party.uuid IN (tokens_swaporder.seller_wallet_id, tokens_swaporder.buyer_wallet_id) "
    f"AND party.user_account_id IN (SELECT {PRINCIPAL_ACCOUNTS}()))"
)


POLICIES = {
    "users_companyeligibilityrequest": (
        f"{_owned('user_account_id')} OR {_company('company_id', ELIGIBILITY_COMPANIES)}",
        "false",
    ),
    "users_companyeligibilitydecision": (
        "EXISTS (SELECT 1 FROM users_companyeligibilityrequest request "
        "WHERE request.uuid = users_companyeligibilitydecision.request_id)",
        "false",
    ),
    "users_companyeligibilityrequestwithdrawal": (
        "EXISTS (SELECT 1 FROM users_companyeligibilityrequest request "
        "WHERE request.uuid = users_companyeligibilityrequestwithdrawal.request_id)",
        "false",
    ),
    "users_companyeligibilityrevocation": (
        "EXISTS (SELECT 1 FROM users_companyeligibilitydecision decision "
        "WHERE decision.uuid = users_companyeligibilityrevocation.decision_id)",
        "false",
    ),
    "companies_company": (
        f"uuid IN (SELECT {ADMINISTRABLE_COMPANIES}()) OR uuid IN (SELECT {DISCOVERABLE_COMPANIES}())",
        "false",
    ),
    "users_userprofile": (f"user_id = {PRINCIPAL} OR {A_SUBSCRIBING_HOLDER}", f"user_id = {PRINCIPAL}"),
    "documents": (f"uploaded_by_id = {PRINCIPAL}", f"uploaded_by_id = {PRINCIPAL}"),
    "users_device_token": (f"user_id = {PRINCIPAL}", f"user_id = {PRINCIPAL}"),
    "notifications": (f"user_id = {PRINCIPAL}", f"user_id = {PRINCIPAL}"),
    "users_financialprofile": (
        _owned_through_the_profile("users_financialprofile"),
        _owned_through_the_profile("users_financialprofile"),
    ),
    "users_userpreferences": (
        _owned_through_the_profile("users_userpreferences"),
        _owned_through_the_profile("users_userpreferences"),
    ),
    "customer_accounts_account": (f"{OWNS_THE_ACCOUNT} OR {A_SUBSCRIBING_ACCOUNT}", OWNS_THE_ACCOUNT),
    "wallets": (f"{_owned('user_account_id')} OR {A_SUBSCRIBING_WALLET}", _owned("user_account_id")),
    "transactions": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_walletsubmission": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_bitcoinsubmission": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_bitcoinsubmissioninput": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_walletchainwatch": (_owned("user_account_id"), "false"),
    "wallets_walletchainobservation": (_owned("user_account_id"), "false"),
    "portfolios": (_owned("user_account_id"), _owned("user_account_id")),
    "users_investorclassification": (_owned("user_account_id"), _owned("user_account_id")),
    "offerings_subscription": (
        f"{_owned('user_account_id')} OR {ISSUES_THE_OFFERING}",
        _owned("user_account_id"),
    ),
    "tokens_transferorder": (
        f"{_owned('owner_account_id')} AND {OWNERSHIP_BOUND}",
        f"{_owned('owner_account_id')} AND {OWNERSHIP_BOUND}",
    ),
    "tokens_ordersubmission": (_owned("owner_account_id"), _owned("owner_account_id")),
    "tokens_swaporder": (A_PARTY_TO_THE_SWAP, "false"),
    "compliance_customerriskassessment": (_owned("user_account_id"), _owned("user_account_id")),
    "holdings": (THROUGH_ITS_WALLET, THROUGH_ITS_WALLET),
    "document_extractions": (THROUGH_ITS_DOCUMENT, THROUGH_ITS_DOCUMENT),
    "tokens_ordermodificationlog": (THROUGH_THE_ORDER_IT_MODIFIED, THROUGH_THE_ORDER_IT_MODIFIED),
    "tokens_shareissuance": (THROUGH_ITS_TOKEN, "false"),
    "tokens_orderactionsubmission": (_owned("owner_account_id"), _owned("owner_account_id")),
    "companies_companydocument": (
        _company("company_id", ADMINISTRABLE_COMPANIES),
        "false",
    ),
    "companies_companyregistrycheck": ("false", "false"),
    "companies_companyauthorityrequest": (f"requester_id = {PRINCIPAL}", "false"),
    "companies_companyappointment": (f"appointee_id = {PRINCIPAL}", "false"),
    "companies_companyteaminvitation": (f"inviter_id = {PRINCIPAL}", "false"),
    "companies_companylegacyownersource": ("false", "false"),
    "companies_companyappointmentrevocation": (
        "appointment_id IN (SELECT uuid FROM companies_companyappointment)",
        "false",
    ),
    "companies_companyauthorityrequestwithdrawal": (
        f"request_id IN (SELECT uuid FROM companies_companyauthorityrequest WHERE requester_id = {PRINCIPAL})",
        "false",
    ),
    "offerings_offering": (
        _company_or_public("company_id"),
        _company("company_id", MANAGEABLE_COMPANIES),
    ),
    "tokens_sharetoken": (
        f'{_company("company_id", VISIBLE_COMPANIES)} OR ({ON_THE_MARKET})',
        _company("company_id", MANAGEABLE_COMPANIES),
    ),
    "tokens_capitalincreaserequest": (
        _company("company_id", VISIBLE_COMPANIES),
        _company("company_id", MANAGEABLE_COMPANIES),
    ),
    "tokens_shareissuancerequest": (
        f"{_company('company_id', VISIBLE_COMPANIES)} OR uuid IN "
        f"(SELECT issuance_request_id FROM offerings_subscription WHERE {_owned('user_account_id')})",
        _company("company_id", MANAGEABLE_COMPANIES),
    ),
    "tokens_formerholder": (f"owner_id = {PRINCIPAL}", "false"),
    "tokens_registercorrection": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registermember": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registermemberwallet": (
        _company("company_id", VISIBLE_COMPANIES),
        "false",
    ),
    "tokens_registeropening": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registerwalletlink": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_shareregister": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registerentry": ("register_id IN (SELECT uuid FROM tokens_shareregister)", "false"),
    "tokens_registerposition": ("register_id IN (SELECT uuid FROM tokens_shareregister)", "false"),
    "tokens_registerreconciliation": ("token_id IN (SELECT token_id FROM tokens_shareregister)", "false"),
    "tokens_registerimport": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registerinstruction": (
        _company("company_id", VISIBLE_COMPANIES),
        f"{_company('company_id', MANAGEABLE_COMPANIES)} AND submitted_by_id = {PRINCIPAL} AND status = 'submitted'",
    ),
    "tokens_registermemberparticulars": ("member_id IN (SELECT uuid FROM tokens_registermember)", "false"),
    "tokens_registergrant": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registerparticularschange": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_importedformermember": ("token_id IN (SELECT token_id FROM tokens_shareregister)", "false"),
    "shareholders_publication": (
        f"{_company('company_id', VISIBLE_COMPANIES)} OR {ADDRESSED_TO_ME}",
        "false",
    ),
    "shareholders_publicationrecipient": (
        f"user_id = {PRINCIPAL} OR {_company('company_id', VISIBLE_COMPANIES)}",
        "false",
    ),
    "shareholders_publicationevent": (
        f"({MY_OWN_BALLOT}) OR ({A_CLOSE_ON_MY_ROLL}) OR ({A_CLOSE_OF_MY_COMPANY}) "
        f"OR ({MY_OWN_PAYMENT_RECORDS}) OR ({PAYMENT_RECORDS_OF_MY_COMPANY})",
        "false",
    ),
    "blockchain_outgoingoperation": ("false", "false"),
    "blockchain_signingaccount": ("false", "false"),
    "blockchain_freshsignerbootstrap": ("false", "false"),
    "blockchain_signedattempt": ("false", "false"),
    "blockchain_outgoinghistorycapture": ("false", "false"),
    "blockchain_outgoinghistoryevidence": ("false", "false"),
    "blockchain_outgoingcutoverhold": ("false", "false"),
}

LOCKING_IS_READING = (
    "PostgreSQL applies the UPDATE policy's USING to SELECT ... FOR UPDATE, so a row the read policy admits "
    "and the update policy does not can be read and never locked - and select_for_update().get() turns that "
    "into DoesNotExist rather than a refusal. So the UPDATE policy's USING is exactly the read scope and all "
    "the narrowing lives in its WITH CHECK, while INSERT's WITH CHECK and DELETE's USING stay owner-only. "
    "Measured by Omarch 5 on a scratch table: it is the only arrangement that both locks the row and refuses "
    "the write. Without it an investor gets DoesNotExist at allotment on the offering they just chose - "
    "offerings/services/subscription.py locks it at 463, 499 and 566."
)

DERIVED_FROM_A_MUTABLE_ATTRIBUTE = {
    "tokens_formerholder": "R24: operator-written. The read term is owner_id alone and carries no market term, "
    "because tokens_sharetoken's public term one hop up exists so investors can browse a listing, and copying it "
    "here would publish former members' names and home addresses to every investor who can see the class. The "
    "write term is false for all three commands: the fold task writes on the operator alias, the retention sweep "
    "deletes on the same alias on the accepted retention clock. Refolding leaves existing particulars unchanged. "
    "The owner is derived through token.company.owner; a future owner-transfer feature must propagate it.",
    "tokens_sharetoken.owner_id": "Derived through company.owner, which is the only owner attribute an admin "
    "can edit. Between the parent changing and the child's next write the column is stale, so the previous "
    "owner keeps seeing the rows - #322 re-derives a stale row in the trigger and makes Company.owner "
    "read-only in the admin. An owner-transfer feature would need an AFTER UPDATE trigger on the parent "
    "before it exists, and this is the entry that says so.",
}

READS_WIDER_THAN_OWNERSHIP = {
    "Exact company eligibility preparation": (
        "users/services/company_eligibility.py company_eligibility_requests and _request_context; "
        "shared/db/policies.py app_company_eligibility_ids",
        "The exact known active issuer or approved offering resolves without a company directory. The operator "
        "validates only the actual participant's source and exact command. Current personal prepare or approve "
        "appointments admit deliberately shared records through a UUID-only definer and immutable parent joins; "
        "no source, identity, financial file or private document policy is expanded.",
        "users/tests/test_company_eligibility_requests.py exercises genuine own submissions, exact company scope, "
        "foreign identifiers and no staff/admin/delegation-only authority; "
        "users/tests/test_company_eligibility_scoped.py proves actual role routing and raw private-source refusal.",
    ),
    "Public company discovery": (
        "shared/db/policies.py companies_company read policy through app_company_discovery_ids",
        "The fixed-search-path definer returns only company UUIDs for a non-null principal and the existing "
        "active/open or deployed/nonempty-address public terms. It stops company-token policy recursion "
        "without admitting private company documents, profiles or basic administration.",
        "companies/tests/test_company_administration.py exercises marketed/open reads, owned draft token reads, "
        "foreign private resources, empty deployments, draft listings and a missing principal; "
        "shared/tests/test_rls_catalogue.py checks the definer boundary.",
    ),
    "Current personal company administration": (
        "companies/querysets/company.py administrable_by; companies/services/administration.py company_contact",
        "The principal-bound definer returns only company UUIDs for current personal admin appointments or genuine "
        "unrooted owner drafts. It sees retained initial and legacy roots regardless of their RLS visibility. Basic "
        "responses expose only the existing contact name and email, without admitting raw profiles or accounts.",
        "companies/tests/test_company_administration.py exercises actual admission, delegated scope, revocation, "
        "foreign identifiers and private files; shared/tests/test_rls_catalogue.py checks the "
        "fixed-search-path definer.",
    ),
    "Company.active for an associated-person claim": (
        "users/services/classification_issuer.py active_issuer_for_claim",
        "The operator validates only the supplied UUID against active issuers and returns only that key. "
        "The owner confirmed on 2026-09-13 that an applicant may name an active issuer before it is listed; "
        "the claim is still written under the applicant and company details remain hidden.",
        "users/tests/test_classification_issuer_scoped.py proves a hidden active issuer succeeds, inactive "
        "and unknown issuers fail, the lookup selects only its UUID, and the claim writes use the app role.",
    ),
    "Market prices for already admitted tokens": (
        "tokens/services/market_data_service.py market_summaries; "
        "tokens/services/trading_order_service.py get_order_book",
        "The operator publishes only price summaries, the last trade's public amounts and aggregated "
        "order-book levels for tokens already admitted under issuer ownership or investor eligibility. "
        "Lists resolve their page under the app role before one operator query bounded to those UUIDs. "
        "No order, wallet or counterparty identity is returned, and their RLS policies remain unchanged.",
        "tokens/tests/test_market_reads_scoped.py proves cross-issuer prices, one bounded summary query, "
        "private order refusal and no operator summary access for ineligible or unknown-token requests.",
    ),
    "Documents attached to a published offering": (
        "offerings/services/documents.py published_documents and published_document, "
        "for offerings/views/directory.py",
        "companies_companydocument and offerings_offering_documents: the stored files attached to an approved or "
        "closed offering of a share class the caller's directory admits. The token resolves through the directory "
        "selector and the offerings through their own policy, under the app role, before one operator query "
        "bounded to those offering UUIDs and the class's own company. No unattached document, no other company's "
        "document and no external link is returned; basic company documents require current personal administration",
        "offerings/tests/test_directory_documents_scoped.py - ScopedDirectoryDocumentsTest proves one operator "
        "read bounded to the published offering and its company, the row still hidden on the app role, and no "
        "operator read for an unpublished, ineligible or unknown request",
    ),
    "Stablecoin approvals for a wallet send": (
        "wallets/services/transaction_confirmation.py require_stablecoin_approvals, at prepare in "
        "wallets/services/transfers.py and at submission in wallets/services/submissions.py _submission_plan",
        "whitelist_whitelistentry joined to wallets by address, and whitelist_whitelistapproval: whether the sending "
        "wallet and the recipient address of a stablecoin send each hold a live approval with any company. Only "
        "that yes or no reaches the sender, as which side is refused; no entry, company, wallet or account of the "
        "recipient is returned, and the wallets policy is unchanged",
        "wallets/tests/test_stablecoin_approvals.py - ScopedStablecoinApprovalTest proves a recipient approved on "
        "another account's wallet is admitted on the app role at prepare and at submission, and an unapproved one "
        "is refused",
    ),
    "PolicyQuerysets on an administrative action": (
        "shared/views/scope.py, the get_queryset every AuthenticatedViewSet inherits",
        "every row of the scoped model, and only for an action the view names in "
        "administrative_actions, which is the set get_permissions turns into IsAdminUser. Keyed to "
        "that set rather than to operator_actions, which only chooses a connection and which the "
        "coverage gate permits to be the wider of the two",
        "shared/tests/test_views_scope_in_the_base.py - import-time checks require every model in the "
        "catalogue and require an explanation for operator_actions wider than administrative_actions",
    ),
    "ShareIssuanceRequest on subscription reads and withdrawal": (
        "offerings/querysets/subscription.py with_relations and offerings/services/subscription.py _linked_request",
        "tokens_shareissuancerequest: the request linked to a subscription of this principal's member account. "
        "Reading that request preserves the withdrawal refusal once issuance is claimed; writes remain issuer-only",
        "shared/tests/test_review_request_policies.py - subscriber read, write refusal and withdrawal controls",
    ),
    "Subscription.for_issuer": (
        "offerings/views/offering.py subscriptions",
        "offerings_subscription: the issuer term, offering_id in the offerings this principal's companies own",
        "shared/tests/test_two_scope_fixture.py - a subscription whose buyer does not own the offering",
    ),
    "Offering.open_now": (
        "offerings/serializers/subscription.py:147, and the select_for_update re-reads at "
        "offerings/services/subscription.py 463, 499 and 566",
        "offerings_offering: the public company term, and the UPDATE policy's USING is as wide, so the "
        "re-read can lock what the serializer offered",
        "shared/tests/test_rls_isolation.py - a public row is locked and the write still refused",
    ),
    "ShareToken.in_directory": (
        "offerings/views/directory.py",
        "tokens_sharetoken: the market predicate, and companies_company: open to investors",
        "shared/tests/test_cross_tenant_routes_under_rls.py - the directory rows of the 184-route matrix",
    ),
    "ShareToken.deployed_with_contract": (
        "tokens/views/trading_token.py, tokens/services/trading_events.py:22, "
        "tokens/services/share_token_service.py:861",
        "tokens_sharetoken: the market predicate, wider than the directory because a token is tradeable "
        "without its issuer opting into the browse surface",
        "shared/tests/test_cross_tenant_routes_under_rls.py - "
        "test_the_market_answers_without_the_issuers_directory_opt_in",
    ),
    "Company.all on the eligibility path": (
        "users/services/eligibility.py:110",
        "companies_company: owner, open to investors, or holding a token on the market. The policy is "
        "narrower than all(), and both consumers - the directory and the subscription serializer - filter "
        "to companies that are open or listed, so the narrowing is invisible to them",
        "shared/tests/test_cross_tenant_routes_under_rls.py - the directory and market rows",
    ),
    "Company.all on the administrative actions": (
        "companies/views/company.py:70",
        "no policy term: those actions run on the operator connection by operator_actions, because a staff "
        "member does not own the company they administer",
        "shared/tests/test_principal_coverage.py - the administrative-action gate",
    ),
}

R13_WATCHES_BOTH_ENDS = (
    "R13's set is computed rather than maintained: links_between_policy_tables() walks Django's metadata for "
    "every non-nullable foreign key whose both ends carry policies, with a non-empty control behind it. The "
    "one direction it cannot watch is a platform-owned table classified out of POLICIES entirely, where "
    "nothing stands behind the classification but the reason written beside it. "
    "The deliberate retained-application parent exception is exercised by ScopedApplicationRetentionTest: "
    "its route reads snapshots without joining hidden company or offering rows."
)

PUBLIC_TERM = {
    "tokens_sharetoken": "The secondary market is deployed_with_contract(), wider than the directory: a "
    "token is tradeable without its issuer opting into the browse surface, and "
    "test_the_market_answers_without_the_issuers_directory_opt_in says so in its name. #322 makes owner_id "
    "the company owner's user, so the owner term alone hides every deployed token from an investor - the "
    "second term has to be on the token's own columns. It is the exact dual of "
    "HAS_A_TOKEN_ON_THE_MARKET on companies_company: a company is visible because a token of its is on the "
    "market, and that token is visible because it is on the market. Remove either and R13's closure between "
    "the two tables fails, which is why it holds by construction rather than by luck. The policy reads only "
    "this table's own columns, so it forms no cycle with the company term that reads it.",
    "offerings_subscription": "Applicants keep their applications when the offering or company is hidden. "
    "The applicant route reads stored names and currency without joining those parents; submit rechecks "
    "the visible offering and withdraw retains its money and mint guards. "
    "R12 at a third table, found by Omarch 2 measuring rather than reading. "
    "OfferingViewSet.subscriptions reads Subscription.objects.for_issuer(offering), "
    "deliberately - the scope is the offering's ownership rather than the subscriber's account - so a "
    "member-only policy shows an issuer their own subscriptions and silently drops everyone else's. "
    "Measured with two tenants: as the owner for_issuer returns 2, as the app role with the issuer's "
    "principal it returns 1, and that is feature 4's capital-raised view answering short with no error. "
    "The read term adds the offerings the principal's companies own; WITH CHECK stays member-only, because "
    "an issuer does not write a subscription on someone's behalf. No cycle: offerings_offering's policy "
    "does not read subscriptions.",
    "customer_accounts_account": "An issuer must know who subscribed to their own offering: "
    "for_issuer select_relates the subscribing account, and a hidden account deletes the subscription row "
    "the issuer was allowed to see. The term is the subscription, not the market - a stranger browsing "
    "companies reaches no account at all. R14 used to let an account through for holding a company's "
    "operator wallet, and one account per person turned that into the holder's name, phone and address, "
    "so it is gone. The term reads offerings_subscription, which reads offerings_offering, which reads "
    "companies_company, which reads nothing back.",
    "wallets": "The same subscription, one column along: for_issuer select_relates the wallet as well, and "
    "the subscription serializer prints its address. A wallet is on the account that subscribed, so the "
    "wallet term and the account term open together and R13's closure holds by construction.",
    "users_userprofile": "The register is a name and an address, so an issuer reading their own "
    "subscriptions reads the subscriber's profile. The account is visible to that issuer already and "
    "user_profile_id is not nullable, so without this term select_related would delete the account row and "
    "the subscription with it. The term is the same subscription predicate, one link further.",
    "companies_company": "Public discovery preserves active companies open to investors and companies with a "
    "deployed token carrying a nonempty contract address. Directory and secondary-market joins require these "
    "parents independently of private basic administration. The fixed-search-path discovery definer returns "
    "only company UUIDs under an admitted principal; its token check avoids the Company-to-token-to-invoker "
    "owner-helper policy cycle. Current personal administration and genuine unrooted draft setup use their "
    "separate UUID helper, while customer basic selectors remain narrower than public discovery.",
    "shareholders_publication": "A publication is the first investor-readable projection of the register, so its "
    "read term has to reach past the company that made it: without the recipient term a member could never open "
    "the statement or notice addressed to them, which is the whole point of the table. The term is a member's own "
    "roll row and nothing else - it never reads a wallet address, because Wallet is unique per (account, chain, "
    "address) and two accounts may hold one address, so an address join would hand one member's statement to "
    "another. Identity is resolved once in Python when the roll is frozen and stored as user_id, exactly the shape "
    "the notifications policy already uses. No cycle: shareholders_publicationrecipient's own policy reads only "
    "its own columns and companies_company through the visible-companies helper, and never reads publications "
    "back. Both tables are read-only to the app role; only the operator writes them.",
    "shareholders_publicationrecipient": "A roll row is readable by the member it names and by the company that "
    "published it, the same two-sided shape offerings_subscription carries. The company term is the row's own "
    "company_id rather than a join through the publication, because the publication's read term reads this table "
    "and a term reading it back would be an infinite recursion in the policy. company_id is copied from the "
    "publication at insert and the guard trigger refuses a row whose company differs from its publication's; "
    "both rows are frozen at insert, so it cannot go stale.",
    "shareholders_publicationevent": "A resolution's record is read by three parties, and each term is narrower than "
    "the publication's own. A member reads their own ballot, found through the roll row it names, so a ballot a "
    "staff member entered for them is theirs too; a member reads the close of any resolution they are on the roll "
    "of, because the tally is the outcome every member was asked about; and the company that published reads the "
    "close alone, on the row's own company_id, which is copied from the publication at insert and checked by the "
    "trigger. No one but staff reads another member's ballot, and the company reads no ballot at all. A "
    "distribution's payment records follow the same two sides: a member reads the records and withdrawals for "
    "their own roll rows, found through the roll row each names, and never another member's; the company reads "
    "every payment record of its own distributions on the row's company_id, because it is the payer and staff "
    "record them on its written instruction. The write "
    "term is false for all three commands: a member's ballot is resolved under this principal's policies and "
    "inserted on the operator connection, where the trigger requires the actor to be the account the roll row "
    "names, and payment records are written by staff on the operator connection alone. No cycle: the member terms "
    "read shareholders_publicationrecipient, whose own policy reads only its own columns and companies_company "
    "through the visible-companies helper, the company terms read that helper alone, and nothing reads this table "
    "back.",
    "offerings_offering": "open_now() deliberately admits investors - the subscription serializer and "
    "submit service re-read the offering in the caller's scope. An owner-only policy would refuse an "
    "eligible investor whose company is open; retaining an existing application never widens this scope.",
}

AWAITING_R0: dict[str, MissingOwnerColumns] = {}

AWAITING_RLS = {}

FRAMEWORK = {
    "auth_group": "Django's own permission grouping.",
    "auth_permission": "Django's own permission rows, one per model and action.",
    "authentication_customuser": "The user table itself. A principal is a row here, so scoping it by the "
    "principal would make authentication depend on the answer it is trying to produce.",
    "django_admin_log": "The admin's audit trail, written and read on the operator connection only.",
    "django_content_type": "Django's model registry.",
    "django_session": "Session rows, read before any view runs and keyed by a cookie rather than a user.",
    "token_blacklist_outstandingtoken": "Issued refresh tokens, read during authentication, before a "
    "principal exists.",
    "token_blacklist_blacklistedtoken": "Revoked refresh tokens, read during authentication for the same reason.",
    "procrastinate_jobs": "The worker queue, consumed on the operator connection. Transaction screening "
    "jobs are inserted on the producer's connection so they commit with the transaction they screen.",
    "procrastinate_events": "Worker job history, written by the queue on the operator connection.",
    "procrastinate_periodic_defers": "Worker schedule bookkeeping, with no tenant in it at all.",
    "procrastinate_workers": "Worker registration rows, one per running worker process.",
    "auth_group_permissions": "Django's own permission plumbing, joining a group to a permission.",
    "authentication_customuser_groups": "Django's own permission plumbing, joining a user to a group.",
    "authentication_customuser_user_permissions": "Django's own permission plumbing, per-user grants.",
}

OPERATOR_ONLY = {
    "tokens_registergrantdecision": "Append-only company decisions of non-paid register grants, bound to current "
    "company appointments and exact immutable commands, read through their company-scoped grant.",
    "tokens_registerevidence": "Immutable company-provided register evidence uploads, written by the bounded "
    "register command on the operator connection and read there only through register-readable queries. Each "
    "prepared import keeps its own copy of the files it used.",
    "tokens_registerimportdecision": "Append-only company approvals, applications and rejections of register "
    "imports, each bound to the deciding appointment and written by the bounded register command on the operator "
    "connection. Register readers see them through the import on the operator connection.",
    "tokens_registercorrectiondecision": "Append-only company approvals, applications and rejections of register "
    "corrections, each bound to the deciding appointment and written by the bounded register command on the "
    "operator connection. Register readers see them through the correction on the operator connection.",
    "tokens_registeropeningdecision": "Append-only company approvals, applications and rejections of register "
    "openings, each bound to the deciding appointment and written by the bounded register command on the operator "
    "connection. Register readers see them through the opening on the operator connection.",
    "tokens_registerparticularschangedecision": "Append-only company approvals, applications and rejections of "
    "member particulars changes, each bound to the deciding appointment and written by the bounded register command "
    "on the operator connection. Register readers see them through the change on the operator connection.",
    "tokens_registerwalletlinkdecision": "Append-only company approvals, applications and rejections of member "
    "wallet links, each bound to the deciding appointment and written by the bounded register command on the "
    "operator connection. Register readers see them through the link on the operator connection.",
    "tokens_registeracknowledgement": "Append-only acknowledgements of register reconciliation discrepancies. A "
    "company's are written by the bounded register command on the operator connection, each bound to the "
    "acknowledging appointment; retained staff-era rows came from a retired operator command. Register readers "
    "read them through the reconciliation on the operator connection, and later reconciliation runs read them "
    "there too.",
    "tokens_pausechange": "Immutable issuer or staff pause submissions and their original outgoing outcomes. "
    "Bounded operator admission retains exact authority and job; issuer token projection uses the scoped connection.",
    "tokens_shareissuanceexecution": "Immutable operator-authorized share issuance intent, queued cancellation, "
    "exact retry authority and protected outgoing associations. Customer paths retain public request state.",
    "tokens_capitalincreaseexecution": "Immutable operator-authorized capital increase intent, exact retry "
    "authorization and original transaction attribution. Issuer request paths never read the private execution record.",
    "tokens_tokendeployment": "Immutable deployment intent and issuer authority snapshots, written through a bounded "
    "operator journal. Public token lifecycle writes retain their issuer connection.",
    "tokens_swapapprovalsubmission": "Immutable participant-signed approval bytes, their nonce and hash, and the "
    "receipt written once. The route records it through a bounded operator transaction before any send and the "
    "sweep replays it; the participant's own connection never reads a signed broadcast capability.",
    "whitelist_whitelistchange": "Immutable operator-authorized whitelist commands and their outgoing-operation "
    "associations. Public membership reads never read this private recovery journal.",
    "whitelist_whitelisteligibilityinvalidation": "Retained account, identity and wallet invalidation facts and "
    "actual human or automatic attribution, written in the original bounded operator transaction. Only the "
    "invalidation worker reads these private cause records.",
    "documents_documentread": "Append-only administrative document read records, written on the operator "
    "connection and visible only to permitted platform reviewers. They contain UUIDs and reader IDs, not "
    "file names, extraction values or file contents, and outlive document content purges.",
    "tokens_registerexport": "Immutable records of who exported a share class's register or prepared a copy, a "
    "certificate, notice figures or a company pack from it, written on the operator connection by the export route, "
    "the register outputs admin and the company pack admin, and queried by staff in admin. No issuer or customer "
    "path reads them, and only the retention purge deletes them.",
    "shareholders_publicationread": "Append-only records of who opened a publication a company made to its "
    "members, or the remittance evidence of one of its payment records, written on the operator connection by "
    "the delivery service and the publications admin, and read "
    "only by permitted staff. They carry UUIDs and reader IDs, not names, holdings or file contents, and a "
    "delivery whose read cannot be recorded is refused rather than served.",
    "compliance_compliancealert": "Raised and worked by compliance staff on the operator connection. It "
    "carries user_account_id but no queryset scopes it, so a policy would be a new rule rather than a "
    "translation of one.",
    "compliance_transactionscreening": "Same surface, same connection, same reason.",
    "compliance_alertproceduretemplate": "Operator-authored procedure text, the same for every tenant.",
    "compliance_alertprocedurestep": "A step of that operator-authored text, reached through its template.",
    "compliance_alertchecklistitem": "A checklist item raised against an alert, reached through it.",
    "compliance_monitoringrule": "Operator-authored screening rules, the same for every tenant.",
    "blockchain_blockchaintransaction": "A record of what the relayer broadcast, written by workers and "
    "keyed by transaction hash rather than by any tenant.",
    "tokens_mintrequest": "Written on the relayer path by workers, reached through its token.",
    "tokens_navupdate": "Issuer-published NAV history, reached through its token.",
    "tokens_yieldtoken": "Token configuration reached through its share token.",
}

NOT_TENANCY = {
    "assets_asset": "A global catalogue shared by every tenant; product filters select supported assets.",
    "feature_flags": "Global kill switches; enabled() selects the active flags for every tenant.",
    "whitelist_whitelistentry": "Staff-only, which is authorisation rather than tenancy, and stays in code.",
    "whitelist_whitelistapproval": "Each whitelist entry's approval in one company's registry: staff-only like the "
    "entry it belongs to, so authorisation rather than tenancy, and it stays in code. A customer deleting their own "
    "wallet cascades through the entry into these rows on the app connection, so a policy that hid them from the "
    "app role would make that deletion fail rather than keep them private.",
    "signing_challenges": "Reached by address through a service rather than by any queryset; #256 deleted "
    "the two methods that looked like scoping. #305 gave it a wallet column, and it is nullable, so a "
    "policy on it would hide exactly the rows consumable() already refuses - no-policy and policy agree on "
    "every row, which is a reason to leave it rather than an absence of one. If the column ever becomes "
    "NOT NULL, or if a queryset starts reading challenges the service does not, that agreement ends.",
    "asset_chain_deployments": "Part of the asset catalogue.",
    "asset_snapshots": "Price history for the catalogue, identical for every tenant.",
    "assets_exchangerate": "Published rates, identical for every tenant.",
    "shared_country": "A reference list of countries, identical for every tenant.",
    "operators_operator": "A singleton naming the operator of this deployment.",
    "operators_operator_supported_settlement_assets": "Which assets that singleton settles in.",
    "offerings_offering_documents": "A link row reached only through its offering, which is scoped. Nothing "
    "scopes this table today, so a policy here would be a new rule rather than a translation of one - and it "
    "is worth writing the day anything reaches these rows without going through the offering first. The "
    "directory's document read joins it on the operator connection only after resolving the published "
    "offerings under the app role, and bounds the join to them.",
    "offerings_offering_settlement_assets": "A link row from a scoped offering to the global asset catalogue, "
    "reached only through the offering, and carrying nothing the catalogue does not already publish.",
    "portfolios_wallets": "A link row between a scoped portfolio and a scoped wallet, reached through either, "
    "and revealing nothing that reading both of those tables would not.",
}

REACHED_DESPITE_OPERATOR_ONLY = {
    "tokens_yieldtoken": "assets/serializers/asset.py:62 reads it for every asset a customer lists, to answer "
    "nav_per_token and last_nav_update. It is filtered by symbol and not by any principal.",
    "compliance_monitoringrule": "reached from the same account-creation path while scoring the new "
    "assessment, on the connection that served the request.",
}

UNSCOPED = {**FRAMEWORK, **OPERATOR_ONLY, **NOT_TENANCY, **AWAITING_RLS}
