# Tenancy model

[Architecture](README.md)

One database serves one deployment. PostgreSQL row-level security (RLS) enforces
tenant isolation. Customer requests and principal-bearing jobs select authority
at their boundary; product selectors retain narrower issuer, account and
eligibility rules where database read scopes are wider.

## Company authority

The roles below are PostgreSQL connection roles, not human job titles. Company
capabilities come from recorded appointments
([authority guide](../plans/company-managed-registers/authority-requests.md));
shareholder membership and a platform staff role grant none. Bounded privileged
services execute a company-authorised command after exact company and
commit-time mandate checks; customer requests never gain unrestricted `BYPASSRLS`
or direct ledger/projection writes. Enqueued unsigned work rechecks company
authority after revocation, while already signed work follows its original
recovery contract ([outgoing signing](outgoing-signing.md)).

## Roles and principal

Basic Company and CompanyDocument API selectors admit current personal `admin`
appointments, including initial, invited and legacy sources, or a genuine
unrooted draft owned by the current active, email-verified actor. The narrow
principal-bound `app_company_administration_ids()` definer sees retained roots
regardless of their app visibility and exposes only company UUIDs. A retained
request-sourced initial appointment or legacy-owner source closes draft setup
permanently; a pending authority request keeps the draft editable. Expiry,
revocation, configured identity and current account checks determine appointment
effectiveness. Delegatable scopes never count as personal authority.

The Company read policy retains its existing public discovery and market terms;
its customer list/detail selectors remain narrower. App writes to Company and
CompanyDocument are denied, with exact actor-bound operator services and database
guards for permitted effects. CompanyDocument responses name the company UUID,
and private-file handles open while the effect-time resource checks are held.
Published-offering document reads retain their existing offering/class eligibility
service and retention boundary. No generic participant, subscriber, profile,
account or wallet policy predicate is widened. Company contact name/email is a bounded response rather than
new access to the owner's raw profile or financial records.
Company API metadata reads admit the exact current active owner alongside current
personal administration. An owner without that administration receives no contact
name/email or private document inventory, and cannot edit company information or
files. Raw Company access retains the separate administration/public policy.
Existing owner-domain reads and writes remain independent of personal
administration: `app_visible_company_ids()` and `app_manageable_company_ids()` keep
their exact owner UUID bodies and become fixed-search-path definers only after
migration 0020. Child, participant, subscriber, profile, account and wallet policy
terms remain unchanged. Historical installation and reversal restore the original
invoker attributes. Owner API selectors bind the actual request owner; offering
and capital effects recheck the live owner and active actor under company-first
locks. Private documents supplied to offering actions separately require current
personal administration. Offering updates and document attachment lock the exact
offering before that check, so expiry during the row wait prevents a new private
document reference. Share-class creation accepts only its existing validated
fields and rechecks its selected owner and active actor under the same lock order.
Personal administration supplies no mandate for these retained owner workflows.
Historical policy installation waits for required columns, and the new
administration migration reverses before the earlier policy installer is removed.

Publication list and file selectors separately bind the exact retained company
owner or named recipient on the operator connection before returning frozen
publication data. Pausing a class does not require a new basic-admin appointment
to read its publications. Customer file lookup excludes unrelated staff; the
existing direct staff read service and its audit remain available. Ballot and
summary paths keep their app-role policies.

[Representative authority requests](../plans/company-managed-registers/authority-requests.md)
are requester-private and company appointments appointee-private
boundaries: the app reads its principal's own requests and the appointments that
name it as appointee, and cannot create, update or delete authority rows. A bounded creation service carries and
restores the individual principal on the selected connection, then locks and
rechecks that person, profile and owned draft company. This does not widen the
existing company helpers or grant any register capability.

Withdrawal likewise resolves the individual's own request on the app connection
before a bounded operator service locks that person and request. A separate
immutable row records cancellation; only its requester can read it. Current
company ownership or staff status grants no access to another person's proposal.
Initial self-declaration admission shares the request lock and rejects a
withdrawal. It retains the exact declaration, scoped appointment and genuine ABR
check without activating the company. Self-revocation creates an immutable outcome;
expiry/revocation stops current capability checks. The preserved configured issuer
identity gate consumes server-owned provider results. None of these reads widens
legacy owner-based company, investor or financial-data scopes.

Invitations are readable only by their inviter through the app role. Bounded
issuance checks a current selected appointment and its explicit delegatable
scope; acceptance binds the first code holder's actual account and profile to
one immutable appointment. The code appears only in the initial response and
acceptance body; retained rows and history contain no plaintext code. Team reads
require current administration for that exact company and expose account and
appointment fields, excluding private identity, financial and authority evidence.
Company administrators can revoke another appointment within that company, and
appointees can revoke their own. These services lock the company before actors,
restore the caller principal and check expiry after lock waits. No new company
visibility helper or global staff mandate is introduced.

The legacy-owner upgrade records existing owners as administrator appointees
without widening the company helpers. Its immutable source table denies app
reads and writes; own appointment history exposes the legacy source and null
declaration fields, while bounded team reads retain the same privacy limits.
Only the atomic upgrade can seed these rows. Installed guards refuse later
legacy source/appointment inserts and source mutation, including through operator
or migration connections. Existing initial or legacy roots remain consumed after
expiry/revocation, and later owner changes supply no appointment.

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
- A catalogue change needs a migration to reinstall policies for existing
  databases. Fresh installs alone cannot prove an upgrade received the change.
  A term that names a column added after its table was created is listed in
  `policy_sql.TERM_COLUMNS_ADDED_AFTER_CREATION`: the creating migration then
  enables and forces row-level security without policies, denying the app role,
  and the column's own migration installs the term.

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
refuse: resolving a supplied active issuer UUID for an associated-person claim,
fetching public market prices for already admitted tokens, and reading the
documents attached to the approved offerings of a share class the caller's
directory admits ([offerings](offerings.md)). Each resolves what the caller may
see under the app role first and bounds one operator query to it. They do not
expose private orders or wallets. The basic company document policy permits reads
for current personal administration or the bounded unrooted-draft setup exception;
app writes remain closed.

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
