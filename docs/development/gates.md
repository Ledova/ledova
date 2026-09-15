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
| `check-ordinary-shards.py` | [The ordinary shard gate](#the-ordinary-shard-gate) | yes | Django ordinary shards |
| `check-api-types.mjs` | [The API type drift gate](#the-api-type-drift-gate) | yes | JavaScript |
| `check-client-operations.mjs` | [The API type drift gate](#the-api-type-drift-gate) | no | JavaScript |
| `check-self-imports.mjs` | [Clients and the shared package](../architecture/clients.md) | yes | JavaScript |

`check-port-free.py` is in `scripts/` and is not on this table: it refuses to
start the chain test when its port is taken, which is Makefile plumbing rather
than a rule anything is held to. `check-docs.py` carries it in `NOT_A_GATE`
with that reason, so its absence is a recorded decision rather than an
oversight, and documenting it here would fail the gate.

Two rules are gated without a script of their own: one migration per model
change, through CI's `makemigrations --check --dry-run`, and the generated
design tokens, through `git diff --exit-code` after `make build`. Four more
checks run from the Makefile rather than from `scripts/`:
`make check-mobile-test-awaits`, `npm --prefix mobile run check:resolution`,
and, in `make test`, `dashboard/scripts/check-react-singleton.mjs` and
`mobile/scripts/shared-peer-resolution.test.mjs`, the negative control for the
peer step of `check:resolution`.

## The PR metadata gate

`scripts/check-pr-metadata.py` requires a `type(#issue): description` title and a
matching `Refs #issue` or `Closes #issue` as the first nonblank body line. It
checks through GitHub that the referenced number is an issue in this repository,
rather than a PR or an unavailable number. The types and ownership convention
are in
[CONTRIBUTING.md](../../CONTRIBUTING.md#pull-request-titles-and-issue-ownership).

A `Refs` PR must close no issue. The gate reads the PR's title,
`closingIssuesReferences` and commits in one `gh pr view` call. The list covers an
issue named by a closing phrase anywhere in the PR body, even a negated one such
as "does not close #N", and one linked from the PR's Development sidebar. It
leaves out commit messages, which still close an issue when they reach the default
branch, and this repository's squash merges copy them into the squash commit. That
is how #170 was closed by #172's squash commit while #172's list was empty. The
title reaches the default branch too, as a merge commit's body and as the squash
headline for a PR with several commits. So the gate also searches the title and
each commit's headline and body for one of GitHub's
[closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword),
in any case and optionally followed by a colon, then whitespace and `#N`,
`OWNER/REPO#N` or a `https://github.com/OWNER/REPO/issues/N` URL.

A `Refs` PR with a list entry or such a phrase in its title or a commit is
refused. The refusal names each issue, each reference in the title, or each commit
by short SHA with its reference; remove the phrase or the link, or reword the
title or the commit. A `Closes` PR is checked against none of these. A type
prefix such as `fix(#123):` is not a closing phrase, because no whitespace follows
the keyword. GitHub documents the keywords, the colon and the `#N` and
`OWNER/REPO#N` forms, not URLs, `GH-N` or a missing space. The gate matches only
the URL spelling above, and passes `GH-N`, `Closes#N` and other undocumented
spellings. A message edited at merge time is not checked.

In gh 2.100.0, `gh pr view` returns at most a PR's first 100 commits, so the gate
also reads the PR's commit count from `repos/OWNER/REPO/pulls/N` in the REST API.
Any PR, `Refs` or `Closes`, is refused when that count is missing, is not an
integer or differs from the number of commits read, and the refusal shows the
count it found and the number it read. A PR with more than 100 commits therefore
cannot pass. A push between the two reads that changes the count is refused the
same way, and every push starts a new run that reads both again.

The separate `PR metadata` workflow runs on creation, edits, new commits,
reopening and readiness changes, including bot PRs. It uses `pull_request_target`
with read-only permissions and checks out only the repository's default branch.
It never checks out or executes the PR's code. Titles, bodies and commit messages
are fetched as data through the API, rather than interpolated into a shell
command. Concurrent runs for the same PR cancel older runs; each check fetches
the current metadata. Linking an issue from the sidebar starts no workflow, so a
link added after the last check is seen only at the next of those events.

This check needs GitHub access and is not part of `make check`; its regression
tests run in `make test-gates`. To check a PR locally, run
`python scripts/check-pr-metadata.py --repository OWNER/REPO --pr NUMBER` with
an authenticated `gh` CLI, version 2.72.0 or later. The gate verifies
traceability, not whether the issue is a sensible match or whether its full scope has been completed. Review owns
those judgments. The workflow starts enforcing once it is on the default branch.

## The comment gate

`make check-comments` parses comments and docstrings across governed source trees.
Rename code or explain behavior through tests; source explanations belong in docs.
Configuration and documentation can retain comments. Root `scripts/` modules carry
docstrings. Python uses tokenize/AST; client parsing distinguishes strings, regexes,
JSX and template expressions. CSS, Solidity and native templates have their own scans.

The trees are, in full: `backend`, `dashboard/src`, `mobile/src`,
`mobile/scripts`, `mobile/native-tests`, `mobile/plugins`, `mobile`, `packages/shared`, `packages/scripts`,
`marketing/src`, `dashboard`, `dashboard/scripts`, `marketing`, `contracts`, `contracts/contracts`,
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

## The ordinary shard gate

CI splits the ordinary suite across parallel jobs, one per shard named in
[`.github/ordinary-suite-shards.json`](../../.github/ordinary-suite-shards.json).
`scripts/check-ordinary-shards.py` runs in every shard before the suite. Through the same
settings and test runner, it discovers the suite once with no labels and once
with each shard's labels, each in a fresh interpreter as each CI job is, so no
discovery sees a module an earlier one imported. It counts each test id in every
discovery, and refuses: a shard label that is not a package directly under
`backend/`, or one listed more than once; a test id the unlabelled suite finds
more than once, as when a factory builds two classes with one name; a module with
a test id the shards find fewer or more times than the unlabelled suite; a test id
a shard finds that the unlabelled suite does not; a module that fails to load; and
a `backend-suite-shard` matrix that is anything but the file's shard names, such as
one with an `include` or `exclude`.

A new module inside an assigned label is covered with no change. A new app fails
until its label is put in exactly one shard, except in the factory shape
[gate internals](../reference/gate-internals.md#layers-and-connection-binding)
records. Balance shards by moving app labels, each a whole top-level package.

The gate needs the backend requirements and a `SECRET_KEY` for the test settings,
but no database. `make check` installs the requirements and runs it, through
`make check-ordinary-shards`, from `backend/` with a generated key, as it runs
`manage.py check`. `--labels SHARD` prints the labels that shard passes to
`manage.py test`. The gate counts test identities, not durations, so balance
remains a measurement.

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

`make check-api-types` regenerates shared TypeScript contracts from the committed
snapshot with the pinned root `openapi-typescript` dependency and compares bytes.
It does not write files. `make update-api-types` explicitly replaces the generated
file; `make update-api-schema` updates both the schema and generated types.
`API_TYPES_SCHEMA=...` selects another input for the type target. The shared,
dashboard and mobile compiler checks validate consumers against those contracts.
Trading events come from the stream extension: the invalidation map must account
for every event and must not retain a removed event. Mutation tests exercise both.

`make check-client-operations` uses installed root Node dependencies and the committed
schema to account for shared/dashboard/mobile HTTP operations and their successful
response kinds, including 204, binary and streams. Each explicitly typed Axios
response must accept a generated response variant from the method/path it calls.
This preserves the old gate's endpoint binding while also checking nested values.
Unresolved transports need explicit tested accounting, not a silent exemption.
See [schema and operation internals](../reference/gate-internals.md#schema-and-client-operations).

The owner accepted PR #562 as the clean-release checkpoint before this conversion;
see [the recorded approval](https://github.com/Ledova/ledova/issues/115#issuecomment-5656632666)
and [the type-generation decision](../decisions.md#clients-and-api-types).
