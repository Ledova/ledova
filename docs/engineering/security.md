# Security model

[Engineering](README.md) · [Documentation](../README.md)

How the backend authenticates sessions, isolates tenants in PostgreSQL, stores and serves private
files, retains and purges them, and validates uploads. For engineers; the settings are in
[configuration](../operations/configuration.md), and how clients hold sessions is in
[frontend](frontend.md) and [mobile](mobile.md).

## Authentication and sessions

- `authentication.classes.HybridJWTAuthentication` is the only DRF authentication class, and
  `IsAuthenticated` the default permission.
- Sessions are simplejwt refresh tokens with the `token_blacklist` app. A refresh rotates and
  blacklists the token presented; `signout` revokes one session, `signout-all` every session. The
  access token carries its refresh's jti (`rjti`), and every request checks that session is live,
  so revocation takes effect on the next request. An admin email change
  (`authentication/admin/user.py`), an account deletion and a signup email change (`restart-signup`;
  both in `users/services/lifecycle.py`) revoke every session; a password change
  (`authentication/views/user.py`) keeps only its own (`keep_jti`).
- `X-Auth-Transport: bearer` returns the tokens in the response body and sets no cookie; without
  the header the access and refresh cookies are set (`httponly`, flags from
  `settings.AUTH_COOKIE`). The dashboard uses cookies, mobile sends the header.
- CSRF applies to the cookie transport only. A cookie-sourced POST, PUT, PATCH or DELETE runs DRF's
  `CSRFCheck`; invalid CSRF receives `403 CSRF Failed`. A Bearer request wins over an `access`
  cookie replayed beside it. The readable `csrftoken` cookie is issued by `auth/verify`, sign-in
  and email verification; the dashboard's axios client echoes it as `X-CSRFToken`.
- Sign-up requires an emailed six-digit code, hashed at rest, expiring after ten minutes and capped
  at five attempts. Sign-in, sign-up, a signup email change, verification and resend are throttled
  per address
  (`auth_email`, ten attempts in a rolling hour) across every backend worker: `CACHES["default"]`
  reserves each attempt atomically in Redis on Redis's clock. Successful and unsuccessful
  credential checks both count; over the limit answers 429 with `Retry-After`. The count survives
  backend restarts; Redis data loss or a cache clear resets it, and an unreachable cache answers
  503 before credentials are checked. Only `auth_email` and uploads have strict atomic windows;
  other DRF rate limits count approximately. Test settings use `LocMemCache`.
- The Django admin uses ordinary Django sessions, not the JWT stack; company users use the client
  transport, and authentication confers no company mandate
  ([company authority boundaries](README.md#company-authority-boundaries)).

## Tenancy model

One database serves one deployment, and PostgreSQL row-level security (RLS) enforces tenant
isolation. Customer requests and principal-bearing jobs select authority at their boundary; product
selectors keep narrower company, account and eligibility rules where database read scopes are
wider. RLS visibility does not decide investor eligibility: market selectors apply the
[eligibility consumers](backend.md#eligibility-decisions). The roles below are PostgreSQL
connection roles, not job titles.

### Roles and principal

| Role     | Purpose                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| App      | Customer requests and scoped jobs; owns no tables and has no `BYPASSRLS`             |
| Operator | Admin, explicit administrative jobs and bounded privileged services; has `BYPASSRLS` |
| Migrate  | Owns the schema and applies migrations                                               |

The app alias uses `CONN_MAX_AGE=0`. The principal is a session-level `app.user_id`, set after DRF
authentication by `SetsThePrincipalOnTheConnection` on the shared view bases, because middleware
cannot know a bearer user before authentication. The admin is recognised by resolved URL
configuration; provider webhooks select `RunsOnTheOperatorConnection`.

Every policy requires a non-null principal, so an unset or cleared principal reads no tenant rows,
even with a public visibility branch. Serving entrypoints refuse the wrong ambient alias.
Transaction-level pooling cannot preserve this principal model; use session pooling or none
([database configuration](../operations/configuration.md#row-level-security-roles)).

Transactions, queries and callbacks share the current alias through `shared.db.atomic` and
`shared.db.on_commit`, and raw cursors name `connections[alias]`: `django.db.connection` reaches
the default connection and can bypass scope
([the connection-binding gate](gates.md#the-connection-binding-gate)).

### Company rows

Company and `CompanyDocument` selectors admit a current personal `admin` appointment or the
bounded draft-setup exception
([authority rules](../business/companies.md#who-may-administer-a-company)) through
`app_company_administration_ids()`, which exposes only company UUIDs. `app_visible_company_ids()`
and `app_manageable_company_ids()` keep their owner terms for the retained owner workflows
(offerings and capital effects), which recheck the live owner and active actor under company-first
locks. Share-class creation instead selects a current personal administrator or preparer and
rechecks that authority inside the locked register command (`backend/tokens/services/creation.py`).

App writes to Company, CompanyDocument, authority requests, appointments, invitations and
legacy-owner sources are denied; the actor-bound services in `companies/services/`
(`administration.py`, `editing.py`, `documents.py`, `authority_requests.py`, `team.py`) carry the
caller's principal, lock the company before the live account, profile, identity requirement and
appointments, and check the clock after the wait. Policies scope authority requests to their
requester, appointments to their appointee and invitations to their inviter; team reads go
through the administration check and exclude private identity, financial and authority evidence.
Triggers attached in `companies/database_guards.sql`, with functions there and in
`companies/authority_guards.sql`, refuse any update or deletion of authority requests, withdrawals,
appointments, invitations, revocations and legacy-owner sources, and check admission, withdrawal,
acceptance and revocation. Publication selectors bind the exact retained company owner or named
roll recipient ([who may read a publication](../business/publications.md#who-may-read-a-publication)).

### Policy catalogue

[policies.py](../../backend/shared/db/policies.py) classifies every table and records exceptional read
and write scopes. Grants derive from that catalogue; unclassified tables are denied rather than
receiving blanket grants. The `AWAITING_R0` and `AWAITING_RLS` sets are empty.

- Policies are per command. UPDATE `USING` is the read scope, so readable rows can be locked;
  `WITH CHECK`, INSERT and DELETE use the write scope.
- Positive ownership predicates fail closed for unknown owners. A visible child's non-nullable
  parents must also be readable, or `select_related` can remove rows that `count()` counted.
- The profile and account helpers define principal membership. The bounded company administration
  and public-discovery helpers return UUIDs through fixed-search-path `SECURITY DEFINER`
  functions, which prevents circular company and token policy evaluation. Public discovery keeps
  the deployed and non-empty-address term and requires a principal; it supplies no private
  document, profile or basic administration access.
- Accounts, wallets and profiles are readable only by their owner. A company's nullable
  operator-wallet link does not expose its owner's profile to an ordinary viewer of that company.
- A member reads a company's row only through an account resolved once and stored, never through a
  live join. `Wallet` is unique per (account, chain, address), so two accounts can hold one
  address and an address join would cross tenants.

`policies.py` is read at migration time: `shared/0002_database_guards` installs its roles, grants,
policies and helpers on a fresh database
([migrations](backend.md#migrations)), and every existing database keeps what it was given. A
schema or catalogue change that alters the live policies therefore needs a migration that re-runs
`shared.db.policy_sql.install`.

`check_rls_catalogue` compares installed policies and helpers with the installer inside a
rolled-back transaction (PostgreSQL-normalised expressions, policy roles and permissiveness, helper
properties), after migration rather than on the scoped serving connection; `check_rls_roles`
checks live connection privileges, grants and principal state. Both run in
[backend verification](testing.md#backend-verification). Neither check runs a read under the
policies. Apart from company administration, which the company setup journey exercises only on its
successful path, no automated test covers the reads the catalogue records as wider than ownership
(`READS_WIDER_THAN_OWNERSHIP`) or its public terms (`PUBLIC_TERM`).

### Requests and jobs

`PolicyQuerysets` starts from the model manager and adds only product filtering in `narrow()`, with
no redundant Python tenancy predicate; writable foreign keys stay scoped in serializer
`get_fields()`.

A scoped task requires its principal in the enqueue contract; where its required recipient ID is
the principal, it refuses a missing ID. Worker ambient authority is operator, so omitting a scope
would widen access; `acting_for(None)` deliberately selects operator authority and suits only a
classified administrative invocation.

Procrastinate's queue connection is separate from the task's ORM scope.
`PROCRASTINATE_DATABASE_ALIAS` selects `operator` for the global Django connector and the
worker's own connector; queue registration, scheduling, retry, completion and pruning therefore
use the operator role. `check_rls_roles` checks the setting and the worker connector's actual
login and active role. This gives the queue no company decision authority.

Producers use `shared.tasks.queue.defer` to insert jobs on their current database connection,
so an enclosing transaction commits or rolls back its rows and jobs together. Deliberate
`on_commit` callbacks capture that connection alias for their lookups and enqueue. Task names,
payloads, queue and lock defaults, and existing delays are retained. The
[connection-binding gate](gates.md#the-connection-binding-gate) refuses direct task deferrals
and separate queue connector construction outside the helper.

The [task catalogue](../../backend/shared/tasks/catalogue.py) records authority and bounded operator
handoffs. Deployments, issuance execution, capital increases and pause changes are operator jobs
that a company's applied decision produces; `executed_by` records the
actor for audit, not a tenant principal. New work needs explicit company authority and a bounded
handoff, not just a changed enqueueing UI or an omitted principal.

Wallet producers insert transaction-screening jobs inside the wallet transaction; the worker
selects operator authority and commits alerts with `monitoring_completed_at`, so rollback removes
both and redelivery does not screen twice.

Deployment scopes token lifecycle writes to the applying principal and the company's exact
approval; its operator-only broadcast journal commits independently before sending, rechecking the
consumed approval under a lock, so an outer transaction cannot undo it
([share-class deployment](chain.md#share-class-deployment)).

A bounded operator read serves public market prices for already admitted tokens, which ownership
alone would refuse. It resolves what the caller may see under the app role first and bounds one
operator query to it, exposing no private orders or wallets.

Order creation is another bounded handoff
([create protocol](trading-protocols.md#creating-an-order)).

## Private files

Uploaded evidence is private in every storage mode and on every instance. File
ownership and the retention clock decide who can read or remove it; no upload is served by
`/media/`, including in debug mode, and a public media URL never substitutes for an authenticated
route. A company appointment reaches only that company's documents and tasks, never participants'
private identity, classification or financial evidence.

### Storage

Private `FileField`s declare `storage=private_storage` and `max_length=255`.
`PrivateMediaStorage.base_url` is null, so `.url` raises. Discovery follows the storage declaration
and alias for each adapter ([where files live](../operations/jobs-and-storage.md#private-storage)).
Stored keys end in a fresh UUID and extension, embedding no email or original filename; company,
account and classification UUIDs in prefixes are pseudonymous.

| Upload                           | Storage prefix and lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Representative authority request | `companies/<uuid>/authority-requests/`; retained with the immutable request; uncommitted-copy orphans are swept                                                                                                                                                                                                                                                                                                                                                                                                   |
| Company register decision        | `companies/<uuid>/register-evidence/` for the company's upload and a per-kind prefix for the decision's own copy: `register-openings/`, `register-imports/`, `register-corrections/`, `register-links/`, `register-particulars/`, `register-grants/`, `register-transfers/`, `register-capital-increases/`, `register-pause-changes/`, `register-instructions/`, `register-awards/`, `register-award-vestings/` and `register-allotments/`; both are retained with their rows; interrupted-copy orphans are swept |
| Member certificate fulfilment    | `companies/<uuid>/member-certificates/`; the recipient-only file, retained with its fulfilment record                                                                                                                                                                                                                                                                                                                                                                                                             |
| Publication to members           | `companies/<uuid>/publications/`; retained with its row until the publication purge                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Dividend payment evidence        | `companies/<uuid>/publications/<publication>/payments/`; retained with its payment record until the publication purge                                                                                                                                                                                                                                                                                                                                                                                             |
| Company document                 | `companies/<uuid>/documents/<type>/`; swept after becoming an orphan                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unattached payslip               | `documents/`; ordinary deletion and orphan cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Classification evidence          | `users/`; retained by the classification clock                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Attached payslip                 | `users/supporting-documents/`; retained with its claim                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Serving

An authenticated serving action resolves the row before streaming it. Foreign and phantom customer
rows return the same 404; anonymous requests return 401. Staff read company files through admin
(`admin_file_path`, [admin row actions](backend.md#admin-row-actions)) rather than widening
customer ownership selectors; refused staff receive 403, matching the change page.

The company document serializer returns the authenticated route as `file_url`; a personal
document and classification evidence are read only through admin. The dashboard opens a file by
top-level navigation with its session cookie; mobile fetches with its bearer client
([document view copies](mobile.md#document-view-copies)).

Admin downloads are attachments; customer serving is inline only for the allowed PDF, PNG and JPEG
MIME types, and an attachment otherwise. `stream_stored_file`, which every customer
file route uses, marks each response `Cache-Control: private, no-store`, so neither a shared cache
nor the browser keeps a copy; admin downloads, the company pack among them, carry the same
directives through the admin's `never_cache`.

### Read audit

Only permitted document-operations staff read attached payslips and extraction history, never
company owners or company-role accounts. Every operations page, file,
extraction and changelist read records `DocumentRead`, and an audit write failure refuses delivery.
Audit rows survive content purge and have no admin mutation path.

A publication to members audits a member's document reads the same way
([publication reads](records.md#publication-policies-and-read-audit)); its purge deletes them.

Company documents carry no read audit, for the owner, staff in admin or an investor opening an
offering's documents: they are offer information, not personal records.

A [company pack](records.md#documents-and-evidence-copies) carries only files stored under
`companies/`: the company's documents, its register evidence copies, its publications' documents
and its payment records' remittance evidence. No file under `users/` or `documents/` leaves in a
pack.

## Deletion and retention

The single statement of each retention clock and what its purge removes and leaves.
Settings and defaults are in [configuration](../operations/configuration.md), and the job schedule
in [jobs](../operations/jobs-and-storage.md#schedule).

### Ordinary deletion and orphans

Ordinary private-file deletion runs on commit, so a rollback cannot restore a row whose bytes
are gone. The nightly orphan sweep
(`sweep_private_uploads`) removes files that interrupted writes left without rows, walking only
`companies/` and `documents/` and requiring 24 hours without a change to protect the interval
between file write and row commit. New private fields must be swept or explicitly classified as
retained, with a reason.

### Retention clocks

| Record                                                                 | Clock                                                                                                                                                                                         | Purge                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Classification evidence                                                | `CLASSIFICATION_EVIDENCE_RETENTION_DAYS` from `reviewed_at` for a rejected, revoked or withdrawn claim and from `expires_at` for a verified one; `0` keeps it indefinitely and purges nothing | `purge_classification_evidence` deletes the bytes, preserving status and content-free metadata                               |
| Attached payslip                                                       | The claim's clock                                                                                                                                                                             | `purge_document_evidence` removes the file, extraction output, filenames and notes, keeping claim links and read audit       |
| Unattached payslip                                                     | `UNATTACHED_DOCUMENT_RETENTION_DAYS` from upload; `0` keeps it indefinitely                                                                                                                   | `purge_document_evidence`                                                                                                    |
| Former members, member particulars and unbound register export records | `FORMER_MEMBER_RETENTION_DAYS`, at least 2,557 days                                                                                                                                           | `purge_former_members_past_the_clock`, below                                                                                 |
| Publications to members                                                | The same setting and floor, from the publication                                                                                                                                              | `purge_publications_past_the_clock` removes the publication, its roll, event chain and read records, and with them its files |
| Register decisions, uploads and copies; authority-request uploads      | No automatic expiry                                                                                                                                                                           | None, below                                                                                                                  |

The classification-evidence and payslip purges remove due private files and derived extraction
payloads only after fresh database checks under the source and document locks; a caller-supplied
future batch time or retention setting cannot authorise early deletion. `shared/0002_database_guards`
(through `users/database_guards.py`) copies `CLASSIFICATION_EVIDENCE_RETENTION_DAYS` and
`UNATTACHED_DOCUMENT_RETENTION_DAYS` into the users database guards, refusing a negative or
non-integer value. Payslip attachment, both evidence purges, eligibility requests, decisions and
evaluations, and approval refreshes refuse to run (`ImproperlyConfigured`) when the settings differ
from the installed values, so changing either clock needs a new migration that re-runs
`users.database_guards.install`. The certificate time zone (`TIME_ZONE`, fixed at UTC) is copied
and checked the same way.

2,557 days is seven years including two leap days. The classification reading is
unadvised ([legal position 3](../legal/positions.md#3-the-evidence-retention-period)), and neither
classification setting changes an eligibility decision. Serving and purge share one clock: read
paths refuse evidence as soon as it passes, and the purge deletes the bytes later.

`FORMER_MEMBER_RETENTION_DAYS` behaves the opposite way: `retention_cutoff` raises
`ImproperlyConfigured` below 2,557 days, so the floor cannot be configured away and `0` is not a
valid value. It implements the accepted, unadvised seven-year assumption for s169(3)
([legal position 1](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)).
The daily purge removes, once past the cutoff:

- former-holder rows and the cessation records of members who no longer hold shares, measured from
  the cessation date; a later full-history fold cannot recreate what it removed;
- imported former members, from their date ceased;
- a member's recorded particulars, from the last date the member held shares in the company;
- register export records, from the export, except those linked to a member certificate fulfilment.

Member certificate fulfilments, their original export records and their private files have no automatic
expiry. The export purge excludes them, preserving their immutable recipient-only output history.

It removes nothing else of a register opening, import, correction, wallet link, particulars change,
grant or direct transfer: during the synthetic experiment a proposal's document copies, decisions,
captured boundaries and identity snapshots, and the company's evidence uploads, used or not, have no
automatic expiry. Every register decision retains a private copy of the company's upload with its
size, type and SHA-256, a particulars change also its own copy of the recorded name and residential
address, and a staff-era proposal its copy of the staff-verified document. The database refuses
ordinary deletion of these rows; only copies left by a rolled-back or interrupted preparation fall
under the orphan sweep.

Documents uploaded after an authority request belong to the company document record and do not
alter the request. Production retention is decided before any real data, and account and company deletion still respect the
protected register relations.

### Classification evidence and payslips

Classification evidence outlives account deletion: a submitted claim is withdrawn rather than
hard-deleted, admin deletion is refused and its account link is protected.

Supporting payslips attach once to an accessible, submitted classification, copying the bytes to
retained storage and deleting the old copy only on commit; attaching neither verifies the claim nor
changes eligibility. Cascades cannot delete an attached row that still holds content, and
storage failures during a purge leave a retryable reference.

## Upload validation

Every upload is byte-bounded, scanned by ClamAV and decoded as PDF, PNG or JPEG before permanent
storage, and its actual type must match the MIME type and extension. Encrypted or repaired PDFs,
truncated or animated images and over-budget content are refused. Original evidence bytes are
preserved; size and MIME type derive from the checked bytes. Only one file is accepted per request.

ASGI bounds request bytes and body arrival time before spooling, including chunked bodies and
falsely small declared sizes, on every resolved upload-create route. WSGI bounds size and reads but
cannot interrupt a blocked socket read, so it needs a server or proxy timeout. Pre-authentication
refusals keep the ingress limits and charge no user quota.

Authenticated attempts and file bytes consume shared Redis quotas before scanning or saving;
accepted and rejected attempts both count, and a quota rejection admits no more work. Redis Lua
reserves count and bytes atomically across processes on the server clock. Files parsed during
successful cookie CSRF authentication are charged before validation; authentication or CSRF
failures, and files refused while authentication is still parsing, have no user to charge but the
same body and file caps. A missing atomic cache implementation or unavailable Redis answers 503,
quota denial 429 with `Retry-After`. Worker restarts keep the quota; Redis data loss resets it.

The scanner client streams each file to clamd with the
[INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)
([scanner deployment](../operations/jobs-and-storage.md#malware-scanning)). An exact clean verdict
is mandatory; connection errors, malformed replies and unavailable scanning fail closed with 503.
The client runs in a child with a parent deadline that also covers DNS resolution. Detected files
return 400 and are never saved to permanent storage; there is no retained quarantine or bypass
switch. Malware scanning cannot prove arbitrary content harmless.

Each decoder or scanner child turns core dumps off and sets its address-space, CPU and file-size
limits before reading the upload, refusing to run unless each is a positive integer, so a setting
below 1 fails every upload instead of lifting a limit. The limits contain work; they are not
a security sandbox or an aggregate concurrency limit
([upload limits](../operations/jobs-and-storage.md#upload-limits)).

Extraction rereads and rescans the stored bytes, renders the first page in a resource-limited
child (which shares the service's OS identity and is not a security sandbox) and sends a bounded
PNG to the configured local model. Failure preserves the original and records a failed extraction.
These controls do not retroactively certify legacy files.

Next: [backend](backend.md), [testing](testing.md),
[upload operations](../operations/jobs-and-storage.md) and
[legal retention positions](../legal/positions.md).
