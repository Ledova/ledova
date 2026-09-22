# Deployment configuration

[Operations](README.md) · [Documentation](../README.md)

Core environment settings and database roles. Run only with synthetic data on local chains or supported public testnets.

Every backend variable below is read in `backend/ledova_backend/settings/`; the
client and contract variables have their own sections below.
`backend/.env.example` is the template; `python3 scripts/init-local-env.py`
(also `make init-local`) copies it and the three client templates to
owner-only `.env` files and fills `SECRET_KEY` and `POSTGRES_PASSWORD` with
generated secrets. It never overwrites an existing file.

`DEBUG`, `COOKIE_SECURE` and `EVM_ASSET_TRANSFER_HISTORY_ENABLED` go through
`read_bool`, which strips and lowercases the value first, so `true`, `TRUE` and
` true ` are all accepted, and must resolve to `true` or `false`; anything else
raises `ImproperlyConfigured` at startup. `KYCAID_CRYPTO_MONITORING_ENABLED` is
lowercased and compared against `true` and treats anything else as off.

## Django core

| Variable | Default | Required |
| --- | --- | --- |
| `SECRET_KEY` | none | Yes, startup fails without it |
| `DEBUG` | `false` | No |
| `DJANGO_ALLOWED_HOSTS` | empty | Yes outside local use, comma separated |
| `DJANGO_CORS_ALLOWED_ORIGINS` | empty | Yes, comma separated; must list the dashboard origin |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | empty | Yes, comma separated; cookie-authenticated writes from an unlisted origin get `403 CSRF Failed` |
| `LEDOVA_ADMIN_BASE_URL` | `http://localhost:5174/admin` | No |
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | No |
| `OPERATOR_NAME` | `Ledova operator` | No, used only when the operator row is created |
| `REDIS_URL` | `redis://redis:6379/0` | **Yes.** It is `CACHES["default"]`, which holds the sign-in and upload quotas, and it is the trading event stream (`tokens/events.py`, `tokens/views/trading_events.py`). Background work is still Procrastinate on PostgreSQL |

The per-address sign-in limit is 10 attempts in a rolling hour, shared by all
backend workers through `CACHES["default"]`. `SharedRedisCache` reserves each
attempt atomically in Redis using Redis's clock. Simultaneous requests cannot
overwrite each other's counts. Successful and unsuccessful credential checks both
consume an attempt; requests already over the limit return 429 with `Retry-After`.
The count survives backend worker restarts and deployments. Redis data loss or an
explicit cache clear resets it; the Compose volume alone is not a durability
guarantee for every Redis failure.

Redis is required for sign-in. An unreachable cache returns 503 with "This service
is temporarily unavailable. Please try again shortly." before checking credentials.
Backend and worker containers wait for the Redis healthcheck. Trading event streams
handle their own Redis failures and continue to degrade independently.

The default cache also holds the Transak access token
(`integrations/transak/client.py`), which is now shared between workers. Other DRF
rate limits use this shared cache but retain DRF's approximate read/write counting;
the strict atomic rolling windows apply to `auth_email` and uploads.

Ordinary test settings retain `LocMemCache`. CI separately runs the deployed cache
against a real Redis service, including fresh processes, concurrent sign-in
requests, window expiry and a connection failure. Run that suite locally with an
isolated Redis URL:

```sh
THROTTLE_TEST_REDIS_URL=redis://127.0.0.1:6379/15 \
  python manage.py test authentication.tests.redis_throttle \
  --settings=ledova_backend.settings.test --noinput
```

The Redis suite requires its URL and fails if Redis is unavailable. It deletes
only its own unique test keys and stops its child processes on completion.
The concurrent test holds real history reads until all requests have read the
same state, exposing lost updates if DRF's read/write implementation returns.

## Auth cookies and tokens

| Variable | Default | Required |
| --- | --- | --- |
| `COOKIE_ACCESS_NAME` | `access` | No |
| `COOKIE_REFRESH_NAME` | `refresh` | No |
| `COOKIE_DOMAIN` | unset | No; also scopes `csrftoken`. Leave empty for localhost, set the shared parent domain when dashboard and API are on different subdomains |
| `COOKIE_SECURE` | the opposite of `DEBUG` | No |
| `ACCESS_TOKEN_LIFETIME` | `604800` seconds | No |
| `REFRESH_TOKEN_LIFETIME` | `604800` seconds | No |

The seven-day access token carries its refresh jti
(`rjti`) and every request checks the session is still live, so revocation is
immediate. Remove any older `ACCESS_TOKEN_LIFETIME=86400` override to pick the
default up.

## Database

| Variable | Default | Required |
| --- | --- | --- |
| `POSTGRES_HOST` | none | Yes |
| `POSTGRES_PORT` | none, so libpq's own default applies | No |
| `POSTGRES_DB` | none | Yes |
| `POSTGRES_USER` | none | Yes |
| `POSTGRES_PASSWORD` | none | Yes |
| `POSTGRES_SSLMODE` | `prefer` | No |

The default connection uses `CONN_MAX_AGE` 300 seconds, a 10-second connect
timeout and TCP keepalives. The scoped app alias disables connection
reuse; the operator alias retains the base lifetime. See [tenancy](../architecture/tenancy.md).

Compose sets `POSTGRES_HOST` to `postgres`, `REDIS_URL` to
`redis://redis:6379/0`, `STORAGE_BACKEND` to `local` and `DEBUG` to `true` for
the `migrate`, `backend` and `worker` services, from one `x-backend-environment`
anchor so the three cannot drift. These are `environment:` entries, so they win
over `backend/.env`: a `STORAGE_BACKEND=s3`, a `DEBUG=false` or a custom
`REDIS_URL` in that file is silently ignored inside the local stack. The local
stack explicitly selects debug mode; uploaded evidence uses private storage
and authenticated routes in both debug modes.

`backend/.env` is still needed: `SECRET_KEY` and `POSTGRES_PASSWORD` come only
from it, and no committed file can supply them. Without it `postgres` refuses to
initialise and `migrate` dies on `KeyError: 'SECRET_KEY'` before anything
serves requests. Run `make init-local` first; `make dev-up` checks.

## Clients

Client variables are public build configuration. They are embedded in the
bundle and must never hold a secret.

| File | Variables |
| --- | --- |
| `dashboard/.env` | `VITE_API_URL`, `VITE_LEDOVA_URL`, `VITE_MARKETING_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `marketing/.env` | `VITE_LEDOVA_URL`, `VITE_MARKETING_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `mobile/.env` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEV_API_HOST`, `EXPO_PUBLIC_USE_MOCK_DATA`, `EXPO_PUBLIC_MARKETING_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_APP_STORE_URL` |

Mobile Release builds require HTTPS. Native Debug accepts loopback, the Android
emulator host, and one private LAN IPv4 explicitly selected with
`EXPO_PUBLIC_DEV_API_HOST` before prebuild. Set the API/marketing URLs to that
same address when using it; a native rebuild is required to change the allowance.
Bearer requests, including absolute download URLs, must remain on the configured
API origin. API servers must serve requests directly: native API/SSE redirects
are refused, including 307/308 responses. Provider WebView navigation remains
independent and disallows insecure mixed content. [Mobile build and security guidance](../development/mobile-builds.md) describes native validation and storage behavior.

## Contracts

Hardhat loads nothing from a file: `contracts/hardhat.config.ts` and the deploy
scripts read `process.env` directly, and there is no dotenv loader in the
package. Export the values you need into the deploying shell.
`contracts/.env.example` is a checklist of the names, not a file Hardhat reads;
`scripts/init-local-env.py` does not create `contracts/.env` and nothing would
load it if you did. `DEPLOYER_PRIVATE_KEY` is a signing key: see
[key management](chains.md#key-management).

| Variable | Used by |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` (secret) | the `localhost` and `baseSepolia` account lists; blank against `localhost` falls back to the node's own accounts, blank against `baseSepolia` leaves it with no signer |
| `BASE_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, `REPORT_GAS` | network URL, contract verification, gas reporting |
| `FACTORY_ADDRESS`, `STABLECOIN_ADDRESS`, `SHARE_TOKEN_ADDRESS`, `RELAYER_ADDRESS`, `TOKEN_NAME`, `TOKEN_SYMBOL`, `COMPANY_ACN`, `AUTHORIZED_SHARES`, `INITIAL_MINT` | inputs to the individual deploy scripts |

## Row-level security roles

`shared/0003_rls_roles_and_grants` creates `ledova_app` and `ledova_operator`,
grants them what they need, and `shared/0004_rls_policies` installs the helpers
and a policy on every tenant table. The deployment requirements are:

- **Provision the roles and their credentials out of band**, and point the
  aliases at them with `RLS_APP_DB_USER`, `RLS_APP_DB_PASSWORD`,
  `RLS_OPERATOR_DB_USER` and `RLS_OPERATOR_DB_PASSWORD`. The migration creates
  the two roles if they are absent, so that development and CI have real ones
  rather than a mechanism that is inert exactly where it is tested — but it
  creates them **with no password**, and it never sets one. A credential does
  not belong in a migration: the statement carrying it reaches the server log on
  any instance with `log_statement = all`, and the migration is replayed on every
  database the schema is applied to. Local work uses
  `POSTGRES_HOST_AUTH_METHOD=trust`, which `docker-compose.yml` sets on the
  `postgres` service, as CI does on its service container.
- **`POSTGRES_HOST_AUTH_METHOD` is read by `initdb`, on the first start only.**
  Setting it against a database that already exists does nothing: `pg_hba.conf`
  was written when the volume was created. A cluster initialised without it
  authenticates `scram-sha-256` for anything but loopback — and the compose
  bridge is not loopback, so the two passwordless roles are refused there while
  `psql` from inside the container succeeds on the `127.0.0.1/32 trust` line
  and proves nothing. On an existing volume, give the roles the password the
  settings already expect rather than recreating the database:

  ```sql
  ALTER ROLE ledova_app      LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ALTER ROLE ledova_operator LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ```

  `DATABASES["app"]["PASSWORD"]` falls back to `POSTGRES_PASSWORD` when
  `RLS_APP_DB_PASSWORD` is unset, so that is the value the connection sends.
  `manage.py check_rls_roles` says all of this when a connection is refused,
  rather than letting the failure surface as an authentication error inside
  whichever command happens to touch the ORM first.
- **`ALTER ROLE … BYPASSRLS` requires superuser.** Whoever applies
  `shared/0003` must be able to grant it, or the roles come out without the
  attributes the policies assume — which `check_rls_roles` then refuses.
- **Transaction-level connection pooling is incompatible, not discouraged.** The
  principal is a session-level `SET`, and a pgbouncer transaction-pooled handover
  does not carry it. The symptom is not an error: it is one request reading
  another user's principal. Session pooling or none.
- **`manage.py --settings=x runserver` refuses to boot**, and the message names the
  variable rather than the argument order. The runserver exemption is keyed on
  `sys.argv[1:2]`, so a global option before the subcommand makes `manage.py`
  set the operator ambient alias and the server's own guard then refuses to
  serve requests unscoped. That is the right side to fail on — it will not start
  rather than start wrong — but the error says `RLS_AMBIENT_ALIAS is
  'operator'`, which reads like a configuration problem. Put the subcommand
  first: `manage.py runserver --settings=x`.
- **`manage.py check_rls_roles` runs in CI's PostgreSQL step and in the compose
  `migrate` service, immediately after `migrate` and before the first command
  that touches the ORM.** That order is deliberate: a role the policies assume
  but the server will not admit is a role problem, and it should be reported
  by the command whose subject is the roles, not by `sync_monitoring_rules`.
  It
  connects on each alias and asserts what no test can see — the app role lacks
  `BYPASSRLS` and owns no table, the operator role has it, the migrate role owns
  the tables, and a fresh app connection carries no principal. A misconfigured
  `DATABASES["app"]` — the right role name against the wrong `USER` — passes the
  whole test suite and fails here, which is the only place the answer means
  anything.
- **CI's schema-generation step runs as the migrate role.** Generating the
  OpenAPI schema evaluates the views' querysets against the real `ledova`
  database, so the step that migrates and the step that generates must both hold
  a role that can read the schema. A step on the app role fails in a way that
  reads like a schema bug rather than a permissions one.
