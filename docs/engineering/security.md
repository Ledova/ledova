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
  503 before credentials are checked. Auth-email, password-reset and upload limits have strict atomic windows;
  other DRF rate limits count approximately. Test settings use `LocMemCache`.
- Web password recovery has separate anonymous request and confirmation actions. A valid email
  request receives the same acknowledgement and queues the same task before account lookup; only
  an active, email-verified account with a usable password receives a link. Delivery runs in the
  existing worker, so account eligibility and provider response time do not change the request
  response. Reset requests allow five attempts per address per hour, confirmations ten per account
  per hour, and both actions share thirty attempts per IP per hour; their Redis reservations fail
  closed. These limits count attempts, not successful resets.
- The reset link uses Django's password-bound token, expires after ten minutes and carries its
  account/proof in a URL fragment. The web page removes the fragment and keeps it only in memory;
  passwords and proof are not put in browser storage. Confirmation locks and rechecks the account,
  validates the password, consumes the old proof through the password change and revokes all
  sessions. Sign-in, refresh, email verification and password changes use the same account lock;
  a password change rechecks its current password and live session before saving.
  Reset neither signs the person in nor changes account verification, standing or company authority.
- The Django admin uses ordinary Django sessions, not the JWT stack; company users use the client
  transport, and authentication confers no company mandate
  ([company authority boundaries](README.md#company-authority-boundaries)).

## Tenancy model

One database serves one deployment, and PostgreSQL row-level security (RLS) enforces tenant
isolation. Customer requests and principal-bearing jobs select authority at their boundary; product
selectors keep narrower company and account rules where database read scopes are wider. RLS
visibility does not decide who sees a company's market: market selectors apply the
[current-participant rules](backend.md#current-participants). The roles below are PostgreSQL
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

Company selectors admit a current personal `admin` appointment or the
bounded draft-setup exception
([authority rules](../business/companies.md#who-may-administer-a-company)) through
`app_company_administration_ids()`, which exposes only company UUIDs. `app_visible_company_ids()`
and `app_manageable_company_ids()` keep their owner terms for the retained owner workflows
(offerings and capital effects), which recheck the live owner and active actor under company-first
locks. Share-class creation instead selects a current personal administrator or preparer and
rechecks that authority inside the locked register command (`backend/tokens/services/creation.py`).

App writes to Company, authority requests, appointments, invitations and
legacy-owner sources are denied, and the app role has no grants on activation receipts; the
actor-bound services in `companies/services/` (`administration.py`, `editing.py`,
`authority_requests.py`, `team.py`, `activation.py`) carry the
caller's principal, lock the company before the live account, profile, identity requirement and
appointments, and check the clock after the wait. Policies scope authority requests to their
requester, appointments to their appointee and invitations to their inviter; team reads go
through the administration check and exclude private identity, financial and authority evidence.
Triggers attached in `companies/database_guards.sql`, with functions there and in
`companies/authority_guards.sql`, refuse any update or deletion of authority requests, withdrawals,
appointments, invitations, revocations and legacy-owner sources, and check admission, withdrawal,
acceptance and revocation; those in `companies/activation_guards.sql` do the same for activation
receipts and check activation.

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
  profile or basic administration access.
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

A Profile save is a bounded operator write. `PATCH /api/user-profiles/<uuid>/` runs on the operator
connection so that a saved full name or residential address reaches every register that currently
links the person in the same transaction
([particulars from Profile](../business/member-records.md#particulars-from-profile)). `narrow()` binds
it to the signed-in person's own locked row, and the serializer keeps provider identity results and
the email read-only. The save also marks its transaction with the person's ID in `app.profile_save`
for the profile update alone, and the `users_provider_identity` trigger checks a marked write as it
checks an app-role one: it refuses any change to provider identity results and any row but the
saving person's own. Unmarked operator writes, the verification service's and account deletion's,
are unchanged. The register guards accept a member's change only through the person's own
current association for that company and member, with each value taken from their profile or kept,
as an applied change over the exact current particulars, and they refuse a company's edit of a
member who has a current association
([particulars changes API](records.md#particulars-changes-api)).

## Private files

Uploaded evidence is private in every storage mode and on every instance. File
ownership and the retention clock decide who can read or remove it; no upload is served by
`/media/`, including in debug mode, and a public media URL never substitutes for an authenticated
route. A company appointment reaches only that company's register evidence and tasks, never
participants' private identity or financial evidence.

### Storage

Private `FileField`s declare `storage=private_storage` and `max_length=255`.
`PrivateMediaStorage.base_url` is null, so `.url` raises. Discovery follows the storage declaration
and alias for each adapter ([where files live](../operations/jobs-and-storage.md#private-storage)).
Stored keys end in a fresh UUID and extension, embedding no email or original filename; company
UUIDs in prefixes are pseudonymous.

| Upload                           | Storage prefix and lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Representative authority request | `companies/<uuid>/authority-requests/`; retained with the immutable request; uncommitted-copy orphans are swept                                                                                                                                                                                                                                                                                                                                                                                                   |
| Company register decision        | `companies/<uuid>/register-evidence/` for the company's upload and a per-kind prefix for the decision's own copy: `register-openings/`, `register-imports/`, `register-corrections/`, `register-links/`, `register-particulars/`, `register-grants/`, `register-transfers/`, `register-capital-increases/`, `register-pause-changes/`, `register-instructions/`, `register-awards/`, `register-award-vestings/` and `register-allotments/`; both are retained with their rows; interrupted-copy orphans are swept |

### Serving

An authenticated serving action resolves the row before streaming it. Foreign and phantom customer
rows return the same 404; anonymous requests return 401. Staff read company files through admin
(`admin_file_path`, [admin row actions](backend.md#admin-row-actions)) rather than widening
customer ownership selectors; refused staff receive 403, matching the change page.

The dashboard opens a file by top-level navigation with its session cookie; mobile fetches with its
bearer client ([document view copies](mobile.md#document-view-copies)).

Admin downloads are attachments; customer serving is inline only for the allowed PDF, PNG and JPEG
MIME types, and an attachment otherwise. `stream_stored_file`, which every customer
file route uses, marks each response `Cache-Control: private, no-store`, so neither a shared cache
nor the browser keeps a copy; admin downloads, the company pack among them, carry the same
directives through the admin's `never_cache`.

### Read audit

Register evidence downloads carry no read audit
([decision](../decisions.md#company-run-register-authority-and-evidence)).

A [company pack](records.md#documents-and-evidence-copies) carries only files stored under
`companies/`: the company's register evidence copies. Nothing else leaves in a pack.

## Deletion and retention

The single statement of each retention clock and what its purge removes and leaves.
Settings and defaults are in [configuration](../operations/configuration.md), and the job schedule
in [jobs](../operations/jobs-and-storage.md#schedule).

### Ordinary deletion and orphans

Ordinary private-file deletion runs on commit, so a rollback cannot restore a row whose bytes
are gone. The nightly orphan sweep
(`sweep_private_uploads`) removes files that interrupted writes left without rows, walking only
`companies/`, `documents/` and `users/` and requiring 24 hours without a change to protect the
interval between file write and row commit. No current model stores files under `documents/` or
`users/`; the sweep there removes any file of the removed investor evidence and payslips that its
migration's deletion missed, as it does under `companies/<uuid>/documents/` for the removed company
documents. It never deletes a file under `companies/<uuid>/publications/`
(`RETAINED_STORAGE_PATHS` in [storage.py](../../backend/shared/storage.py)), where shareholder
publications kept their documents and payment evidence: no model references them since publications
were [removed](../decisions.md#shareholder-publications-removed), and a database whose removal
migration refused still holds their rows. New private fields must be swept or explicitly
classified as retained, with a reason.

### Account closure and export

The `delete-account` action in [lifecycle.py](../../backend/users/services/lifecycle.py)
replaces the sign-in email, disables the account and password, clears unused email-verification
codes and revokes sessions. It erases personal profile and identity-provider metadata, financial
answers, preferences, device tokens and inbox notifications. Account-only risk assessments and
identity/periodic-review alerts are removed unless linked to an identified retained compliance
case. Executed transaction journals and specific flagged/filed case evidence remain separate.
Provider callbacks, profile and account writers recheck the fresh active user under account locks;
inactive callbacks cannot repopulate erased details. Company-first profile locking is preserved.

If a provider holds an applicant, closure creates a private operator-only erasure work item before
clearing the profile. A signed callback for an unused duplicate provider profile is tracked in
the same queue rather than overwriting the current applicant. An operator must request
**permanent** supplier deletion, not reversible
deactivation, and record genuine confirmation. The target is thirty days. Applicant IDs and the
completion address are kept only for that follow-through, then cleared after confirmation and
notice. A specific legal hold needs its case, reason and review date; it is not a blanket exemption
for registry users. Pending, overdue and held items remain visible to the operator. No supplier
request is silently treated as completed. An active account’s current applicant cannot be
completed as erased; an unused duplicate additionally needs explicit operator confirmation.

Stable user, profile and account identifiers remain for protected references. Company member
particulars, associations, decisions, evidence and copied snapshots are retained separately for the
company's recorded purpose; closure neither edits them nor fabricates a company revocation.
Inactive users lose access. The [account summary](records.md#account-data-export) includes the
person's Terms receipts but is not every record companies hold about them.

The legacy [financial-profile API](../../backend/users/views/financial_profile.py) only lists the
caller's retained records. It accepts no new POST or PATCH collection; the retired detail route
is absent. Existing model/admin records, compliance reads, account summary and account erasure
remain. No web or native signup sends financial-profile answers.

Company exit is separate from account deletion. The maintenance-only
[company-disposal command](../operations/operator-console.md#company-exit) requires verified
company instruction, export handover and purpose/hold review. It supports the non-chain registry
graph, including copied history and evidence, while preserving sign-ins and other companies.
Runtime application/operator roles cannot use its private receipt or deletion admission. The
schema-maintenance credential supplies a reviewed, exact-row manifest bound to one company and
transaction; guards admit only those DELETEs, never ordinary history edits. Unknown relationships
and retained execution history refuse disposal. Current authority is rechecked before deletion
and expiry before commit; a stale preview or failed database-deletion transaction removes no
company rows or files.

Files are removed only after database commit, with a private retryable list. Database disposal and
current-storage completion are separate states; neither proves delivery to the company or erasure
of support mail, logs, supplier copies or retained archives. The operator must review those copies,
record any lawful remaining purpose/expiry and drain in-flight company work before disposal.
No command disables triggers or substitutes a universal seven-year period. Factual live supplier
and copy-lifecycle acceptance remains under [#1589](https://github.com/Ledova/ledova/issues/1589).

Versioned Terms acceptance is recorded separately in immutable operator-only
[receipts](../../backend/authentication/models/terms_acceptance.py). New signup or explicit renewal
requires the current version and acknowledgement. Existing booleans are not backfilled; historical
company Terms and appointments are preserved. Public versions remain accessible.

### Retention clocks

| Record                                                                 | Clock                                               | Purge                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Former members, member particulars and unbound register export records | `FORMER_MEMBER_RETENTION_DAYS`, at least 2,557 days | `purge_former_members_past_the_clock`, below        |
| Register decisions, uploads and copies; authority-request uploads      | Purpose/hold review; no automatic expiry            | Reviewed maintenance-only company exit, above       |
| Uncompleted signup without protected history or a provider follow-up   | Thirty days without signup/login activity           | Existing daily maintenance erases account-only data |
| Expired JWT and Django session rows                                    | Token/session expiry                                | Existing daily maintenance removes expired rows     |
| Successful / unsuccessful jobs                                         | Seven / thirty days                                 | Existing job maintenance                            |
| Unreferenced private uploads                                           | At least 24 hours unchanged                         | Existing orphan sweep                               |

2,557 days is seven years including two leap days. `FORMER_MEMBER_RETENTION_DAYS` has a floor:
`retention_cutoff` raises `ImproperlyConfigured` below 2,557 days, so the floor cannot be
configured away and `0` is not a valid value. It implements the accepted, unadvised seven-year assumption for s169(7)
([legal position 1](../legal/positions.md#1-section-1697-members-who-ceased-in-the-last-seven-years)).
The daily purge removes, once past the cutoff:

- former-holder rows and the cessation records of members who no longer hold shares, measured from
  the cessation date; a later full-history fold cannot recreate what it removed;
- imported former members, from their date ceased;
- a member's recorded particulars, from the last date the member held shares in the company;
- register export records, from the export.

It removes nothing else of a register opening, import, correction, wallet link, particulars change,
grant or direct transfer: during the synthetic experiment a proposal's document copies, decisions,
captured boundaries and identity snapshots, and the company's evidence uploads, used or not, have no
automatic expiry. Every register decision retains a private copy of the company's upload with its
size, type and SHA-256, except a one-step particulars change, which takes no upload; a particulars
change also keeps its own copy of the recorded name and residential address and, when made in one
step or from a linked member's Profile, of the particulars it replaced; and a staff-era proposal or
retained instruction keeps its copy of the staff-verified company document, which was itself
deleted when company documents were [removed](../decisions.md#company-documents-removed). The
database refuses ordinary deletion of these rows; only copies left by a rolled-back or interrupted
preparation fall under the orphan sweep.

The account periods and service Terms were accepted by the owner on 9 November under
[#1589](https://github.com/Ledova/ledova/issues/1589). The former-member clock implements the
company-register assumption; it does not erase older names/addresses embedded in immutable
imports, decisions or evidence. Reviewed company exit can remove the supported company-scoped
records and current storage separately; retained archives and supplier copies need their own
reviewed treatment. The live supplier/retention assessment remains a release gate. No
implementation here authorises real-data use.

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

These controls do not retroactively certify legacy files.

Next: [backend](backend.md), [testing](testing.md),
[upload operations](../operations/jobs-and-storage.md) and
[legal retention positions](../legal/positions.md).
