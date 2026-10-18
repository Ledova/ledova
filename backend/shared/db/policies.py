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
        "false",
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
        f"{_company('company_id', VISIBLE_COMPANIES)} AND preparing_appointment_id IS NULL",
        f"{_company('company_id', MANAGEABLE_COMPANIES)} AND preparing_appointment_id IS NULL "
        f"AND submitted_by_id = {PRINCIPAL} AND status = 'submitted'",
    ),
    "tokens_registermemberparticulars": ("member_id IN (SELECT uuid FROM tokens_registermember)", "false"),
    "tokens_registergrant": (f"award_id IS NULL AND {_company('company_id', VISIBLE_COMPANIES)}", "false"),
    "tokens_registertransfer": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registermembercessation": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_registerparticularschange": (
        f"member_request_id IS NULL AND {_company("company_id", VISIBLE_COMPANIES)}",
        "false",
    ),
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
    "the narrowing lives in its WITH CHECK, while INSERT's WITH CHECK and DELETE's USING stay on the write term. "
    "Measured by Omarch 5 on a scratch table: it is the only arrangement that both locks the row and refuses "
    "the write. Without it an investor ordering another company's share class gets DoesNotExist from "
    "tokens/services/trading_order_create.py issue_order_submission, which locks that class on the app role."
)

DERIVED_FROM_A_MUTABLE_ATTRIBUTE = {
    "tokens_formerholder": "R24: operator-written. The read term is owner_id alone and carries no market term, "
    "because tokens_sharetoken's public term one hop up exists so investors can browse a listing, and copying it "
    "here would publish former members' names and home addresses to every investor who can see the class. The "
    "write term is false for all three commands: tokens/tasks/former_holders.py fold_every_share_class writes on "
    "the operator alias, and purge_former_members_past_the_clock deletes on the same alias on the accepted "
    "retention clock. Refolding leaves existing particulars unchanged. "
    "The owner is derived through token.company.owner; a future owner-transfer feature must propagate it.",
}

READS_WIDER_THAN_OWNERSHIP = {
    "Exact company eligibility preparation": (
        "users/services/company_eligibility.py company_eligibility_requests and _request_context; "
        "shared/db/policies.py app_company_eligibility_ids",
        "The exact known active issuer or approved offering resolves without a company directory. The operator "
        "validates only the actual participant's source and exact command. Current personal prepare or approve "
        "appointments admit deliberately shared records through a UUID-only definer and immutable parent joins; "
        "no source, identity, financial file or private document policy is expanded.",
    ),
    "Public company discovery": (
        "shared/db/policies.py companies_company read policy through app_company_discovery_ids",
        "The fixed-search-path definer returns only company UUIDs for a non-null principal and the existing "
        "active/open or deployed/nonempty-address public terms. It stops company-token policy recursion "
        "without admitting private company documents, profiles or basic administration.",
    ),
    "Current personal company administration": (
        "companies/querysets/company.py administrable_by; companies/services/administration.py company_contact",
        "The principal-bound definer returns only company UUIDs for current personal admin appointments or genuine "
        "unrooted owner drafts. It sees retained initial and legacy roots regardless of their RLS visibility. Basic "
        "responses expose only the existing contact name and email, without admitting raw profiles or accounts.",
    ),
    "Company.active for an associated-person claim": (
        "users/services/classification_issuer.py active_issuer_for_claim",
        "The operator validates only the supplied UUID against active issuers and returns only that key. "
        "The owner confirmed on 2026-09-13 that an applicant may name an active issuer before it is listed; "
        "create_classification then writes the claim on the operator connection under the applicant's principal, "
        "for their own account and profile, and company details remain hidden.",
    ),
    "Market prices for already admitted tokens": (
        "tokens/services/market_data_service.py market_summaries; "
        "tokens/services/trading_order_service.py get_order_book",
        "The operator publishes only price summaries, the last trade's public amounts and aggregated "
        "order-book levels for tokens already admitted under issuer ownership or investor eligibility. "
        "Lists resolve their page under the app role before one operator query bounded to those UUIDs. "
        "No order, wallet or counterparty identity is returned, and their RLS policies remain unchanged.",
    ),
    "Documents attached to a published offering": (
        "offerings/services/documents.py published_documents and published_document, "
        "for DirectoryTokenViewSet.documents and document_file in offerings/views/directory.py",
        "companies_companydocument and offerings_offering_documents: the stored files attached to an approved or "
        "closed offering of a share class the caller's directory admits. The token resolves through the directory "
        "selector and the offerings through their own policy, under the app role, before one operator query "
        "bounded to those offering UUIDs and the class's own company. No unattached document, no other company's "
        "document and no external link is returned; basic company documents require current personal administration",
    ),
    "Stablecoin approvals for a wallet send": (
        "wallets/services/transaction_confirmation.py require_stablecoin_approvals, at prepare in "
        "wallets/services/transfers.py _prepare_erc20_transfer and at submission in "
        "wallets/services/submissions.py _submission_plan",
        "whitelist_whitelistentry joined to wallets by address, and whitelist_whitelistapproval: whether the sending "
        "wallet and the recipient address of a stablecoin send each hold a live approval with any company. Only "
        "that yes or no reaches the sender, as which side is refused; no entry, company, wallet or account of the "
        "recipient is returned, and the wallets policy is unchanged",
    ),
    "ShareIssuanceRequest on subscription reads and withdrawal": (
        "offerings/querysets/subscription.py for_applicant and offerings/services/subscription.py _linked_request",
        "tokens_shareissuancerequest: the request linked to a subscription of this principal's member account. "
        "Reading that request preserves the withdrawal refusal once issuance is claimed; writes remain issuer-only",
    ),
    "Subscription.for_issuer": (
        "offerings/views/offering.py OfferingViewSet.subscriptions",
        "no policy term: subscriptions is one of OfferingViewSet's operator_actions, and the view filters to the "
        "offerings issued_by this principal, the scope of offerings_subscription's issuer term",
    ),
    "Offering.open_now": (
        "offerings/serializers/subscription.py SubscriptionCreateSerializer.get_fields",
        "offerings_offering: the public company term. create_draft and submit in offerings/services/subscription.py "
        "then re-read the offering on the operator connection behind the subscription admission lock",
    ),
    "ShareToken.in_directory": (
        "offerings/services/directory.py directory_tokens, for DirectoryTokenViewSet in offerings/views/directory.py",
        "tokens_sharetoken: the market predicate, and companies_company: open to investors",
    ),
    "ShareToken.deployed_with_contract": (
        "tokens/services/market_data_service.py list_market_tokens, for TradingTokenViewSet in "
        "tokens/views/trading_token.py and streamable_token_uuid in tokens/services/trading_events.py; "
        "tokens/services/share_token_service.py get_wallet_token_balances",
        "tokens_sharetoken: the market predicate, wider than the directory because a token is tradeable "
        "without its issuer opting into the browse surface",
    ),
    "Company.all on the administrative actions": (
        "companies/views/company.py CompanyViewSet.narrow, for the administrative_actions that get_permissions "
        "limits to IsAdminUser",
        "no policy term: those actions run on the operator connection by operator_actions, because a staff "
        "member does not own the company they administer. The view's other operator actions stay narrowed to "
        "readable_by and for_activation",
    ),
}

PUBLIC_TERM = {
    "tokens_sharetoken": "The secondary market is deployed_with_contract(), wider than the directory: a "
    "token is tradeable without its issuer opting into the browse surface, and no automated test covers that "
    "market read. The owner term admits only the classes of the principal's own companies, so alone it hides "
    "every deployed token from an investor - the second term has to be on the token's own columns. It is the "
    "exact dual of HAS_A_TOKEN_ON_THE_MARKET on companies_company: a company is visible because a token of its "
    "is on the market, and that token is visible because it is on the market. Remove either and R13's closure "
    "between the two tables fails, which is why it holds by construction rather than by luck. The market term "
    "reads only this table's own columns and the owner term goes through the app_visible_company_ids definer, so "
    "the policy forms no cycle with the company term that reads it.",
    "offerings_subscription": "Applicants keep their applications when the offering or company is hidden. "
    "The applicant route reads stored names and currency without joining those parents; submit re-reads "
    "the offering on the operator connection behind the subscription admission lock, and withdraw retains its "
    "money and mint guards. tokens/services/register_instructions.py submit_instruction, directly and through "
    "_check_items, asks on the app role whether a subscription stands behind each issuance request a company "
    "owner's issue instruction names - the scope is the offering's ownership rather than the subscriber's "
    "account, so a member-only policy would hide every other investor's subscription from those checks. "
    "OfferingViewSet.subscriptions runs Subscription.objects.for_issuer(offering) on the operator connection. "
    "The read term adds the offerings the principal's companies own; WITH CHECK stays member-only, because "
    "an issuer does not write a subscription on someone's behalf. No cycle: offerings_offering's policy "
    "does not read subscriptions.",
    "customer_accounts_account": "An issuer must know who subscribed to their own offering. On the app role, "
    "tokens/services/holder_identity.py identity_at_allotment, which submit_instruction reaches through "
    "_check_items, follows a recipient's wallet to its account and profile; when that wallet subscribed to the "
    "owner's offering the wallet term admits it, so without this term the account lookup would raise. The term "
    "is the subscription, not the market - a stranger browsing companies reaches no account at all. R14 used to "
    "let an account through for holding a company's operator wallet, and one account per person turned that "
    "into the holder's name, phone and address, so it is gone. The term reads offerings_subscription, which "
    "reads offerings_offering, which reads companies_company, which reads nothing back.",
    "wallets": "The same subscription, one column along: identity_at_allotment finds the recipient's wallet by "
    "address, and this term admits it when that wallet subscribed to the owner's offering. A wallet is on the "
    "account that subscribed, so the wallet term and the account term open together and R13's closure holds by "
    "construction.",
    "users_userprofile": "The register is a name and an address, so identity_at_allotment reads the profile "
    "behind a subscribing account for the recipient's name and residential address. The account is visible to "
    "that issuer already and user_profile_id is not nullable, so without this term that read would raise. The "
    "term is the same subscription predicate, one link further.",
    "companies_company": "Public discovery preserves active companies open to investors and companies with a "
    "deployed token carrying a nonempty contract address. Directory and secondary-market joins require these "
    "parents independently of private basic administration. The fixed-search-path discovery definer returns "
    "only company UUIDs under an admitted principal; its token check avoids the Company-to-token-to-invoker "
    "owner-helper policy cycle. Current personal administration and genuine unrooted draft setup use their "
    "separate UUID helper, while customer basic selectors remain narrower than public discovery.",
    "shareholders_publication": "A publication is the first investor-readable projection of the register, so its "
    "read term has to reach past the company that made it: without the recipient term a member's app-role reads "
    "- the summary, cast_ballot and the ballot response - would never reach the publication addressed to them. "
    "Listing and opening the file run on the operator connection, where Publication.objects.for_reader binds the "
    "company owner or a named recipient. The term is a member's own roll row and nothing else - it never reads a "
    "wallet address, because Wallet is unique per (account, chain, address) and two accounts may hold one "
    "address, so an address join would hand one member's statement to another. Identity is resolved once in "
    "Python when the roll is frozen and stored as user_id, exactly the shape the notifications policy already "
    "uses. No cycle: shareholders_publicationrecipient's own policy reads only its own columns and "
    "companies_company through the visible-companies helper, and never reads publications back. Both tables are "
    "read-only to the app role; only the operator writes them.",
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
    "offerings_offering": "open_now() deliberately admits investors - the subscription serializer resolves the "
    "offering in the caller's scope, before create_draft and submit re-read it on the operator connection behind "
    "the subscription admission lock. An owner-only policy would refuse an eligible investor whose company is "
    "open; retaining an existing application never widens this scope.",
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
    "django_session": "Session rows, keyed by a cookie rather than a user. The admin reads and writes them on the "
    "operator connection. The browsable API login and logout views that rest_framework.urls mounts at api-auth read, "
    "create and delete them on the app connection with no principal set, so the app role needs the grant. The API "
    "authenticates with HybridJWTAuthentication, which does not read them.",
    "token_blacklist_outstandingtoken": "Issued refresh tokens, read during authentication, before a "
    "principal exists.",
    "token_blacklist_blacklistedtoken": "Revoked refresh tokens, read during authentication for the same reason.",
    "procrastinate_jobs": "The worker queue. The worker fetches, retries, finishes and prunes jobs, and plain "
    "task.defer() calls and the job admin's actions write them, through the default alias, the migration role (#1131); "
    "the admin reads them on the operator connection. Jobs that must commit with their producer go in on the "
    "producer's connection: the app connection when WalletViewSet or a wallet task acting for a principal reaches "
    "compliance/services/transaction_monitoring.py queue_new_transaction or "
    "wallets/services/transaction_confirmation.py _notify_wallet_users, and the operator connection for the bounded "
    "register and wallet commands.",
    "procrastinate_events": "Worker job history, written by Procrastinate's triggers on procrastinate_jobs as "
    "whichever role inserts or updates the job: the default alias, the migration role, for the worker, plain "
    "task.defer() calls and the job admin's actions (#1131), and otherwise the producer's own connection, which is the "
    "app connection when queue_new_transaction or _notify_wallet_users defers a job for a principal. Pruning old jobs "
    "deletes their events, and the job admin reads them on the operator connection.",
    "procrastinate_periodic_defers": "Worker schedule bookkeeping, with no tenant in it at all.",
    "procrastinate_workers": "Worker registration rows, one per running worker process.",
    "auth_group_permissions": "Django's own permission plumbing, joining a group to a permission.",
    "authentication_customuser_groups": "Django's own permission plumbing, joining a user to a group.",
    "authentication_customuser_user_permissions": "Django's own permission plumbing, per-user grants.",
}

OPERATOR_ONLY = {
    "companies_companysignuptermsacceptance": "Immutable current signup Terms receipts bound to one company, "
    "appointment and appointee. The bounded acceptance command writes them on the operator connection, and own "
    "appointment serialization reads only that appointee's exact receipt on that connection. The app role has "
    "no grants and forced row-level security admits no direct rows.",
    "tokens_membercertificatefulfilment": "Immutable recipient-only member certificates with their producing authority "
    "and export, inserted by tokens/services/member_certificates.py fulfil_member_certificate on the operator "
    "connection. Every reader is on that connection. member_certificate_bytes serves the file only to a current own "
    "association or current company register reader. MemberCertificateRequestViewSet nests the fulfilment's metadata "
    "in its responses, and its list and detail show it to current register readers and to the original requester even "
    "after their association ends.",
    "tokens_memberinvitation": "Immutable intended-recipient company member invitations issued by current "
    "ADMIN appointments.",
    "tokens_memberassociation": "Exact signed-in user/account member associations served only through "
    "bounded own or company projections.",
    "tokens_memberassociationrevocation": "Append-only exact company administration ending member access "
    "without deleting attribution.",
    "tokens_memberparticularsrequest": "Confirmed own proposed particulars handed to the existing company "
    "decision flow with immutable provenance.",
    "tokens_membercertificaterequest": "Own genuine receiving-effect certificate requests with truthful "
    "recorded status and current company queues.",
    "tokens_membercertificatewithdrawal": "Append-only own requester withdrawals without invented "
    "certificate fulfilment.",
    "tokens_registeragreement": "Retained private external agreements served through current "
    "exact-company register appointments.",
    "tokens_registercontribution": "Immutable company-recorded AUD receipts served through current "
    "exact-company register appointments.",
    "tokens_registerallotment": "Fully paid external allotments, written by tokens/services/register_allotments.py "
    "prepare_allotment and decide_allotment on the operator connection; a trigger refuses deletion and any change but "
    "the decision. Every reader is on that connection. RegisterAllotmentViewSet serves records and files to current "
    "register appointments, and CompanyViewSet.pack and the company pack admin include them. ShareTokenViewSet's "
    "holders, entries and export, which also admit the company owner, its certificates and inspection copies, "
    "MemberRecordViewSet and MemberCertificateRequestViewSet's certificates take only an allotment's amount paid or "
    "company event date.",
    "tokens_registerallotmentdecision": "Append-only attributable company allotment decisions "
    "reached through their private parent.",
    "tokens_registeraward": "Immutable employee award entitlements and their agreement evidence, written by "
    "tokens/services/register_awards.py record_award on the operator connection. Every reader is on that connection. "
    "RegisterAwardViewSet, ShareTokenViewSet.register_members and the award, grant, import and invitation-issuing "
    "commands act for current company appointments, and member invitation and association checks also read them. "
    "MemberRecordViewSet shows the recipient their own awards without the agreement file, and the name and address "
    "recorded on them until they join the register. CompanyViewSet.pack and the company pack admin include them with "
    "their files.",
    "tokens_registerawardend": "Append-only award endings and their private evidence, written by "
    "tokens/services/register_awards.py record_award_end on the operator connection. Every reader is on that "
    "connection. RegisterAwardEndViewSet, RegisterAwardViewSet, RegisterGrantViewSet's award grants and the award and "
    "grant commands act for current company appointments. MemberRecordViewSet shows the recipient their own endings "
    "without the evidence, and CompanyViewSet.pack and the company pack admin include them with their files.",
    "tokens_registerawardvestingreversal": "Append-only vesting reversals and their private evidence, written by "
    "tokens/services/register_awards.py record_award_vesting_reversal on the operator connection. Every reader is on "
    "that connection. RegisterAwardVestingReversalViewSet, RegisterAwardViewSet, RegisterGrantViewSet's award grants "
    "and the award and grant commands act for current company appointments. MemberRecordViewSet shows the recipient "
    "their own reversals without the evidence, and CompanyViewSet.pack and the company pack admin include them with "
    "their files.",
    "tokens_registerawardvesting": "Append-only company-confirmed vesting facts and their private evidence files. "
    "tokens/services/register_awards.py record_award_vesting inserts each one on the operator connection under a "
    "current exact-company preparation appointment, and its trigger refuses every update and delete. Every reader is "
    "on the operator connection: the award, vesting and grant paths for current exact-company register appointments, "
    "the company pack on both of its paths, and tokens/services/member_access.py own_record, through which "
    "MemberRecordViewSet shows a currently associated member their own vesting facts without the evidence.",
    "tokens_registerpausechange": "Private immutable company pause sources and retained authority evidence, "
    "served through current exact-company register authority.",
    "tokens_registerpausechangedecision": "Append-only personal company pause decisions served through "
    "their exact-company proposal.",
    "tokens_registercapitalincrease": "Private immutable company capital sources and retained authority files; "
    "current exact-company register readers receive the bounded projection and "
    "unsigned signatures require the consumed source.",
    "tokens_registercapitalincreasedecision": "Append-only personal company capital decisions served only through "
    "their exact-company capital instruction.",
    "wallets_walletpossessionproof": "Private append-only successful wallet signature proofs. Only the actual "
    "owned verification producer writes them; bounded own nominations consume exact current associations.",
    "whitelist_companywalletnomination": "Immutable explicit one-wallet participant sharing sources. Own "
    "request reads and exact-company register reads expose only their respective bounded projections.",
    "whitelist_companywalletinstruction": "Private immutable company wallet instructions and original target "
    "associations, served through current exact-company register authority and checked before new signatures.",
    "whitelist_companywalletinstructiondecision": "Append-only personal company wallet instruction decisions "
    "served only through their exact-company instruction.",
    "tokens_registerdeployment": "Immutable private company deployment sources, including captured wallet and "
    "actor associations. Current exact-company register readers receive only the bounded review projection "
    "through the operator connection; new signatures require the original consumed company approval.",
    "tokens_registerdeploymentdecision": "Append-only company deployment decisions, bound to personal company "
    "appointments and served through their exact-company deployment review.",
    "tokens_registerinstructiondecision": "Append-only company issue decisions bound to exact personal appointments "
    "and retained original issue sources, served through the bounded exact-company issue projection.",
    "tokens_registertransferdecision": "Append-only company decisions of exact non-paid direct register transfers, "
    "bound to current company appointments and read through their company-scoped transfer.",
    "tokens_registergrantdecision": "Append-only company decisions of non-paid register grants, bound to current "
    "company appointments and exact immutable commands, read through their company-scoped grant.",
    "tokens_registerevidence": "Immutable company-provided register evidence uploads. "
    "tokens/services/register_evidence.py retain_register_evidence inserts each one inside the bounded register "
    "command on the operator connection, and RegisterEvidenceViewSet returns the uploader only that row and lists "
    "nothing. Every reader is on the operator connection. Preparation commands use an upload only when the acting user "
    "uploaded it for the same company, but an award grant may cite its award's matching retained agreement. Pause and "
    "capital checks recheck it against its submitter, and the company pack and guard triggers read it. Its guard "
    "refuses every update and delete.",
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
    "tokens_registeracknowledgement": "Append-only acknowledgements of register reconciliation discrepancies, each "
    "bound to the acknowledging approval appointment. tokens/services/register_reconciliation.py "
    "acknowledge_discrepancy inserts them inside the bounded register command on the operator connection. Every reader "
    "is on that connection: register readers through RegisterReconciliationViewSet, the company pack on both of its "
    "paths, and later reconciliation runs.",
    "tokens_pausechange": "Immutable company pause executions and their outgoing outcomes. "
    "tokens/services/pause_changes.py admit_company inserts each one when a company applies a RegisterPauseChange "
    "inside the bounded register command on the operator connection. The pause workers sign, observe and project it "
    "there, and protect_pause_change refuses deletion. Every reader is on the operator connection, including "
    "RegisterPauseChangeViewSet's bounded receipt, the company pack and ShareTokenAdmin. ShareTokenViewSet's pause, "
    "unpause and pause_submission actions replay or find only issuer-authority rows, which the guard does not admit.",
    "tokens_shareissuanceexecution": "Immutable share issuance intents with their cancellation, retry authority and "
    "outgoing associations. tokens/services/issuance_execution.py admit_company inserts each one when a company "
    "applies a register issue or paid issue inside the bounded register command on the operator connection. Staff "
    "retry one, or cancel it on a refund, through the admin, the issuance workers execute and recover it, and "
    "protect_issuance_execution refuses deletion. Every reader is on the operator connection, including the bounded "
    "receipt for RegisterIssueViewSet and RegisterPaidIssueViewSet and the company pack.",
    "tokens_capitalincreaseexecution": "Immutable capital increase intents, exact retry authorization and original "
    "transaction attribution. tokens/services/capital_execution.py admit_company inserts each one when a company "
    "applies a RegisterCapitalIncrease inside the bounded register command on the operator connection. Staff retry a "
    "failed attempt through CapitalIncreaseAdmin, the capital workers execute and recover it, and "
    "protect_capital_execution refuses deletion. Every reader is on the operator connection, including "
    "RegisterCapitalIncreaseViewSet's bounded receipt and the company pack.",
    "tokens_tokendeployment": "Immutable deployment intents and company authority snapshots. "
    "tokens/services/deployment.py _admit inserts each one on the operator connection from the company's applied "
    "RegisterDeployment; the deployment and swap approval workers record outcomes there, and protect_token_deployment "
    "refuses deletion. Readers are on the operator connection, including RegisterDeploymentViewSet's bounded receipt "
    "and the company pack. tokens/services/settlement_context.py _deployment_chain_disagrees switches to that "
    "connection to compare the chain, including when TradingOrderViewSet.create_order on the app connection matches a "
    "swap.",
    "tokens_swapapprovalsubmission": "Immutable participant-signed approval bytes, their nonce and hash, and the "
    "receipt written once. The route records it through a bounded operator transaction before any send and the "
    "sweep replays it; the participant's own connection never reads a signed broadcast capability.",
    "whitelist_whitelistchange": "Immutable whitelist commands and their outgoing associations: company additions and "
    "removals inserted by whitelist/services/company_wallet_instructions.py _apply inside the bounded command on the "
    "operator connection, and automatic removals from the refresh worker. Workers execute and recover them there, and "
    "protect_whitelist_change refuses deletion. Every reader is on the operator connection, including "
    "CompanyWalletInstructionViewSet's receipt and CompanyWalletTargetViewSet, which shows current register readers "
    "their companies' confirmed or unchanged additions. WhitelistStatusView's public membership reads do not read it.",
    "whitelist_whitelisteligibilityinvalidation": "Retained account, identity and wallet invalidation facts and "
    "actual human or automatic attribution, written in the original bounded operator transaction. Only the "
    "invalidation worker reads these private cause records.",
    "documents_documentread": "Append-only administrative document read records, written on the operator "
    "connection and visible only to permitted platform reviewers. They contain UUIDs and reader IDs, not "
    "file names, extraction values or file contents, and outlive document content purges.",
    "tokens_registerexport": "Immutable records of who exported a share class's register or prepared an inspection "
    "copy, a certificate, notice figures or a company pack from it. ShareTokenViewSet's register export, inspection "
    "copy and certificate actions, the register outputs admin, MemberCertificateRequestViewSet.fulfil, the issuer's "
    "CompanyViewSet.pack and the company pack admin write them on the operator connection, where outputs_due, "
    "RegisterExportAdmin and the member certificate fulfilment trigger read them. tokens/services/former_holders.py "
    "purge_register_exports deletes them on the retention clock, except those a member certificate fulfilment is bound "
    "to.",
    "shareholders_publicationread": "Records of who opened a company's publication to its members, or a payment "
    "record's remittance evidence, holding UUIDs and reader IDs, not names, holdings or file contents. "
    "shareholders/services/publications.py record_publication_read writes them on the operator connection for "
    "PublicationViewSet.file and the publications admin, and a delivery whose read cannot be recorded is refused. "
    "PublicationReadAdmin and both company pack paths read them there, but CompanyViewSet.pack refuses any pack "
    "holding a publication. A worker deletes them on the seven-year clock.",
    "compliance_compliancealert": "Alerts about a user account, raised by the monitoring workers in "
    "compliance/tasks.py, by CryptoScreeningService when a screening scores medium or high, and by "
    "compliance/services/identity_screening.py raise_screening_alert for KYCAIDWebhookView. Staff work them, and may "
    "add or delete them, in ComplianceAlertAdmin. A customer's WalletViewSet.destroy clears the transaction an alert "
    "names through wallets/services/registration.py delete_wallet. Every writer and reader is on the operator "
    "connection. It carries user_account_id but no queryset scopes it, so a policy would be a new rule rather than a "
    "translation of one.",
    "compliance_transactionscreening": "Provider risk screenings of a recorded transaction. "
    "CryptoScreeningService.screen_transaction creates them in the screen_transaction worker, KYCAIDCryptoWebhookView "
    "records later provider results, and staff read and retry them, and may edit or delete them, in "
    "TransactionScreeningAdmin. A customer's WalletViewSet.destroy deletes those of the wallet's transactions through "
    "wallets/services/registration.py delete_wallet. Every writer and reader is on the operator connection. It carries "
    "user_account_id but no queryset scopes it, so a policy would be a new rule rather than a translation of one.",
    "compliance_alertproceduretemplate": "Operator-authored procedure text, the same for every tenant.",
    "compliance_alertprocedurestep": "A step of that operator-authored text, reached through its template.",
    "compliance_alertchecklistitem": "A checklist item recording one procedure step against an alert. No service, "
    "worker or seed creates them: staff add them in AlertChecklistItemAdmin and work them there or in the alert's "
    "admin inline, on the operator connection. They are deleted there or with their alert, procedure step or template, "
    "as when the sync_procedure_templates command removes an obsolete step, also on that connection.",
    "compliance_monitoringrule": "Operator-authored screening rules, the same for every tenant.",
    "blockchain_blockchaintransaction": "Records of the outgoing chain transactions the platform prepares and sends, "
    "keyed by transaction hash or, for an admitted swap, by the swap, not by any tenant. Every writer is on the "
    "operator connection; tokens/services/swap_execution.py submit_signature records an admitted swap inside "
    "participant_context during the app-connection TradingOrderViewSet.swap_sign. The execution receipts of register "
    "issues and paid issues, capital increases, deployments and company wallet instructions read them for customers on "
    "the operator connection. Nothing deletes them.",
    "tokens_mintrequest": "Staff mint requests for a settlement asset or a yield token, tied to that asset or token "
    "rather than to any tenant. Staff create, execute and reject them in the admin through "
    "tokens/services/mint_service.py, which refuses the app connection. tokens/tasks/mint_request.py "
    "recover_mint_requests resolves unresolved ones, and check_pending_transactions and the outgoing-history commands "
    "read them, all on the operator connection. Nothing deletes them.",
    "tokens_navupdate": "Staff-submitted NAV history for a yield token, tied to no tenant. YieldTokenAdmin submits it "
    "through tokens/services/nav.py submit, which refuses the app connection and requires an active staff member with "
    "tokens.change_yieldtoken. The workers in tokens/tasks/nav.py resolve unresolved updates, and the admin and the "
    "outgoing-history commands read it, all on the operator connection. The protect_nav_update trigger refuses every "
    "delete.",
    "tokens_yieldtoken": "Staff-configured yield tokens and their current NAV, tied to no share token and no tenant. "
    "Staff add, edit and delete them in YieldTokenAdmin, and tokens/services/nav.py updates the NAV, on the operator "
    "connection. The one app-connection read, recorded in REACHED_DESPITE_OPERATOR_ONLY, is "
    "assets/serializers/asset.py AssetSerializer._get_yield_token, which matches an active token by symbol for "
    "AssetViewSet and WalletViewSet holdings.",
}

NOT_TENANCY = {
    "assets_asset": "A global catalogue shared by every tenant; product filters select supported assets.",
    "feature_flags": "Global kill switches; enabled() selects the active flags for every tenant.",
    "whitelist_whitelistentry": "A wallet or treasury address that company registries can approve. That is "
    "authorisation rather than tenancy, so it stays in code. Entries are written on the operator connection, wallet "
    "deletion included. The only app-connection read is wallets/services/holdings.py approved_share_assets, for the "
    "caller's own wallet during a wallet sync. require_stablecoin_approvals reads them on the operator connection and "
    "tells a sender only which side lacks a live approval. Company register reads and packs identify holders from them "
    "on the operator connection, through whitelist/services/identity.py identities_for.",
    "whitelist_whitelistapproval": "One whitelist entry's approval in one company's registry. That is authorisation "
    "rather than tenancy, so it stays in code. Approvals are written on the operator connection, including the cascade "
    "when a customer deletes a wallet. The only app-connection read is wallets/services/holdings.py "
    "approved_share_assets, for the caller's own wallet during a wallet sync. require_stablecoin_approvals reads them "
    "on the operator connection and tells a sender only which side lacks a live approval. Company register reads and "
    "packs show readers that company's own approvals on the operator connection.",
    "signing_challenges": "Single-use order signing challenges, each bound to its wallet by the "
    "signing_challenges_wallet_is_checked trigger. The app connection inserts them in "
    "tokens/services/trading_order_create.py issue_order_submission and tokens/services/order_actions.py "
    "issue_order_action, and execute_order_action first reads one there by digest and checks it against the caller's "
    "own action and wallet. Spending, matching, the order book, market summaries and purging use the operator "
    "connection. A wallet policy would refuse the same requests the service already refuses.",
    "asset_chain_deployments": "Part of the asset catalogue.",
    "asset_snapshots": "Price history for the catalogue, identical for every tenant.",
    "assets_exchangerate": "Published rates, identical for every tenant.",
    "shared_country": "A reference list of countries, identical for every tenant.",
    "operators_operator": "A singleton naming the operator of this deployment.",
    "operators_operator_supported_settlement_assets": "Which assets that singleton settles in.",
    "offerings_offering_documents": "A link row between an offering and a company document. Nothing scopes it, so a "
    "policy would be a new rule, and nothing on the app connection reads or writes it (#1132). OfferingViewSet "
    "attaches and returns documents on the operator connection for offerings of companies the caller owns. The "
    "directory's document reads in offerings/services/documents.py join it there, bounded to offerings resolved as "
    "published under the app role. Eligibility request previews and submissions in "
    "users/services/company_eligibility.py show investors an approved offering's document UUIDs, read on the operator "
    "connection.",
    "offerings_offering_settlement_assets": "A link row naming which catalogue assets an offering accepts for "
    "settlement. Nothing scopes it, so a policy would be a new rule, and nothing on the app connection reads or writes "
    "it (#1132). OfferingViewSet sets and returns them on the operator connection for offerings of companies the "
    "caller owns. Eligibility request previews and submissions in users/services/company_eligibility.py show investors "
    "an approved offering's settlement asset UUIDs, read on the operator connection.",
    "portfolios_wallets": "A link row between a scoped portfolio and a scoped wallet, reached through either, "
    "and revealing nothing that reading both of those tables would not.",
}

REACHED_DESPITE_OPERATOR_ONLY = {
    "tokens_yieldtoken": "assets/serializers/asset.py AssetSerializer._get_yield_token reads it for every asset a "
    "customer lists, to answer nav_per_token and last_nav_update. It is filtered by symbol and not by any principal.",
}

UNSCOPED = {**FRAMEWORK, **OPERATOR_ONLY, **NOT_TENANCY, **AWAITING_RLS}
