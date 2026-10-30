# Working guidance

Read this file, [CONTRIBUTING.md](CONTRIBUTING.md), the
[accepted company-managed register plan](docs/plans/company-managed-registers/plan.md)
and its [implementation index](docs/plans/company-managed-registers/README.md)
when starting or resuming work, including after context compaction.

## Owner's standing instructions

- Follow the essential company-managed register scope under the
  [9 October decision](docs/decisions.md#essential-registry-and-development-workflow-priority)
  and each issue's current dependencies; the development workflow under #943 is
  complete. Check the GitHub issue and claim before each increment; preserve
  other agents' claimed work.
- Keep the design and implementation simple. Prefer existing patterns and small,
  focused changes over speculative abstractions or additional product modes.
- Deliver the essential register scope of the 9 October decision and its
  [10 October first scopes](docs/decisions.md#first-scopes-for-employee-awards-and-external-capital):
  employee awards and vesting records, externally arranged investor capital and
  company-approved allotments, accurate ownership, member access and basic
  outputs. An award is an entitlement, not issued shares. New integrated AUD
  payments, trading, advanced governance and filings are deferred. Wallets and
  the class's on-chain features are out of the web app for now under the
  [31 October decision](docs/decisions.md#wallets-removed-from-the-web-app);
  the backend keeps their controls and history. Companies must not buy
  cryptocurrency through the on-ramp; #920's investor and provider guards stand.
- Tidy as each issue progresses. Remove code, imports, configuration, routes,
  tests and documentation that become obsolete when their replacement lands.
  Check references before deleting; do not leave parallel unused implementations.
- Preserve useful history, retained records and evidence, the earlier journey
  artifacts and unrelated local work. Cleanup must not discard data or weaken
  privacy, authority or execution safeguards. Migrations are fresh initial
  migrations from current models, installing the PostgreSQL roles, grants, RLS
  policies, functions and triggers; old migration source stays in Git history
  and there is no older-database adoption path.
- Update documentation to describe what is actually delivered, keeping planned
  capabilities distinct from current behaviour.
- Keep only tests guarding the worst failures, within the binding suite caps of
  the [minimum-test policy](docs/engineering/testing.md). At capacity, a new
  core test replaces an existing case or needs an explicit owner-approved cap
  increase in the same PR; record before/after counts and the replacement or
  approval for review. Never exceed a cap temporarily.
- Run `make preflight` before pushing. Every PR runs the same lean checks on
  GitHub's runners; native Android/iOS builds are manual before a mobile
  release ([CI](docs/engineering/testing.md#ci)).
- Use focused pull requests, independent review at the merging commit, and green
  required CI on a branch up to date with main. Do not push directly to main.

The owner has authorised implementation, routine cleanup, and the repository's
review-and-merge workflow without repeated permission requests. Live deployment,
live database migrations, signer activation and real-funds use require the
owner's explicit direction under CONTRIBUTING.md. The already-authorised
ledova.io rebuild and release completed under #979; its permission and the
instruction to do no further backup work are recorded in the
[11 October release decision](docs/decisions.md#ledovaio-rebuild-and-release-authorisation).
