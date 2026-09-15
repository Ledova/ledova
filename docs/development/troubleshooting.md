# Development troubleshooting

[Contributing](../../CONTRIBUTING.md) · [Testing](testing.md)

Start by checking the environment and the actual command outcome before changing
application code. These are current remedies distilled from prior failures.

| Symptom | Check and remedy |
| --- | --- |
| Dashboard serves old code after restart | Rebuild its image; Compose has no dashboard source volume. Keep backend and worker images aligned too. |
| Signup has no email | On the local debug stack, read the backend log for the verification code. Check the configured provider outside debug. |
| Cookie writes return CSRF 403 | Put the dashboard origin in `DJANGO_CSRF_TRUSTED_ORIGINS`; clearing localStorage does not clear cookies. |
| Backend tests cannot start | Start PostgreSQL and supply the isolated test database/role settings. SQLite is no longer the default test environment. |
| Backend `make lint` reports *No module named black* (or isort, flake8) | The lint tools are development requirements, not part of the backend image. Run `make install-backend` on the host, then `cd backend && make lint`; see [backend verification](testing.md#backend-verification). |
| Type-check cannot find Expo configuration | Install mobile dependencies inside `mobile/`, or run `make check`. A root package copy is not proof Metro can resolve it. |
| Many unrelated PostgreSQL failures | Check alias/principal selection, role credentials and another runner sharing the same test database before blaming a policy. Use a separate database per worktree. |
| Missing rows only with `select_related` | Check parent policy visibility: an INNER JOIN can remove a child that an unjoined count sees. |
| Database transaction remains aborted after a caught error | A caught permission/integrity error still aborts PostgreSQL's transaction. Verify the correct connection and savepoint/rollback boundary. |
| A test hangs in JSON rendering | A mock probably returned another mock. Supply a concrete response value and inspect a faulthandler dump. |
| All assertions pass but test process fails | Inspect exit status and teardown: leaked React queries, unmounted components or unresolved promises can fail after assertions finish. |
| Migration test selects a nonexistent column | Query historical state through the migration executor; restore all migrations before current services run. |
| Upload returns 503 | Check Redis and ClamAV readiness/signature loading; there is no scanner bypass. |
| LLM or local chain on host times out from container | Check bridge-to-host reachability. Prefer a service on the Compose network and use the documented hostname allowlist for extraction. |

For PostgreSQL authentication on an existing volume, see
[role provisioning](../operations/configuration.md#row-level-security-roles).
Changing `POSTGRES_HOST_AUTH_METHOD` after initialization does not rewrite its
authentication configuration. A successful loopback connection does not prove
that the container bridge can authenticate.

For native build/device failures, use [native probes](native-probes.md). For a
pending issuance, transfer or retained file, use [operator recovery](../operations/recovery.md).

When an instrument caused the apparent failure, record that correction. Keep
historical failure counts and old implementation shapes in their dated source
records rather than turning them into current setup instructions.

**A signing-test timeout can be cold renderer setup rather than signing.**
The first settlement-screen test timed out at five seconds twice in CI, with
488 of 489 mobile tests passing ([#542](https://github.com/Ledova/ledova/issues/542)).
Stage timings and a V8 profile located most of its cost in the initial screen
render: Jest was lazily transforming React Native's ScrollView, animation code
and native renderer. Mnemonic derivation took tens of milliseconds. Removing
the decorative gradient did not fix the controlled failure, so that change was
discarded.

With a fresh transform cache, three Jest workers and one CPU of affinity, the
unchanged test failed while the other 488 passed. A measured run with its budget
raised completed all assertions in 7.28 seconds: 6.67 seconds in the first
render, then about 0.6 seconds for the rest of the flow. This one integration
test now has a ten-second limit; the five-second default, actual renderer,
cryptographic signer, duplicate-submit assertions and all other tests remain.
That allows the measured cold fixture cost and adds five seconds to detecting a
hang in this case. These are test-harness timings, not application performance
measurements or a reason to extend timeouts without locating the cost.
