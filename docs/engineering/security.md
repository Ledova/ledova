# Security model

[Engineering](README.md) · [Documentation](../README.md)

How the backend authenticates sessions, isolates tenants in PostgreSQL, stores and serves private
files, retains and purges them, and validates uploads. For engineers; the settings behind these
mechanisms are in [configuration](../operations/configuration.md), and native transport and
secrets are in [mobile](mobile.md).

## Authentication and sessions

- One authentication class, `authentication.classes.HybridJWTAuthentication`, is the DRF default;
  `IsAuthenticated` is the default permission.
- Sessions are simplejwt refresh tokens with the `token_blacklist` app. A refresh rotates and
  blacklists the token presented; `signout` revokes one session, `signout-all` every session. The
  access token carries its refresh's jti (`rjti`) and every request checks that session is live,
  so revocation takes effect on the next request. An admin email change
  (`authentication/admin/user.py`) and an account deletion (`users/services/lifecycle.py`) revoke
  every session; a password change (`authentication/views/user.py`) revokes every other, passing
  its own `rjti` as `keep_jti`. Both tokens default to seven days.
- `X-Auth-Transport: bearer` returns the tokens in the response body and sets no cookie; without
  the header the access and refresh cookies are set (`httponly`, flags from
  `settings.AUTH_COOKIE`). The dashboard uses cookies, mobile sends the header.
- CSRF applies to the cookie transport only. A cookie-sourced POST, PUT, PATCH or DELETE runs DRF's
  `CSRFCheck`; invalid CSRF receives `403 CSRF Failed`. A Bearer request wins over an `access`
  cookie replayed beside it. The readable `csrftoken` cookie is issued by `auth/verify`, sign-in
  and email verification; the dashboard's axios client echoes it as `X-CSRFToken`.
- Sign-up requires an emailed six-digit code, hashed at rest, expiring after ten minutes and capped
  at five attempts. Sign-in, sign-up, verification and resend are throttled per address
  (`auth_email`, ten attempts in a rolling hour), shared by every backend worker through
  `CACHES["default"]`, which reserves each attempt atomically in Redis on Redis's clock.
  Successful and unsuccessful credential checks both consume an attempt; requests over the limit
  return 429 with `Retry-After`. The count survives backend restarts; Redis data loss or a cache
  clear resets it. An unreachable cache returns 503 before credentials are checked. The other DRF
  rate limits keep DRF's approximate counting; the strict atomic windows apply to `auth_email` and
  uploads. Test settings use `LocMemCache`.
- The Django admin uses ordinary Django sessions, not the JWT stack above. Company users use the
  client transport, not an admin session, and authentication confers no company mandate
  ([company authority boundaries](README.md#company-authority-boundaries)).

How the clients hold and refresh these sessions is in [frontend](frontend.md)
and [mobile](mobile.md).

## Tenancy model

One database serves one deployment. PostgreSQL row-level security (RLS) enforces tenant isolation.
Customer requests and principal-bearing jobs select authority at their boundary; product selectors
keep narrower company, account and eligibility rules where database read scopes are wider. RLS
visibility does not decide investor eligibility: directory and market selectors apply the
[eligibility consumers](backend.md#eligibility-decisions).

The roles below are PostgreSQL connection roles, not human job titles
([company authority boundaries](README.md#company-authority-boundaries)).

### Roles and principal

| Role | Purpose |
| --- | --- |
| App | Customer requests and scoped jobs; owns no tables and has no `BYPASSRLS` |
| Operator | Admin, explicit administrative jobs and bounded privileged services; has `BYPASSRLS` |
| Migrate | Owns the schema and applies migrations |

The app alias uses `CONN_MAX_AGE=0`. The principal is a session-level `app.user_id`, set after DRF
authentication by `SetsThePrincipalOnTheConnection` on the shared view bases. Middleware cannot
determine a bearer user's identity before authentication. The admin is recognised by resolved URL
configuration; provider webhooks explicitly select `RunsOnTheOperatorConnection`.

Every policy requires a non-null principal. An unset or cleared principal reads no tenant rows,
including tables with a public visibility branch. Serving entrypoints refuse the wrong ambient
alias. Transaction-level pooling cannot preserve this principal model; use session pooling or no
pooling. Provisioning and live checks are in
[database configuration](../operations/configuration.md#row-level-security-roles).

Use `shared.db.atomic` and `shared.db.on_commit` so transactions, queries and callbacks share the
current alias. Raw cursors name `connections[alias]`; `django.db.connection` reaches the default
connection and can bypass scope.

### Company rows

Company and `CompanyDocument` selectors admit a current personal `admin` appointment or the
bounded draft-setup exception
([authority rules](../business/companies.md#who-may-administer-a-company)). The
fixed-search-path definer `app_company_administration_ids()` exposes only company UUIDs, and
`app_visible_company_ids()` and `app_manageable_company_ids()` keep their owner terms for the
retained owner workflows (offerings, capital effects and share-class creation), which recheck the
live owner and active actor under company-first locks.

App writes to Company, CompanyDocument, authority requests, appointments, invitations and
legacy-owner sources are denied. The actor-bound services in `companies/services/`
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

- Policies are per command. UPDATE `USING` is the read scope so readable rows can be locked;
  `WITH CHECK` is the write scope. INSERT and DELETE use that write scope too.
- Positive ownership predicates fail closed for unknown owners. A visible child's non-nullable
  parents must also be readable, or `select_related` can remove rows that `count()` counted.
  Investor applications deliberately keep their company and offering identifiers after those
  parents become hidden; their route reads stored names and currency without joining them.
- The profile and account helpers define principal membership. The bounded company administration
  and public-discovery helpers return UUIDs through fixed-search-path `SECURITY DEFINER`
  functions. Public discovery keeps the active and open, deployed and non-empty-address terms and
  requires a principal; it supplies no private document, profile or basic administration access.
  These explicit boundaries prevent circular company and token policy evaluation. Other invoker
  helpers and participant scopes keep their existing terms.
- A company may read subscriber accounts, wallets and profiles for its own offerings. Personal API
  surfaces still select the caller's own records. A company's nullable operator-wallet link does
  not expose its owner's profile to an ordinary viewer of that company.
- A member reads a company's row only through an account resolved once and stored, never through a
  live join. `Wallet` is unique per (account, chain, address), so two accounts can hold one
  address and an address join would cross tenants.
- `shared/0002_database_guards` installs the catalogue's roles, grants, policies and helpers on a
  fresh database; there is no in-place adoption path for an older one.

`policies.py` is read at migration time, so changing it alters what a fresh database gets while
every existing database keeps what it was given. A schema or catalogue change that alters the live
policies therefore needs a migration that re-runs `shared.db.policy_sql.install`.
`check_rls_catalogue` compares installed policies and helpers with the installer inside a
rolled-back transaction: PostgreSQL-normalised expressions, policy roles and permissiveness, and
helper properties. It runs after migration, not on the scoped serving connection.
`check_rls_roles` checks live connection privileges, grants and principal state. Both run in
[backend verification](testing.md#backend-verification).

### Requests and jobs

`PolicyQuerysets` starts from the model manager and applies explicit product filtering in
`narrow()`. Redundant Python tenancy predicates are removed. Writable foreign keys stay scoped in
serializer `get_fields()`.

A scoped task requires its principal in the enqueue contract. Where the existing required
recipient ID already is the principal, the task refuses a missing ID. `acting_for(None)`
deliberately selects operator authority; it is appropriate only for a classified administrative
invocation. Worker ambient authority is operator, so omitting a scope would widen access.

The [task catalogue](../../backend/shared/tasks/catalogue.py) records authority and bounded operator
handoffs. Deployments, issuance execution, capital increases, pause changes and subscription
allotment are operator jobs that a company's applied decision produces; `executed_by` records the
actor for audit and does not choose a tenant principal. New work requires explicit company
authority and a bounded handoff; changing the enqueueing UI or omitting the principal is not
enough.

Wallet producers insert transaction-screening jobs on their current connection inside the wallet
transaction. The worker explicitly selects operator authority and commits alerts with
`monitoring_completed_at`; rollback removes both, and redelivery does not screen twice.

Deployment captures the applying principal and the company's exact approval and scopes token
lifecycle writes. Its operator-only broadcast journal commits independently before sending,
rechecking the consumed approval under a lock; an outer transaction cannot undo that durable
boundary ([share-class deployment](chain.md#share-class-deployment),
[recovery](../operations/recovery.md)).

Three bounded operator reads serve product behaviour that ownership alone would refuse: resolving
a supplied active company UUID for an associated-person claim, fetching public market prices for
already admitted tokens, and reading the documents attached to the approved or closed offerings of
a share class the caller's directory admits
([offering data flow](backend.md#offering-data-flow)). Each resolves what the
caller may see under the app role first and bounds one operator query to it. They expose no private
orders or wallets.

Order creation authorises the exact submission in app scope, then rechecks its owner and wallet
under locks in one bounded operator transaction
([create protocol](trading-protocols.md#creating-an-order)).

## Private files

Uploaded evidence is private in every storage mode. File ownership and the retention clock decide
who can read or remove it; a public media URL never substitutes for an authenticated route, and no
upload is served by `/media/`, including in debug mode. A company appointment authorises only that
company's documents and tasks; it grants no access to participants' private identity,
classification or financial evidence. Supporting evidence keeps the same private access, review
and retention safeguards on hosted and private instances.

### Storage

Private `FileField`s declare `storage=private_storage` and `max_length=255`.
`PrivateMediaStorage.base_url` is null, so `.url` raises. Discovery follows the storage declaration
and alias for each adapter ([where files live](../operations/jobs-and-storage.md#private-storage)).
Stored keys end in a fresh UUID and extension; no email or original filename is embedded. Company,
account and classification UUIDs in prefixes remain pseudonymous identifiers.

| Upload | Storage prefix and lifecycle |
| --- | --- |
| Representative authority request | `companies/<uuid>/authority-requests/`; the immutable request retains private evidence; uncommitted-copy orphans are swept |
| Company register decision: opening, import, correction, wallet link, particulars change, grant, transfer, capital increase, pause change, instruction, employee award, vesting event, external allotment | `companies/<uuid>/register-evidence/` for the company's upload and `register-<kind>/` for the decision's own copy: `register-openings/`, `register-imports/`, `register-corrections/`, `register-links/`, `register-particulars/`, `register-grants/`, `register-transfers/`, `register-capital-increases/`, `register-pause-changes/`, `register-instructions/`, `register-awards/`, `register-award-vestings/` and `register-allotments/`; both are retained with their rows; interrupted-copy orphans are swept |
| Member certificate fulfilment | `companies/<uuid>/member-certificates/`; the recipient-only file a company's fulfilment produced, retained with its fulfilment record |
| Publication to members | `companies/<uuid>/publications/`; retained with its row until the publication purge |
| Dividend payment evidence | `companies/<uuid>/publications/<publication>/payments/`; retained with its payment record until the publication purge |
| Company document | `companies/<uuid>/documents/<type>/`; swept after becoming an orphan |
| Unattached payslip | `documents/`; ordinary deletion and orphan cleanup |
| Classification evidence | `users/`; retained by the classification clock |
| Attached payslip | `users/supporting-documents/`; retained with its claim |

### Serving

An authenticated serving action resolves the row before streaming it. Foreign and phantom customer
rows return the same 404; anonymous requests return 401. Staff read company files through admin
rather than widening customer ownership selectors. `admin_file_path` checks model and object view
permission; refused staff receive 403, matching the change page.

The company document serializer returns the authenticated route as `file_url`; a personal
document and classification evidence are read only through admin. The dashboard opens a file by
top-level navigation with its session cookie. Mobile fetches with its bearer client and shares a
temporary cached copy ([mobile](mobile.md)).

Documents of a class's published offerings are also streamed to the investors the directory
admits, through the directory route under these serving rules
([offering data flow](backend.md#offering-data-flow)).

Admin downloads are attachments. Customer serving is inline only for the allowed PDF, PNG and JPEG
MIME types; other or absent types become attachments. `stream_stored_file`, which every customer
file route uses, marks each response `Cache-Control: private, no-store`, so neither a shared cache
nor the browser keeps a copy; admin downloads, the company pack among them, carry the same
directives through the admin's `never_cache`.

### Read audit

Permitted document-operations staff read attached payslips and extraction history. Company owners
and company-role accounts do not gain that cross-customer access. Every operations page, file,
extraction and changelist read records `DocumentRead`; an audit write failure refuses delivery.
Audit rows survive content purge and have no admin mutation path.

A publication to members follows the same read-audit rule for a document a member reads
([publication reads](records.md#publication-policies-and-read-audit)),
except that its read records are deleted with it when it is purged.

Company documents carry no read audit: not for the owner, not for staff in admin, and not for an
investor opening an offering's documents. They are offer information the company chose to give
every eligible investor, not a personal record such as a payslip or a member's own statement.

A [company pack](records.md#documents-and-evidence-copies) carries a company's documents, the
evidence copies its register changes retained, its publications' documents and its payment
records' remittance evidence, all stored under `companies/`. No file stored under `users/` or
`documents/` leaves in a pack.

## Deletion and retention

This is the single statement of what each retention clock measures and what each purge removes and
leaves. The settings and their defaults are in [configuration](../operations/configuration.md);
the schedule of the jobs below is in [jobs](../operations/jobs-and-storage.md#schedule).

### Ordinary deletion and orphans

The lifecycle receiver schedules ordinary private-file deletion on commit, so a database rollback
cannot restore a row whose bytes were already destroyed. The nightly orphan sweep
(`sweep_private_uploads`) handles files left without rows by interrupted writes. It walks only the
swept prefixes (`companies/` and `documents/`) and requires 24 hours without a change, protecting
the interval between file write and row commit. New private fields must be swept or explicitly
classified as retained, with a reason.

### Retention clocks

| Record | Clock | Purge |
| --- | --- | --- |
| Classification evidence | `CLASSIFICATION_EVIDENCE_RETENTION_DAYS` from `reviewed_at` for a rejected, revoked or withdrawn claim and from `expires_at` for a verified one; `0` keeps it indefinitely and purges nothing | `purge_classification_evidence` deletes the bytes, preserving status and content-free metadata |
| Attached payslip | The claim's clock | `purge_document_evidence` removes the file, extraction output, filenames and notes, keeping claim links and read audit |
| Unattached payslip | `UNATTACHED_DOCUMENT_RETENTION_DAYS` from upload; `0` keeps it indefinitely | `purge_document_evidence` |
| Former members, member particulars and register export records | `FORMER_MEMBER_RETENTION_DAYS`, at least 2,557 days | `purge_former_members_past_the_clock`, below |
| Publications to members | The same setting and floor, from the publication | `purge_publications_past_the_clock` removes the publication, its roll, event chain and read records, and with them its files |
| Register decisions, uploads and copies; authority-request uploads | No automatic expiry | None, below |

The classification-evidence and payslip purges remove due private files and derived extraction
payloads only after fresh database checks under the source and document locks; a caller-supplied
future batch time or retention setting cannot authorise early deletion. The guard migration
(`shared/0002_database_guards`, through `users/database_guards.py`) copies
`CLASSIFICATION_EVIDENCE_RETENTION_DAYS` and `UNATTACHED_DOCUMENT_RETENTION_DAYS` into the users
database guards and refuses a negative or non-integer value. Payslip attachment, both evidence
purges, eligibility requests, decisions and evaluations, and approval refreshes compare the settings
with the installed values and refuse to run on a mismatch (`ImproperlyConfigured`), so changing
either clock needs a new migration that re-runs `users.database_guards.install`. The certificate
time zone (`TIME_ZONE`, fixed at UTC) is copied and checked the same way.

2,557 days is seven calendar years including two leap days. The classification reading is
unadvised ([legal position 3](../legal/positions.md#3-the-evidence-retention-period)); neither
classification setting changes an eligibility decision. The serving horizon and the purge share
one clock: read paths refuse evidence immediately after the horizon and the purge deletes the bytes
later.

`FORMER_MEMBER_RETENTION_DAYS` behaves the opposite way: `retention_cutoff` raises
`ImproperlyConfigured` below 2,557 days, so the floor cannot be configured away and `0` is not a
valid value. It implements the accepted, unadvised seven-year assumption for s169(3)
([legal position 1](../legal/positions.md#1-section-1693-members-who-ceased-in-the-last-seven-years)).
The daily purge removes, once past the cutoff:

- former-holder rows and the cessation records of members who no longer hold shares, measured from
  the cessation date; a later full-history fold cannot recreate what it removed;
- imported former members, from their date ceased;
- a member's recorded particulars, from the last date the member held shares in the company;
- register export records, from the export.

It removes nothing else of a register opening, import, correction, wallet link, particulars change,
grant or direct transfer. A proposal's copies of its register, ASIC, authority, supporting, terms,
acceptance and instrument documents, its decisions, captured boundaries and identity snapshots,
and the company's evidence uploads of kind `share_register`, `asic_extract`, `authority` or
`supporting`, including those no proposal used, are evidence with no automatic expiry during the
synthetic experiment. Every register decision retains a private copy of the company's upload with
its size, type and SHA-256, and a particulars change also its own copy of the recorded name and
residential address; one submitted before the decisions were company-run keeps its copy of the
staff-verified document. The database refuses ordinary deletion of these rows; only copies left by
a rolled-back or interrupted preparation fall under the orphan sweep.

A representative authority request retains any supplied private upload with the immutable
request, readable only by its requester and never purged automatically. Signup requests need no
file; documents uploaded later belong to the company document record and do not alter the
retained request.

Production retention is decided before any real data. Account and company deletion still respect
the protected register relations, and classification evidence, former-member retention and export
records keep their independent policies.

### Classification evidence and payslips

Classification evidence outlives account deletion. A submitted claim is withdrawn rather than
hard-deleted; admin deletion is refused and its account link is protected.

Supporting payslips attach once to an accessible, submitted classification. Attachment copies the
bytes to retained storage and deletes the old copy only on commit. It neither verifies the claim
nor changes eligibility. Cascades cannot delete an attached row that still holds content. Storage
failures during a purge leave a retryable reference.

## Upload validation

Every upload is byte-bounded, scanned by ClamAV and decoded as PDF, PNG or JPEG before permanent
storage. The actual type must match the MIME type and extension. Encrypted or repaired PDFs,
truncated or animated images and over-budget content are refused. Original evidence bytes are
preserved; size and MIME type derive from the checked bytes. Only one file is accepted per request.

ASGI bounds request bytes and body arrival time before spooling, including chunked bodies and
falsely small declared sizes, on every resolved upload-create route. WSGI bounds size and reads but
cannot interrupt a blocked socket read, so it needs a server or proxy timeout. Pre-authentication
refusals keep the ingress limits without claiming a user quota was charged.

Authenticated attempts and file bytes consume shared Redis quotas before scanning or saving:
accepted and rejected attempts both count, and a quota rejection does not admit more work. Redis
Lua uses the server clock and reserves count and bytes atomically across processes. Files parsed
during successful cookie CSRF authentication are charged before validation. Authentication or
CSRF failures, and files refused while authentication is still parsing, have no completed user
identity to charge but have the same body and file caps. A missing atomic cache implementation or
unavailable Redis returns 503; quota denial returns 429 with `Retry-After`. Worker restarts keep
the quota; Redis data loss resets it.

The scanner client streams each file to clamd with the
[INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)
([scanner deployment](../operations/jobs-and-storage.md#malware-scanning)). An exact clean verdict
is mandatory; connection errors, malformed replies and unavailable scanning fail closed with 503.
The client runs in a child with a parent deadline that also covers DNS resolution. Detected files
return 400 and are never saved to permanent storage; there is no retained quarantine or bypass
switch. Malware scanning cannot prove arbitrary content harmless.

Each decoder or scanner child refuses to run unless its address-space, CPU and file-size limits
are positive integers, so a setting below 1 fails every upload instead of lifting a limit. It turns
core dumps off and sets the limits before reading the upload. The limits contain work; they are not
a security sandbox or an aggregate concurrency limit. Platform behaviour, the settings and the proxy
and clamd alignment are in [upload limits](../operations/jobs-and-storage.md#upload-limits).

Extraction rereads and rescans the stored bytes, renders the first page inside a resource-limited
child and sends a bounded PNG to the configured local model. The child shares the service's OS
identity and is not a security sandbox. Failure preserves the original and records a failed
extraction. These controls do not retroactively certify legacy files.

Next: [backend](backend.md), [testing](testing.md),
[upload operations](../operations/jobs-and-storage.md) and
[legal retention positions](../legal/positions.md).
