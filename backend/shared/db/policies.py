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
ADMINISTRABLE_COMPANIES = "app_company_administration_ids"
DISCOVERABLE_COMPANIES = "app_company_discovery_ids"
ELIGIBILITY_COMPANIES = "app_company_eligibility_ids"


def on_the_market(prefix: str = "") -> str:
    return f"{prefix}status = 'deployed' AND length({prefix}contract_address) > 0"


ON_THE_MARKET = on_the_market()

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
    DISCOVERABLE_COMPANIES: f"SELECT uuid FROM companies_company WHERE {ADMITTED} AND {HAS_A_TOKEN_ON_THE_MARKET}",
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


def _owned_through_the_profile(table):
    return f"{table}.user_profile_id IN (SELECT {PRINCIPAL_PROFILES}())"


def _owned(column):
    return f"{column} IN (SELECT {PRINCIPAL_ACCOUNTS}())"


def _company(column, helper):
    return f"{column} IN (SELECT {helper}())"


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
    "users_userprofile": (f"user_id = {PRINCIPAL}", f"user_id = {PRINCIPAL}"),
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
    "customer_accounts_account": (OWNS_THE_ACCOUNT, OWNS_THE_ACCOUNT),
    "wallets": (_owned("user_account_id"), _owned("user_account_id")),
    "transactions": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_walletsubmission": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_bitcoinsubmission": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_bitcoinsubmissioninput": (_owned("user_account_id"), _owned("user_account_id")),
    "wallets_walletchainwatch": (_owned("user_account_id"), "false"),
    "wallets_walletchainobservation": (_owned("user_account_id"), "false"),
    "portfolios": (_owned("user_account_id"), _owned("user_account_id")),
    "users_investorclassification": (_owned("user_account_id"), _owned("user_account_id")),
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
    "tokens_sharetoken": (
        f'{_company("company_id", VISIBLE_COMPANIES)} OR ({ON_THE_MARKET})',
        _company("company_id", MANAGEABLE_COMPANIES),
    ),
    "tokens_capitalincreaserequest": (
        _company("company_id", VISIBLE_COMPANIES),
        "false",
    ),
    "tokens_shareissuancerequest": (
        _company("company_id", VISIBLE_COMPANIES),
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
    "tokens_registerparticularschange": (_company("company_id", VISIBLE_COMPANIES), "false"),
    "tokens_importedformermember": ("token_id IN (SELECT token_id FROM tokens_shareregister)", "false"),
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
        "The exact known active issuer resolves without a company directory. The operator "
        "validates only the actual participant's source and exact command. Current personal prepare or approve "
        "appointments admit deliberately shared records through a UUID-only definer and immutable parent joins; "
        "no source, identity, financial file or private document policy is expanded.",
    ),
    "Public company discovery": (
        "shared/db/policies.py companies_company read policy through app_company_discovery_ids",
        "The fixed-search-path definer returns only company UUIDs for a non-null principal and the existing "
        "deployed/nonempty-address market term. It stops company-token policy recursion "
        "without admitting private company documents, profiles or basic administration.",
    ),
    "Current personal company administration": (
        "companies/querysets/company.py administrable_by; companies/services/administration.py company_contact",
        "The principal-bound definer returns only company UUIDs for current personal admin appointments or genuine "
        "unrooted owner drafts. It sees retained initial and legacy roots regardless of their RLS visibility. Basic "
        "responses expose only the existing contact name and email, without admitting raw profiles or accounts.",
    ),
    "Market prices for already admitted tokens": (
        "tokens/services/market_data_service.py market_summaries; "
        "tokens/services/trading_order_service.py get_order_book",
        "The operator publishes only price summaries, the last trade's public amounts and aggregated "
        "order-book levels for tokens already admitted under issuer ownership or investor eligibility. "
        "Lists resolve their page under the app role before one operator query bounded to those UUIDs. "
        "No order, wallet or counterparty identity is returned, and their RLS policies remain unchanged.",
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
    "ShareToken.deployed_with_contract": (
        "tokens/services/market_data_service.py list_market_tokens, for TradingTokenViewSet in "
        "tokens/views/trading_token.py and streamable_token_uuid in tokens/services/trading_events.py; "
        "tokens/services/share_token_service.py get_wallet_token_balances",
        "tokens_sharetoken: the market predicate",
    ),
}

PUBLIC_TERM = {
    "tokens_sharetoken": "The secondary market is deployed_with_contract(), and no automated test covers that "
    "market read. The owner term admits only the classes of the principal's own companies, so alone it hides "
    "every deployed token from an investor - the second term has to be on the token's own columns. It is the "
    "exact dual of HAS_A_TOKEN_ON_THE_MARKET on companies_company: a company is visible because a token of its "
    "is on the market, and that token is visible because it is on the market. Remove either and R13's closure "
    "between the two tables fails, which is why it holds by construction rather than by luck. The market term "
    "reads only this table's own columns and the owner term goes through the app_visible_company_ids definer, so "
    "the policy forms no cycle with the company term that reads it.",
    "companies_company": "Public discovery preserves companies with a deployed token carrying a nonempty "
    "contract address. Secondary-market joins require these parents independently of private basic "
    "administration. The fixed-search-path discovery definer returns "
    "only company UUIDs under an admitted principal; its token check avoids the Company-to-token-to-invoker "
    "owner-helper policy cycle. Current personal administration and genuine unrooted draft setup use their "
    "separate UUID helper, while customer basic selectors remain narrower than public discovery.",
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
    "tokens_registerpersonregistration": "Append-only company-person registration provenance, with no share effect. "
    "Exact-company reader and prepare commands retain current personal authority, actor and initial particulars; "
    "the app role receives no direct table grant.",
    "tokens_registermemberdocument": "Append-only company-private shareholder and share-class document links. "
    "Current exact-company register readers list and download them through register_member_document views on the "
    "operator connection. Bounded prepare commands add links, and exact applied opening records retain their links; "
    "neither public nor member projections expose the files.",
    "tokens_classrightsrevision": "Append-only company-supplied class-rights descriptions. Current exact-company "
    "register readers read them through the class-rights action and permitted company-pack exports; the bounded "
    "producer requires a current personal ADMIN appointment and retains actor, time, exact revision history and "
    "linked class-document snapshots. Private downloads require an exact readable class and retained revision link. "
    "They are not included in market or member projections.",
    "auth_group": "Django's own permission grouping.",
    "auth_permission": "Django's own permission rows, one per model and action.",
    "django_admin_log": "The admin's audit trail, written and read on the operator connection only.",
    "django_content_type": "Django's model registry.",
    "procrastinate_periodic_defers": "Worker schedule bookkeeping, with no tenant in it at all.",
    "procrastinate_workers": "Worker registration rows, one per running worker process.",
    "auth_group_permissions": "Django's own permission plumbing, joining a group to a permission.",
    "authentication_customuser_groups": "Django's own permission plumbing, joining a user to a group.",
    "authentication_customuser_user_permissions": "Django's own permission plumbing, per-user grants.",
    "companies_companysignuptermsacceptance": "Immutable current signup Terms receipts bound to one company, "
    "appointment and appointee. The bounded acceptance command writes them on the operator connection, and own "
    "appointment serialization reads only that appointee's exact receipt on that connection. The app role has "
    "no grants and forced row-level security admits no direct rows.",
    "tokens_memberinvitation": "Immutable intended-recipient company member invitations issued by current "
    "ADMIN appointments.",
    "tokens_memberassociation": "Exact signed-in user/account member associations served only through "
    "bounded own or company projections.",
    "tokens_memberassociationrevocation": "Append-only exact company administration ending member access "
    "without deleting attribution.",
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
    "connection. Class-document uploads require ADMIN; other kinds require preparation authority. "
    "The upload route returns only the uploader's own row; company-private shareholder and class attachments list "
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
    "tokens_registerparticularschangedecision": "Retained company approvals, applications and rejections of "
    "member particulars changes from before the one-step edit, each bound to the deciding appointment. The database "
    "refuses every new or changed row. Register readers see them through the change on the operator connection.",
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
    "register issue, staff retry of an existing row and protected outgoing associations. Customer paths retain "
    "public request state; the register issue routes and the company pack read the record on the operator "
    "connection.",
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
    "tokens_registerexport": "Immutable records of who prepared an inspection copy, a certificate, notice figures or a "
    "company pack from a share class's register; register CSV exports made before that download was removed remain "
    "as retained records. Each records in produced_through whether the company's pages or platform admin produced "
    "it. Every writer is on the operator connection: tokens/services/register.py "
    "prepare_inspection_copy and prepare_certificate for ShareTokenViewSet's register_inspection_copy and "
    "register_certificate actions; prepare_notice_figures for the register outputs admin; "
    "and tokens/services/company_pack.py _record for the issuer's "
    "CompanyViewSet.pack through tokens/services/company_pack_outputs.py prepare_company_pack and for "
    "CompanyPackAdmin.produce through produce_company_pack. The readers are on the same connection: "
    "tokens/services/register.py outputs_due, which finds the certificates and notice figures still owed for the "
    "register outputs admin and for _build_company_pack on both company pack paths; RegisterExportAdmin for staff; "
    "tokens/services/output_history.py inspection_copy_history and company_pack_history for "
    "ShareTokenViewSet.register_inspection_copies and CompanyViewSet.packs, which list to a company's current "
    "register readers or administrators only the inspection copies and packs whose produced_through records the "
    "company's own pages, never one produced in platform admin. Only tokens/services/former_holders.py "
    "purge_register_exports deletes them, on the retention clock.",
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
