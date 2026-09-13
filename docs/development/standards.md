# Engineering standards

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Rules for new and changed code. [Gates](gates.md) names the mechanical checks;
[testing](testing.md) explains how to establish behavior beyond them.

## The rules

- Prefer fewer layers and less code. Remove what a change makes redundant in the
  same change, including caller parameters, guards and tests that existed only
  for a removed capability. Explain meaningful product tradeoffs before deciding them.
- Follow the [backend layer table](../architecture/backend.md#backend-layers).
  Services orchestrate; views adapt HTTP; querysets own reusable queries.
  New/touched service modules use plain functions. Existing seed-era service
  classes convert when otherwise edited; stateful provider clients remain classes.
- Use `shared.db.atomic` and `shared.db.on_commit`. A transaction and its queries
  must share the selected connection. Cursors explicitly name their alias.
- No Django signals except the declared private-file lifecycle receivers in
  `shared/apps.py`. Cascades need these hooks because they bypass service calls.
- No new manager packages. `CustomUserManager` is the existing exception;
  querysets use `as_manager()`.
- Keep raised exceptions in the app's `exceptions.py`. Use DRF's standard
  exceptions for ordinary validation/permission/not-found errors. Preserve
  actionable API messages; never return raw provider exception text.
- Bind loggers using `logging.getLogger(__name__)`. Log operational errors in
  services/tasks, not duplicate request lines in views. Log IDs instead of
  email/password/token values. Client logs use narrow strings; `describeFailure`
  retains status/code and a path without query data.
- Keep `TextChoices` beside their model and numeric thresholds in app constants.
- Source carries no comments or docstrings outside the closed tooling-directive
  allowances documented by the [comment gate](gates.md#the-comment-gate).
  Configuration and documentation may carry comments. Root gate scripts document
  their algorithms and deliberate limits.
- Never edit an applied migration. A testnet migration known to be unapplied
  may be removed. Model changes require migrations. A schema change that changes
  the live RLS catalogue needs its policy-install migration too.
- Dependencies need an importer. Endpoints need a client, documented external
  consumer or operator use. Search shared services before declaring a route unused.
- Clients and shared types are API consumers: their keys, statuses and URLs are
  contracts. The [schema workflow](gates.md#the-api-type-drift-gate) checks them.
- Shared packages use relative imports internally. External client imports use
  `@ledova/shared`; generated design-token CSS is never edited manually.

Rules name reference implementations and enforcement. Existing gate debt is
counted separately from justified exceptions; counts may shrink and stale pins
must be removed. Do not add an exception merely to make a check green.

## Admin boundaries and external consumers

Custom admin row mutations use `admin_action_path`/`admin_action_re_path`;
file reads use `admin_file_path`. They check model and object permission and
resolve through the admin's queryset. `is_staff` alone is insufficient.
See [admin actions](../architecture/backend.md#admin-row-actions).

The operator API is a deliberate external consumer: `IsAdminUser`-gated
whitelist routes and portfolio add/remove-wallet actions may be driven by
operator scripts without a bundled UI. Keep them tested and documented.

## Shared TypeScript types

Types and interfaces use PascalCase; properties use camelCase except wire/query
names explicitly allowed by ESLint. Query parameters follow the API's snake_case
names. Compose pagination, ordering and date-range types from shared API types.
Entities use their bare name, queries `{Entity}QueryParams`, and non-CRUD calls
`{Action}Request` / `{Action}Response`.

The naming rule is an error; the query-parameter naming rule is a warning.
The existing utility-type/payload preferences are not enforced: repeated
`no-restricted-syntax` object keys leave only the last selector installed.
Changing that behavior requires a separate code change, not a stronger docs claim.

## Documentation changes

Keep one home per explanation and link from related pages. Overviews introduce
the topic; task guides state prerequisites, steps and expected results; references
state invariants and limits. Current behavior belongs in architecture, planned
outcomes in roadmap, and enduring rationale in decisions. Preserve the distinction
between available, disabled and planned capabilities.

Give each page a parent and useful next links. Use descriptive link labels and
headings that can be anchored. Update the [docs checker](gates.md#the-documentation-gate)
when moving its canonical inventories. Avoid hand-maintained counts in prose.
