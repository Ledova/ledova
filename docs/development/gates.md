# Gates

[Contributing](../../CONTRIBUTING.md) · [Standards](standards.md) · [Testing](testing.md)

Start here when a check fails. Each section states the rule, the remedy and
what the check does and does not establish. The source owns exact matchers and
exception inventories: when extending a checker or investigating a false result,
run `make test-gates`, and introduce a failing fixture and a valid control for a
changed matcher. Counted historical debt must shrink and stale counts must fail;
a justified exclusion needs a reason and coverage proving its boundary. Commands
run from the repository root unless stated otherwise.

## Every gate, and where its rule is written

`check-docs.py` holds this table to `scripts/`: a gate script with no entry
fails, and an entry naming no script fails.

| Script                        | Rule                                                         | `make check` | CI job                 |
| ----------------------------- | ------------------------------------------------------------ | ------------ | ---------------------- |
| `check-comments.py`           | [The comment gate](#the-comment-gate)                        | yes          | source gates           |
| `check-type-check.py`         | [The type-check gate](#the-type-check-gate)                  | yes          | source gates           |
| `check-layers.py`             | [The layer gate](#the-layer-gate)                            | yes          | source gates           |
| `check-connection-binding.py` | [The connection-binding gate](#the-connection-binding-gate)  | yes          | source gates           |
| `check-schema-responses.py`   | [The schema response gate](#the-schema-response-gate)        | yes          | source gates           |
| `check-test-shadowing.py`     | [The test shadowing gate](#the-test-shadowing-gate)          | yes          | source gates           |
| `check-error-bodies.py`       | [The error body gate](#the-error-body-gate)                  | yes          | source gates           |
| `check-logging.py`            | [The logging privacy gate](#the-logging-privacy-gate)        | yes          | source gates           |
| `check-docs.py`               | [The documentation gate](#the-documentation-gate)            | yes          | source gates           |
| `check-pr-metadata.py`        | [The PR metadata gate](#the-pr-metadata-gate)                | no           | PR metadata            |
| `check-api-schema.py`         | [The API type drift gate](#the-api-type-drift-gate)          | no           | Django                 |
| `check-ordinary-shards.py`    | [The ordinary shard gate](#the-ordinary-shard-gate)          | yes          | Django ordinary shards |
| `check-api-types.mjs`         | [The API type drift gate](#the-api-type-drift-gate)          | yes          | JavaScript             |
| `check-client-operations.mjs` | [The API type drift gate](#the-api-type-drift-gate)          | no           | JavaScript             |
| `check-self-imports.mjs`      | [Clients and the shared package](../architecture/clients.md) | yes          | JavaScript             |

`check-port-free.py` is in `scripts/` and is not on this table: it refuses to
start the chain test when its port is taken, which is Makefile plumbing rather
than a rule anything is held to. `check-docs.py` carries it in `NOT_A_GATE`
with that reason, so its absence is a recorded decision rather than an
oversight, and documenting it here would fail the gate.

Two rules are gated without a script of their own: one migration per model
change, through CI's `makemigrations --check --dry-run`, and the generated
design tokens, through `git diff --exit-code` after `make build`. Other checks
run from the Makefile rather than from `scripts/`: `make check-mobile-test-awaits`,
`npm --prefix mobile run check:resolution`, which checks the real native
dependency graph including shared React/query peers (Jest and TypeScript
resolution alone do not prove Metro resolution), and, in `make test`,
`dashboard/scripts/check-react-singleton.mjs`,
`mobile/scripts/shared-peer-resolution.test.mjs`, the negative control for the
peer step of `check:resolution`, and `mobile/scripts/tests/relative-imports.test.mjs`,
the control for its refusal of a relative import that climbs out of `mobile/`
into a `node_modules` directory. `check-self-imports.mjs` prevents the shared
package importing its own public barrel.

## The PR metadata gate

`scripts/check-pr-metadata.py` requires a `type(#issue): description` title and a
matching `Refs #issue` or `Closes #issue` as the first nonblank body line, and
checks through GitHub that the number is an issue in this repository. The types
and ownership convention are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#pull-request-titles-and-issue-ownership).
A `Refs` PR must close no issue: the gate refuses one whose
`closingIssuesReferences` list has an entry, or whose title or any commit's
message carries one of GitHub's
[closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword)
followed by `#N`, `OWNER/REPO#N` or an issue URL, because squash merges copy
commit messages into the squash commit (that is how #170 was closed by #172's
squash commit while #172's list was empty). The refusal names each issue, title
reference or commit; remove the phrase or link, or reword the title or commit.
A `Closes` PR is checked against none of these, and a type prefix such as
`fix(#123):` is not a closing phrase.

The gate reads the PR in one `gh pr view` call, which returns at most 100
commits, so it also reads the commit count from the REST API and refuses a PR
whose count is missing or differs from the commits read. It matches only
GitHub's documented spellings and the issue-URL form, so `GH-N` and `Closes#N`
pass, and a message edited at merge time is not checked. The `PR metadata`
workflow runs on creation, edits, new commits, reopening and readiness changes,
including bot PRs, under `pull_request_target` with read-only permissions: it
checks out only the default branch and fetches titles, bodies and commits as
data. The check needs GitHub access and is not part of `make check`; locally,
run `python scripts/check-pr-metadata.py --repository OWNER/REPO --pr NUMBER`
with an authenticated `gh` 2.72.0 or later. It verifies traceability, not
whether the issue is a sensible match; review owns that.

## The comment gate

`make check-comments` parses comments and docstrings across governed source trees.
Rename code or explain behaviour through tests; source explanations belong in docs.
Configuration and documentation can retain comments. Root `scripts/` modules carry
docstrings. Python uses tokenize/AST; client parsing distinguishes strings, regexes,
JSX and template expressions. CSS, Solidity and native templates have their own scans.

The trees are, in full: `backend`, `dashboard/src`, `mobile/src`,
`mobile/scripts`, `mobile/native-tests`, `mobile/plugins`, `mobile`, `packages/shared`, `packages/scripts`,
`marketing/src`, `dashboard`, `dashboard/scripts`, `marketing`, `contracts`, `contracts/contracts`,
`contracts/scripts`, `contracts/test`.

That sentence is checked against `TREES`. Each tree's extension and recursion scope
lives in the script; `NOT_SCANNED` names intentional omissions with reasons. The
[tree-coverage tests](../../scripts/tests/test_check_comments_trees.py) refuse
source outside both lists, so dropping a recursive tree fails them. Native
preprocessor code, URLs, regexes and JSX text are positive parsing controls, not
comment exemptions. Admin templates are outside the scan and should also remain
free of comments.

Only functional directives are allowed: Python `# noqa`, `# type:`, `# pragma`,
`# fmt:`, `# isort`, shebang/coding lines; JavaScript/TypeScript ESLint disable/enable,
`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `prettier-ignore`, reference directives,
Vitest/Jest environment directives, Istanbul/c8/v8 coverage pragmas, `/* global */`,
`biome-ignore`; Solidity SPDX identifiers. The list is closed.

## The type-check gate

`make check-type-check` refuses workspace scripts that can report success while
checking no files. Use `tsc -b --noEmit` for a solution config with references;
a config with no file set and no references must name its files. The checker
resolves JSONC and inherited `files`/`include` independently, reports unreadable
configuration, accounts for every discovered workspace or explicit exclusion,
and distinguishes a successful empty check from a compiler error that already
fails CI. It does not replace compilation. Install the correct workspace
dependencies before running its type-check directly; `make check` installs
missing ones.

## The layer gate

`make check-layers` enforces the [backend layer table](../architecture/backend.md#backend-layers):
services orchestrate, querysets own queries, and views adapt HTTP. Follow the
reference files named there. New/touched services use functions; existing class
conversions are tracked debt. Stateful provider clients remain classes. The
checker reads Python syntax and maintains rule-specific historical allowances;
it is not a call graph, and a measured legacy site is not a general permission
for new code.

## The connection-binding gate

`make check-connection-binding` refuses default-bound transaction and cursor imports
in backend production code. Use `shared.db.atomic`, `shared.db.on_commit` and an
explicitly selected connection. A default-bound transaction can commit writes on
another alias even when its own block rolls back. The checker refuses imports as
well as known call spellings, including aliases and decorators; its allowances
are the alias-aware helper implementation, principal handling and role checks,
and tests and migrations have separate scope. Test settings can conceal a wrong
alias; [scoped tests](testing.md#scoped-connection-evidence) prove the real boundary.

## The schema response gate

`make check-schema-responses` requires explicit schema metadata when routed methods
return another serializer or an action builds a literal success body. Fix the
response declaration at the routed method, including private-helper responses:
the checker follows local private helpers to their routed callers. The gate
establishes that metadata exists, not that it is accurate. Provider webhooks may
be explicitly excluded. Non-DRF routes need another schema mechanism; the
trading stream is covered by the
[schema postprocessing hook](../../backend/shared/api/schema_hooks.py), which
derives event names from the publisher catalogue, and its tests.

## The test shadowing gate

`make check-test-shadowing` refuses helpers that override reserved
`unittest.TestCase` methods, such as `fail`, and silently disable assertions.
Rename the helper. The reserved set derives from `dir(TestCase)` and excludes
intentional setup/teardown and runner hooks; its regression controls establish
which assertions become inert when `fail` is replaced. This does not establish
assertion quality.

## The error body gate

`make check-error-bodies` refuses caught exception text in API errors or public
serialized failure fields. Raise the fixed API exception message or use an approved
sanitizer, and keep bounded diagnostics in the log and on the operator-facing
record under the logging rules. The checker follows caught exception values
through local assignments, formatted messages and selected model failure
writers, and resolves public serializer exposure. Sanitizer allowances assert a
real safe transformation and need tests; moving text into a 200 response field
does not make it safe to serve. The gate verifies selected receiver/serializer
boundaries; it is not general interprocedural taint analysis.

## The logging privacy gate

`make check-logging` refuses whole objects in client console calls, object
serialization and request/response bodies interpolated into strings. Backend logs
must not name private values or whole provider bodies. Use narrow identifiers and
safe diagnostics, with logger names the checker scans (`logger`, `log`, `logging`):
renaming a logger silently drops its calls from coverage. The checker recognises
whole-body attributes, subscripts, `.get()`, serialization and formatting
wrappers; client string literals are not a blanket permission to interpolate
provider bodies. In the modules listed in `PROVIDER_FACING`, which call the EVM
node whose URL carries the provider's key in its path, a log line never formats
a caught exception except through `failure_summary()` (its class and the
endpoint's host) or `type()`, and never prints a traceback (`logger.exception`,
`exc_info`): a requests error's text names the URL it failed on, key included.
This gate and the error body gate are syntax analyses with bounded local
reasoning: a passing result does not establish privacy through arbitrary helper
calls or runtime-computed names, so read new data flows yourself.

## The documentation gate

`make check-docs` checks relative inline links and heading anchors in root README,
CONTRIBUTING, SECURITY and CODE_OF_CONDUCT, plus **every Markdown document recursively
under docs/**. It holds the [job schedule](../operations/jobs.md#schedule) to the names
of the backend's `@app.periodic` tasks, `def` or `async def`, and the gate inventory
above to `scripts/check-*`, in both directions. `check-port-free` is deliberately not
a gate.

The checker compares paths, anchors and names, with GitHub's space-to-hyphen
heading behaviour. It does not verify external URLs, cron values, arbitrary
Markdown syntax or behavioural claims. New nested guides must remain
discoverable from a parent; [documentation review](testing.md#documents-against-code)
checks navigation and statements against source.

## The ordinary shard gate

CI splits the ordinary suite across parallel jobs, one per shard named in
[`.github/ordinary-suite-shards.json`](../../.github/ordinary-suite-shards.json).
Each shard lists test name patterns, and its job passes each to `manage.py test`
after `-k`, so it runs the tests whose ids match one of them. A test id is the
module that defines its class, the class and the method, so `wallets.*` selects
every test a module under `backend/wallets/` defines; a new app, or a module
named outside its app's patterns, fails until a pattern covers it. Balance
shards by moving patterns between them or splitting one into narrower ones. The
gate counts test identities, not durations: `--run SHARD` runs a shard as its
CI job does and emits the runner's method durations and setup timings, which
exclude class/module fixtures and Django pre/post hooks.

`scripts/check-ordinary-shards.py` runs once in the first matrix job before its
suite; a failure fails that job and the Django verdict. It discovers the suite
with no patterns and with each shard's patterns, each in a fresh interpreter,
and refuses a shard without patterns, a pattern that selects no test, a test id
the unlabelled suite finds more than once (as when a factory builds two classes
with one name), a module whose test ids the shards find fewer or more times
than the unlabelled suite, a test id only a shard finds, a module that fails to
load, and a `backend-suite-shard` matrix that is anything but the file's shard
names. `-k` selects by name, so a test unittest builds without reading names (a
module that raises `SkipTest` as it is imported, a class whose only test is
`runTest`, an instance a `load_tests` adds) is found by every shard and refused
as duplicated: skip a class rather than a module. The gate needs the backend
requirements and a `SECRET_KEY` but no database; `make check` runs it from
`backend/` with a generated key, and
[its tests](../../scripts/tests/test_check_ordinary_shards.py) plant each
finding against a stand-in for Django's runner.

## The API type drift gate

The committed [OpenAPI document](../../backend/schema/openapi.json) is generated with
Python 3.13.15, PostgreSQL 16 and packages constrained by
[the schema requirements](../../backend/schema/requirements.txt). In an isolated
environment, run `make install-schema-environment`, migrate a dedicated database
using `ledova_backend.settings.test_postgres`, then run `make check-api-schema`.
`POSTGRES_*` selects the database. Generation refuses other toolchains, SQLite,
pending migrations, warnings and errors; it never migrates for you.
`make update-api-schema` explicitly generates and checks before updating the
snapshot; ordinary comparison never rewrites it. Mapping keys are canonicalised;
array order, constraints, request/response metadata and nullability remain
significant. Fix diagnostics through real declarations and existing enum
definitions, without bypassing authorisation or suppressing warnings. The
schema checker's explicit provider-webhook exclusions are Alchemy, KYCAID
identity, KYCAID crypto and Sumsub; missing routes, phantom operations and
stale exclusions fail.

`make check-api-types` regenerates the
[shared TypeScript contracts](../../packages/shared/src/generated/api.ts) from
the committed snapshot with the pinned root `openapi-typescript` dependency and
compares bytes; it does not write files. `make update-api-types` explicitly
replaces the generated file, and `make update-api-schema` updates both.
`API_TYPES_SCHEMA=...` selects another input. Read-only server fields are
absent from generated requests and write-only inputs from responses;
nullability, required fields, enums and exact decimal strings survive, binary
payloads use `Blob`, and received objects remain mutable JavaScript data.
Trading event types come from the stream extension: the invalidation map must
account for every event and must not retain a removed event, and mutation tests
exercise both. The shared, dashboard and mobile compiler checks validate
consumers against those contracts.

`make check-client-operations` uses installed root Node dependencies and the
committed schema to account for shared, dashboard and mobile HTTP operations and
their successful response kinds, including 204, binary and streams. It
recognises Axios through locked compiler declarations, not the name of a `.get`
method. Every member of a typed Axios call's claimed response union must accept
a generated successful response variant from the operation it calls, which
covers nested values and arrays and rejects invented required fields; bodyless
responses remain `void`. Unavailable generated operations and unresolved
explicit types fail closed; untyped calls stay in the route census without
claiming a response-type proof, and unresolved transports need explicit tested
accounting, not a silent exemption. The checker does not establish which
response branch a runtime request selects or certify external destination
policy. The type-generation decision and its checkpoint are recorded in
[decisions](../decisions.md#clients-and-api-types).
