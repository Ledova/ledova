# Testing and review

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Choose evidence for the behaviour changed. A successful command establishes only
what it exercised. Record the commands, results, untested boundaries and tested
commit in the PR.

## Commands

Run root commands from the repository root unless the table says otherwise.
Use an isolated PostgreSQL database with the required role privileges; the
backend suites run on PostgreSQL in both ordinary and specialised settings.

| Area                            | Commands                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Source checks and type-checking | `make check`                                                                                        |
| Gate unit tests                 | `make test-gates`                                                                                   |
| Lint                            | `make lint`; `cd backend && make lint`, which needs the [backend lint tools](#backend-verification) |
| JavaScript and contracts        | `make test`                                                                                         |
| Backend group                   | `make backend-test`; add relevant `BACKEND_CHECKS` flags for integrations/advisories |
| Prepare a push                  | `make preflight BASE=origin/main`; see [preflight](#preflight) |
| Migration drift                 | `cd backend && python manage.py makemigrations --check --dry-run`                                   |
| Real EVM chain                  | `make chain-test`                                                                                   |
| Real Bitcoin chain              | `python scripts/test-bitcoin-chain.py` against isolated PostgreSQL                                  |
| Browser bundle smoke            | `make build && make smoke`                                                                          |
| Dependency advisories           | `make audit`                                                                                        |
| Design tokens                   | `make generate-tokens`, then check generated CSS is unchanged                                       |
| Native/mobile                   | [Builds](mobile-builds.md) and [probes](native-probes.md)                                           |

`make check` installs backend development requirements and any missing workspace
dependencies. Workspace-only commands require the correct workspace installation;
mobile resolves from its own `node_modules`. `make help` lists entry points.
Formatting checks remain local: CI has no general workspace format step.

The real-chain selectors in `make chain-test`, including the exact company
capital/pause seed classes and paid-issue module, are skipped by an ordinary
backend suite without their chain environment. The command uses two sequential
test-database lifetimes: the integration module, then the remaining selectors,
with the same node, deployed contracts and original case order. Each lifetime
runs the baseline migrations and destroys its test database. Record both complete
test footers separately; their sum is not a single suite invocation. See
[chains and keys](../operations/chains.md#chain-configuration). Use a free
`CHAIN_TEST_PORT` per checkout, and one other than 8545 while the local stack is
up, since its chain holds that port (`make chain-test CHAIN_TEST_PORT=8546`).
Inspect verbose skip reasons. A PostgreSQL policy, trigger or status constraint requires the full
PostgreSQL suite; status constraints also require real-chain coverage. Do not
infer coverage from the test count.

CI configuration is authoritative for invoked checks:
[ordinary CI](../../.github/workflows/ci.yml) and
[native CI](../../.github/workflows/mobile-native.yml).
Real Redis/ClamAV controls are separate from unit fakes; see
[integrations](../operations/integrations.md) and [uploads](../operations/uploads.md).

## Backend verification

Use focused regression tests while developing. The applicable CI checks must pass
on the final PR head, up to date with main, with independent review. A successful
CI run need not be repeated as a complete local run. Retire obsolete and redundant
tests deliberately; preserve core register effects, authority, isolation, private
evidence, economics and current execution/recovery boundaries.

`make backend-test` runs one backend group: lint, Django system and migration
consistency checks, baseline migration, role/catalogue checks, the pinned API
schema comparison, ordinary tests and compact scoped tests. Each phase runs once
and a failure stops the group. Add integrations when changing their inputs:

```bash
make backend-test BACKEND_CHECKS="--uploads --chains --audit"
```

`--uploads` runs real Redis throttle/quota and ClamAV scanner controls. `--chains`
runs genuine EVM and Bitcoin checks. `--audit` checks backend production
advisories. CI selects these flags from the complete changed paths. Database
policies/settings/dependencies and unknown inputs select the affected integrations;
ordinary test-only changes use the core group. Manual or unavailable comparisons
select all checks. Every main push runs the core group, with integrations selected
from its verified push comparison. The source in
[`ci-scope.py`](../../scripts/ci-scope.py) owns the exact family rules.

| Check | Meaningful boundary |
| ----- | ------------------- |
| Ordinary (`settings.test`) | Current behaviour and app permissions through `SET ROLE` on a shared connection |
| Scoped (`settings.test_scoped`) | Real separate app/operator credentials, tenant isolation and immutable records |
| Roles/catalogue | Installed privileges and policies that behavioural tests alone cannot establish |

Normal Django discovery reports failed imports and the runner refuses an empty
suite. The [shadowing gate](gates.md#the-test-shadowing-gate) checks assertion/fixture helpers that shadow reserved TestCase methods. Scoped coverage requires its declared connection-boundary classes and no
skipped cases. There is no separate discovery run or shard scheduler. The suite
commands are also available directly from `backend/`:

```bash
python manage.py test --settings=ledova_backend.settings.test --parallel 4 --noinput
python manage.py test --settings=ledova_backend.settings.test_scoped --require-scoped-coverage --parallel 4 --noinput
```

The group requires Python 3.13.15 with committed schema constraints, backend
development tools and a local PostgreSQL 16 administrator connection. Upload
integrations also need local Redis 7 and Docker. Chain integrations need Node 22.15.1,
installed contract dependencies and Bitcoin Core 31.1; on native macOS provide
`BITCOIN_TEST_BINARY`. Use `make install-schema-environment` and
`npm --prefix contracts ci` to prepare those dependencies. Backend formatting uses
`backend/pyproject.toml` and `backend/.flake8`.

The command creates a synthetic scratch database and separate migrate/app/operator
roles. It removes only its owned database, roles, scanner and child processes;
developer resources are preserved. Logs, schema diagnostics, phase timings and
cleanup receipts are retained under `/tmp/ledova-backend-checks`. Suite output
includes named durations, database setup and overall runner timings during the
necessary run. A partial phase, cancellation or missing result is not a group
pass. A hard kill cannot run Python cleanup; retain its resource receipt when
recovering interrupted local work.

Test settings pin Base Sepolia and approved finality policies. Real-chain selectors
are deliberately skipped in ordinary tests without their chain environment.
Inspect skip reasons and both complete EVM test footers. Native macOS cannot prove
the decoder address-space cap; that case records a skip, while the Linux guest
proves the kernel limit. See [upload limits](../operations/uploads.md#upload-validation-and-resource-limits).

## CI routing

[CI](../../.github/workflows/ci.yml) has two execution groups: **Source and client
checks** and **Backend verification**, plus lightweight scope and verdict jobs.
Source rules run for changes; client builds/typechecks/tests/smoke run when client
or API inputs change, and tooling controls run when their scripts/workflows change.
Backend tests run for backend inputs and documents that backend code reads.
Unknown or incomplete comparisons select coverage. Native builds have their
[own input rules](mobile-builds.md).

Compatible main jobs use the Mac's isolated Linux ARM64 guests: backend on the
primary profile, source/client checks on the ordinary profile. Scope and verdict
stay hosted. Native Android/iOS builds use their platform-specific hosted runners.
PR execution stays hosted until the protected definition and actual Mac admission
are delivered. Linux-host expansion is deferred under the owner's Mac-only direction.

Main routing verifies repository, event, full main ref, run ID and attempt. Each
one-job guest requests the exact run/attempt/job labels and has six CPUs, 12 GiB and
a bounded disk. A changed workflow needs reviewed delivery, a clean drain and host
policy rebinding before admission. Preserve diagnostics and let busy jobs finish;
missing selected capacity remains visible rather than silently rerouting.

The permanent service starts at Mac user login; the Mac must remain powered and
logged in. Administrator installation for system startup is deferred. Source
routing does not prove unattended availability or full-load timings.

PR checks within 15 minutes and the full backend suite within 20 minutes on the Mac
remain targets. Report observed queue/setup/test/job timings against them in each
increment. Focused test times and sums of parallel method durations do not establish
those targets.

## Preflight

Run `make preflight BASE=origin/main` before pushing. It previews the same path
rules for committed, staged, unstaged, deleted, renamed and untracked changes.
Missing, shallow or divergent comparisons fail with a useful message. Inherited
GitHub identity/output variables cannot supply local runner identity.

Preflight runs quick source/document checks, relevant client type/lint checks and
tooling controls. Backend changes select formatting, lint and Django configuration
checks. Run focused tests for the changed behaviour during development; preflight
does not repeat the complete backend/integration pipeline before every push.
Native builds, online issue verification and complete applicable CI remain required
on the merging head.

Supply intended PR text only when preparing its description:

```bash
make preflight BASE=origin/main PR_TITLE_FILE=/tmp/pr-title.txt PR_BODY_FILE=/tmp/pr-body.md
python scripts/preflight.py --base origin/main --preview
```

With both files supplied, preflight checks the intended text and complete
base-to-HEAD commit messages. Closing phrases in a `Refs` body or commit fail even
when negated. Without those files, it runs the selected checks without drafting a
PR or requiring a final title for each push. The online metadata gate still
verifies the owning issue and GitHub closing references.

## Migration baseline

The [10 October owner decision](../decisions.md#backend-migration-baseline)
replaces the shipped project migration chain with a baseline. Old migration
source and its upgrade/rollback tests remain in Git history. Retire those tests
and their rewind helpers after proving equivalence; preserve meaningful current
authority, isolation, economic, retention and execution/recovery assertions.
Runtime fixtures build rows on the current schema. Retained history uses bounded
synthetic fixtures with their exact guards restored before assertions or other
workers run. It does not invent a successful old upgrade or revive formats the
owner confirmed absent.

The baseline PR records comparison of old-chain and baseline databases with the
same PostgreSQL version and settings: normalised complete schema and reference
data, roles/ACLs, RLS, functions, triggers and constraints. Keep the required
ordinary, strict scoped, genuine chain, role/catalogue and API-schema checks.
Also prove fully upgraded old-cut adoption retains its records and schema,
partial old history refuses before DDL or recorder changes, and valid interrupted
fresh phases can resume. Record expected replacement labels separately from
application rows in the comparison.

Each migration after the baseline gets a focused upgrade test from its immediate
predecessor, covering affected records and refusal/rollback behaviour where
applicable. Restore the current schema before using current models. These tests
do not rebuild or rewind the shipped old chain. The
[upgrade notes](../operations/upgrades.md#adopting-the-migration-baseline)
describe adoption; a live release still requires the owner's explicit approval.

## Parallel failures and process timing

Ordinary and scoped tests share the Django runner extensions in
`backend/shared/test_runner.py`. Picklable errors retain their original assertion,
traceback and subtest parameters. A failure or result event that cannot be
serialized becomes a named error with the original diagnostic, preserving a
failed verdict. Setup and teardown errors retain their class identity. Expected
failures keep their normal meaning; there is no automatic serial rerun or retry.
The scoped runner still refuses missing required coverage and skipped cases.

Independent issuance and capital workers use one parent readiness deadline for
the cohort and a longer child release limit. Swap workers distinguish startup
from command deadlines, buffer complete messages and report exited workers,
EOF and malformed messages. A ready file or thread-start event alone does not
prove that a worker is alive or waiting on the intended database row.

Lock-order tests observe the actual PostgreSQL blocker, Lock wait event and
named query, then probe which rows are held or free. Expiry tests observe the
database clock after the intended boundary. Preserve the genuine independent
nonce/claim, signed-commit crash, receipt/finality and exactly-once effect proofs;
use deterministic interruption controls for the domain recovery assertions
already covered by those shared process proofs.

## Test traps

- Red-prove a behavioural claim: remove the fix, observe a named failure, restore
  it and observe success. Confirm the mutation actually applied. If a meaningful
  red proof cannot be made, state why in the PR.
- An assertion of absence needs a positive control. A test should fail on a
  deliberately wrong expectation as well as on broken product code.
- `APITestCase`'s outer transaction can hide missing transaction boundaries. Use
  `APITransactionTestCase` for durable effects, rollback and real locking.
  The API exception handler may return a response rather than raise; assert the
  response and resulting state.
- Give mocks concrete return values before they reach serializers. An
  unconfigured `Mock` can recurse through DRF's `tolist()` handling indefinitely.
- Concurrency tests use distinct objects/connections and prove database behaviour,
  not accidental serialization through one shared Python object.
- Mobile render/event helpers are async. Await them and settle deferred promises;
  the lint mutation control verifies that unawaited events fail. Clean mounted
  components and query clients after every test, including the final one.
- For a new post-baseline migration, read predecessor rows with the executor's
  historical models. Restore current migrations after a tested rollback or
  rollback refusal before using current models.

The cross-tenant route matrix uses the existing explicit synthetic historical-owner
fixture to retain its legacy-source assertions on the current schema. Its setup
does not replay the owner-upgrade migrations for each route case. The fixture
requires the migration role and restores both appointment/source identity guards;
the shipped owner-upgrade tests are retired under the baseline decision.

Routine company registry and legacy-owner authority cases also use the existing
bounded synthetic historical-owner fixture on the current schema. Their fixture
does not rewind and reinstall later migrations for each runtime assertion.
Legacy authority cases supply their retained migration-format provenance as
synthetic fixture data; this does not establish that a migration executed or
that its source and appointment timestamps match. The retired legacy-owner
upgrade/reversal tests remain in Git history; current runtime tests retain the
authority, actors, private records and immutability assertions. The baseline
changes the old migration selections while preserving required current
ordinary/scoped coverage.

## Scoped connection evidence

The ordinary suite uses SET ROLE on a shared test connection to exercise policies
without cross-alias fixture deadlocks. The scoped suite exercises actual app and
operator aliases. Fixtures use `as_an_operator_would()` where needed, and writes
another connection must observe need a commit. Per-case rollback uses
`shared.db.atomic` with the current alias.

The scoped runner requires its complete class inventory, refuses skips and
filtered subsets, and verifies a real non-bypassing app role. Separate locking
tests prove the route opens its own transaction; a matrix's outer rollback cannot
establish that. A task proof must exercise its real authority boundary before
provider/delivery fakes. See [tenancy](../architecture/tenancy.md).

## Company-managed register verification

The [accepted plan](../architecture/company-managed-registers.md#acceptance-criteria)
states the outcomes. Each delivered increment's guide under the
[implementation index](../plans/company-managed-registers/README.md) records
the admission, recovery and verification boundaries it carries and names its
tests; product modes are retired and company authority is delivered, so their
migration and contract evidence lives in those guides and the
[upgrade notes](../operations/upgrades.md), not here. Each new increment
identifies the company/participant decision, its bounded executor and the
failure cases it changes, and keeps the ordinary, scoped and role/catalogue
verification above; the operator alias remains an execution boundary and does
not prove a human company mandate. Standing evidence rules:

- **Authority and register commands:** exercise individual appointments,
  prepare versus approve/apply capabilities, cross-company references,
  revocation after preview and before a queued effect, stale evidence or terms,
  direct SQL/ORM forgery, concurrent identical/changed retries and atomic
  rollback. Global staff access and shareholder status must not substitute for
  company authority.
- **Issuance and dependent crypto actions:** keep receipt, issue authority,
  execution, holding and register effect independently attributable, with
  isolated real-chain checks where execution changes. A non-paid authorised
  issue must not manufacture a receipt, and recovery of original signed
  transactions after authority changes admits no new instruction.
- **Participant access and outputs:** verify own-record privacy, access
  independent of unrelated investment eligibility, and actions that need no
  wallet; certificates and exports retain authority, sequence and provenance.
- **Web/mobile acceptance:** complete the supported workflows from fresh company
  and participant accounts without routine platform staff, global privilege
  grants, admin screens or undocumented API calls.

Seeded staff-assisted journeys remain historical controls and evidence; fresh
company wallet admission refuses the historical no-key treasury target. A new
recording follows working implementation and records its served commit,
commands, results and limits.

## Driving the product

Before browser QA, prove which code is served using its build identity or file
hash. Clear old sessions and network captures as needed; distinguish application
requests from manual probes. "Works with policies bypassed" and "enforcement
holds" are different claims. Leave shared stacks and fixtures as found.
[CONTRIBUTING](../../CONTRIBUTING.md#review-and-merge) owns the PR convention
and review/merge policy.

## Documents against code

Read the source and quote both sides of a discrepancy with locations. Explain
what a reader would conclude wrongly. A summary or matching issue title is a
lead, not evidence. Separate outdated claims from deliberately limited scope.

## Other audits and design work

For standards audits, enumerate governed sites and known blind spots; propose a
mechanical check where possible. For runbook audits, follow the procedure on a
throwaway environment with unique ports and volumes, record the first failure,
and try the documented remedy. Fresh and existing databases can behave differently.
For test audits, mutate the claimed property and always restore the mutation.

Triage compares merged code with original acceptance criteria and distinguishes
duplicates by scope. Design notes measure the affected surface, compare two or
three shapes and their costs, and identify decisions reserved for the owner.
Historical evidence remains in Git and linked issues; current remedies are in
[troubleshooting](troubleshooting.md).
