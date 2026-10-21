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
    "authentication_customuser": "The user table itself. A principal is a row here, so scoping it by the "
    "principal would make authentication depend on the answer it is trying to produce.",
    "django_session": "Session rows keyed by a cookie rather than a user and loaded lazily inside a view. The admin "
    "reads and writes them on the operator connection; the LoginView and LogoutView of rest_framework.urls, at "
    "api-auth/, write and delete them on the app connection before any principal exists. API views authenticate "
    "by token and never load them.",
    "token_blacklist_outstandingtoken": "Issued refresh tokens, read during authentication, before a "
    "principal exists.",
    "token_blacklist_blacklistedtoken": "Revoked refresh tokens, read during authentication for the same reason.",
    "procrastinate_jobs": "The worker queue. The worker uses procrastinate's own operator-alias connection, and "
    "staff read it in admin on the operator connection. Producers enqueue through shared/tasks/queue.py defer "
    "on their current or captured Django alias: transactional producers share that transaction, while deliberate "
    "on_commit callbacks enqueue after its commit using the captured alias. Company and execution commands defer "
    "on the operator connection; producers acting for a user defer on the app connection.",
    "procrastinate_events": "Worker job history, inserted by procrastinate's triggers on procrastinate_jobs as "
    "whichever role changes the job, so the app role writes it whenever it defers.",
}

OPERATOR_ONLY = {
    "tokens_registermemberdocument": "Append-only company-private shareholder and share-class document links. "
    "Current exact-company register readers list and download them through register_member_document views on the "
    "operator connection. Bounded prepare commands add links, and exact applied opening records retain their links; "
    "neither public nor member projections expose the files.",
    "tokens_classrightsrevision": "Append-only company-supplied class-rights descriptions. Current exact-company "
    "register readers read them through the class-rights action and permitted company-pack exports; the bounded "
    "producer requires a current personal ADMIN appointment and retains actor, time and exact revision history. "
    "They are not included in market, directory or member projections.",
    "auth_group": "Django's own permission grouping.",
    "auth_permission": "Django's own permission rows, one per model and action.",
    "django_admin_log": "The admin's audit trail, written and read on the operator connection only.",
    "django_content_type": "Django's model registry.",
    "procrastinate_periodic_defers": "Worker schedule bookkeeping, with no tenant in it at all.",
    "procrastinate_workers": "Worker registration rows, one per running worker process.",
    "auth_group_permissions": "Django's own permission plumbing, joining a group to a permission.",
    "authentication_customuser_groups": "Django's own permission plumbing, joining a user to a group.",
    "authentication_customuser_user_permissions": "Django's own permission plumbing, per-user grants.",
    "offerings_offering_documents": "A link row reached through its offering, which is scoped, and from the "
    "document side by companies/services/documents.py delete_document. Nothing scopes this table today, so a "
    "policy here would be a new rule rather than a translation of one. Every reader and writer runs on the "
    "operator connection, including OfferingViewSet's actions, delete_document, the offering and company document "
    "admins, the eligibility SQL, and the directory's document read, which joins it only after resolving the "
    "published offerings under the app role and bounds the join to them.",
    "offerings_offering_settlement_assets": "A link row from a scoped offering to the global asset catalogue, "
    "reached from the offering and only on the operator connection.",
    "companies_companysignuptermsacceptance": "Immutable current signup Terms receipts bound to one company, "
    "appointment and appointee. The bounded acceptance command writes them on the operator connection, and own "
    "appointment serialization reads only that appointee's exact receipt on that connection. The app role has "
    "no grants and forced row-level security admits no direct rows.",
    "tokens_membercertificatefulfilment": "Immutable private recipient-only certificates served through current "
    "own association or personal company register appointment, with original producing authority and export.",
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
    "tokens_registeragreement": "Retained private external agreements served through current exact-company "
    "register appointments and the staff company pack, CompanyPackAdmin.produce.",
    "tokens_registercontribution": "Immutable company-recorded AUD receipts served through current "
    "exact-company register appointments and the staff company pack; the stored register reads them only to "
    "confirm each allotment's amount paid.",
    "tokens_registerallotment": "Exact fully paid external allotments, served through current exact-company "
    "register appointments and the staff company pack. Applying one records its shares in the register and, for a "
    "new member, copies its name and address into the member's particulars; of the rows themselves, only the "
    "consideration, as each member's amount paid, and the event date reach the wider register outputs.",
    "tokens_registerallotmentdecision": "Append-only attributable company allotment decisions "
    "reached through their private parent.",
    "tokens_registeraward": "Immutable private company employee awards, carrying the recipient's name and address "
    "and the agreement file, written only by tokens/services/register_awards.py record_award. Current "
    "exact-company register appointments read them; the recipient's current own member association reads its own "
    "award terms and quantities, and an award-only member's recorded identity, through "
    "tokens/services/member_access.py own_record; and permitted staff copy them into a company pack through "
    "CompanyPackAdmin.produce. All of it runs on the operator connection.",
    "tokens_registerawardend": "Append-only company entitlement endings and private evidence, written only by "
    "record_award_end under an exact company appointment. Current exact-company register appointments read them; "
    "the recipient's current own member association reads its own endings, without the evidence, through "
    "own_record; and permitted staff copy them into a company pack through CompanyPackAdmin.produce. All of it "
    "runs on the operator connection.",
    "tokens_registerawardvestingreversal": "Append-only referenced vesting reversals and private evidence, written "
    "only by record_award_vesting_reversal under an exact company appointment, and read like the award endings.",
    "tokens_registerawardvesting": "Append-only company-confirmed vesting facts and private evidence, written only "
    "by record_award_vesting. Current exact-company register appointments read them; the recipient's current own "
    "member association reads its own vesting shares and dates, without the evidence, through own_record; and "
    "permitted staff copy them into a company pack through CompanyPackAdmin.produce. All of it runs on the "
    "operator connection.",
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
    "tokens_registerevidence": "Immutable company-provided register evidence uploads, written only by "
    "tokens/services/register_evidence.py retain_register_evidence in the bounded register command on the operator "
    "connection. The upload route returns only the uploader's own row; company-private shareholder attachments list "
    "their retained metadata and download through their exact record links. The "
    "uploader's own prepare commands accept them through own_evidence_bytes, and grant preparation also accepts an "
    "award's retained agreement evidence. Action-specific proposals, agreements, receipts, awards, vestings, endings "
    "and reversals keep their own copies; shareholder attachments retain immutable links to the original file. "
    "The pause and capital _state checks, run for their proposals "
    "and execution workers, re-read the original, and the company pack and staff admin pages read the rows through "
    "the records that cite them, all on the operator connection.",
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
    "tokens_registeracknowledgement": "Append-only acknowledgements of register reconciliation discrepancies, "
    "written only by tokens/services/register_reconciliation.py acknowledge_discrepancy in the bounded register "
    "command on the operator connection, each bound to the acknowledging appointment. Register readers read them "
    "through the reconciliation on the operator connection; later reconciliation runs and the company pack read a "
    "class's acknowledgements there directly.",
    "tokens_pausechange": "Company pause executions with immutable identity, authority and intent, and their "
    "original outgoing outcomes. Only tokens/services/pause_changes.py admit_company inserts them, when a company "
    "pause decision is applied on the operator connection, retaining exact authority and job; the insert guard "
    "refuses any other source. The pause worker, through tokens/services/pause_recovery.py recover, then moves each "
    "row's status forward and records its operation, observation and completion once. The worker, the register "
    "pause routes, the share token admin and the company pack read them on the operator connection.",
    "tokens_shareissuanceexecution": "Immutable company-admitted share issuance intent from the exact applied "
    "register issue or paid issue, queued cancellation, staff retry of an existing row and protected outgoing "
    "associations. Customer paths retain public request state; the register issue routes and the company pack read "
    "the record on the operator connection.",
    "tokens_capitalincreaseexecution": "Immutable company-admitted capital increase intent from the exact applied "
    "register capital increase, staff retry of an existing row and original transaction attribution. The register "
    "capital routes and the company pack read it on the operator connection; the CapitalIncreaseViewSet request "
    "list never does.",
    "tokens_tokendeployment": "Immutable deployment intent and applying principal copied from the company's applied "
    "register deployment, written through a bounded operator journal. A deployment's share token lifecycle writes "
    "run on the operator connection too.",
    "tokens_swapapprovalsubmission": "Immutable participant-signed approval bytes, their nonce and hash, and the "
    "receipt written once. The route records it through a bounded operator transaction before any send and the "
    "sweep replays it; the participant's own connection never reads a signed broadcast capability.",
    "whitelist_whitelistchange": "Company-instructed and eligibility-invalidation whitelist commands, whose terms "
    "are fixed at insert and whose status only moves forward, with their outgoing-operation associations. Company "
    "register readers see their own targets on the operator connection; public membership reads never read this "
    "recovery journal.",
    "whitelist_whitelisteligibilityinvalidation": "Retained account, identity and wallet invalidation facts and "
    "actual human or automatic attribution, written in the original bounded operator transaction. Only the "
    "invalidation worker reads these private cause records.",
    "documents_documentread": "Append-only administrative document read records, written on the operator "
    "connection and visible only to permitted platform reviewers. They contain UUIDs and reader IDs, not "
    "file names, extraction values or file contents, and outlive document content purges.",
    "tokens_registerexport": "Immutable records of who exported a share class's register or prepared an inspection "
    "copy, a certificate, notice figures or a company pack from it. Every writer is on the operator connection: "
    "tokens/services/register.py export_rows, prepare_inspection_copy and prepare_certificate for ShareTokenViewSet's "
    "register_export, register_inspection_copy and register_certificate actions; prepare_notice_figures for the "
    "register outputs admin; tokens/services/member_certificates.py fulfil_member_certificate for "
    "MemberCertificateRequestViewSet.fulfil; and tokens/services/company_pack.py _record for the issuer's "
    "CompanyViewSet.pack through tokens/services/company_pack_outputs.py prepare_company_pack and for "
    "CompanyPackAdmin.produce through produce_company_pack. The readers are on the same connection: "
    "tokens/services/register.py outputs_due, which finds the certificates and notice figures still owed for the "
    "register outputs admin and for _build_company_pack on both company pack paths; RegisterExportAdmin for staff; "
    "and the trigger function tokens_guard_member_certificate_fulfilment, which checks the export a member "
    "certificate is bound to. Only tokens/services/former_holders.py purge_register_exports deletes them, on the "
    "retention clock, and it keeps every export bound to a member certificate fulfilment.",
    "shareholders_publicationread": "Append-only records of who opened a publication a company made to its "
    "members, or the remittance evidence of one of its payment records, written on the operator connection by "
    "the delivery service for the publication file route and the publications admin, and read only by permitted "
    "staff, including as per-publication counts in the staff company pack; only the retention purge deletes them. "
    "They carry UUIDs and reader IDs, not names, holdings or file contents, and a delivery whose read cannot be "
    "recorded is refused rather than served.",
    "compliance_compliancealert": "Raised automatically by the screening, monitoring and periodic review tasks and "
    "the KYCAID webhooks, or by compliance staff, and worked by staff in admin, all on the operator connection. It "
    "carries user_account_id but no queryset scopes it, so a policy would be a new rule rather than a "
    "translation of one.",
    "compliance_transactionscreening": "Created by the screening worker and updated by the KYCAID crypto webhook "
    "and staff in admin: the same connection and the same reason.",
    "compliance_alertproceduretemplate": "Operator-authored procedure text, the same for every tenant.",
    "compliance_alertprocedurestep": "A step of that operator-authored text, reached through its template.",
    "compliance_alertchecklistitem": "A checklist item staff add and work against an alert in admin, with no tenant "
    "but the alert's.",
    "compliance_monitoringrule": "Operator-authored screening rules, the same for every tenant.",
    "blockchain_blockchaintransaction": "A record of a transaction the platform signer admits or signs, identified "
    "by uuid and by the record it belongs to, with a unique transaction hash once signed, rather than by any tenant. "
    "Workers write most rows; TradingOrderViewSet.swap_sign and the mint admin views write them inside a request, "
    "on the operator connection.",
    "tokens_mintrequest": "A staff mint of a settlement stablecoin or a yield token, created and executed in admin "
    "and recovered by the mint worker, for a global asset or yield token with no tenant.",
    "tokens_navupdate": "Staff-submitted NAV history for a yield token with no tenant, applied in the "
    "YieldTokenAdmin request or, when staff choose on-chain execution, executed by the NAV worker.",
    "tokens_yieldtoken": "Standalone yield token configuration with no share token relation, matched to its "
    "catalogue asset by symbol.",
}

NOT_TENANCY = {
    "assets_asset": "A global catalogue shared by every tenant; product filters select supported assets.",
    "feature_flags": "Global kill switches; enabled() selects the active flags for every tenant.",
    "whitelist_whitelistentry": "A wallet's whitelist identity. Company wallet instructions, staff sync and the "
    "admin write it and wallet deletion removes it, all on the operator connection, where eligibility invalidation "
    "and the register identity and output paths read it. Who may act is authorisation enforced in code rather "
    "than tenancy. On the app connection it is read only beneath whitelist_whitelistapproval in "
    "wallets/services/holdings.py approved_share_assets.",
    "whitelist_whitelistapproval": "Each whitelist entry's approval in one company's registry, written and mostly "
    "read like the entry it belongs to, so authorisation rather than tenancy, and it stays in code. The app "
    "connection reads it once: wallets/services/holdings.py approved_share_assets, while syncing the caller's own "
    "wallet through WalletViewSet.sync or the sync_wallet task acting for that user, takes only the ids of the "
    "companies with an approval row for that wallet to choose which share classes to discover. Deleting a wallet "
    "cascades into these rows on the operator connection.",
    "signing_challenges": "Reached by digest in the signing-challenge and trading services rather than by any "
    "queryset that scopes it; #256 deleted the two methods that looked like scoping. On the app connection "
    "tokens/services/signing_challenge.py issue_challenge inserts each challenge for a wallet the caller is "
    "authorised to use, which the trigger signing_challenges_wallet_is_checked requires to be present and to match "
    "the address and order, and consume_challenge refuses a challenge not bound to the action or submission the "
    "caller is authorised for; every other read, update and delete runs on the operator connection. A wallet-owner "
    "policy would therefore change no current app-role allow or refuse outcome, which is a reason to leave it "
    "rather than an absence of one. That agreement ends if an app-connection read stops binding the challenge to "
    "the caller's authorised action, submission or order, or a view or serializer exposes the table.",
    "asset_chain_deployments": "Part of the asset catalogue.",
    "asset_snapshots": "Price history for the catalogue, identical for every tenant.",
    "assets_exchangerate": "Published rates, identical for every tenant.",
    "shared_country": "A reference list of countries, identical for every tenant.",
    "operators_operator": "A singleton naming the operator of this deployment.",
    "operators_operator_supported_settlement_assets": "Which assets that singleton settles in.",
    "portfolios_wallets": "A link row between a scoped portfolio and a scoped wallet, reached through either, "
    "and revealing nothing that reading both of those tables would not.",
}

REACHED_DESPITE_OPERATOR_ONLY = {
    "tokens_yieldtoken": "assets/serializers/asset.py AssetSerializer._get_yield_token reads it for every asset a "
    "customer lists, to answer nav_per_token and last_nav_update. It is filtered by symbol and not by any principal.",
}

UNSCOPED = {**FRAMEWORK, **OPERATOR_ONLY, **NOT_TENANCY, **AWAITING_RLS}
