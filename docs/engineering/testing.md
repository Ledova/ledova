# Testing and review

[Engineering](README.md) · [Documentation](../README.md)

How a change shows that it works, for anyone changing code or documentation; each mechanical
check is described in [gates](gates.md).

- [Minimum-test policy](#minimum-test-policy)
- [Commands](#commands)
- [Backend verification](#backend-verification)
- [Client suites](#client-suites)
- [CI](#ci)
- [Preflight](#preflight)
- [Documents against code](#documents-against-code)

## Minimum-test policy

Under the [11 October owner decision](../decisions.md#minimum-tests-and-fresh-migrations), keep
only tests guarding the worst failures and one happy path per delivered core journey. Delete other tests and their unused fixtures and helpers. Report what the
remaining suite proves and leaves out. Documentation-only changes need no tests mirroring their
text.

The caps are binding and count every executed case, including each parameterised row. At
capacity, a new core test replaces an existing case or needs an explicit owner-approved cap
increase in the same PR; never exceed a cap temporarily. The PR records before and after counts and
the replaced cases or the approval, and independent review checks them
([binding caps](../decisions.md#binding-caps-and-backup-authorisation)).

| Suite               | Delivered cases | Maximum | Essential coverage                                                                                                             |
| ------------------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Backend, PostgreSQL | 25              | 150     | Core API happy paths, tenant isolation, company authority, ownership totals and issuance idempotency, one fake-scanner refusal |
| Dashboard unit      | 20              | 20      | Main pages, sign-in, core flows                                                                                                |
| Playwright smoke    | 9               | 9       | Core browser journeys and route wiring                                                                                         |
| Mobile Jest         | 10              | 10      | App start, sign-in, core flows                                                                                                 |
| Shared package      | 10              | 10      | Essential shared behaviour                                                                                                     |
| Contracts           | 14              | 20      | Who can mint, pause and transfer                                                                                               |

Type-check and lint are outside the case caps. Build, probe and device results before a mobile
release are separate evidence
([mobile releases](mobile-releases.md)).

## Commands

Run commands from the repository root with workspace dependencies, backend development tools and an
isolated PostgreSQL administrator connection available.

| Purpose                                       | Command                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| All ordinary CI checks before pushing         | `make preflight`                                                           |
| Source and client CI group                    | `make ci-checks`                                                           |
| Source gates and type-checks                  | `make check`                                                               |
| Lint                                          | `make lint`; `cd backend && make lint`                                     |
| Small gate controls                           | `make test-gates`                                                          |
| Client, shared and contract tests             | `make test`                                                                |
| PostgreSQL backend verification               | `make backend-test`                                                        |
| Production dependency advisories              | `make audit`                                                               |
| Browser bundle and Playwright smoke           | `make build && make smoke`                                                 |
| Optional local chain smoke (one or two tests) | `make chain-test`                                                          |
| Native builds before mobile release           | Manual [mobile native workflow](../../.github/workflows/mobile-native.yml) |

Native builds and chain smoke are manual, outside PR and main CI and preflight. Where dependency
advisories run is in [gates](gates.md#dependency-advisories). Correct dependency installation and
PostgreSQL role privileges are prerequisites; record setup time separately from test time.

## Backend verification

Use PostgreSQL, not SQLite: RLS, history and share-total triggers and issuance locks are part of
the actual application. `make backend-test` runs the suite, lint, dependency advisories, Django
system and migration checks, the RLS role and catalogue checks (`check_rls_roles`,
`check_rls_catalogue`, against the deployed connections and schema) and the API schema snapshot.
The command owns its scratch database and roles, preserves developer resources, and gives the
backend only `PATH`, `HOME`, locale and temporary-directory variables, a synthetic secret, local
storage and its scratch credentials, so the local `.env` file in `backend/` plays no part. It runs the suite through
Django discovery; the [runner](../../backend/shared/test_runner.py) refuses an empty suite. The
test settings fix `BLOCKCHAIN_CHAIN_ID=84532` with the approved finality policies, so an accepted
`LOCAL_CHAIN_FINALITY_DEPTH` in the environment has no effect on the suites, while a value the
backend refuses stops them as it stops every other command.

The backend suite covers:

- One happy API path for each delivered core journey: sign-in, company setup and appointments,
  register and members, employee awards, investor allotments, member access, certificates and
  exports. Planned journeys need implementation first; a fixture or mock does not establish their
  delivery.
- Company A cannot read or change company B through the API or the database.
- A user without the necessary appointment cannot approve, issue or allot, and a staff account
  without the company change permission cannot change a company's status.
- A member without a full name is never named by their email address.
- Issued shares equal holdings, and a repeated request produces one issue.
- One fake-scanner test refuses infected or unscannable uploads. The ordinary suite stubs the
  scanner and cache and needs no chain node or scanner service.

The company setup journey covers signup without a supporting file, initial representative
admission without an ABR lookup, activation with one and later checked company documents, with
the identity, versioned acknowledgement and company authority checks in that path; resuming signup
uses current administrator authority and a retained current Terms receipt without rewriting
historical permissions or declarations.
Member invitations, own records and company-reviewed requests have one core journey, and the
tenant controls include foreign invitation and revoked association refusals. One output case covers
real company and member PDFs, pack provenance and file integrity; a request creates no output until
company fulfilment retains the actual recipient-only file. Two mirror cases cover complete copied
holdings and allotments, once-only opening corrections, retained earlier snapshots, stale and
incomplete requests, and refusal after later ownership or member-access activity. They exercise
the API and PostgreSQL guards; they establish no genuine legal register or source verification.

### Real-app-login tenant cases

Keep at most five real-app-login tenant cases. They use real non-bypassing app credentials for
their API and database boundaries: a privileged fixture connection alone does not prove RLS
isolation, and ordinary `SET ROLE` fixtures are not app-login evidence.
`backend/shared/tests/test_scoped_access.py` holds them:
session and principal handling, foreign reads and writes, exact-company binding, foreign approval
and once-only issue. The PR description records the executed count, the scoped count and any skips.

## Client suites

The dashboard cases cover the main pages, sign-in, the guided manual company mirror journey,
individual draft add, edit and cancel, interrupted-request recovery and confirmed ownership; the
ownership dashboard case keeps the unopened-class guard. Chrome observation uses fictional records
and a local PostgreSQL app role, separate from the client mocks and from genuine company or provider
verification.

## CI

Every pull request, main and manual CI run uses the same lean checks on GitHub's Ubuntu runners:
`Source and client checks` runs `make ci-checks` and `Backend verification` runs
`make backend-test`. There is no file-based routing and no self-hosted pool
([decision](../decisions.md#github-runners-and-mac-retirement)). The verdict fails closed: a
failed, cancelled or missing required job is a failure, and no rerun is automatic. The
[PR metadata gate](gates.md#the-pr-metadata-gate) runs as its own workflow.

The targets are the whole PR run within ten minutes on GitHub's runners and all tests together
within five minutes on the Mac. Record actual suite counts, commands and setup, queue, test and job
times rather than claiming the targets from a focused subset or a historical larger-suite timing.

## Preflight

`make preflight` runs the same ordinary checks as CI, except native builds. There is no change
preview or test-selection policy. Run a focused case during development when useful, then preflight
once before publication; applicable CI must still pass on the final head, up to date with main.

Preflight also checks local wording and the commits since `BASE` (default `origin/main`) through
the local mode of the [PR metadata gate](gates.md#the-pr-metadata-gate). Supply
`PR_TITLE_FILE` and `PR_BODY_FILE` to check the actual draft description; otherwise it checks a
draft derived from the HEAD commit, adding a `Refs` header from its title when needed. Record the
local and online boundaries separately in the PR.

## Documents against code

Independent review reads the final changed behaviour and the claims made about it, under the
[review and merge](../../CONTRIBUTING.md#review-and-merge) protocol; documentation review is in
[the documentation gate](gates.md#the-documentation-gate). Removed test names do not establish
current coverage, and product authority, privacy and ownership rules remain behaviour even where
exhaustive test permutations are retired. Record meaningful results and gaps in short, plain PR
descriptions.

Next: [gates](gates.md), [backend](backend.md),
[security model](security.md) and [contributing](../../CONTRIBUTING.md).
