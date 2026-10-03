# Tenancy model

[Architecture](README.md)

One database serves one deployment. PostgreSQL row-level security (RLS) enforces
tenant isolation. Customer requests and principal-bearing jobs select authority
at their boundary; product selectors retain narrower issuer, account and
eligibility rules where database read scopes are wider.

## Company-managed authority boundaries

The [accepted plan](company-managed-registers.md#existing-gates-to-replace)
extends today's owner-based company scopes to active administrative appointments
and capabilities. Shareholder membership and a platform staff role must not
grant those company capabilities. Rework company selectors, writable foreign
keys, RLS helpers and decision triggers together; preserve participant own-record
terms and private evidence boundaries rather than widening every company read.

The roles below are PostgreSQL connection roles, not human job titles. Bounded
privileged services may execute a company-authorised command after exact company
and commit-time mandate checks; customer requests must never gain unrestricted
`BYPASSRLS` or direct ledger/projection writes. Enqueued new unsigned work must
retain and recheck company authority after revocation, while already accepted
signed work follows its original recovery contract. The policy/job catalogue
below describes current implementation until those changes are installed and
proved on existing databases as well as fresh ones.

## Roles and principal

[Representative authority requests](../plans/company-managed-registers/authority-requests.md)
are an unverified submission/withdrawal boundary: the app reads its principal's
requests and cannot insert, update or delete them. A bounded creation service carries and
restores the individual principal on the selected connection, then locks and
rechecks that person, profile and owned draft company. This does not widen the
existing company helpers or grant any register capability.

Withdrawal likewise resolves the individual's own request on the app connection
before a bounded operator service locks that person and request. A separate
immutable row records cancellation; only its requester can read it. Current
company ownership or staff status grants no access to another person's proposal.
Future verified admission must share the request lock and reject a withdrawal.

| Role | Purpose |
| --- | --- |
| App | Customer requests and scoped jobs; owns no tables and has no `BYPASSRLS` |
| Operator | Admin, explicit administrative jobs and bounded privileged services; has `BYPASSRLS` |
| Migrate | Owns the schema and applies migrations |

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

## Policy catalogue

[policies.py](../../backend/shared/db/policies.py) classifies every table and
records exceptional read/write scopes. Grants derive from that catalogue;
unclassified tables are denied rather than receiving blanket grants. The current
`AWAITING_R0` and `AWAITING_RLS` sets are empty, including swap coverage.

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
- The profile/account helpers are the explicitly enumerated `SECURITY DEFINER`
  functions that define principal membership. Invoker helpers read leaf
  policies, avoiding circular policy evaluation.
- Issuers may read subscriber accounts, wallets and profiles for their own
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
- A catalogue change needs a migration to reinstall policies for existing
  databases. Fresh installs alone cannot prove an upgrade received the change.

`check_rls_catalogue` compares installed policies and helpers with the installer
inside a rolled-back transaction. It compares PostgreSQL-normalized expressions,
policy roles/permissiveness and helper properties, and checks pending-column
classifications. It runs after migration, not on the scoped serving connection.
`check_rls_roles` checks live connection privileges, grants and principal state.

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
and bounded operator handoffs. Issuance execution and subscription allotment are
operator jobs produced by staff admin actions; `executed_by` records the actor
for audit and does not choose a tenant principal. The planned company execution
entry points require the explicit company authority and bounded handoff described
above; changing the enqueueing UI or omitting the principal is insufficient.

Wallet producers insert transaction-screening jobs on their current connection
inside the wallet transaction. The worker explicitly selects operator authority
and commits alerts with `monitoring_completed_at`; rollback removes both the
alerts and completion marker, and redelivery does not screen twice.

Deployment captures the issuer principal and scopes token lifecycle writes.
Its operator-only broadcast journal commits independently before sending, with
company ownership rechecked under a lock. An outer issuer transaction cannot
undo that durable boundary. See [issuance](contracts-and-issuance.md) and
[recovery](../operations/recovery.md).

Three bounded operator reads serve product behavior that ownership alone would
refuse: resolving a supplied active issuer UUID for an associated-person claim,
fetching public market prices for already admitted tokens, and reading the
documents attached to the approved offerings of a share class the caller's
directory admits ([offerings](offerings.md)). Each resolves what the caller may
see under the app role first and bounds one operator query to it. They do not
expose private orders or wallets, and the company document policy stays
owner-only.

Order creation authorizes the exact submission in app scope, then rechecks its
owner and wallet under locks in one bounded operator transaction. Challenge spend,
matching, reservations and the recorded result commit together. Private order
reads and edits remain owner-scoped; swap insertion is operator-only. See the
[create protocol](../reference/order-submissions.md#creating-an-order).

## Verification

The ordinary request suite takes the app role on one ambient
test connection, keeping fixtures visible without cross-alias deadlocks. That
checks policy behavior. The separate scoped suite checks actual alias routing,
transaction rollback, locks and task boundaries. Role/catalogue commands check
the deployed connections and schema. Each proves a different boundary.

Run the commands in [testing](../development/testing.md). The earlier owner-column
rollout is historical; current code and the policy catalogue are the reference
for new work. See [decisions](../decisions.md) for the retained rationale.
