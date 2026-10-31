# Backend

[Engineering](README.md) · [Documentation](../README.md)

Where backend code belongs, the rules it follows, and how the Django API implements company
workflows, identity providers and notifications, for engineers changing `backend/`.
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

`users/` is the reference app. Where a rule and a file disagree, the rule wins and the file is
the backlog. [The layer gate](gates.md#the-layer-gate) enforces the table.

| Layer          | Owns                                                                                                                                                                                                                       | Never contains                                                                                        | Reference                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `models/`      | Fields, `TextChoices`, constraints, `__str__`, properties over own fields, single-row transitions (guard, set fields, `save(update_fields=...)`, at most about ten lines, raising the app's `APIException` on a bad state) | Queries on other models, multi-step workflows, external I/O                                           | `users/models/investor_classification.py`    |
| `querysets/`   | Every reusable query: product selectors, status filters, `select_related` bundles, annotations, aggregates; wired with `objects = XQuerySet.as_manager()`                                                                  | Saves, side effects, calls into services                                                              | `users/querysets/investor_classification.py` |
| `services/`    | Orchestration across models, external I/O (chain, KYC, email), `shared.db.atomic` and `select_for_update`; the one place a multi-model workflow lives. Plain module-level `verb_noun` functions, named after the noun      | HTTP objects, serializers, `Response`                                                                 | `users/services/investor_classification.py`  |
| `serializers/` | JSON shape and input validation; writable FKs constrained in `get_fields()` by policies and product selectors                                                                                                              | Business rules, locking, queries beyond FK scoping                                                    | `users/serializers/user_profile.py`          |
| `views/`       | Permissions, `scoped_model` plus product filtering in `narrow()`, serializer choice, one service call, `Response`                                                                                                          | Raw `.objects.filter`, try/except that re-wraps an `APIException`, log lines that restate the request | `users/views/investor_classification.py`     |
| `tasks/`       | `@app.task` / `@app.periodic`: load the row by uuid, call one service, return a dict                                                                                                                                       | Orchestration, state machines                                                                         | `users/tasks/retention.py`                   |
| `admin/`       | Registration, list/search/filter, operator actions that call the same model transition or service the API calls                                                                                                            | A second implementation of a workflow, HTML badge builders                                            | `users/admin/investor_classification.py`     |

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
  (`shared/api/pagination.py`). A search built with `every_word` (`shared/api/search.py`), so far the
  ownership list's, matches every word, ignoring case; the older `search` filters on
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

These route groups have no bundled client and are kept deliberately:

- The `IsAdminUser`-gated whitelist entry routes under `/api/v1/whitelist/`
  ([entry.py](../../backend/whitelist/views/entry.py)): list, detail, `entry/{address}/`,
  `sync/{address}/` and `export/` (CSV), for staff scripts' lookup, chain synchronisation and
  export. Fresh additions and removals use the
  [company wallet workflow](../business/participants.md#wallet-nominations-and-company-wallet-approvals);
  a staff script supplies no company mandate or acceptance evidence.
- The portfolio routes under `/api/portfolios/`, including `{uuid}/add-wallet/` and
  `{uuid}/remove-wallet/`, on an ordinary authenticated viewset scoped to the caller's own active
  portfolios; not a staff surface.
- Since [#1452](https://github.com/Ledova/ledova/issues/1452), the wallet routes (`/api/wallets/`,
  `/api/transactions/`, `/api/assets/`, the on-ramp's `/api/fiat-purchases/` and the wallet
  nominations and instructions), the share-class chain decisions with the retained issuance and
  capital-increase reads, the register's openings, wallet links and reconciliations with their
  acknowledgements, and the publication summary. The
  [31 October decision](../decisions.md#wallets-removed-from-the-web-app) keeps them, with their
  records, so the features can return.

`GET /api/operator/` is not one of them: signed-in clients read it, and its
`payment_instructions` are null except for platform staff and holders of a current
secondary-market decision from at least one company (`secondary_company_ids`).

## Migrations

- Model changes require migrations; CI's drift step (`makemigrations --check --dry-run` in
  `make backend-test`) refuses a missing one.
- Never edit an applied migration. A testnet migration known to be unapplied may be removed.
- A schema change that changes the live RLS catalogue needs its policy-install migration too
  ([policy catalogue](security.md#policy-catalogue)).
- A change to the guard SQL needs a forward migration that replaces each changed function from the
  current source, substituting the role placeholders as the installer does, and drops removed
  triggers and functions, so an existing database ends as a fresh one does;
  `tokens/0004_one_step_particulars_edit` is the example. A function an earlier migration replays
  from current source keeps its name and must still work against that migration's schema.
- Where anyone else is working, claim the migration number in a comment on the plan issue before
  pushing it. Where two migrations fork off one parent, the second to land re-points one
  dependency line in its rebase.

The history starts from fresh initial migrations generated from current models
([decision](../decisions.md#minimum-tests-and-fresh-migrations)). They install the schema, the
PostgreSQL roles and grants, RLS policies, functions and triggers, and the history, share-total and
issuance safeguards. `shared/0002_database_guards` runs `shared/database_setup.py`, which installs
the catalogue and each app's guards, then the later guard families in the order they were added,
and keeps the share columns of awards, allotments and contributions as unbounded `numeric`. The
baseline was regenerated when offerings were removed
([#1421](https://github.com/Ledova/ledova/issues/1421)), and a schema comparison with the previous
history found only the removed tables, columns, functions and policy terms. No old-chain rewind,
equivalence, adoption or per-migration upgrade test is required
([backend verification](testing.md#backend-verification)). A database on an older initial graph,
including one migrated before #1421, needs a [fresh rebuild](../operations/README.md#rebuild-a-database);
there is no adoption path.

The mirror guards keep the exact company, name and address of a selected award-only recipient in
first copied holdings through commit. Earlier same-company ledger entries establish existing
membership independently of the current snapshot, so registered members keep their normal
particulars and correction flows.

Award recipients have person records:

- An award for a new recipient creates their member and award-sourced particulars, and the member
  and particulars guards accept only that award as the source.
- The copied first holdings are compared with the person's current particulars.
- The member identity behind member access holds while the person has an award.
- Grant and allotment digests omit an empty award source, so digests for other members are unchanged.

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

| Family                              | Route prefix                                                                                                                                                                                                           | Business rules                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority requests                  | `/api/v1/company-authority/requests/`                                                                                                                                                                                  | [Authority](../business/companies.md)                                                                                                                                                                                                                                               |
| Team invitations and appointments   | `/api/v1/company-authority/invitations/`, `/appointments/`                                                                                                                                                             | [Team](../business/companies.md#team-invitations-and-appointments)                                                                                                                                                                                                                  |
| Company details and documents       | `/api/v1/companies/`, `/api/v1/companies/{uuid}/documents/`                                                                                                                                                            | [Company information](../business/companies.md#company-information-and-documents)                                                                                                                                                                                                   |
| Activation                          | `/api/v1/companies/{uuid}/activate/`                                                                                                                                                                                   | [Activation](../business/companies.md#activation-and-the-registry-check)                                                                                                                                                                                                            |
| Eligibility                         | `/api/v1/company-eligibility/requests/`, `/api/v1/companies/{uuid}/eligibility-requests/`                                                                                                                              | [Eligibility](../business/participants.md#company-eligibility-decisions)                                                                                                                                                                                                            |
| Wallet nominations and instructions | `/api/v1/whitelist/wallet-nominations/`, `company-wallet-nominations/`, `company-wallet-instructions/`, `company-wallet-targets/`                                                                                      | [Wallet approvals](../business/participants.md#wallet-nominations-and-company-wallet-approvals)                                                                                                                                                                                     |
| Register evidence and setup         | `/api/v1/tokens/register-evidence/`, `register-member-documents/`, `register-openings/`, `register-links/`, `register-imports/`, `register-corrections/`, `register-particulars-changes/`, `register-reconciliations/` | [Register](../business/register.md)                                                                                                                                                                                                                                                 |
| Grants, awards and allotments       | `/api/v1/tokens/register-grants/`, `register-awards/`, `register-award-vestings/`, `register-allotments/`                                                                                                              | [Grants](../business/issuing-shares.md#grants-to-walletless-members), [awards](../business/issuing-shares.md#employee-awards-and-vesting), [allotments](../business/issuing-shares.md#external-investor-allotments)                                                                 |
| Transfers and retained instructions | `/api/v1/tokens/register-transfers/`, `register-instructions/`                                                                                                                                                         | [Transfers](../business/register.md#non-paid-transfers-between-members)                                                                                                                                                                                                             |
| Share-class chain decisions         | `/api/v1/tokens/register-deployments/`, `register-issues/`, `register-capital-increases/`, `register-pause-changes/`                                                                                                   | [Deployments](../business/issuing-shares.md#deploying-an-empty-class), [issues](../business/issuing-shares.md#non-paid-chain-grants), [capital](../business/issuing-shares.md#raising-the-authorised-shares), [pauses](../business/issuing-shares.md#pausing-and-unpausing-a-class) |
| Member access                       | `/api/v1/tokens/member-invitations/`, `member-associations/`, `member-records/`, `member-certificate-requests/`                                                                                                        | [Member access](../business/member-records.md#member-access)                                                                                                                                                                                                                        |
| Register outputs                    | `/api/v1/tokens/{uuid}/register/` (`certificate/`, `inspection-copy/`), `/api/v1/companies/{uuid}/pack/`                                                                                                               | [Outputs](../business/member-records.md#outputs-at-a-glance)                                                                                                                                                                                                                        |

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

The eligibility routes reject unrecognised input fields; creation answers 201 and an exact replay 200.
`users/services/company_eligibility.py` records requests and decisions, and
`users/services/company_eligibility_consumption.py` consumes them: `company_eligibility(account,
company)` evaluates the current decision, standing and evidence at the time of the action. Orders,
order changes and swap signatures retain the decision they used and recheck evidence, standing and
expiry after lock waits.

`secondary_company_ids(user)` in [the eligibility service](../../backend/users/services/eligibility.py)
bounds the market to the companies whose decisions are current. Inaccessible list and detail
querysets give empty lists or 404, never a 403 that confirms a hidden row
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
| `publication`      | `shareholders/services/publications.py`, when a publication is announced to its roll               | Notices        |
| `transaction`      | `wallets/services/transaction_confirmation.py`, when a transaction is confirmed or fails           | Nothing        |
| `identity`         | `users/services/identity.py`, when the identity check's result changes                             | Profile        |
| `certificate`      | `tokens/services/member_events.py`, when a member's certificate request is fulfilled               | Nothing        |
| `award`            | `tokens/services/member_events.py`, when shares vest under a member's award                        | Nothing        |
| `holding`          | `tokens/services/member_events.py`, when a grant or allotment issues shares to a member            | Nothing        |

A notice of any other kind, including identity notices sent before they carried a type and
`particulars` notices sent before members' particulars requests were removed, stays where it is.
The three member kinds go only to the member's current association and name the company, with the
class for certificate and holding notices, but no quantities. Each carries `record` (the
association), with `company` for a certificate, `award` for a vesting and `token` for an issue. The
mobile app opens publication notices and these three kinds, from its inbox or a tapped push
([mobile](mobile.md)). Push registration and its settings
are in [configuration](../operations/configuration.md#push-notifications).

Next: [security model](security.md), [records engine](records.md), [testing](testing.md) and
[gates](gates.md).
