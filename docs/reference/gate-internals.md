# Gate implementation reference

[Reference](README.md) · [Gate rules and remedies](../development/gates.md)

Use this page when extending a checker or investigating a false result. The source
owns exact matchers and exception inventories. Run `make test-gates`; introduce a
failing fixture and a valid control for a changed matcher. Counted historical debt
must shrink and stale counts must fail. A justified exclusion needs a reason and
coverage proving its boundary.

## Source coverage and parsing

[Comment checker](../../scripts/check-comments.py) and
[tree-coverage tests](../../scripts/tests/test_check_comments_trees.py) account for
both governed and deliberately omitted files. Generated/ignored output is not source.
Dropping a recursive tree must fail the coverage control. Native preprocessor code,
URLs, regexes and JSX text are positive parsing controls, not comment exemptions.

[Type-check checker](../../scripts/check-type-check.py) distinguishes a successful
empty check from a compiler error that already fails CI. Inherited `files` and
`include` resolve independently. Compiler-calibrated fixtures preserve the difference
between ordinary tsc and project-reference build mode.

[Self-import checker](../../scripts/check-self-imports.mjs) prevents the shared package
importing its own public barrel. [Mobile resolution](../../mobile/scripts/check-resolution.mjs)
checks the real native dependency graph, including shared React/query peers; Jest
and TypeScript resolution alone do not prove Metro resolution.

## Layers and connection binding

[Layer checker](../../scripts/check-layers.py) reads Python syntax and maintains
rule-specific historical allowances. It is not a call graph or a proof that every
service has appropriate responsibilities. The [backend guide](../architecture/backend.md)
owns the normative layer table and examples. Do not turn measured legacy sites
into a general permission for new code.

[Connection checker](../../scripts/check-connection-binding.py) refuses imports as
well as known call spellings, including aliases and decorators. Explicit allowances
are the alias-aware helper implementation, principal handling and role checks.
Tests/migrations have separate scope. The [scoped suite](../development/testing.md#scoped-connection-evidence)
is needed to establish actual transactions and authority under app/operator aliases.

[Test-shadowing checker](../../scripts/check-test-shadowing.py) catches test helpers
that shadow reserved TestCase methods. Its regression controls establish which
assertions become inert when `fail` is replaced; intentional lifecycle/runner
overrides remain allowed. It does not verify every test's assertions.

[Ordinary shard checker](../../scripts/check-ordinary-shards.py) compares the test
ids Django's runner builds, not module files, and counts each id in every
discovery. A shard's discovery is the unlabelled one with the shard's patterns
passed to the runner as `-k`, which Django matches against each whole test id, so
a class one module imports from another is selected by the pattern for the module
that defines it, and a pattern without `*` matches anywhere in an id. Two classes a
factory builds, whether bound to module attributes or added by `load_tests`, can
share one test id, and Django runs both, so the checker refuses any id the
unlabelled suite finds more than once. A module that fails to import is a finding
rather than a module: it is discovered as one `_FailedTest` in every discovery and
would otherwise look covered. A module that raises `SkipTest` as it is imported is
discovered as one skipped test that no pattern filters, so every shard finds it.
Each discovery re-runs the checker with `--discover` in a fresh interpreter,
because a module can find different tests the second time it is loaded in one
interpreter, as a `load_tests` that keeps state does, and each CI shard starts
from nothing.
[Regression tests](../../scripts/tests/test_check_ordinary_shards.py) plant each
finding with synthetic cases, run the checker's `main()` over them to hold its exit
status to its findings and its printed total to the sum of the shard counts, hold
`--run` to the ordinary command with each pattern after `-k`, and hold the committed
matrix to the committed shard file. Against a stand-in for Django's runner, they
plant a module no pattern selects, a module two shards select, a class one module
imports from another, a factory's class built in two modules, a module skipped as
it is imported, which must be named by its own name, and a `load_tests` that finds
its tests only the first time it runs. Discovery of the real backend runs in CI's
shard jobs and in `make check`.

## Schema and client operations

[Response-declaration checker](../../scripts/check-schema-responses.py) follows local
private helpers to their routed callers. A declaration may still be wrong. A plain
Django streaming response needs explicit generated-schema support; the
[stream hook](../../backend/shared/api/schema_hooks.py) derives event names from the
publisher catalogue, and tests hold the hook to registration and the route.

[Schema checker](../../scripts/check-api-schema.py) compares registered operations
against the generated snapshot. It shares the tenancy route walker's documented
administrative/static/API-root/format-duplicate and bodyless-method scope. The
explicit provider-webhook exclusions are Alchemy, KYCAID identity, KYCAID crypto
and Sumsub. Missing routes, phantom operations and stale exclusions fail; unused
application routes and error-only compatibility routes still count.

[Type generator and comparison](../../scripts/check-api-types.mjs) uses the committed
OpenAPI snapshot to produce [shared contracts](../../packages/shared/src/generated/api.ts).
Named domain aliases select operation responses, requests and queries; nested types
select schema components. Input and output components are split by Django metadata,
so read-only server fields are absent from requests and write-only inputs are absent
from responses. Nullability, required fields, enums and exact decimal strings remain
in the generated types. Binary payloads use `Blob`. Received objects remain mutable
JavaScript data; OpenAPI `readOnly` does not freeze them in the client.

Generation is deterministic and check mode never writes. The former partial parser
and its type/schema debt inventories have been removed. Trading event types come
from the schema extension, and the real invalidation map is compiled against both
added and removed event mutations. Generation checks run in the JavaScript CI job;
the Django job independently establishes that the committed schema is current.

[Client-operation checker](../../scripts/check-client-operations.mjs) recognizes Axios
through locked compiler declarations, not the name of a `.get` method. Request replay
sites cannot change destination, method or origin. The mobile stored-file download
has explicit binary-route accounting, while externally linked documents are not
registered API operations. Browser/mobile stream builders are accounted for too.
For typed Axios calls, every member of the claimed response union must accept a
generated successful response variant from the actual operation. This covers
nested values and arrays, rejects invented required fields, and retains legitimate
branches selected by a caller. Literal `blob`/`arraybuffer` response decoders use
their browser result types; bodyless responses remain `void`. Unavailable generated
operations and unresolved explicit types fail closed. Untyped calls remain in the
route census without claiming a response-type proof.

The checker does not establish which response branch a runtime request selects or
certify external destination policy. Generation environment, diagnostics and drift
artifacts remain CI evidence.

## Errors and logging

[Error-body checker](../../scripts/check-error-bodies.py) follows caught exception
values through local assignments, formatted messages and selected model failure
writers. It resolves public serializer exposure and checks permitted operator-only
receivers. Sanitizer allowances assert a real safe transformation and need tests.
Moving text into a 200 response field does not make it safe to serve.

[Logging checker](../../scripts/check-logging.py) recognizes client console calls and
backend logger syntax, including whole-body attributes, subscripts, `.get()`,
serialization and formatting wrappers. Client string literals are not a blanket
permission to interpolate provider bodies. Bind loggers under scanned names;
renaming a logger must not silently drop its calls from coverage.

Both checks are syntax analyses with bounded local reasoning. A passing result
does not establish privacy through arbitrary helper calls or runtime-computed names.
Read new data flows and ensure diagnostics never carry credentials or dossiers.

## Documentation inventories

[Documentation checker](../../scripts/check-docs.py) scans nested Markdown and owns
paths to the canonical job and gate tables. [Regression tests](../../scripts/tests/test_check_docs.py)
plant missing and phantom entries, invalid nested links/anchors, and valid parent
and sibling navigation. Markdown heading punctuation retains GitHub's space-to-hyphen
behavior. Links and inventory names are mechanical evidence; claims and current
schedules still need a reader against the implementation.
