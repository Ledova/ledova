# Engineering standards

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Rules for new and changed code. [Gates](gates.md) states each mechanical check's
rule, remedy and limits; [testing](testing.md) explains how to establish
behaviour beyond them.

## The rules

- Prefer fewer layers, less code and less capability. Where functionality or
  complexity is not necessary, the simpler option wins by default; where the
  trade-off is meaningful, say what it costs and ask rather than deciding alone.
  That applies to engineering trade-offs, not only product ones: explaining a
  cost is not authorisation to accept it. A proposal says what could be removed
  as well as what could be added. Remove what a change makes redundant
  in the same change, including caller parameters, guards and tests that
  existed only for a removed capability.
- Services orchestrate, views adapt HTTP and querysets own reusable queries;
  new/touched service modules use plain functions ([the layer gate](gates.md#the-layer-gate)).
- Use `shared.db.atomic` and `shared.db.on_commit` with an explicitly selected
  connection ([the connection-binding gate](gates.md#the-connection-binding-gate)).
- No Django signals except the declared private-file lifecycle receivers in
  `shared/apps.py`. Cascades need these hooks because they bypass service calls.
- No new manager packages. `CustomUserManager` is the existing exception;
  querysets use `as_manager()`.
- Keep raised exceptions in the app's `exceptions.py` and use DRF's standard
  exceptions for ordinary validation/permission/not-found errors. Preserve
  actionable API messages.
- Never return raw provider exception text ([the error body gate](gates.md#the-error-body-gate)).
- Bind loggers with `logging.getLogger(__name__)`, log operational errors in
  services/tasks rather than duplicate request lines in views, and log IDs
  instead of email/password/token values or whole bodies
  ([the logging privacy gate](gates.md#the-logging-privacy-gate)).
- Declare the response schema at every routed method
  ([the schema response gate](gates.md#the-schema-response-gate)).
- Test helpers never override reserved `TestCase` methods
  ([the test shadowing gate](gates.md#the-test-shadowing-gate)).
- Workspace type-check scripts must reach their files
  ([the type-check gate](gates.md#the-type-check-gate)).
- Keep `TextChoices` beside their model and numeric thresholds in app constants.
- Source carries no comments or docstrings outside the closed tooling-directive
  allowances ([the comment gate](gates.md#the-comment-gate)); configuration and
  documentation may carry comments, and root gate scripts document their
  algorithms and deliberate limits.
- Never edit an applied migration. A testnet migration known to be unapplied
  may be removed. Model changes require migrations, checked by CI's
  [migration drift step](gates.md#every-gate-and-where-its-rule-is-written). A
  schema change that changes the live RLS catalogue needs its policy-install
  migration too. Where anyone else is working, claim the migration number in a
  comment on the plan issue before pushing it: two migrations have claimed the
  same number here. Where two migrations fork off one parent, the second to
  land re-points one dependency line in its rebase.
- Dependencies need an importer. Endpoints need a client, documented external
  consumer or platform staff use. Search shared services before declaring a
  route unused.
- Clients and shared types are API consumers: their keys, statuses and URLs are
  contracts ([the API type drift gate](gates.md#the-api-type-drift-gate)).
- Shared packages use relative imports internally and never import their own
  public barrel; external client imports use `@ledova/shared`
  ([clients and the shared package](../architecture/clients.md)). Generated
  design-token CSS is never edited manually.

Rules name reference implementations and enforcement. Existing gate debt is
counted separately from justified exceptions; counts may shrink and stale pins
must be removed. Do not add an exception merely to make a check green.

## Company authority

- Company users make register decisions within recorded appointments; software
  validates and executes the exact authorised instruction, as the
  [accepted plan](../architecture/company-managed-registers.md) sets out.
- Platform staff permissions, the technical signer and the privileged database
  connection are execution boundaries, not a company mandate; shareholder
  records and participant access confer no company administration rights.
- Recheck current authority at the effect boundary, use bounded commands, and
  preserve evidence, actor history, isolation and recovery for already
  submitted transactions. Company policy defines required approvals; there is
  no universal Ledova reviewer.
- The staff checks that remain are platform
  [settlement-asset minting](../architecture/outgoing-signing.md#mint-requests)
  and technical retries of already admitted work.
- Product modes are retired: [`operators/0002`](../operations/upgrades.md#one-registry-product)
  removed the field, its initial migration stays, and private hosting uses the
  same product and authority model.

## Admin boundaries and external consumers

Custom admin row mutations use `admin_action_path`/`admin_action_re_path`;
file reads use `admin_file_path`. They check model and object permission and
resolve through the admin's queryset. A page over no single row uses
`admin_page_path`, which checks model change permission. `is_staff` alone is
insufficient.
See [admin actions](../architecture/backend.md#admin-row-actions).

The `/api/operator/` routes are a deliberate external consumer: `IsAdminUser`-gated
whitelist lookup/synchronisation and portfolio add/remove-wallet actions may be
driven by platform staff scripts without a bundled UI. Keep those technical
contracts tested and documented. Fresh whitelist additions and removals use the
[company wallet workflow](../plans/company-managed-registers/company-wallet-approvals.md).
A staff script supplies no company mandate or acceptance evidence for that
self-service outcome.

## Shared TypeScript types

Types and interfaces use PascalCase; properties use camelCase except wire/query
names explicitly allowed by ESLint. Query parameters follow the API's snake_case
names. Compose pagination, ordering and date-range types from shared API types.
Entities use their bare name, queries `{Entity}QueryParams`, and non-CRUD calls
`{Action}Request` / `{Action}Response`.

The naming rule is an error; the query-parameter naming rule is a warning.
The existing utility-type/payload preferences are not enforced: repeated
`no-restricted-syntax` object keys leave only the last selector installed.
Changing that behaviour requires a separate code change, not a stronger docs claim.

## Documentation changes

Keep one home per explanation and link from related pages. Overviews introduce
the topic; task guides state prerequisites, steps and expected results; references
state invariants and limits. Current behaviour belongs in
[the product description](../product.md) and the architecture guides, planned
outcomes in the [accepted register plan](../architecture/company-managed-registers.md)
and the GitHub issues, and enduring rationale in [decisions](../decisions.md).
Preserve the distinction between available, disabled and planned capabilities.

Give each page a parent and useful next links. Use descriptive link labels and
headings that can be anchored. Update the [docs checker](gates.md#the-documentation-gate)
when moving its canonical inventories. Avoid hand-maintained counts in prose.
