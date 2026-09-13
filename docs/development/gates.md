# Gates

[Contributing](../../CONTRIBUTING.md) · [Standards](standards.md) · [Testing](testing.md)

Start here when a check fails. Each section states the rule, remedy and limits;
[gate internals](../reference/gate-internals.md) links implementations and regression
controls. Commands run from the repository root unless stated otherwise.

## Every gate, and where its rule is written

`check-docs.py` holds this table to `scripts/`: a gate script with no entry
fails, and an entry naming no script fails.

| Script | Rule | `make check` | CI job |
| --- | --- | --- | --- |
| `check-comments.py` | [The comment gate](#the-comment-gate) | yes | source gates |
| `check-type-check.py` | [The type-check gate](#the-type-check-gate) | yes | source gates |
| `check-layers.py` | [The layer gate](#the-layer-gate) | yes | source gates |
| `check-connection-binding.py` | [The connection-binding gate](#the-connection-binding-gate) | yes | source gates |
| `check-schema-responses.py` | [The schema response gate](#the-schema-response-gate) | yes | source gates |
| `check-test-shadowing.py` | [The test shadowing gate](#the-test-shadowing-gate) | yes | source gates |
| `check-error-bodies.py` | [The error body gate](#the-error-body-gate) | yes | source gates |
| `check-logging.py` | [The logging privacy gate](#the-logging-privacy-gate) | yes | source gates |
| `check-docs.py` | [The documentation gate](#the-documentation-gate) | yes | source gates |
| `check-pr-metadata.py` | [The PR metadata gate](#the-pr-metadata-gate) | no | PR metadata |
| `check-api-schema.py` | [The API type drift gate](#the-api-type-drift-gate) | no | Django |
| `check-api-types.py` | [The API type drift gate](#the-api-type-drift-gate) | no | Django |
| `check-client-operations.mjs` | [The API type drift gate](#the-api-type-drift-gate) | no | JavaScript |
| `check-self-imports.mjs` | [Clients and the shared package](../architecture/clients.md) | yes | JavaScript |

`check-port-free.py` is in `scripts/` and is not on this table: it refuses to
start the chain test when its port is taken, which is Makefile plumbing rather
than a rule anything is held to. `check-docs.py` carries it in `NOT_A_GATE`
with that reason, so its absence is a recorded decision rather than an
oversight, and documenting it here would fail the gate.

Two rules are gated without a script of their own: one migration per model
change, through CI's `makemigrations --check --dry-run`, and the generated
design tokens, through `git diff --exit-code` after `make build`. Two more
checks run from the Makefile rather than from `scripts/`:
`make check-mobile-test-awaits` and `npm --prefix mobile run check:resolution`.

## The PR metadata gate

`scripts/check-pr-metadata.py` requires a `type(#issue): description` title and a
matching `Refs #issue` or `Closes #issue` as the first nonblank body line. It
checks through GitHub that the referenced number is an issue in this repository,
rather than a PR or an unavailable number. The types and ownership convention
are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#pull-request-titles-and-issue-ownership).

The separate `PR metadata` workflow runs on creation, edits, new commits,
reopening and readiness changes, including bot PRs. It uses `pull_request_target`
with read-only permissions and checks out only the repository's default branch.
It never checks out or executes the PR's code. Titles and bodies are fetched as
data through the API, rather than interpolated into a shell command. Concurrent
runs for the same PR cancel older runs; each check fetches the current metadata.

This check needs GitHub access and is not part of `make check`; its regression
tests run in `make test-gates`. To check a PR locally, run
`python scripts/check-pr-metadata.py --repository OWNER/REPO --pr NUMBER` with
an authenticated `gh` CLI. The gate verifies traceability, not whether the issue
is a sensible match or whether its full scope has been completed. Review owns
those judgments. The workflow starts enforcing once it is on the default branch.

## The comment gate

`make check-comments` parses comments and docstrings across governed source trees.
Rename code or explain behavior through tests; source explanations belong in docs.
Configuration and documentation can retain comments. Root `scripts/` modules carry
docstrings. Python uses tokenize/AST; client parsing distinguishes strings, regexes,
JSX and template expressions. CSS, Solidity and native templates have their own scans.

The trees are, in full: `backend`, `dashboard/src`, `mobile/src`,
`mobile/scripts`, `mobile/native-tests`, `mobile/plugins`, `mobile`, `packages/shared`, `packages/scripts`,
`marketing/src`, `dashboard`, `marketing`, `contracts`, `contracts/contracts`,
`contracts/scripts`, `contracts/test`.

That sentence is checked against `TREES`. Each tree's extension and recursion scope
lives in the script; `NOT_SCANNED` names intentional omissions with reasons. Tests
refuse source outside both lists. Admin templates are outside the scan and should
also remain free of comments.

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
configuration, and accounts for every discovered workspace or explicit exclusion.
It does not replace compilation. Install the correct workspace dependencies before
running its type-check directly; `make check` installs missing ones.

## The layer gate

`make check-layers` enforces the [backend layer table](../architecture/backend.md#backend-layers):
services orchestrate, querysets own queries, and views adapt HTTP. Follow the
reference files named there. New/touched services use functions; existing class
conversions are tracked debt. Stateful provider clients remain classes.
Syntax checks have deliberate allowances; see [the implementation limits](../reference/gate-internals.md#layers-and-connection-binding).

## The connection-binding gate

`make check-connection-binding` refuses default-bound transaction and cursor imports
in backend production code. Use `shared.db.atomic`, `shared.db.on_commit` and an
explicitly selected connection. A default-bound transaction can commit writes on
another alias even when its own block rolls back. Test settings can conceal this;
[scoped tests](testing.md#scoped-connection-evidence) prove the real boundary.

## The schema response gate

`make check-schema-responses` requires explicit schema metadata when routed methods
return another serializer or an action builds a literal success body. Fix the
response declaration at the routed method, including private-helper responses.
The gate establishes that metadata exists, not that it is accurate. Provider
webhooks may be explicitly excluded. Non-DRF routes need another schema mechanism;
the trading stream is covered by the schema postprocessing hook and its tests.

## The test shadowing gate

`make check-test-shadowing` refuses helpers that override reserved
`unittest.TestCase` methods, such as `fail`, and silently disable assertions.
Rename the helper. The reserved set derives from `dir(TestCase)` and excludes
intentional setup/teardown and runner hooks. This does not establish assertion quality.

## The error body gate

`make check-error-bodies` refuses caught exception text in API errors or public
serialized failure fields. Raise the fixed API exception message or use an approved
sanitizer, and keep bounded diagnostics on the operator side under the logging
rules. The gate verifies selected receiver/serializer boundaries; it is not general
interprocedural taint analysis. See [privacy checks](../reference/gate-internals.md#errors-and-logging).

## The logging privacy gate

`make check-logging` refuses whole objects in client console calls, object
serialization and request/response bodies interpolated into strings. Backend logs
must not name private values or whole provider bodies. Use narrow identifiers and
safe diagnostics, with logger names the checker scans (`logger`, `log`, `logging`).
Syntax-based checks do not establish that arbitrary strings contain no secrets.

## The documentation gate

`make check-docs` checks relative inline links and heading anchors in root README,
CONTRIBUTING, SECURITY and CODE_OF_CONDUCT, plus **every Markdown document recursively
under docs/**. It holds the [job schedule](../operations/jobs.md#schedule) to periodic
backend task names and the gate inventory above to `scripts/check-*`, in both
directions. `check-port-free` is deliberately not a gate.

The checker compares paths, anchors and names. It does not verify external URLs,
cron values, arbitrary Markdown syntax or behavioral claims. New nested guides
must remain discoverable from a parent; [documentation review](testing.md#documents-against-code)
checks navigation and statements against source.

## The API type drift gate

The committed [OpenAPI document](../../backend/schema/openapi.json) is generated with
Python 3.13.15, PostgreSQL 16 and packages constrained by
[the schema requirements](../../backend/schema/requirements.txt). In an isolated
environment, run `make install-schema-environment`, migrate a dedicated database
using `ledova_backend.settings.test_postgres`, then run `make check-api-schema`.
`POSTGRES_*` selects the database. Generation refuses other toolchains, SQLite,
pending migrations, warnings and errors; it never migrates for you.

`make update-api-schema` explicitly generates and checks before updating the snapshot.
Ordinary comparison never rewrites it. Mapping keys are canonicalized; array order,
constraints, request/response metadata and nullability remain significant.
Fix diagnostics through real declarations and existing enum definitions, without
bypassing authorization or suppressing warnings.

`make check-api-types SCHEMA=...` reads an already generated schema. Required shared
response fields must exist at the called method/path; event names are compared in
both directions. Type debt and schema debt are separate, counted inventories.
The field check does not establish complete nested type compatibility.

`make check-client-operations` uses installed root Node dependencies and the committed
schema to account for shared/dashboard/mobile HTTP operations and their successful
response kinds, including 204, binary and streams. It is separate from type checking.
Unresolved transports need explicit tested accounting, not a silent exemption.
See [schema and operation internals](../reference/gate-internals.md#schema-and-client-operations).

Reliable snapshots do not alone authorize generated shared types. The clean-release
prerequisite in [the type-generation decision](../decisions.md#clients-and-api-types)
remains in place.
