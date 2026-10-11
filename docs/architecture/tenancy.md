# Tenancy model

[Architecture](README.md)

One database serves one deployment. PostgreSQL row-level security (RLS) enforces
tenant isolation. Customer requests and principal-bearing jobs select authority
at their boundary; product selectors retain narrower company, account and
eligibility rules where database read scopes are wider.

## Company authority

The roles below are PostgreSQL connection roles, not human job titles. Company
capabilities come from recorded appointments
([authority guide](../plans/company-managed-registers/authority-requests.md));
shareholder membership and a platform staff role grant none, and customer
requests never gain unrestricted `BYPASSRLS` or direct ledger writes. Bounded
privileged services execute a company-authorised command after exact company and
commit-time mandate checks, and enqueued unsigned work rechecks authority after
revocation ([outgoing signing](outgoing-signing.md#company-decisions-and-signer-authority)).

## Roles and principal

| Role     | Purpose                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| App      | Customer requests and scoped jobs; owns no tables and has no `BYPASSRLS`             |
| Operator | Admin, explicit administrative jobs and bounded privileged services; has `BYPASSRLS` |
| Migrate  | Owns the schema and applies migrations                                               |

The app alias uses `CONN_MAX_AGE=0`. The principal is a session-level
`app.user_id`, set after DRF authentication by `SetsThePrincipalOnTheConnection`
on the shared view bases. Middleware cannot determine a bearer user's identity
before authentication. The admin is recognized by resolved URL configuration;
provider webhooks explicitly select `RunsOnTheOperatorConnection`.

Every policy requires a non-null principal. An unset or cleared principal reads
no tenant rows, including tables with a public visibility branch. Serving
entrypoints refuse the wrong ambient alias. Transaction-level pooling cannot
preserve this principal model; use session pooling or no pooling. Provisioning
and live checks are in [database configuration](../operations/configuration.md#row-level-security-roles).

Use `shared.db.atomic` and `shared.db.on_commit` so transactions, queries and
callbacks share the current alias. Raw cursors name `connections[alias]`;
`django.db.connection` reaches the default connection and can bypass scope.

Company rows follow the same rule. Company and CompanyDocument selectors admit a
current personal `admin` appointment or a genuine unrooted draft owned by the
current active, email-verified actor; the fixed-search-path definer
`app_company_administration_ids()` exposes only company UUIDs, and
`app_visible_company_ids()` and `app_manageable_company_ids()` keep their owner
terms for the retained owner workflows (offerings, capital effects and
share-class creation), which recheck the live owner and active actor under
company-first locks. App writes to Company, CompanyDocument, authority requests,
appointments, invitations and legacy-owner sources are denied; the actor-bound
services in `companies/services/` (`administration.py`, `editing.py`,
`documents.py`, `authority_requests.py`, `team.py`) carry the caller's
principal, lock the company before the live account, profile, identity
requirement and appointments, and check the clock after the wait. Authority
requests are requester-private, appointments appointee-private and invitations
inviter-private; team reads need current administration for that exact company
and exclude private identity, financial and authority evidence. Publication
selectors bind the exact retained company owner or named roll recipient. The
[authority guide](../plans/company-managed-registers/authority-requests.md#what-is-recorded)
and [shareholder publications](shareholder-publications.md#who-may-read-a-publication)
own those boundaries.

## Policy catalogue

[policies.py](../../backend/shared/db/policies.py) classifies every table and
records exceptional read/write scopes. Grants derive from that catalogue;
unclassified tables are denied rather than receiving blanket grants. The current
`AWAITING_R0` and `AWAITING_RLS` sets are empty.

Important invariants:

- Policies are per command. UPDATE `USING` is the read scope so readable rows
  can be locked; `WITH CHECK` is the write scope. INSERT and DELETE use that
  write scope too.
- Positive ownership predicates fail closed for unknown owners. A visible
  child's non-nullable parents must also be readable, or `select_related`
  can remove rows that `count()` counted. Investor applications deliberately retain
  their company and offering identifiers after those parents become hidden. Their
  route reads stored names and currency without joining those parents; hidden
  drafts cannot be submitted, while reads and guarded withdrawals remain available.
- The profile/account helpers define principal membership. The bounded company
  administration and public-discovery helpers return UUIDs through fixed-search-path
  `SECURITY DEFINER` functions. Public discovery retains the existing active/open
  and deployed/nonempty-address terms and requires a principal; it supplies no
  private document, profile or basic administration access. These explicit
  boundaries prevent circular company/token policy evaluation. Other invoker
  helpers and participant scopes retain their existing terms.
- A company may read subscriber accounts, wallets and profiles for its own
  offerings. Personal API surfaces still select the caller's own records.
  A company's nullable operator-wallet link does not expose its owner's profile
  to an ordinary viewer of that company.
- A member reads a company's row only through an account resolved once and
  stored, never through a live join. `Wallet` is unique per (account, chain,
  address), so two accounts can hold one address and an address join would cross
  tenants. [Shareholder publications](shareholder-publications.md) is the first
  table to carry such a term.
- RLS visibility does not decide investor eligibility. Directory and market
  selectors apply the [eligibility rules](companies-and-eligibility.md).
- `shared/0002_database_guards` installs the catalogue's roles, grants, policies
  and helpers on a fresh database; there is no in-place adoption path for an
  older one.

`check_rls_catalogue` compares installed policies and helpers with the installer
inside a rolled-back transaction. It compares PostgreSQL-normalised expressions,
policy roles/permissiveness and helper properties. It runs after migration, not
on the scoped serving connection. `check_rls_roles` checks live connection
privileges, grants and principal state.

## Requests and jobs

`PolicyQuerysets` starts from the model manager and applies explicit product
filtering in `narrow()`. Redundant Python tenancy predicates have been removed.
Writable foreign keys remain scoped in serializer `get_fields()`.

A scoped task requires its principal in the enqueue contract. Where the existing
required recipient ID already is the principal, the task refuses a missing ID.
`acting_for(None)` deliberately selects operator authority; it is appropriate
only for a classified administrative invocation. Worker ambient authority is
operator, so omitting a scope would widen access.

The [task catalogue](../../backend/shared/tasks/catalogue.py) records authority
and bounded operator handoffs. Deployments, issuance execution, capital
increases, pause changes and subscription allotment are operator jobs that a
company's applied decision produces; `executed_by` records the actor for audit
and does not choose a tenant principal. New work requires the explicit company
authority and bounded handoff described above; changing the enqueueing UI or
omitting the principal is insufficient.

Wallet producers insert transaction-screening jobs on their current connection
inside the wallet transaction. The worker explicitly selects operator authority
and commits alerts with `monitoring_completed_at`; rollback removes both the
alerts and completion marker, and redelivery does not screen twice.

Deployment captures the applying principal and the company's exact approval and
scopes token lifecycle writes. Its operator-only broadcast journal commits
independently before sending, rechecking the consumed approval under a lock. An
outer transaction cannot undo that durable boundary. See [issuance](contracts-and-issuance.md) and
[recovery](../operations/recovery.md).

Three bounded operator reads serve product behavior that ownership alone would
refuse: resolving a supplied active company UUID for an associated-person claim,
fetching public market prices for already admitted tokens, and reading the
documents attached to the approved offerings of a share class the caller's
directory admits ([offerings](offerings.md)). Each resolves what the caller may
see under the app role first and bounds one operator query to it. They do not
expose private orders or wallets. The basic company document policy permits reads
for current personal administration or the bounded unrooted-draft setup exception;
app writes remain closed.

Order creation authorises the exact submission in app scope, then rechecks its
owner and wallet under locks in one bounded operator transaction
([create protocol](../reference/order-submissions.md#creating-an-order)).

## Verification

`check_rls_roles` and `check_rls_catalogue` run inside `make backend-test`
against the deployed connections and schema.
`backend/shared/tests/test_scoped_access.py` holds the real-app-login tenant
cases: session and principal handling, foreign reads and writes, exact-company
binding, foreign approval and once-only issue. See
[backend verification](../development/testing.md#backend-verification).
