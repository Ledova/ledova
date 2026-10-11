# Working guidance

Read this file, [CONTRIBUTING.md](CONTRIBUTING.md), the
[accepted company-managed register plan](docs/architecture/company-managed-registers.md)
and its [implementation index](docs/plans/company-managed-registers/README.md)
when starting or resuming work, including after context compaction.

## Owner's standing instructions

- Prioritise the development workflow under #943, then the essential
  company-managed register journeys. Follow the
  [11 October testing decision](docs/decisions.md#minimum-tests-and-fresh-migrations),
  the essential register priority and each issue's current dependencies. Check
  the GitHub issue and claim before each increment; preserve other agents' claimed work.
- Keep the design and implementation simple. Prefer existing patterns and small,
  focused changes over speculative abstractions or additional product modes.
- Deliver the essential register scope of the 9 October decision and its
  [10 October first scopes](docs/decisions.md#first-scopes-for-employee-awards-and-external-capital):
  employee awards and vesting records, externally arranged investor capital and
  company-approved allotments, accurate ownership, member access and basic
  outputs. An award is an entitlement, not issued shares; employees never buy
  their awards. New integrated AUD payments, trading, advanced governance and
  filings are deferred; keep useful existing payment/chain controls and history.
  Companies must not buy cryptocurrency through the on-ramp; preserve #920's
  investor account and provider-lifetime guards.
- Tidy as each issue progresses. Remove code, imports, configuration, routes,
  tests and documentation that become obsolete when their replacement lands.
  Check references before deleting; do not leave parallel unused implementations.
- Preserve useful history, old database migrations in Git, retained records and
  evidence, the earlier journey artifacts, and unrelated local work. Cleanup
  must not discard data or weaken privacy, authority or execution safeguards.
- Use fresh initial project migrations from current models and install the current
  PostgreSQL roles, grants, RLS policies, functions and triggers. Old migration
  source remains in Git history; there is no older-database adoption path.
- Update documentation to describe what is actually delivered, keeping planned
  capabilities distinct from current behaviour.
- Keep only tests guarding the worst failures, under the
  [minimum-test policy](docs/development/testing.md): backend at most 150,
  dashboard 20, mobile 10, shared 10 and contracts 20 executed cases. Keep at
  most five real-app-login tenant tests and the Playwright smoke tests. Retire
  other tests and unused helpers/fixtures; historical or deferred features do
  not require coverage. No blanket regression or per-route cross-tenant matrix
  requirement remains.
- Every PR runs the same lean checks. `make preflight` runs those checks locally;
  native Android/iOS builds are manual before a mobile release. Report actual
  counts and times against ten minutes for the whole Hosted PR run and five
  minutes for all tests on the Mac. Keep source gates, PR wording, the
  fail-closed verdict, PostgreSQL role/catalogue checks and the API snapshot.
- Use focused pull requests, independent review at the merging commit, and green
  required CI on a branch up to date with main. Do not push directly to main.

The owner has authorised implementation, routine cleanup, and the repository's
review-and-merge workflow without repeated permission requests. Any ledova.io
backup, export, rebuild or re-seed requires the owner's approval before execution. Live deployment, live database migrations, signer activation
and real-funds use require explicit direction under CONTRIBUTING.md.
