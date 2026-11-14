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

The [registry-only execution boundary](chain.md#registry-only-execution-boundary) overrides the
historical chain, wallet and trading mutation routes described here. They retain their API shapes
and scoped reads, but new execution admissions are denied before preparation; background recovery
observes and reconciles existing receipts without signing or broadcasting.

## Backend apps

One Django app per bounded concern. `backend/ledova_backend/settings/` is a package of per-concern
modules re-exported by `settings/__init__.py`.

| App              | Owns                                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`      | The single `Operator` configuration row, `GET /api/operator/` (that configuration, read by signed-in clients), and the operator console: `worklist()` and `configuration_health()` rendered by `OperatorAdmin.changelist_view`                                                                              |
| `authentication` | `CustomUser`, the `AuthViewSet`, JWT sessions, email verification codes                                                                                                                                                                                                                                     |
| `users`          | Profiles, accounts, preferences (the transaction-alerts switch, on one `UserPreferences` row), financial profiles, device tokens and notifications                                                                                                                                                          |
| `companies`      | `Company`, its retained activation receipts (`CompanyActivation`), representative-authority request, appointment, invitation, signup-terms and retained revocation records, and the staff company-pack page                                                                                                 |
| `tokens`         | `ShareToken`, `ShareIssuanceRequest`, `ShareIssuance`, `CapitalIncreaseRequest`, `MintRequest`, `YieldToken`, the stored register with its company decision records, employee award and vesting records, external capital and allotment records, member access and register outputs, and the trading models |
| `shareholders`   | No models since shareholder publications were [removed](../decisions.md#shareholder-publications-removed); the app keeps the migrations that created and dropped them ([migrations](#migrations))                                                                                                           |
| `whitelist`      | `WhitelistEntry`, the per-company `WhitelistApproval` mirror, `WhitelistChange` commands, wallet nominations and company wallet instructions, and the sync from each company's registry                                                                                                                     |
| `wallets`        | `Wallet`, `Holding`, `Transaction`, balance sync and transfer confirmation                                                                                                                                                                                                                                  |
| `assets`         | `Asset`, `AssetChainDeployment`, `AssetSnapshot`, `ExchangeRate`, price sync, asset identity                                                                                                                                                                                                                |
| `portfolios`     | `Portfolio` and its owner-scoped routes                                                                                                                                                                                                                                                                     |
| `blockchain`     | `BlockchainTransaction` and transaction monitoring; the durable outgoing-signing foundation (`SigningAccount`, `OutgoingOperation`, `SignedAttempt`) and its immutable history inventory (`OutgoingHistoryCapture`, `OutgoingHistoryEvidence`, `OutgoingCutoverHold`)                                       |
| `compliance`     | Monitoring rules, alerts, procedure templates, risk assessments                                                                                                                                                                                                                                             |
| `documents`      | Nothing: since investor eligibility was removed it stays installed only for its migrations ([migrations](#migrations))                                                                                                                                                                                      |
| `integrations`   | Chain client, KYC providers, Alchemy, CoinGecko, Blockstream, SendGrid, Expo push, Transak                                                                                                                                                                                                                  |
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

| Layer          | Owns                                                                                                                                                                                                                       | Never contains                                                                                        | Reference                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `models/`      | Fields, `TextChoices`, constraints, `__str__`, properties over own fields, single-row transitions (guard, set fields, `save(update_fields=...)`, at most about ten lines, raising the app's `APIException` on a bad state) | Queries on other models, multi-step workflows, external I/O                                           | `users/models/notification.py`      |
| `querysets/`   | Every reusable query: product selectors, status filters, `select_related` bundles, annotations, aggregates; wired with `objects = XQuerySet.as_manager()`                                                                  | Saves, side effects, calls into services                                                              | `users/querysets/notification.py`   |
| `services/`    | Orchestration across models, external I/O (chain, KYC, email), `shared.db.atomic` and `select_for_update`; the one place a multi-model workflow lives. Plain module-level `verb_noun` functions, named after the noun      | HTTP objects, serializers, `Response`                                                                 | `users/services/preferences.py`     |
| `serializers/` | JSON shape and input validation; writable FKs constrained in `get_fields()` by policies and product selectors                                                                                                              | Business rules, locking, queries beyond FK scoping                                                    | `users/serializers/user_profile.py` |
| `views/`       | Permissions, `scoped_model` plus product filtering in `narrow()`, serializer choice, one service call, `Response`                                                                                                          | Raw `.objects.filter`, try/except that re-wraps an `APIException`, log lines that restate the request | `users/views/notification.py`       |
| `tasks/`       | `@app.task` / `@app.periodic`: load the row by uuid, call one service, return a dict                                                                                                                                       | Orchestration, state machines                                                                         | `users/tasks/notifications.py`      |
| `admin/`       | Registration, list/search/filter, operator actions that call the same model transition or service the API calls                                                                                                            | A second implementation of a workflow, HTML badge builders                                            | `users/admin/notification.py`       |

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
- No Django signals except the private-file lifecycle receiver that `shared/apps.py` connects from
  `shared/storage.py`: `post_delete` deletes a private file once its row is gone, whichever path
  deleted the row. A cascade delete never reaches a service, so an explicit call in each delete path
  cannot cover it.
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
  (`shared/api/pagination.py`). The `search` filters on companies, share classes, transfer orders,
  capital increases and assets match the whole text.
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
([company information rules](../business/companies.md#company-information)), which
stay read-only unless the staff member personally holds a current `admin` appointment for that
company or the draft-setup exception applies (`companies/admin/company.py`). It cannot add or
delete a company, registration uses its bounded service, and the owner is read-only.

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
  capital-increase reads, and the register's openings, wallet links and reconciliations with their
  acknowledgements. The
  [31 October decision](../decisions.md#wallets-removed-from-the-web-app) keeps them, with their
  records, so the features can return.

`GET /api/operator/` is not one of them: signed-in clients read the operator configuration from it.

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
  from current source keeps its name and must still work against that migration's schema:
  `tokens/0007_register_follows_profile` changes three guards `0004` replays, and their new bodies
  still install on `0004`'s schema because they read the added column only when they run.
- A data step in a migration that also changes a guarded table settles its deferred checks
  (`SET CONSTRAINTS ALL IMMEDIATE`) before Django runs the migration's deferred index and foreign-key
  SQL, which PostgreSQL refuses while trigger events are pending; `tokens/0007` does this after its
  backfill.
- A migration that removes a model with stored files deletes them through the storage API once its
  transaction commits, as `tokens/0005_remove_member_certificate_requests` does. A callable an
  applied migration imports stays importable after its model goes, such as the path function in
  `tokens/models/member_certificate.py` that `tokens/0001_initial` names.
- A migration that removes retained records the owner has not decided about refuses while any exist,
  and changes nothing: `shareholders/0002_remove_publications` stops with a message naming the
  publications, roll rows, events and read records it found, and otherwise drops their tables,
  guard triggers, functions and policies. It counts with `row_security` off, so a migrating role
  the policies would still filter stops with PostgreSQL's row-level security error instead of
  counting no rows. No model references a publication's stored files any more, so the
  [orphan sweep](../operations/jobs-and-storage.md#previewing-the-upload-sweep) never deletes files
  under `companies/<uuid>/publications/`, and a database the migration refused keeps them while
  later code runs. `shareholders/0003_remove_publication_jobs` then deletes the queued jobs that
  have not started for the removed tasks (the publications purge, the resolution close and the
  member notification), so the new worker never picks up a job it cannot run.
- An app whose models are gone stays installed while an applied migration depends on it:
  `shared/0002_database_guards` depends on `shareholders/0001_initial`, so `shareholders` keeps its
  migrations and the two path functions that migration names, in `shareholders/models/event.py`
  and `shareholders/models/publication.py`.
- Removing investor eligibility ([#1491](https://github.com/Ledova/ledova/issues/1491)) kept the
  minimal source the applied migrations still import. The `documents` app stays installed with only
  its migrations, because `shared/0002_database_guards` depends on `documents/0001_initial`, and
  `documents/0002_remove_documents` deletes its tables and files. `documents/models/document.py`
  keeps only `document_upload_path`, which `documents/0001_initial` names, and
  `users/models/investor_classification.py` keeps only `investor_evidence_path`, which
  `users/0001_initial` names. `users/database_shared_name_guards.py` keeps an `install` that does
  nothing, because `users/0002_eligibility_participant_name` runs it and the functions it replayed
  are gone. The same migrations delete the queued jobs that have not started for the removed tasks
  (`extract_document` and the two evidence purges) and for whitelist refreshes that name an
  eligibility decision, and drop the empty `decision_id` argument from the other queued refreshes,
  so a worker never picks up a job it cannot run. `documents/0002_remove_documents`,
  `tokens/0006_remove_trading_eligibility` and `whitelist/0002_remove_wallet_eligibility` depend on
  `shareholders/0002_remove_publications`, so a database whose publications removal refuses stops
  before any eligibility record or file is deleted.
- Removing the ABR company check ([#1491](https://github.com/Ledova/ledova/issues/1491)) kept no
  source for old migrations: none imports the registry-check model, its services or the ABR client.
  `companies/0003_remove_registry_checks` copies each applied activation into the new
  `CompanyActivation` table before it drops the registry-check table with its records, triggers and
  functions and the company and appointment registry columns, then replays the changed company
  guards from current source. The lookup ran inside the request, so there were no queued jobs to
  delete. `companies/activation_guards.py` installs the receipt guards: `shared/0002_database_guards`
  runs it too but skips it while the table does not exist yet, so on a fresh database, as on an
  existing one, `companies/0003` installs them.
- Removing company documents ([#1491](https://github.com/Ledova/ledova/issues/1491)) kept the
  minimal source the applied migrations still import: `companies/models/document.py` keeps only
  `company_document_path`, which `companies/0001_initial` names.
  `companies/0004_remove_company_documents` deletes each document's file through the storage API
  once its transaction commits, then the documents with their table, triggers, functions, content
  type and permissions; admin log entries keep their staff user, time and object id, with the content
  type cleared. It reads them with `row_security` off, so a migrating role the policies
  would still filter stops with PostgreSQL's row-level security error instead of leaving files
  behind. It replays `tokens_guard_register_instruction` and `tokens_guard_company_issue` from
  current source, because retained register instructions now take the company's own evidence, and
  reinstalls the policy catalogue, whose register instructions are no longer written by the app
  role. No task served company documents, so it deletes no queued job. It depends on
  `shareholders/0002_remove_publications`, so a database whose publications removal refuses stops
  before any document or file is deleted.
- Removing activation ([#1567](https://github.com/Ledova/ledova/issues/1567)) kept the receipts.
  `companies/0007_activate_at_signup` replays the company and receipt guards from current source,
  drops the receipt-effect trigger and the activation-source function, and makes each company still
  in Draft or an older onboarding state that already has an initial appointment Active from that
  admission time. Its reverse changes no data.
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
including one migrated before #1421, needs a [fresh rebuild](../decisions.md#minimum-tests-and-fresh-migrations);
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

Register decisions, share-class chain decisions and company wallet instructions follow four
steps; who may take each is in
[how a company decision works](../business/README.md#how-a-company-decision-works). Employee
awards, vesting events and member-access commands prepare under a retry key and take no decision;
authority requests and team commands take a retry key and, where needed, an exact
declaration; company detail edits act on the caller's current administration.

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
| Company details                     | `/api/v1/companies/`                                                                                                                                                                                                   | [Company information](../business/companies.md#company-information)                                                                                                                                                                                                                 |
| Wallet nominations and instructions | `/api/v1/whitelist/wallet-nominations/`, `company-wallet-nominations/`, `company-wallet-instructions/`, `company-wallet-targets/`                                                                                      | [Wallet approvals](../business/participants.md#wallet-nominations-and-company-wallet-approvals)                                                                                                                                                                                     |
| Register evidence and setup         | `/api/v1/tokens/register-evidence/`, `register-member-documents/`, `register-openings/`, `register-links/`, `register-imports/`, `register-corrections/`, `register-particulars-changes/`, `register-reconciliations/` | [Register](../business/register.md)                                                                                                                                                                                                                                                 |
| Grants, awards and allotments       | `/api/v1/tokens/register-grants/`, `register-awards/`, `register-award-vestings/`, `register-allotments/`                                                                                                              | [Grants](../business/issuing-shares.md#grants-to-walletless-members), [awards](../business/issuing-shares.md#employee-awards-and-vesting), [allotments](../business/issuing-shares.md#external-investor-allotments)                                                                 |
| Transfers and retained instructions | `/api/v1/tokens/register-transfers/`, `register-instructions/`                                                                                                                                                         | [Transfers](../business/register.md#non-paid-transfers-between-members)                                                                                                                                                                                                             |
| Share-class chain decisions         | `/api/v1/tokens/register-deployments/`, `register-issues/`, `register-capital-increases/`, `register-pause-changes/`                                                                                                   | [Deployments](../business/issuing-shares.md#deploying-an-empty-class), [issues](../business/issuing-shares.md#non-paid-chain-grants), [capital](../business/issuing-shares.md#raising-the-authorised-shares), [pauses](../business/issuing-shares.md#pausing-and-unpausing-a-class) |
| Member access                       | `/api/v1/tokens/member-invitations/`, `member-associations/`, `member-records/`                                                                                                                                        | [Member access](../business/member-records.md#member-access)                                                                                                                                                                                                                        |
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

### Company status

`companies/services/authority.py:admit_authority_request` admits the first administrator's request
and, in the same transaction, moves the company from Draft to `ACTIVE`, setting `activated_at` from
the database clock and advancing its revision
([company status](../business/companies.md#company-status)). No business register is consulted and
no one reviews the company. The company guard admits this `admission` transition only for the
owner's draft, with that owner's current initial appointment and an `activated_at` taken inside the
transaction. Receipts from before activation was removed stay read-only:
[activation_guards.sql](../../backend/companies/activation_guards.sql) refuses any new receipt,
change or deletion outside migrations, and the app role has no grants on them. Staff warning
recovery and reinstatement stay in `companies/services/company.py:transition_company`; returning to
Active needs an earlier `activated_at` or a historical officeholder attestation
([rule](../business/companies.md#staff-company-controls)).

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
requester and draft and creates one immutable initial appointment per company; a refused check
creates none, and a repeated admission returns the retained outcome.
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

### Current participants

Wallet nominations, company wallet instructions, non-paid chain grants, orders, order changes and
swap signatures check the participant at the time of each action, in the service and again in the
database guards after lock waits: an active login with a verified email, an investor or both
account, standing Active (or Pending Verification while the operator does not require the investor
identity check), a verified identity when it does, and an active company
([rules](../business/participants.md#account-standing)). Since
[#1491](https://github.com/Ledova/ledova/issues/1491) no classification source, document or company
eligibility decision is involved, and orders, submissions and swaps no longer record one. A company
reading a nomination, a wallet instruction or an issue to a nominated wallet sees any participant
lapse as `participant_not_current`; only the participant's own nomination preview names the reason.

The market list and the trading events stream are bounded to the companies where one of the
caller's current investing accounts has a wallet with a live company wallet approval. Inaccessible
list and detail querysets give empty lists or 404, never a 403 that confirms a hidden row.

## Company identifiers

ACN and ABN check digits are checked on validated form and serializer write paths: the fields carry
the algorithms in [validators.py](../../backend/companies/validators.py) as `validators=[...]`, so
the admin's `ModelForm.full_clean` and the serializers run them and the API answers 400. A direct
ORM write skips field validators, but the `companies_administration` trigger
(`companies_valid_identifiers` in `companies/database_guards.sql`) refuses a new company, or an edit
changing the ACN or ABN, whose check digits fail or whose non-empty ABN is not the ACN with two
check digits in front; only the migration role bypasses it. `Company.clean()` applies the one rule
needing both fields, `abn_carries_acn`
([rules](../business/companies.md#company-information)). The ABN check is a modulus of
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
| `company`          | Retained history only: the sender is retired, and no company status change sends one     | Profile        |
| `publication`      | Retained history only: the sender went with shareholder publications                               | Nothing        |
| `transaction`      | `wallets/services/transaction_confirmation.py`, when a transaction is confirmed or fails           | Nothing        |
| `identity`         | `users/services/identity.py`, when the identity check's result changes                             | Profile        |
| `certificate`      | Retained history only: the sender went with members' certificate requests                          | Nothing        |
| `award`            | `tokens/services/member_events.py`, when shares vest under a member's award                        | Nothing        |
| `holding`          | `tokens/services/member_events.py`, when a grant or allotment issues shares to a member            | Nothing        |

A notice of any other kind, including identity notices sent before they carried a type,
`particulars` notices sent before members' particulars requests were removed and eligibility
notices sent before investor eligibility was removed, stays in the inbox and opens nothing.
The two member kinds go only to the member's current association and name the company, with the
class for holding notices, but no quantities. Each carries `record` (the association), with `award`
for a vesting and `token` for an issue. The mobile app opens these two kinds, from its inbox or a
tapped push ([mobile](mobile.md)). A `certificate` notice sent before members' certificate requests
were removed, and a `publication` notice sent before shareholder publications were removed, stays in
the inbox and opens nothing, on the web and in the app. Push registration and its settings
are in [configuration](../operations/configuration.md#push-notifications).

Next: [security model](security.md), [records engine](records.md), [testing](testing.md) and
[gates](gates.md).
