# Backend

[Engineering](README.md) · [Documentation](../README.md)

Where backend code belongs, the rules it follows, and how the Django API implements company
workflows, offerings, identity providers and notifications, for engineers changing `backend/`.
Request and response shapes are in the [OpenAPI schema](../../backend/schema/openapi.json); this
page keeps what the schema cannot express and links each business rule.

- [Backend apps](#backend-apps)
- [Backend layers](#backend-layers)
- [Backend rules](#backend-rules)
- [Admin row actions](#admin-row-actions)
- [External API consumers](#external-api-consumers)
- [Migrations](#migrations)
- [Company workflow API](#company-workflow-api)
- [Company identifiers](#company-identifiers)
- [Offerings and subscriptions](#offerings-and-subscriptions)
- [Identity providers](#identity-providers)
- [Notifications](#notifications)

## Backend apps

One Django app per bounded concern. `backend/ledova_backend/settings/` is a package of per-concern
modules re-exported by `settings/__init__.py`.

| App              | Owns                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`      | The single `Operator` configuration row, `GET /api/operator/` (that configuration, read by signed-in clients), and the operator console: `worklist()` and `configuration_health()` rendered by `OperatorAdmin.changelist_view`                                                                              |
| `authentication` | `CustomUser`, the `AuthViewSet`, JWT sessions, email verification codes                                                                                                                                                                                                                                     |
| `users`          | Profiles, accounts, preferences (the transaction-alerts switch, on one `UserPreferences` row), financial profiles, device tokens, notifications, classification sources, and company eligibility requests and decisions                                                                                     |
| `companies`      | `Company`, its activation, `CompanyDocument`, representative-authority request, appointment, invitation, signup-terms and retained revocation records, and the staff company-pack page                                                                                                                      |
| `tokens`         | `ShareToken`, `ShareIssuanceRequest`, `ShareIssuance`, `CapitalIncreaseRequest`, `MintRequest`, `YieldToken`, the stored register with its company decision records, employee award and vesting records, external capital and allotment records, member access and register outputs, and the trading models |
| `shareholders`   | `Publication`, the `PublicationRecipient` roll frozen at a record date with each entitlement, the `PublicationRead` audit, and the `PublicationEvent` chain of a resolution's ballots and close and of a distribution's payment records                                                                     |
| `offerings`      | `Offering`, `Subscription`, their review and payment lifecycles, allotment, and the eligibility-gated investor directory at `/api/v1/directory/`                                                                                                                                                            |
| `whitelist`      | `WhitelistEntry`, the per-company `WhitelistApproval` mirror, `WhitelistChange` commands, wallet nominations and company wallet instructions, and the sync from each company's registry                                                                                                                     |
| `wallets`        | `Wallet`, `Holding`, `Transaction`, balance sync and transfer confirmation                                                                                                                                                                                                                                  |
| `assets`         | `Asset`, `AssetChainDeployment`, `AssetSnapshot`, `ExchangeRate`, price sync, asset identity                                                                                                                                                                                                                |
| `portfolios`     | `Portfolio` and its owner-scoped routes                                                                                                                                                                                                                                                                     |
| `blockchain`     | `BlockchainTransaction` and transaction monitoring; the durable outgoing-signing foundation (`SigningAccount`, `OutgoingOperation`, `SignedAttempt`) and its immutable history inventory (`OutgoingHistoryCapture`, `OutgoingHistoryEvidence`, `OutgoingCutoverHold`)                                       |
| `compliance`     | Monitoring rules, alerts, procedure templates, risk assessments                                                                                                                                                                                                                                             |
| `documents`      | Uploaded documents and their extraction records                                                                                                                                                                                                                                                             |
| `integrations`   | Chain client, KYC providers, Alchemy, CoinGecko, Blockstream, ABR company registry, LLM document extraction, SendGrid, Expo push, Transak                                                                                                                                                                   |
| `feature_flags`  | `FeatureFlag` and the trading middleware                                                                                                                                                                                                                                                                    |
| `shared`         | Base model, country lookup, health-check middleware, PostgreSQL connection and principal helpers, the policy catalogue and database setup, private storage and upload validation, the task catalogue, seeds and the backend test suite                                                                      |

Signing admission, locking and history are in [chain](chain.md).

## Backend layers

Most apps are laid out as `models/ querysets/ serializers/ services/ views/ tasks/ admin/`, taking
only the layers they need: `operators/` is flat modules, `integrations/` only `admin.py` (the rest
is one subpackage per provider), and `blockchain/`, `compliance/`, `feature_flags/` and `shared/`
are partial. Add a layer only when a second caller needs the same logic.

`offerings/` is the reference app. Where a rule and a file disagree, the rule wins and the file is
the backlog. [The layer gate](gates.md#the-layer-gate) enforces the table.

| Layer          | Owns                                                                                                                                                                                                                       | Never contains                                                                                        | Reference                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `models/`      | Fields, `TextChoices`, constraints, `__str__`, properties over own fields, single-row transitions (guard, set fields, `save(update_fields=...)`, at most about ten lines, raising the app's `APIException` on a bad state) | Queries on other models, multi-step workflows, external I/O                                           | `offerings/models/offering.py`           |
| `querysets/`   | Every reusable query: product selectors, status filters, `select_related` bundles, annotations, aggregates; wired with `objects = XQuerySet.as_manager()`                                                                  | Saves, side effects, calls into services                                                              | `offerings/querysets/offering.py`        |
| `services/`    | Orchestration across models, external I/O (chain, KYC, email), `shared.db.atomic` and `select_for_update`; the one place a multi-model workflow lives. Plain module-level `verb_noun` functions, named after the noun      | HTTP objects, serializers, `Response`                                                                 | `offerings/services/subscription.py`     |
| `serializers/` | JSON shape and input validation; writable FKs constrained in `get_fields()` by policies and product selectors                                                                                                              | Business rules, locking, queries beyond FK scoping                                                    | `offerings/serializers/subscription.py`  |
| `views/`       | Permissions, `scoped_model` plus product filtering in `narrow()`, serializer choice, one service call, `Response`                                                                                                          | Raw `.objects.filter`, try/except that re-wraps an `APIException`, log lines that restate the request | `offerings/views/subscription.py`        |
| `tasks/`       | `@app.task` / `@app.periodic`: load the row by uuid, call one service, return a dict                                                                                                                                       | Orchestration, state machines                                                                         | `users/tasks/retention.py`               |
| `admin/`       | Registration, list/search/filter, operator actions that call the same model transition or service the API calls                                                                                                            | A second implementation of a workflow, HTML badge builders                                            | `users/admin/investor_classification.py` |

One exception to plain-function services: the chain clients under `integrations/` stay classes
because they hold a connection. A class whose methods are all `staticmethod` is a module spelled
awkwardly: do not add one.

### When not to add a layer

- A service method with one caller that only forwards to the ORM: put the query in `querysets/`
  and call it from the view.
- A queryset method with one call site: inline the filter.
- A base class or mixin for one subclass; an exception class for one raise that DRF already
  covers; a manager for a queryset.
- A task that is never deferred; a periodic task for a one-off backfill (use a management command
  or the shell).
- A model, column or endpoint that records data nothing reads.

## Backend rules

- Services orchestrate, views adapt HTTP and querysets own reusable queries; new or touched
  service modules use plain functions ([the layer gate](gates.md#the-layer-gate)).
- Use `shared.db.atomic` and `shared.db.on_commit` with an explicitly selected connection
  ([the connection-binding gate](gates.md#the-connection-binding-gate)).
- No Django signals except the private-file lifecycle receivers that `shared/apps.py` connects
  from `shared/storage.py`: `post_delete` deletes a private file once its row is gone, and
  `pre_delete` protects a conditionally retained file. A cascade delete (a company's or a user's
  documents) never reaches a service, so an explicit call in each delete path cannot cover it.
- No new manager packages. `CustomUserManager` is the existing exception; querysets use
  `as_manager()`.
- Keep raised exceptions in the app's `exceptions.py` and use DRF's standard exceptions for
  ordinary validation, permission and not-found errors. Preserve actionable API messages.
- Never return raw provider exception text
  ([the error body gate](gates.md#the-error-body-gate)).
- Bind loggers with `logging.getLogger(__name__)`, log operational errors in services and tasks
  rather than duplicate request lines in views, and log IDs instead of email, password or token
  values or whole bodies ([the logging privacy gate](gates.md#the-logging-privacy-gate)).
- Declare the response schema at every routed method
  ([the schema response gate](gates.md#the-schema-response-gate)).
- Test helpers never override reserved `TestCase` methods
  ([the test shadowing gate](gates.md#the-test-shadowing-gate)).
- Keep `TextChoices` beside their model and numeric thresholds in app constants.
- Paged lists return 25 rows at a time, and `page_size` asks for up to 100
  (`shared/api/pagination.py`). A search built with `every_word` (`shared/api/search.py`), so far an
  offering's applications, matches every word, ignoring case; the older `search` filters on
  companies, share classes, transfer orders, capital increases and assets match the whole text.
- JSON is camel-case on the wire: `djangorestframework_camel_case` renders responses in camelCase
  and parses requests in either spelling. This document uses the serializers' snake_case names.

## Admin row actions

Register custom admin row mutations with `admin_action_path` / `admin_action_re_path` from
[admin_actions.py](../../backend/shared/utils/admin_actions.py). The helper checks model change
permission, resolves the row through the admin's queryset, checks object change permission, and
passes the instance to the view; a callable `rows` can widen related fetching without discarding
an empty queryset. Row routes capture `uuid`. A page over no single row, such as the register
outputs due, uses `admin_page_path`, which checks model change permission only. File reads use
`admin_file_path` from [admin_files.py](../../backend/shared/utils/admin_files.py), which checks
model and object view permission instead.

These named-staff actions follow admin's 403 permission behaviour; `is_staff` alone is not
enough. Mint actions check change permission on the parent, and `MintRequestAdmin` deliberately
provides no add permission. The layer gate refuses bare admin-view registration outside its
helper allowance.

Admin fields keep the API's edit boundaries. `CompanyAdmin` edits go through the bounded
`update_company` service and its `EDITABLE_FIELDS`
([company information rules](../business/companies.md#company-information-and-documents)), which
stay read-only unless the staff member personally holds a current `admin` appointment for that
company or the draft-setup exception applies (`companies/admin/company.py`). It cannot add or
delete a company, registration uses its bounded service, and the owner is read-only.

### Company document verification

The procedure is in
[staff verification of a company document](../business/companies.md#staff-verification-of-a-company-document).
`CompanyDocumentAdmin`'s row action `<uuid>/verify/` calls
[document_review.py](../../backend/companies/services/document_review.py) on the operator
connection, for active staff holding `companies.change_companydocument`. The preview signs the
document, reviewer and fingerprint; confirmation accepts that signature for
`DOCUMENT_REVIEW_MAX_AGE` (900 seconds), runs as the `document_review` company operation, locks
the company, reviewer, profile and appointments (`lock_company_actor`) and then the document, and
requires the recomputed fingerprint to equal the previewed one.

The fingerprint is the SHA-256 of canonical JSON over the document and company UUIDs, the
company's name, ACN, ABN, type and owner, the document's type, name, stored path, size, MIME type,
external URL and validity dates, and the SHA-256 of its bytes. It is refused for a document with
no stored file, a rejection reason or non-current validity, or a file that is unreadable, empty or
not its recorded size.

Triggers in [database_guards.sql](../../backend/companies/database_guards.sql):
`companies_document_verification` refuses an app-role (customer) write that sets or changes a
verification and clears all four verification fields when the document's company, type, name,
file, size, MIME type, external URL, validity dates or rejection reason change;
`companies_identity_document_verification` clears every document of a company whose name, ACN,
ABN, type or owner changes; and `companies_document_administration` admits a document update only
as that clearing, inside a current administrator's company `edit`, or as a `document_review`
recording a permitted staff reviewer and changing only the verification fields. A company edit can
therefore revoke a verification; no customer path can grant one.

Retained register instructions consume it through `verified_document_snapshot`, which recomputes
the fingerprint from the current file: preparation locks the document and keeps a private copy,
snapshot and fingerprint, and staff review rechecks the document and copy against them. Publishing
to members needs a verified document of the class's company and records its fingerprint.

## External API consumers

Two route groups have no bundled client and are kept deliberately:

- The `IsAdminUser`-gated whitelist entry routes under `/api/v1/whitelist/`
  ([entry.py](../../backend/whitelist/views/entry.py)): list, detail, `entry/{address}/`,
  `sync/{address}/` and `export/` (CSV), for staff scripts' lookup, chain synchronisation and
  export. Fresh additions and removals use the
  [company wallet workflow](../business/participants.md#wallet-nominations-and-company-wallet-approvals);
  a staff script supplies no company mandate or acceptance evidence.
- The portfolio routes under `/api/portfolios/`, including `{uuid}/add-wallet/` and
  `{uuid}/remove-wallet/`, on an ordinary authenticated viewset scoped to the caller's own active
  portfolios; not a staff surface.

`GET /api/operator/` is not one of them: signed-in clients read it, and its
`payment_instructions` are null except for platform staff and holders of a current
secondary-market decision from at least one company (`secondary_company_ids`).

## Migrations

- Model changes require migrations; CI's drift step (`makemigrations --check --dry-run` in
  `make backend-test`) refuses a missing one.
- Never edit an applied migration. A testnet migration known to be unapplied may be removed.
- A schema change that changes the live RLS catalogue needs its policy-install migration too
  ([policy catalogue](security.md#policy-catalogue)).
- Where anyone else is working, claim the migration number in a comment on the plan issue before
  pushing it. Where two migrations fork off one parent, the second to land re-points one
  dependency line in its rebase.

The history starts from fresh initial migrations generated from current models
([decision](../decisions.md#minimum-tests-and-fresh-migrations)). They install the schema, the
PostgreSQL roles and grants, RLS policies, functions and triggers, and the history, share-total and
issuance safeguards; `shared/0002_database_guards` installs the catalogue, and
`shared/0003_member_certificate_guards` and `shared/0004_register_mirror_guards` add their
families' guards. No old-chain rewind, equivalence, adoption or per-migration upgrade test is
required ([backend verification](testing.md#backend-verification)). A database on an older
initial graph needs a [fresh rebuild](../operations/README.md#rebuild-a-database); there is no
adoption path.

`shared/0007_register_award_identity_guards` extends the mirror guards: first copied holdings keep
the exact company, name and address of a selected award-only recipient through commit. Earlier
same-company ledger entries establish existing membership independently of the current snapshot,
so registered members keep their normal particulars and correction flows.

`shared/0014_award_person_records` gives award recipients person records.

- An award for a new recipient creates their member and award-sourced particulars, and the member
  and particulars guards accept only that award as the source.
- The copied first holdings are now compared with the person's current particulars.
- The member identity behind member access holds while the person has an award.
- Grant and allotment digests omit an empty award source, so digests for other members are unchanged.
- The migration gives each existing award recipient without a member a person record from their
  earliest award.

The members response lists award-only people, award recipients who have never been on the company's
register, as members with `on_register` false, and only to readers of the company's awards (current register
appointees). Every other member is listed with `on_register` true, including one with no shares yet,
such as a member created by a wallet link. Its `award_recipients` list stays empty. Private award
evidence is not returned, and the RLS policies and grants are unchanged.

## Company workflow API

Non-tokenised share-change commands require an explicit company event date, separate from actual
recording and decision timestamps. Retained unknown dates are not backfilled; the
[register mechanism](records.md#company-event-dates) owns the exact chronology, digest, projection
and output rules.

Register decisions, share-class chain decisions, company wallet instructions and company
eligibility decisions follow four steps; who may take each is in
[how a company decision works](../business/README.md#how-a-company-decision-works). Employee
awards, vesting events and member-access commands prepare under a retry key and take no decision;
activation, authority requests and team commands take a retry key and, where needed, an exact
declaration; company detail edits and document uploads act on the caller's current
administration.

1. Prepare. The caller supplies a caller-scoped retry key (`idempotency_key`, or `operation_id`
   for register proposals) and, where company authority is needed, their exact appointment. The
   server validates any upload, freezes the inputs, identities and evidence fingerprints, and
   retains the record. An identical retry returns it; the same key with any change conflicts.
2. Preview. The preview for the caller's appointment reports unmet requirements and answers a
   digest binding the record, decision kind, person, appointment, reason and, where an effect
   depends on it, the current state.
3. Decide. The decision carries that digest, a retry key and `confirmation: true`. A changed digest
   or a reused key with different inputs answers 409, unmet requirements 400 naming them, and an
   inaccessible record 404, never 403. An identical retry returns the retained result through
   current read permission, even after the conditions for a new effect have changed.
4. Apply. One transaction locks the company before the actor and affected rows, rechecks the
   appointment, uses the database clock after lock waits, and commits the effect, the decision and
   any projection (such as holdings) together. Chain work becomes a bounded operator job that
   rechecks before signing ([locks, holds and recovery](chain.md#locks-holds-and-recovery)).

Each step needing company authority rechecks it after taking the company lock, so a revocation
that commits first refuses the step and records nothing. Requests, decisions, withdrawals and
revocations are append-only, keep their actual actor, appointment, retry key, digest and
database-stamped time, and are checked by database triggers; customer requests reach them only
through the bounded services. An uncertain reply is resolved by resending the exact original body
and key: current read access recovers the retained receipt, even after the appointment has
expired or the proposal has changed stage. No replay after process loss is promised, and a client
never infers success from a lost response.

| Family                              | Route prefix                                                                                                                                                                                                           | Business rules                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority requests                  | `/api/v1/company-authority/requests/`                                                                                                                                                                                  | [Authority](../business/companies.md)                                                                                                                                                                                                                                                                                                                 |
| Team invitations and appointments   | `/api/v1/company-authority/invitations/`, `/appointments/`                                                                                                                                                             | [Team](../business/companies.md#team-invitations-and-appointments)                                                                                                                                                                                                                                                                                    |
| Company details and documents       | `/api/v1/companies/`, `/api/v1/companies/{uuid}/documents/`                                                                                                                                                            | [Company information](../business/companies.md#company-information-and-documents)                                                                                                                                                                                                                                                                     |
| Activation                          | `/api/v1/companies/{uuid}/activate/`                                                                                                                                                                                   | [Activation](../business/companies.md#activation-and-the-registry-check)                                                                                                                                                                                                                                                                              |
| Eligibility                         | `/api/v1/company-eligibility/requests/`, `/api/v1/companies/{uuid}/eligibility-requests/`                                                                                                                              | [Eligibility](../business/participants.md#company-eligibility-decisions)                                                                                                                                                                                                                                                                              |
| Wallet nominations and instructions | `/api/v1/whitelist/wallet-nominations/`, `company-wallet-nominations/`, `company-wallet-instructions/`, `company-wallet-targets/`                                                                                      | [Wallet approvals](../business/participants.md#wallet-nominations-and-company-wallet-approvals)                                                                                                                                                                                                                                                       |
| Register evidence and setup         | `/api/v1/tokens/register-evidence/`, `register-member-documents/`, `register-openings/`, `register-links/`, `register-imports/`, `register-corrections/`, `register-particulars-changes/`, `register-reconciliations/` | [Register](../business/register.md)                                                                                                                                                                                                                                                                                                                   |
| Grants, awards and allotments       | `/api/v1/tokens/register-grants/`, `register-awards/`, `register-award-vestings/`, `register-allotments/`                                                                                                              | [Grants](../business/issuing-shares.md#grants-to-walletless-members), [awards](../business/issuing-shares.md#employee-awards-and-vesting), [allotments](../business/issuing-shares.md#external-investor-allotments)                                                                                                                                   |
| Transfers and retained instructions | `/api/v1/tokens/register-transfers/`, `register-instructions/`                                                                                                                                                         | [Transfers](../business/register.md#non-paid-transfers-between-members)                                                                                                                                                                                                                                                                               |
| Share-class chain decisions         | `/api/v1/tokens/register-deployments/`, `register-issues/`, `register-paid-issues/`, `register-capital-increases/`, `register-pause-changes/`                                                                          | [Deployments](../business/issuing-shares.md#deploying-an-empty-class), [issues](../business/issuing-shares.md#non-paid-chain-grants), [paid issues](../business/offerings.md#company-paid-issues), [capital](../business/issuing-shares.md#raising-the-authorised-shares), [pauses](../business/issuing-shares.md#pausing-and-unpausing-a-class) |
| Member access                       | `/api/v1/tokens/member-invitations/`, `member-associations/`, `member-records/`, `member-particulars-requests/`, `member-certificate-requests/`                                                                        | [Member access](../business/member-records.md#member-access)                                                                                                                                                                                                                                                                                          |
| Register outputs                    | `/api/v1/tokens/{uuid}/register/` (`certificate/`, `inspection-copy/`), `/api/v1/companies/{uuid}/pack/`                                                                                                               | [Outputs](../business/member-records.md#outputs-at-a-glance)                                                                                                                                                                                                                                                                                          |

Owning apps are in [backend apps](#backend-apps). Register routes and family requirement codes
are in [register commands](records.md#register-commands), and the chain families' admission and
execution in [signing families](chain.md#signing-families).

### Shareholder documents

`RegisterMemberDocument` retains a category and immutable links to a company, member, share class
and private supporting `RegisterEvidence`; an attachment made during setup also names its applied
`RegisterImport`. Import member rows freeze each attachment's evidence, category and file snapshot
at preparation, recheck the bytes before application, and create the links only after the actual
members exist. This copies existing holdings without manufacturing an issuance.

`/api/v1/tokens/register-member-documents/` lists attachments with pagination and optional `company`,
`member` and `token` filters. POST adds one to an existing holding under a current preparation
appointment, keeping its actor and retry key. Reads and `/{uuid}/file/` downloads require current
exact-company register authority; the file route rechecks its size and SHA-256. These bounded
operator routes expose no files through member or public projections. Categories describe the
company's files and grant no disclosure or certificate-verification status
([business rules](../business/register.md#shareholder-documents)).

### Register decisions

Share-class creation at `POST /api/v1/tokens/` keeps the existing request shape. Its company
selector uses `register_preparable_by`, and the service rechecks the actor's current personal
administrator/preparer authority inside `register_command` with the `register_class_create`
operation. Company, actor, profile, operator settings and appointments are locked by the existing
command; ownership and platform staff status supply no creation authority. Metadata creation makes
no ownership entry; the opening and each issue retain their own actor and appointment records.

Every company-decided register proposal family is a `DecisionFamily` in
[register_decisions.py](../../backend/tokens/services/register_decisions.py), served by a
`RegisterProposalViewSet` with `decision-preview/` and `decide/`; retained register instructions
keep their staff review instead. The kinds are `approve`, `apply` and `reject`, the preview digest
comes from the family's SQL digest function, and a conflict is 409 `register_change_conflict`.
Shared requirement codes:

| Requirement                             | Meaning                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `appointment_capability_required`       | The appointment holds neither `admin` nor the capability the decision needs                                                |
| `<subject>_decided`                     | The proposal is already applied or rejected, for example `correction_decided` or `paid_issue_decided`                      |
| `company_provided_evidence_required`    | A retained staff-era proposal, which can only be rejected                                                                  |
| `already_approved`                      | A current approval exists                                                                                                  |
| `approval_required`, `approval_lapsed`  | Application needs a current approval; an earlier approver's appointment ended                                              |
| `evidence_unavailable`                  | A retained copy no longer matches its size or SHA-256; checked by each family that retains evidence                        |
| `reason_required`, `reason_not_allowed` | Rejection needs a reason ([limit](../business/README.md#how-a-company-decision-works)); approval and application take none |

Each family adds its own effect requirements.

### Activation

`companies/services/activation.py:activate_company` records a distinct attempt and calls
`companies/services/registry.py:perform_registry_check`, which uses
`integrations/abr/client.py:lookup_company`. `CompanyDetail.activation` is null except for a
current personal administrator, who receives the appointment, company revision, exact declaration
and their own latest attempt for that appointment, never private identity snapshots or another
representative's attempts. With `issuer_kyc_required` on, an administrator who is not
identity-verified gets 400 `issuer_identity_verification_required` before any attempt or provider
request, and readiness is redacted.

`POST .../activate/` binds the exact `lifecycle_revision` and declaration version `2026-10-04`. A
pending or failed attempt answers 200 with the retained attempt. Stale or changed requests answer
409 `company_activation_conflict`; the same key with the exact request returns the attempt without
another provider call. A passed but unapplied attempt can resume its final effect after a transient
commit failure, subject to every current check.

The service locks the company, actor, profile and settings, validates the appointment and records
the attempt before releasing the transaction; ABR runs outside SQL locks and transactions. The
final transaction locks and rechecks those inputs and the attempt, and commits the `ACTIVE`
transition with the immutable `applied_at` receipt. Database guards refuse forged provider
decisions, raw application-role effects and orphan applied receipts; the receipt identity must
match the exact company snapshot, and receipt and projection times come from the database clock.
Staff warning recovery and reinstatement stay in `companies/services/company.py:_registry_transition`
([rule](../business/companies.md#staff-registry-controls)). Lookup limits are in
[company registry lookup](../operations/configuration.md#company-registry-lookup).

### Authority requests and team

`/api/v1/company-authority/requests/` takes JSON without a file or checked multipart with an
optional file, and pages the caller's own history; detail and `file/` resolve only the caller's own
request. It freezes raw and normalised identities, the file's SHA-256, size and type when
supplied, and the requested scopes and expiry. A no-file request keeps empty file metadata and
returns `file_url: null`, with no placeholder document. No caller-supplied verification result or
representative account is accepted. Retries under the requester-scoped key return the retained
request even after the company leaves draft or changes owner, comparing incoming bytes, filename,
MIME type and terms with the retained digest and current identities without rescanning; a new key
validates any file and rechecks draft ownership.

`admit/` reruns the [admission checks](../business/companies.md#company-signup) on the live
requester and draft without an ABR lookup, which a new company first meets at activation, and
creates one immutable initial appointment per company; a refused check creates none, and a
repeated admission returns the retained outcome. A new initial appointment records no registry
check; earlier appointments keep the authority-purpose check they were admitted with.
Admission and `withdraw/` share the request lock, so whichever commits first excludes the other; a
repeated `revoke/` returns its original outcome.

Who reads which authority record is in [company rows](security.md#company-rows). Invitation
issuance returns a random code once, with `Cache-Control: private, no-store`, and the database
keeps only its SHA-256; an identical retry returns the invitation with `code: null`, and a changed
company, source, scope or explicit date conflicts
([team rules](../business/companies.md#team-invitations-and-appointments)).
`appointments/{uuid}/signup-terms/` acts on the caller's own current personal `admin` appointment
for that exact company and returns it with a read-only `signup_terms` receipt (`null` in the list
until accepted): the original admission's when that already records this version, otherwise one
immutable `CompanySignupTermsAcceptance`.

Legacy-owner appointments return null declaration fields. Capabilities are six independent values,
`admin`, `prepare`, `approve`, `apply`, `finance` and `read_register`
([company capabilities](../business/README.md#company-capabilities)).

### Eligibility decisions

The eligibility routes reject unrecognised input fields; creation answers 201 and an exact replay 200. `users/services/company_eligibility.py` records requests and decisions, and
`users/services/company_eligibility_consumption.py` consumes them:
`company_eligibility(account, company, purpose=...)` and
`subscription_eligibility(account, offering, quantity)` evaluate the current decision, standing
and evidence at the time of the action, and `require_subscription_eligibility` and
`require_subscription_acceptance_eligibility` apply them to a subscription's own account and
offering, which must also be approved, within its opening period, on a deployed token and of an
active company open to investors. New subscriptions, orders, order changes and swap signatures
retain the decision they used and recheck evidence, standing and expiry after lock waits.

In [the eligibility service](../../backend/users/services/eligibility.py), `investor_readiness(user)`
checks account standing and the identity requirement; `directory_admission(user)` admits a
participant to the companies and exact products their decisions cover, including an offered class's
documents; `secondary_company_ids(user)` bounds the market the same way. Inaccessible list and
detail querysets give empty lists or 404, never a 403 that confirms a hidden row, and the
account-readiness response supplies no company permission
([rules](../business/participants.md#company-eligibility-decisions);
[evidence purges](security.md#retention-clocks)).

## Company identifiers

ACN and ABN check digits are checked on validated form and serializer write paths: the fields carry
the algorithms in [validators.py](../../backend/companies/validators.py) as `validators=[...]`, so
the admin's `ModelForm.full_clean` and the serializers run them and the API answers 400. A direct
ORM write skips field validators, but the `companies_administration` trigger
(`companies_valid_identifiers` in `companies/database_guards.sql`) refuses a new company, or an edit
changing the ACN or ABN, whose check digits fail or whose non-empty ABN is not the ACN with two
check digits in front; only the migration role bypasses it. `Company.clean()` applies the one rule
needing both fields, `abn_carries_acn`
([rules](../business/companies.md#company-information-and-documents)). The ABN check is a modulus of
89 and catches every single-digit error; the ACN check is a weighted modulus of 10 and does not.

## Offerings and subscriptions

The business rules are in [offerings](../business/offerings.md) and
[subscriptions](../business/offerings.md#applying-for-shares). Offering
writes (create, edit, delete, submit, withdraw, attach documents) run inside
`company_owner_operation`, which requires the active company owner; naming documents also passes
`require_company_documents`, which needs current administration of that company.

### Offering data flow

- [Listing](../business/offerings.md#listing-the-company-in-the-directory) is the
  `Company.is_open_to_investors` flag, one of the `EDITABLE_FIELDS` that `update_company`
  (`companies/services/editing.py`) applies from the API and admin alike; it is not a
  `CompanyStatus`, so suspension and reinstatement leave it set.
- Every writable `Offering` FK is scoped in `get_fields()`. `submit/` calls `submit_offering`,
  which first takes
  `select_for_update` on the `ShareToken` row so the liveness read and the status write are
  serialised per class: two simultaneous submissions give one submission and one 400, not the
  `IntegrityError` the partial unique index would turn into a 503. Its refusals
  ([rules](../business/offerings.md#creating-and-submitting-an-offering)) use
  `can_issue_tokens`, `unissued_headroom` (`total_supply` less completed supply less the caps of
  other live offerings; the refusal names `CapitalIncreaseRequest`, because `setAuthorizedShares`
  cannot go below `totalSupply`), `operators.settlement.require_deployment` per settlement asset,
  and for `s708_8_minimum_amount` the AUD value of `minimum_shares`.
- `UniqueConstraint(token)` `WHERE status IN (submitted, under_review, approved)` backstops one live
  offering per class; two tranches at once would need a migration relaxing it.
- `transition_offering` is the single chokepoint for every status change and sends one push to the
  owner; `approve` re-runs the headroom check. Review, approval, rejection and closing exist only
  in admin, where `OfferingAdmin.get_readonly_fields` freezes the economics past `DRAFT`
  (`LOCKED_PAST_DRAFT`) instead of repeating the submit checks.
- There is no `OPEN` status and no scheduler: `OfferingQuerySet.open_now()` is approved with
  `opens_at <= now` and `closes_at` null or future, and `ShareTokenQuerySet.with_open_offering()`
  annotates the directory from it.
- `OfferingQuerySet.published()` (approved or closed) decides which attached documents
  `GET /api/v1/directory/tokens/{uuid}/documents/` lists and `.../documents/{document}/file/`
  streams (inline for a PDF or image). The class resolves through the directory's own selector, so
  an ineligible investor, a class out of the directory, a document not published through that class
  and an unknown UUID all answer the same 404. The offering serializer refuses another company's
  document. The company document policy admits only the company's administration, so these routes
  use one bounded operator query ([requests and jobs](security.md#requests-and-jobs)).
- `POST /api/v1/offerings/{uuid}/documents/` attaches `OFFER_DOCUMENT_TYPES` documents to a draft,
  rejected, approved or closed offering and answers 400 naming any other status
  ([offer documents](../business/offerings.md#offer-documents)). Deleting a document an
  approved or closed offering carries answers 409 `offered_document`; admin's picker and delete
  pages apply the same rule, and `offerings/database_guards.sql` refuses to delete or re-point such
  an attachment or move its document to another company.

### Subscription data flow

- `POST /api/v1/subscriptions/` creates a whole-share draft. `get_fields()` scopes the offering to
  `Offering.objects.open_now()` under the caller's policies, which admit the offerings of the
  caller's own companies and of every active company open to investors. It scopes the wallet to
  `owned_by(user).verified_evm()` on Base, and `validate()` takes the caller's investing account.
  `create_draft` copies the price, currency, company display name (trading name, else legal name),
  class name and symbol onto the row; the personal list and detail read these copies without
  joining the parents, so reads, bank instructions and guarded withdrawal survive a hidden parent.
  An unchanged link can keep its stored owner when its parent is hidden; inserts, changed hidden
  links and owner tampering are refused.
- `create_draft` and `submit` re-read the offering, class and company on the operator connection
  under the caller's principal and run `_require_frozen_economics` and
  `require_subscription_eligibility`, then take `offerings_lock_subscription_admission`, re-read and
  run both again before writing. `_require_frozen_economics` answers 400 through
  `SubscriptionRefusedException` when the offering, its class or its company is no longer open
  (`_require_open`), the quantity is outside its bounds or the frozen terms changed. Admin `accept`
  runs `_require_frozen_economics` and `require_subscription_acceptance_eligibility` before and
  after taking the same lock.
- Acceptance issues the payment instruction. `generate_reference` appends an eight-character
  Crockford base32 code to `Operator.payment_reference_prefix` and refuses a normalised prefix over
  the `shared.payment_references` limit even when a write bypassed model validation, so the code is
  never truncated ([prefix limits](../operations/operator-console.md#operator-configuration));
  `issue_instruction` retries on `IntegrityError` against the partial unique index.
  `normalize_reference` runs on generation and admin lookup. `build_instruction` returns the
  operator's bank fields, or the receiving wallet with the settlement asset's contract and decimals
  from `require_deployment`, which refuses an asset with no active deployment on
  `Operator.receiving_wallet_chain`.
- Payment confirmation is columns on the subscription, not a second model
  ([rules](../business/offerings.md#payments-refunds-and-scale-back)); a short payment accepted
  as final sets `allotted_quantity` to `floor(received / price)`. A stablecoin hash is lower-cased
  and must be `0x` plus 64 hexadecimal characters; the partial unique index is on
  `Lower("payment_tx_hash")`, and `confirm_payment` catches its `IntegrityError` so a concurrent
  duplicate gets the same refusal, not a 500. Acceptance, confirmation, refund, rejection, technical
  retry and scale-back each write a `LogEntry`, so a restated `amount_received` keeps the earlier
  figure in the history.
- `has_money_in` (received less refunds actually returned) blocks reject and withdraw;
  `amount_refundable` caps a refund at the money not backing allotted shares (after allotment, more
  is refused as a claimed mint), and `refund_amount` accumulates once `refunded_at` is set. A
  refund before allotment cancels queued issuance work, keeping a cancelled private admission and
  rejecting its approved request atomically; once the worker commits its claim, a refund waits for
  the original operation ([share issuances](chain.md#share-issuances)). Historical rows with
  unresolved hashes keep their holds.
- Paid issuance consumes an applied
  [paid-issue decision](../business/offerings.md#company-paid-issues), which admits one private
  `ShareIssuanceExecution` with its approved request, subscription link and exact task identity.
  Each application must fit `min(offering headroom, authorized - issued - unminted)` under the
  original source locks, with chain observations taken before locking. Unminted counts every
  request that can still mint (`approved`, `executing`, and historical failed issuances with
  unresolved hashes), because `totalSupply()` counts only what is on chain; otherwise two
  sequential applications could each fit alone and strand the second as a `paid` row whose task
  refuses forever. A new command with a confirmed revert keeps its hash as evidence without holding
  headroom. `scale_back` sets `allotted_quantity` and leaves `amount_due` and `amount_received`, so
  the difference becomes `refund_amount`; its clamp floors at zero, so a negative headroom scales a
  row to nothing rather than to a quantity the database check constraint rejects.
- Recovery commits the request, issuance and allotted status together after original receipt
  verification ([subscription recovery](../operations/recovery.md#subscriptions)); the daily
  `expire_unpaid_subscriptions` touches only rows with no payment recorded.
- The investor API makes no financial write. The company reads its offering's subscriptions at
  `GET /api/v1/offerings/{uuid}/subscriptions/`, which runs on the operator connection and filters
  to `Offering.objects.issued_by(user)` and `for_issuer(offering)`, and
  `ShareIssuanceListSerializer` carries `subscription_reference` back to the payment.
- `Subscription.offering`, `.user_account` and `.wallet` are `PROTECT`; the handler turns the
  `ProtectedError` into a 409 that counts the holding rows.
- Each transition stamps its own `*_at` field (`closed_at` for rejection or withdrawal), and
  `payment_received_on` is the date staff recorded; older rows leave earlier steps null
  ([when each step happened](../business/offerings.md#when-each-step-happened)).

## Identity providers

How a KYC provider's result reaches the profile. Settings are in
[provider configuration](../operations/configuration.md#identity-verification-providers); the
rules the results feed are in
[identity check results](../business/participants.md#identity-check-results).

### Profile fields

Both providers write `verification_status`; `review_result`, null while there is no result (never
an empty string); `rejection_labels`, which keeps every reason; the identity document's type and
country; and, for an approval, the PEP type the risk policy reads. The applicant-facing serializer
(`users/serializers/identity_verification.py`) shows any label in `SCREENING_REJECTION_LABELS`
(`integrations/kyc/constants.py`: Sum&Sub's `PEP`, `SANCTIONS`, `COMPROMISED_PERSONS`,
`ADVERSE_MEDIA`, `CRIMINAL`, `BLOCKLIST` and `RESTRICTED_PERSON`, and KYCAID's
`COMPROMISED_PERSON`) once as `NEUTRAL_REJECTION_LABEL` (`UNABLE_TO_VERIFY`)
([what applicants see](../business/participants.md#what-applicants-see)).

| The provider reports   | KYCAID                                                                                                               | Sum&Sub                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Not started            | `unused`, recorded as `init`                                                                                         | `init`, from the created webhook                                                         |
| In progress, no result | `pending`                                                                                                            | `pending`, `queued`, `prechecked` or `onHold`, from the pending and on-hold webhooks too |
| Finished               | `completed`: `verified` true is `GREEN`, false is `RED`, null is no result                                           | `completed` with its `reviewAnswer`                                                      |
| A status poll          | the applicant's last verification: `pending`; `valid` is `completed` and `GREEN`; `invalid` is `completed` and `RED` | the review status, normalised through the same mapping as a webhook                      |
| Reasons                | each check's `decline_reasons` and the applicant's, once each                                                        | `reviewResult.rejectLabels`                                                              |
| Identity document      | the type of the applicant's latest valid identity document; no country                                               | approved `IDENTITY` steps from `requiredIdDocsStatus`, including the issuing country     |
| PEP evidence           | the applicant's `pep` flag, or a failed `pep` check                                                                  | with `RED`, the `PEP` label or `pep` button; with `GREEN`, the fetched AML case          |

### When a result counts

A result counts only once the provider reports the check completed. Sum&Sub says so of
`reviewAnswer`, so an answer beside another status (a provisional `GREEN` while `awaitingService`)
or with no `reviewStatus` is not recorded, and a poll that brings no result writes nothing.
KYCAID's `verified` is read as a JSON boolean or the string `true` or `false`; anything else is no
result. An undocumented KYCAID verification status is recorded as `pending` with no result, and a
status-changed callback carrying one changes nothing; both are logged. Callbacks and applicant
records are read by separate mappings. Sum&Sub's created, pending and on-hold webhooks record their
status in `verification_status`, the field the apps read, as well as in
`sumsub_verification_status`, unless the profile has since moved to KYCAID.

Every result is applied with the profile's row locked, so a callback and a poll arriving together
activate the account, assess its risk and notify the person once; no provider is called while that
lock is held.

### Identity documents

KYCAID's document objects carry a type, number, dates and issuing authority but no country, so the
foreign-passport factor stays unset; neither provider's applicant country or nationality is
inferred as an issuing country. On a Sum&Sub approval the integration reads
[verification step results](https://docs.sumsub.com/reference/get-status-of-verification-steps)
and records an approved identity document, preferring a passport, converting its alpha-3 issuing
country to alpha-2 where ISO defines it. A completed `GREEN` result with no current identity
document clears the stored type and country; a pending one keeps earlier verified evidence. A valid
KYCAID document records its type with no country, even when an earlier result supplied one.

### The Sum&Sub AML case

A completed `GREEN` Sum&Sub approval then reads
[the applicant's AML case](https://docs.sumsub.com/reference/get-aml-case-data), which needs the
View applicants and View AML screening permissions; a shared Redis window applies the endpoint's
ten requests per minute across applicants and workers. Exhaustion, unavailable Redis, a failed
request or malformed evidence leaves the approval unapplied: the webhook answers 500 for Sum&Sub
to resend, and a poll keeps the cached pending result to retry. Provider calls happen before the
apply transaction; rejections and unfinished reviews make neither extra read.

A PEP hit counts unless marked `false_positive` or `no_match`; a case that omits its hits can
supply the `pep` case label. Only the hit ID, match status and labels are retained, without names
or source URLs. Sum&Sub gives no PEP locality or category here, so the risk assessment records
category `unknown` with `approved_by_provider` and applies the `provider_approved_pep` adjustment
([PEP rules](../business/participants.md#pep-rules)); `integrations/kyc/pep.py` classifies rejected
PEP evidence. The authenticated callback always replaces any supplied AML or document fields with
fetched evidence; unsigned callbacks never cause a read.

### KYCAID approvals and screening callbacks

A KYCAID approval is recorded only once the applicant's `pep` flag reads as true or false (a JSON
boolean or those strings); the
[Get applicant reference](https://docs.kycaid.com/objects/applicants/applicant-get) allows null,
which does not establish that the person is not a PEP. When the callback's applicant is missing,
not an object, or has no interpretable `pep` flag, the applicant record is read first; if that read
fails the callback answers 500, KYCAID retries, and the next status poll applies the result too. An
approval whose record still supplies no interpretable flag is recorded as `pending` with no result
and logged.

KYCAID's `DATABASE_SCREENING` callback reports a monitoring match on a sanctions, PEP, wanted,
lost-or-stolen-document or internal list. Each raises a compliance alert under rule `KYC-SCREEN`:
`sanctions_match`, `pep_match`, or `watchlist_match` for a wanted-list or any other match
([severities and what the alert leaves unchanged](../business/participants.md#transaction-monitoring));
`sync_procedure_templates` loads a staff procedure for each type. The alert keeps the list types,
databases, accuracy, verification and document ids and the matched person's details. The account
is locked while an existing alert is looked for, so a repeated, retried or concurrent delivery of a
match already raised, whatever that alert's status, raises nothing. The callback is authenticated
as every KYCAID callback is.

### Crypto address screening

A provider result counts only when it is a JSON object whose risk score (`riskScore`, or in a
`/webhooks/kycaid/crypto/` callback `result.risk_score`, which KYCAID's reference table spells
`result.riskscore`; both are read) is a finite, non-negative number
([screening rules](../business/participants.md#transaction-monitoring)). Anything else, including
a result without a score that KYCAID documents as no risk found, stays on the screening's raw
response and leaves it pending; a submission reply that is not an object fails it, and the callback
refuses one with HTTP 400. A KYCAID submission reply without a score therefore waits for the
callback, whose score meets `CRYPTO_RISK_THRESHOLD_MEDIUM` and `CRYPTO_RISK_THRESHOLD_HIGH`. A
completed result is final: a repeated or late callback, a retry or a provider error leaves it
unchanged.

A screening records the provider that screens it: one recorded while
`KYCAID_CRYPTO_MONITORING_ENABLED` is off is sent nowhere and names `KYC_PROVIDER` or `disabled`,
and an admin retry ([operating note](../operations/configuration.md#identity-verification-providers))
records the provider it is sent to. KYCAID answers an address check with `data.service_request_id` and delivers the result in a later
`SERVICE_RESULT` callback with the same id
([address verification](https://docs.kycaid.com/risks-check/crypto),
[result callback](https://docs-v1.kycaid.com/#crypto-result-callback)), which the screening records
as its provider id to find it by. The result's `signals` are shares by category; only a sanctions
share above zero makes the alert a sanctioned-address one.

### Provider documentation

KYCAID's documentation disagrees with itself twice. The current reference types the applicant's
`verification_status` as `any`; only the [legacy reference](https://docs-v1.kycaid.com/) lists the
`pending`, `valid` and `invalid` the poll reads. The current
[Verification completed](https://docs.kycaid.com/callbacks/verification-completed) and
[Verification status changed](https://docs.kycaid.com/callbacks/verification-status-changed) pages
say they are sent, respectively, with `pending` on form submission and with `completed` when a
status is set; the
[callbacks overview](https://docs.kycaid.com/callbacks/overview) and legacy reference say the
opposite. The mapping depends on neither: each callback is read by the status it carries.

Other sources, read on 2 October 2026: KYCAID's
[Database screening](https://docs.kycaid.com/callbacks/database-screening),
[form integration](https://docs.kycaid.com/guides/form-integration) and
[decline reasons](https://docs.kycaid.com/decline-reasons); Sum&Sub's
[Get applicant review status](https://docs.sumsub.com/reference/get-applicant-review-status),
[applicant statuses](https://docs.sumsub.com/docs/applicant-statuses),
[rejection labels](https://docs.sumsub.com/docs/rejection-labels),
[rejection explanatory buttons](https://docs.sumsub.com/reference/rejected),
[AML screening](https://docs.sumsub.com/docs/aml-how-it-works) and
[applicant risk labels](https://docs.sumsub.com/docs/applicant-risk-labels).

## Notifications

Every `Notification` row is written through `NotificationService.notify_user`
([notifications.py](../../backend/users/services/notifications.py)) from one of two tasks in
[users/tasks/notifications.py](../../backend/users/tasks/notifications.py):
`send_transaction_notification` for confirmed and failed transactions, `send_push_notification` for
every other sender. A sender only defers the job, so the in-app inbox (dashboard bell, mobile inbox)
needs a running Procrastinate worker; with none, the change succeeds and the inbox stays empty until
a worker drains the queue. Staff can add, change and delete rows in the Django admin
(`users/admin/notification.py`); a row added there sends no push.

Each notice names its kind as `data.type`, and the dashboard bell opens that kind's page:

| Kind (`data.type`) | Sent by                                                                                            | The bell opens |
| ------------------ | -------------------------------------------------------------------------------------------------- | -------------- |
| `company`          | Retained history only: the sender is retired, and no activation or company status change sends one | Activation     |
| `offering`         | `offerings/services/offering.py`, on each notified offering transition                             | Offerings      |
| `publication`      | `shareholders/services/publications.py`, when a publication is announced to its roll               | Notices        |
| `transaction`      | `wallets/services/transaction_confirmation.py`, when a transaction is confirmed or fails           | Activity       |
| `identity`         | `users/services/identity.py`, when the identity check's result changes                             | Profile        |
| `certificate`      | `tokens/services/member_events.py`, when a member's certificate request is fulfilled               | Nothing        |
| `award`            | `tokens/services/member_events.py`, when shares vest under a member's award                        | Nothing        |
| `holding`          | `tokens/services/member_events.py`, when a grant or allotment issues shares to a member            | Nothing        |
| `particulars`      | `tokens/services/member_events.py`, when a member's particulars change is applied or declined      | Nothing        |

A notice of any other kind, including identity notices sent before they carried a type, stays
where it is. The four member kinds go only to the member's current association and name the
company, with the class for certificate and holding notices, but no quantities. Each carries
`record` (the association), with `company` for a certificate, `award` for a vesting and `token` for
an issue. The mobile app opens publication notices and these four kinds, from its inbox or a tapped
push ([mobile](mobile.md)). Push registration and its settings
are in [configuration](../operations/configuration.md#push-notifications).

Next: [security model](security.md), [records engine](records.md), [testing](testing.md) and
[gates](gates.md).
