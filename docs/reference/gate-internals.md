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

[Type-drift checker](../../scripts/check-api-types.py) binds a client's declared
response type to its method/path, not a coincidentally similar serializer name.
It normalizes wire-field spelling. Required response fields are checked in one
direction; trading event names are checked in both. This is not full recursive
schema/type equivalence. `TYPE_DEBT` and `SCHEMA_DEBT` represent different failures
and must not be substituted for each other.

[Client-operation checker](../../scripts/check-client-operations.mjs) recognizes Axios
through locked compiler declarations, not the name of a `.get` method. Request replay
sites cannot change destination, method or origin. The mobile stored-file download
has explicit binary-route accounting, while externally linked documents are not
registered API operations. Browser/mobile stream builders are accounted for too.
Operation coverage does not certify external destination policy or generated-client
readiness. Generation environment, diagnostics and drift artifacts remain CI evidence.

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
