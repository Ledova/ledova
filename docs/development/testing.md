# Testing and review

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

The [11 October owner decision](../decisions.md#minimum-tests-and-fresh-migrations)
replaces the earlier coverage rules. Keep only tests guarding the worst failures
and one happy path per delivered core journey. Delete other tests and their
unused fixtures/helpers. Report what the remaining suite proves and leaves out.

## Commands

Run commands from the repository root with workspace dependencies, backend
development tools and an isolated PostgreSQL administrator connection available.

| Purpose                               | Command                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| All ordinary CI checks before pushing | `make preflight`                                                           |
| Source gates and type-checks          | `make check`                                                               |
| Lint                                  | `make lint`; `cd backend && make lint`                                     |
| Small gate controls                   | `make test-gates`                                                          |
| Client, shared and contract tests     | `make test`                                                                |
| PostgreSQL backend verification       | `make backend-test`                                                        |
| Browser bundle and Playwright smoke   | `make build && make smoke`                                                 |
| Optional local chain smoke            | `make chain-test`                                                          |
| Native builds before mobile release   | Manual [mobile native workflow](../../.github/workflows/mobile-native.yml) |

Native builds and chain smoke are manual. They are outside PR/main CI and
preflight. Dependency advisories remain available through `make audit` when
needed. Correct dependency installation and PostgreSQL role privileges are
prerequisites; record setup time separately from test time.

## Backend verification

Use PostgreSQL, not SQLite: RLS, history/share-total triggers and issuance locks
are part of the actual application. `make backend-test` runs the small suite,
lint, Django system/migration checks, role/catalogue checks and the API schema
snapshot. The fresh migrations create the current schema and database guards.
The command owns its scratch database and roles; preserve developer resources.

Keep at most **150 executed backend cases** in total. Cover:

- One happy API path for each delivered core journey: sign-in, company setup and
  appointments, register/members, employee awards, investor allotments, member
  access, certificates and exports. Planned journeys need implementation first;
  a fixture or mock does not establish their delivery.
- Company A cannot read or change company B through the API or database.
- A user without the necessary appointment cannot approve, issue or allot.
- Issued shares equal holdings, and a repeated request produces one issue.
- One fake-scanner test refuses infected or unscannable uploads.

Keep at most five real-app-login tenant tests. Remove the broad strict suite,
real Redis/ClamAV, multi-process timing, deferred/legacy tests and unused support.
One or two optional chain smoke tests run through `make chain-test`; no chain
node or scanner service is needed by the ordinary suite.

## Scoped connection evidence

The small tenant suite must use real non-bypassing app credentials for its
API/database boundaries. A privileged fixture connection alone does not prove
RLS isolation. Record the actual scoped test count and any skips; do not describe
ordinary `SET ROLE` fixtures as separate app-login evidence.

## Client limits

Count executed cases, including parameterized rows:

| Suite          | Maximum | Essential coverage                 |
| -------------- | ------- | ---------------------------------- |
| Dashboard unit | 20      | Main pages, sign-in, one core flow |
| Mobile Jest    | 10      | App starts, sign-in, one core flow |
| Shared package | 10      | Essential shared behaviour         |
| Contracts      | 20      | Who can mint, pause and transfer   |

Keep the Playwright smoke tests. Mobile type-check and lint stay. Retire unused
mock factories, presentation permutations and test-only dependencies with their
tests. Build/probe/device results before release are separate evidence.

## CI routing

Every pull request runs the same lean checks on GitHub's runners. There is no
file-based routing. Keep the fail-closed verdict, PR wording and source gates.
A failed, cancelled or missing required job is a failure; no rerun is automatic.

Compatible main jobs keep the existing permanent Mac pool selection: backend
uses the primary profile and source/client checks the ordinary profile. Guests
are isolated Linux ARM64 with exact run/attempt/job identity. A workflow change
requires independent review, a clean drain and host policy rebinding before
admission. Missing capacity remains visible. Linux-host expansion stays deferred.

The login service needs the Mac powered and logged in. Administrator-level
system startup installation remains deferred. Guest cleanup and queue time are
separate from execution time; a configured route does not prove availability.

Targets are the whole PR run within **ten minutes on GitHub's runners** and all
tests together within **five minutes on the Mac**. Record actual suite counts,
commands, setup/queue/test/job times and gaps. Do not claim the targets from a
focused subset, parallel method-time sum or historical larger-suite timing.

## Preflight

`make preflight` runs the same ordinary checks as CI, except native builds.
There is no change preview or test-selection policy. Run a focused case during
development when useful, then preflight once before publication; applicable CI
must still pass on the final head up to date with main.

The [PR wording gate](gates.md#the-pr-metadata-gate) verifies the owning issue and
closing phrases. A `Refs` body or commit must contain no closing phrase before
an issue number, even a negated phrase. Record local wording checks and any
online metadata boundary separately in the PR.

## Migration baseline

The earlier baseline/adoption procedure is retired. Generate fresh initial
project migrations from current models; install PostgreSQL roles/grants, RLS,
functions/triggers and current history/share-total/issuance safeguards. Keep
migration drift, roles/catalogue and API schema checks. No old-chain rewind,
equivalence/adoption suite or blanket per-migration upgrade test is required.

Historical sources remain in Git. Held product migrations rebase onto the fresh
history. An older ledova.io database needs a rebuild; the
[backup/export/rebuild/re-seed plan](../operations/upgrades.md#fresh-database-rebuild)
requires owner approval before executing any part.

## Documents against code

Independent review reads the final changed behaviour and the claims made about
it. State reviewer identity, head SHA, depth and omissions; a branch movement
needs unchanged-content proof or review of its delta. A blocking review stands
until its author clears it. Record meaningful results and gaps in short, plain
PR descriptions. Documentation needs no tests mirroring its prose.

Delivered increment guides retain their original evidence as history. Removed
test names do not establish current coverage. Product authority, privacy and
ownership rules remain behaviour even where exhaustive test permutations are
retired; the minimum suite is deliberately narrower.
