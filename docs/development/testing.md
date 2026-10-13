# Testing and review

[Contributing](../../CONTRIBUTING.md) · [Documentation](../README.md)

The [11 October owner decision](../decisions.md#minimum-tests-and-fresh-migrations)
replaces the earlier coverage rules. Keep only tests guarding the worst failures
and one happy path per delivered core journey. Delete other tests and their
unused fixtures/helpers. Report what the remaining suite proves and leaves out.

The caps below are binding and count every executed case, including each
parameterized row. At capacity, a new core test replaces an existing case or
needs an explicit owner-approved cap increase in the same PR; never exceed a
cap temporarily. The PR records before/after counts and the replacement or
approval, and independent review checks them. The
[11 October follow-up](../decisions.md#binding-caps-and-backup-authorisation)
keeps the existing limits, including at most five real-app-login tenant cases.

## Commands

Run commands from the repository root with workspace dependencies, backend
development tools and an isolated PostgreSQL administrator connection available.

| Purpose                               | Command                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| All ordinary CI checks before pushing | `make preflight`                                                           |
| Source and client CI group            | `make ci-checks`                                                           |
| Source gates and type-checks          | `make check`                                                               |
| Lint                                  | `make lint`; `cd backend && make lint`                                     |
| Small gate controls                   | `make test-gates`                                                          |
| Client, shared and contract tests     | `make test`                                                                |
| PostgreSQL backend verification       | `make backend-test`                                                        |
| Production dependency advisories      | `make audit`                                                               |
| Browser bundle and Playwright smoke   | `make build && make smoke`                                                 |
| Optional local chain smoke            | `make chain-test`                                                          |
| Native builds before mobile release   | Manual [mobile native workflow](../../.github/workflows/mobile-native.yml) |

Native builds and chain smoke are manual, outside PR/main CI and preflight.
Dependency advisories run inside `make ci-checks` and `make backend-test`
([the audit gate](gates.md#dependency-advisories)); only the exceptions in
[the security policy](../../SECURITY.md#dependency-advisories) are accepted.
Correct dependency installation and PostgreSQL role privileges are
prerequisites; record setup time separately from test time.

## Backend verification

Use PostgreSQL, not SQLite: RLS, history/share-total triggers and issuance locks
are part of the actual application. `make backend-test` runs the small suite,
lint, dependency advisories, Django system/migration checks, role/catalogue checks
and the API schema snapshot. The fresh migrations create the current schema and
database guards. The command owns its scratch database and roles; preserve
developer resources.

Keep at most **150 executed backend cases** in total. Cover:

- One happy API path for each delivered core journey: sign-in, company setup and
  appointments, register/members, employee awards, investor allotments, member
  access, certificates and exports. Planned journeys need implementation first;
  a fixture or mock does not establish their delivery.
- Company A cannot read or change company B through the API or database.
- A user without the necessary appointment cannot approve, issue or allot.
- Issued shares equal holdings, and a repeated request produces one issue.
- One fake-scanner test refuses infected or unscannable uploads.

The delivered suite has 19 cases, including five real-app-login tenant cases.
Its company setup journey covers signup without a supporting file, initial
representative admission and later checked company documents. Identity, ABR,
versioned acknowledgement and company authority checks remain in that path.
Member invitations, own records and company-reviewed requests have one core API
journey; the existing tenant controls include foreign invitation and revoked
association refusals. One core output case covers real company/member PDFs,
pack provenance and file integrity; the same tenant controls cover private
output refusals. A request creates no output until company fulfilment retains
the actual recipient-only file.

Keep at most five real-app-login tenant cases; they must use real non-bypassing
app credentials for their API/database boundaries: a privileged fixture
connection alone does not prove RLS isolation, and ordinary `SET ROLE` fixtures
are not app-login evidence. The PR description records the executed count, the
scoped count and any skips. One or two optional chain smoke tests run through
`make chain-test`; the ordinary suite needs no chain node or scanner service.

## Client limits

Count executed cases, including parameterized rows:

| Suite          | Delivered cases | Maximum | Essential coverage               |
| -------------- | --------------- | ------- | -------------------------------- |
| Dashboard unit | 20              | 20      | Main pages, sign-in, core flows  |
| Mobile Jest    | 10              | 10      | App starts, sign-in, core flows  |
| Shared package | 9               | 10      | Essential shared behaviour       |
| Contracts      | 14              | 20      | Who can mint, pause and transfer |

The nine Playwright smoke tests remain, as do mobile type-check and lint.
Build, probe and device results before release are separate evidence.

## CI

Every pull request, main and manual CI run uses the same lean checks on
GitHub's Ubuntu runners; there is no file-based routing and no self-hosted
pool. The verdict fails closed: a failed, cancelled or missing required job is
a failure, and no rerun is automatic. The targets are the whole PR run within
**ten minutes on GitHub's runners** and all tests together within **five
minutes on the Mac**; record actual suite counts, commands and
setup/queue/test/job times rather than claiming the targets from a focused
subset or a historical larger-suite timing. The first complete run under this
policy on 11 October met both targets
([PR #970 CI](https://github.com/Ledova/ledova/actions/runs/38100287527)); the
Mac pool's retirement is recorded in
[decisions](../decisions.md#github-runners-and-mac-retirement).

## Preflight

`make preflight` runs the same ordinary checks as CI, except native builds.
There is no change preview or test-selection policy. Run a focused case during
development when useful, then preflight once before publication; applicable CI
must still pass on the final head up to date with main.

Preflight validates local wording and the commits since `BASE` (default
`origin/main`) through the local mode of the
[PR metadata gate](gates.md#the-pr-metadata-gate). Supply `PR_TITLE_FILE` and
`PR_BODY_FILE` to check the actual draft description; otherwise it checks a
draft derived from the HEAD commit, adding a `Refs` header from its title when
needed. The real PR description and online owning-issue verification stay in
CI; record the local and online boundaries separately in the PR.

## Migrations

Fresh initial migrations from current models install the schema, the PostgreSQL
roles and grants, RLS policies, functions and triggers, and the
history/share-total/issuance safeguards. `make backend-test` checks migration
drift, roles/catalogue and the API schema snapshot; no old-chain rewind,
equivalence/adoption suite or per-migration upgrade test is required. A database
using an older initial graph needs a rebuild, including the pre-member graph
used by the completed ledova.io cutover. The
[upgrade guide](../operations/upgrades.md#completed-ledovaio-rebuild-11-october-2026)
records that completed operation and the later, undeployed member/output scope.
There is no older-database adoption path.

## Documents against code

Independent review reads the final changed behaviour and the claims made about
it, under the [review and merge](../../CONTRIBUTING.md#review-and-merge)
protocol. Documentation review checks navigation and statements against source;
a page needs no tests mirroring its prose. Removed test names do not establish
current coverage, and product authority, privacy and ownership rules remain
behaviour even where exhaustive test permutations are retired. Record
meaningful results and gaps in short, plain PR descriptions.
