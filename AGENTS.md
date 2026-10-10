# Working guidance

Read this file, [CONTRIBUTING.md](CONTRIBUTING.md), the
[accepted company-managed register plan](docs/architecture/company-managed-registers.md)
and its [implementation index](docs/plans/company-managed-registers/README.md)
when starting or resuming work, including after context compaction.

## Owner's standing instructions

- Prioritise the development workflow under #943, then the essential
  company-managed register journeys. Follow the
  [9 October owner decision](docs/decisions.md#essential-registry-and-development-workflow-priority)
  and each issue's current dependencies. Check the GitHub issue and claim before
  each increment; preserve other agents' claimed work.
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
- Preserve useful history, database migration history, retained records and
  evidence, the earlier journey artifacts, and unrelated local work. Cleanup
  must not discard data or weaken privacy, authority or execution safeguards.
- Update documentation to describe what is actually delivered, keeping planned
  capabilities distinct from current behaviour.
- Use focused checks during development and the applicable required checks once
  on the merging head, as the [testing guide](docs/development/testing.md) says;
  do not claim proposed #943 test routing before it lands. Keep authority,
  isolation, economic, retention and historical migration coverage. Record
  results and material gaps in the pull request.
- Use focused pull requests, independent review at the merging commit, and green
  required CI on a branch up to date with main. Do not push directly to main.

The owner has authorised implementation, routine cleanup, and the repository's
review-and-merge workflow without repeated permission requests. Live deployment,
live database migrations, signer activation and real-funds use still require the
owner's explicit direction under CONTRIBUTING.md.
