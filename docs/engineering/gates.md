# Gates

[Engineering](README.md) · [Documentation](../README.md)

Start here when a check fails. Each section states the rule, the remedy and what the check does and
does not establish. The source owns exact matchers and exception inventories; the
[minimum-test policy](testing.md#minimum-test-policy) and the
[debt rules](#gate-debt-and-exceptions) apply to the gates' own small controls. Commands run from
the repository root unless stated otherwise.

Contents: [every gate](#every-gate-and-where-its-rule-is-written) (its table links each gate),
[gate debt and exceptions](#gate-debt-and-exceptions),
[dependency advisories](#dependency-advisories).

## Every gate, and where its rule is written

`check-docs.py` holds this table to `scripts/`: a gate script with no entry fails, and an entry
naming no script fails.

| Script                        | Rule                                                                 | `make check` | CI job                   |
| ----------------------------- | -------------------------------------------------------------------- | ------------ | ------------------------ |
| `check-comments.py`           | [The comment gate](#the-comment-gate)                                | yes          | Source and client checks |
| `check-type-check.py`         | [The type-check gate](#the-type-check-gate)                          | yes          | Source and client checks |
| `check-layers.py`             | [The layer gate](#the-layer-gate)                                    | yes          | Source and client checks |
| `check-connection-binding.py` | [The connection-binding gate](#the-connection-binding-gate)          | yes          | Source and client checks |
| `check-schema-responses.py`   | [The schema response gate](#the-schema-response-gate)                | yes          | Source and client checks |
| `check-test-shadowing.py`     | [The test shadowing gate](#the-test-shadowing-gate)                  | yes          | Source and client checks |
| `check-error-bodies.py`       | [The error body gate](#the-error-body-gate)                          | yes          | Source and client checks |
| `check-logging.py`            | [The logging privacy gate](#the-logging-privacy-gate)                | yes          | Source and client checks |
| `check-docs.py`               | [The documentation gate](#the-documentation-gate)                    | yes          | Source and client checks |
| `check-pr-metadata.py`        | [The PR metadata gate](#the-pr-metadata-gate)                        | no           | PR metadata              |
| `check-api-schema.py`         | [The API type drift gate](#the-api-type-drift-gate)                  | no           | Backend verification     |
| `check-api-types.mjs`         | [The API type drift gate](#the-api-type-drift-gate)                  | yes          | Source and client checks |
| `check-client-operations.mjs` | [The API type drift gate](#the-api-type-drift-gate)                  | yes          | Source and client checks |
| `check-self-imports.mjs`      | [Shared package imports](frontend.md#clients-and-the-shared-package) | yes          | Source and client checks |

Two rules are gated without a script of their own: migration drift through
`makemigrations --check --dry-run` in the backend group, and generated design tokens through the
non-writing `generate-css-tokens.mjs --check` in `make check`. The Makefile also runs the mobile
test-await control, the real native dependency resolver (`npm --prefix mobile run check:resolution`)
and the dashboard React singleton check. [Dependency advisories](#dependency-advisories) have their own
helper.

## Gate debt and exceptions

Rules name reference implementations and enforcement. Existing gate debt is counted separately from
justified exceptions; counts may shrink and stale pins must be removed. Do not add an exception
merely to make a check green.

## The PR metadata gate

`scripts/check-pr-metadata.py` requires a `type(#issue): description` title and a matching
`Refs #issue` or `Closes #issue` as the first nonblank body line, and checks through GitHub that the
number is an issue in this repository. The types and ownership convention are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#pull-request-titles-and-issue-ownership). A `Refs` PR must
close no issue: the gate refuses one whose `closingIssuesReferences` list has an entry, or whose
title or any commit's message carries one of GitHub's
[closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword)
followed by `#N`, `OWNER/REPO#N` or an issue URL, because squash merges copy commit messages into
the squash commit. The refusal names each issue, title reference or commit; remove the phrase or
link, or reword the title or commit. A `Closes` PR is checked against none of these, and a type
prefix such as `fix(#123):` is not a closing phrase.

The gate reads the PR in one `gh pr view` call, which returns at most 100 commits, so it also reads
the commit count from the REST API and refuses a PR whose count is missing or differs from the
commits read. It matches only GitHub's documented spellings and the issue-URL form, so `GH-N` and
`Closes#N` pass, and a message edited at merge time is not checked. The `PR metadata` workflow runs
on creation, edits, new commits, reopening and readiness changes, including bot PRs, under
`pull_request_target` with read-only permissions: it checks out only the default branch and fetches
titles, bodies and commits as data. The check needs GitHub access and is not part of `make check`;
locally, run `python scripts/check-pr-metadata.py --repository OWNER/REPO --pr NUMBER` with an
authenticated `gh`. It verifies traceability, not whether the issue is a sensible match; review owns
that.

For local wording checks, use
`python scripts/check-pr-metadata.py --title-file TITLE --body-file BODY --base BASE`. This mode
reads the complete ancestor-to-HEAD commit range and detects closing phrases in the whole draft
body, including negated phrases. It refuses incomplete, shallow or divergent history. It verifies
wording and the local range; issue existence, GitHub closing references and the complete PR commit
count remain the online gate's responsibility. The online and local modes are mutually exclusive.
[Preflight](testing.md#preflight) uses this local mode for supplied PR files or an explicitly
qualified draft derived from HEAD.

## The comment gate

`make check-comments` parses comments and docstrings across governed source trees. Rename code or
explain behaviour through tests; source explanations belong in docs
([what may carry comments](README.md#principles)). Python uses tokenize/AST; client parsing
distinguishes strings, regexes, JSX and template expressions. CSS, Solidity and native templates
have their own scans.

The governed trees are `TREES` in `scripts/check-comments.py`; `NOT_SCANNED` names intentional
omissions with reasons. The [tree/parser control](../../scripts/tests/test_check_comments_trees.py)
checks that native templates and tests are reached and that URLs are not comments; it does not prove
every tree or parser permutation. Functional native directives, URLs, regexes and JSX text are not
comment exemptions. Admin templates are outside the scan and should also remain free of comments.

Only functional directives are allowed: Python `# noqa`, `# type:`, `# pragma`, `# fmt:`, `# isort`,
shebang/coding lines; JavaScript/TypeScript ESLint disable/enable, `@ts-ignore`, `@ts-expect-error`,
`@ts-nocheck`, `prettier-ignore`, reference directives, Vitest/Jest environment directives,
Istanbul/c8/v8 coverage pragmas, `/* global */`, `biome-ignore`; Solidity SPDX identifiers. The list
is closed.

## The type-check gate

`make check-type-check` refuses workspace scripts that can report success while checking no files.
Use `tsc -b --noEmit` for a solution config with references; a config with no file set and no
references must name its files. The checker resolves JSONC and inherited `files`/`include`
independently, reports unreadable configuration, accounts for every discovered workspace or explicit
exclusion, and distinguishes a successful empty check from a compiler error that already fails CI.
It does not replace compilation. Install the correct workspace dependencies before running
`make check`; checks do not install missing tools.

## The layer gate

`make check-layers` enforces the [backend layer table](backend.md#backend-layers): services
orchestrate, querysets own queries, and views adapt HTTP. Follow the reference files named there.
New/touched services use functions; existing class conversions are tracked debt. Stateful provider
clients remain classes. The checker reads Python syntax and maintains rule-specific historical
allowances; it is not a call graph, and a measured legacy site is not a general permission for new
code.

## The connection-binding gate

`make check-connection-binding` refuses default-bound transaction and cursor imports in backend
production code. Use `shared.db.atomic`, `shared.db.on_commit` and an explicitly selected
connection. A default-bound transaction can commit writes on another alias even when its own block
rolls back. The checker refuses imports as well as known call spellings, including aliases and
decorators; its allowances are the alias-aware helper implementation, principal handling and role
checks, and tests and migrations have separate scope. Test settings can conceal a wrong alias;
[real-app-login tests](testing.md#real-app-login-tenant-cases) prove the real boundary.

## The schema response gate

`make check-schema-responses` requires explicit schema metadata when routed methods return another
serializer or an action builds a literal success body. Fix the response declaration at the routed
method, including private-helper responses: the checker follows local private helpers to their
routed callers. The gate establishes that metadata exists, not that it is accurate. Provider
webhooks may be explicitly excluded. Non-DRF routes need another schema mechanism; the trading
stream is covered by the [schema postprocessing hook](../../backend/shared/api/schema_hooks.py),
which derives event names from the publisher catalogue. The API snapshot checks the resulting
schema.

## The test shadowing gate

`make check-test-shadowing` refuses helpers that override reserved `unittest.TestCase` methods, such
as `fail`, and silently disable assertions. Rename the helper. The reserved set derives from
`dir(TestCase)` and excludes intentional setup/teardown and runner hooks. Its small control checks
the matcher's positive/negative boundary, not whether every assertion executes. This does not
establish assertion quality.

## The error body gate

`make check-error-bodies` refuses caught exception text in API errors or public serialised failure
fields. Raise the fixed API exception message or use an approved sanitizer, and keep bounded
diagnostics in the log and on the operator-facing record under the logging rules. The checker
follows caught exception values through local assignments, formatted messages and selected model
failure writers, and resolves public serializer exposure. Sanitizer allowances assert a real safe
transformation and need tests; moving text into a 200 response field does not make it safe to serve.
The gate verifies selected receiver/serializer boundaries; it is not general interprocedural taint
analysis.

## The logging privacy gate

`make check-logging` refuses whole objects in client console calls, object serialization and
request/response bodies interpolated into strings. Backend logs must not name private values or
whole provider bodies. Use narrow identifiers and safe diagnostics, with logger names the checker
scans (`logger`, `log`, `logging`): renaming a logger silently drops its calls from coverage. The
checker recognises whole-body attributes, subscripts, `.get()`, serialization and formatting
wrappers; client string literals are not a blanket permission to interpolate provider bodies. In the
modules listed in `PROVIDER_FACING`, which call the EVM node whose URL carries the provider's key in
its path, a log line never formats a caught exception except through `failure_summary()` (its class
and the endpoint's host) or `type()`, and never prints a traceback (`logger.exception`, `exc_info`):
a requests error's text names the URL it failed on, key included. This gate and the error body gate
are syntax analyses with bounded local reasoning: a passing result does not establish privacy
through arbitrary helper calls or runtime-computed names, so read new data flows yourself.

## The documentation gate

`make check-docs` checks relative inline links and heading anchors in root README, CONTRIBUTING,
SECURITY and CODE_OF_CONDUCT, plus **every Markdown document recursively under docs/**. It holds the
[job schedule](../operations/jobs-and-storage.md#schedule) to the names of the backend's
`@app.periodic` tasks, `def` or `async def`, and the gate inventory above to `scripts/check-*`, in
both directions. `check-port-free` is deliberately not a gate (`NOT_A_GATE`: Makefile plumbing for
`make chain-test`).

The checker compares paths, anchors and names, with GitHub's space-to-hyphen heading behaviour. It
does not verify external URLs, cron values, arbitrary Markdown syntax or behavioural claims. New
nested guides must remain discoverable from a parent, and documentation review checks navigation and
statements against source.

## Dependency advisories

`make ci-checks` runs `npm audit --omit=dev` for the root JavaScript workspaces, site, contracts and
mobile. `make backend-test` runs `pip-audit` against the backend requirements. `make audit` runs
both directly; preflight inherits each audit once from its CI group. Dependabot continues
separately.

[The audit helper](../../scripts/audit-dependencies.py) accepts only the fixed package/advisory
pairs recorded in [SECURITY.md](../../SECURITY.md#dependency-advisories). A new advisory, a critical
npm finding, an incomplete report or a tool failure fails verification. Resolve the dependency
finding or obtain an explicit, reviewed exception; do not accept every future finding in an existing
category. Production dependency audits do not cover omitted development dependencies.

## The API type drift gate

The committed [OpenAPI document](../../backend/schema/openapi.json) is generated with Python
3.13.15, PostgreSQL 16 and packages constrained by
[the schema requirements](../../backend/schema/requirements.txt). In an isolated environment, run
`make install-schema-environment`, migrate a dedicated database using
`ledova_backend.settings.test_postgres`, then run `make check-api-schema`. `POSTGRES_*` selects the
database. Generation refuses other toolchains, SQLite, pending migrations, warnings and errors; it
never migrates for you. `make update-api-schema` explicitly generates and checks before updating the
snapshot; ordinary comparison never rewrites it. Mapping keys are canonicalised; array order,
constraints, request/response metadata and nullability remain significant. Fix diagnostics through
real declarations and existing enum definitions, without bypassing authorisation or suppressing
warnings. The schema checker excludes administrative, static, API-root, format-duplicate and
bodyless methods; its explicit provider-webhook exclusions are Alchemy, KYCAID identity, KYCAID
crypto and Sumsub. Missing routes, phantom operations and stale exclusions fail; unused application
routes and error-only compatibility routes still count.

`make check-api-types` regenerates the
[shared TypeScript contracts](../../packages/shared/src/generated/api.ts) from the committed
snapshot with the pinned root `openapi-typescript` dependency and compares bytes; it does not write
files. `make update-api-types` explicitly replaces the generated file, and `make update-api-schema`
updates both. `API_TYPES_SCHEMA=...` selects another input. Generated types keep nullability,
required fields, enums and exact decimal strings; read-only fields are absent from requests and
write-only inputs from responses. Trading event types come from the stream extension: the
invalidation map must account for every event and must not retain a removed event. The shared,
dashboard and mobile compiler checks validate consumers against those contracts.

`make check-client-operations` uses installed root Node dependencies and the committed schema to
account for shared, dashboard and mobile HTTP operations and their successful response kinds,
including 204, binary and streams. It recognises Axios through compiler declarations, requires every
member of a typed call's claimed response union to accept a generated successful response of the
operation it calls, and fails closed on unavailable operations, unresolved explicit types and
unaccounted transports; untyped calls stay in the route census without a response-type proof. The
checker does not establish which response branch a runtime request selects or certify external
destination policy. The type-generation decision and its checkpoint are recorded in
[decisions](../decisions.md#clients-and-api-types).

Next: [testing](testing.md), [backend](backend.md) and [contributing](../../CONTRIBUTING.md).
