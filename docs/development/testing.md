# Testing and review

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

Choose evidence for the behavior changed. A successful command establishes only
what it exercised. Record the commands, results, untested boundaries and tested
commit in the PR.

## Commands

Run root commands from the repository root unless the table says otherwise.
Use an isolated PostgreSQL database with the required role privileges. Backend
tests now use PostgreSQL in both ordinary and specialized settings.

| Area | Commands |
| --- | --- |
| Source checks and type-checking | `make check` |
| Gate unit tests | `make test-gates` |
| Lint | `make lint`; `cd backend && make lint`, which needs the [backend lint tools](#backend-verification) |
| JavaScript and contracts | `make test` |
| Backend suites | The three suites under [backend verification](#backend-verification), always together |
| Migration drift | `cd backend && python manage.py makemigrations --check --dry-run` |
| Real EVM chain | `make chain-test` |
| Real Bitcoin chain | `python scripts/test-bitcoin-chain.py` against isolated PostgreSQL |
| Browser bundle smoke | `make build && make smoke` |
| Dependency advisories | `make audit` |
| Design tokens | `make generate-tokens`, then check generated CSS is unchanged |
| Native/mobile | [Builds](mobile-builds.md) and [probes](native-probes.md) |

`make check` installs backend development requirements and any missing workspace
dependencies. Workspace-only commands require the correct workspace installation;
mobile resolves from its own `node_modules`. `make help` lists entry points.
Formatting checks remain local: CI has no general workspace format step.

The four real-chain modules that `make chain-test` runs, listed in
[chains and keys](../operations/chains.md#chain-configuration), are skipped by an
ordinary backend suite without their chain environment. Use a free
`CHAIN_TEST_PORT` per checkout and inspect verbose skip
reasons. A PostgreSQL policy, trigger or status constraint requires the full
PostgreSQL suite; status constraints also require real-chain coverage. Do not
infer coverage from the test count.

CI configuration is authoritative for invoked checks:
[ordinary CI](../../.github/workflows/ci.yml) and
[native CI](../../.github/workflows/mobile-native.yml).
Real Redis/ClamAV controls are separate from unit fakes; see
[integrations](../operations/integrations.md) and [uploads](../operations/uploads.md).

## Backend verification

CI runs three backend suites, the ordinary suite in shard jobs of its own, and a
backend change runs all three locally before it is called green. A change to a policy,
a role grant or the test settings can pass two and fail the third, because each
sees something the others cannot. From `backend/`, the commands CI runs, though CI
splits the first across shard jobs (below):

```bash
python manage.py test --settings=ledova_backend.settings.test --parallel 4 --noinput
python manage.py test --settings=ledova_backend.settings.test_scoped --require-scoped-coverage --parallel 4 --noinput
python manage.py migrate --noinput
python manage.py check_rls_roles
python manage.py check_rls_catalogue
```

| Suite | What only it sees |
| --- | --- |
| Ordinary (`settings.test`; `cd backend && make test` runs it without `--noinput`) | The app role on one shared connection, through `SET ROLE` |
| Scoped | Real, separate app and operator aliases: a different code path from the ordinary suite's shared connection |
| Roles and catalogue | Grants and installed policies, which no test can observe |

An empty or suppressed run is not a pass: find the `Ran N tests` tally before
reading the exit status. [Scoped connection evidence](#scoped-connection-evidence)
explains how the ordinary and scoped suites differ.

CI splits the ordinary suite into parallel "Django ordinary shard (NAME)" jobs,
one for each shard in
[`.github/ordinary-suite-shards.json`](../../.github/ordinary-suite-shards.json).
Each job has its own PostgreSQL 16, and runs the ordinary command above with
`-k` and each of that shard's test name patterns appended. Before the suite, each
runs the [ordinary shard gate](gates.md#the-ordinary-shard-gate). It refuses a
test id defined by more than one test class, and holds the shards' test ids to a
partition of the unlabelled suite's, so on the same commit their `Ran N tests`
counts add up to the unsharded run's. Locally, run the unsharded command. To
repeat one shard, run `python ../scripts/check-ordinary-shards.py --run NAME`.

On a pull request, a scope job decides whether the Django jobs run: the shards
and "Django checks & tests". They run unless every changed file is under
`dashboard/`, `docs/`, `marketing/`, `mobile/` or `packages/`. Even then, two kinds
of change run them:

- A document that any file under `backend/` names, which is the only way the Django
  jobs read one: `check_rls_catalogue` names `docs/architecture/tenancy.md`, and a
  test reads that document's heading.
- Any `.gitattributes`, which can change how a document is checked out without
  changing the document.

The scope job compares the pull request's head with the base commit its event
records. GitHub can leave that at the branch point after `main` moves, which still
covers every file the pull request changes. A comparison it cannot complete runs
them. Every push to `main` runs them whatever changed, which catches a test that
reads a document through a path it builds.
[`scripts/ci-scope.py`](../../scripts/ci-scope.py) makes the decision, and the same
kind for the [native builds](mobile-builds.md). The "Django verdict" check fails
unless the scope job succeeded and each Django job succeeded, or was skipped
because the scope job found none needed; a failed, cancelled or wrongly skipped
job fails it.

`black`, `isort` and `flake8` are development requirements and are not in the
backend image, so running the source gates inside that image proves nothing
about CI's Lint step. Lint runs first in the Django checks job and stops that
job when it fails; the ordinary suite's shards run in their own jobs whether or
not it passes. Install the tools with `make install-backend` from the repository root
(`make check` does the same); CI installs the same file with
`pip install -r requirements-dev.txt -c schema/requirements.txt` from
`backend/`. Then run `cd backend && make lint`: `black --check` and
`isort --check-only` against `backend/pyproject.toml`, and `flake8` against
`backend/.flake8`.

## Test traps

- Red-prove a behavioral claim: remove the fix, observe a named failure, restore
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
- Concurrency tests use distinct objects/connections and prove database behavior,
  not accidental serialization through one shared Python object.
- Mobile render/event helpers are async. Await them and settle deferred promises;
  the lint mutation control verifies that unawaited events fail. Clean mounted
  components and query clients after every test, including the final one.
- Read migration-era rows with the executor's historical models. Restore current
  migrations after a tested rollback or rollback refusal before using current models.

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

## Reviewing and driving the product

The PR title identifies both its change type and owning issue using
`type(#issue): description`; its body starts with the matching `Refs #issue` or
`Closes #issue`. This includes automated dependency PRs. The complete convention
and type list live in
[Pull request titles and issue ownership](../../CONTRIBUTING.md#pull-request-titles-and-issue-ownership).

Review the diff and description at the named head. After a rebase, read the delta
or prove the reviewed content is unchanged. State depth and omissions; an approval
must not imply a read that did not occur. Read both intentions behind conflicts.
[CONTRIBUTING](../../CONTRIBUTING.md#review-and-merge) owns review/merge policy.

Before browser QA, prove which code is served using its build identity or file
hash. Clear old sessions and network captures as needed; distinguish application
requests from manual probes. “Works with policies bypassed” and “enforcement
holds” are different claims. Leave shared stacks and fixtures as found.

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
