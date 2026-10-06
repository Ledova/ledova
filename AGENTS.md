# Working guidance

Read this file, [CONTRIBUTING.md](CONTRIBUTING.md), the
[accepted company-managed register plan](docs/architecture/company-managed-registers.md)
and its [implementation index](docs/plans/company-managed-registers/README.md)
when starting or resuming work, including after context compaction.

## Owner's standing instructions

- Implement the company-managed register programme in dependency order. Check
  the current GitHub issue and claim before beginning each increment; GitHub is
  the working backlog.
- Keep the design and implementation simple. Prefer existing patterns and small,
  focused changes over speculative abstractions or additional product modes.
- Prioritise the private-company register and issuing, managing, transferring
  and purchasing shares. Crypto on-ramp purchases are optional personal investor
  functionality; companies must not buy cryptocurrency through that integration.
  AUD is a required share-payment method, distinct from pricing or a stablecoin.
  Follow the [5 October product decision](docs/decisions.md#registry-priority-crypto-on-ramp-and-aud-payments);
  record undecided payment mechanics for the owner through #868/#869 before
  implementing them, and preserve #920's investor account and provider-lifetime
  guards.
- Tidy as each issue progresses. Remove code, imports, configuration, routes,
  tests and documentation that become obsolete when their replacement lands.
  Check references before deleting; do not leave parallel unused implementations.
- Preserve useful history, database migration history, retained records and
  evidence, the earlier journey artifacts, and unrelated local work. Cleanup
  must not discard data or weaken privacy, authority or execution safeguards.
- Update documentation to describe what is actually delivered, keeping planned
  capabilities distinct from current behaviour.
- Verify each increment with meaningful tests and the checks required by the
  repository. Record results and material gaps in the pull request.
- Use focused pull requests, independent review at the merging commit, and green
  required CI on a branch up to date with main. Do not push directly to main.

The owner has authorised implementation, routine cleanup, and the repository's
review-and-merge workflow without repeated permission requests. Live deployment,
live database migrations, signer activation and real-funds use still require the
owner's explicit direction under CONTRIBUTING.md.
