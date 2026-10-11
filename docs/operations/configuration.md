# Deployment configuration

[Operations](README.md) · [Documentation](../README.md)

Core environment settings and database roles. Run only with synthetic data on local chains or supported public testnets. Database roles are service identities, not company appointments.

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
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | No |
| `OPERATOR_NAME` | `Ledova operator` | No, used only when the operator row is created |
| `REDIS_URL` | `redis://redis:6379/0` | **Yes.** It is `CACHES["default"]`, which holds the sign-in and upload quotas, and it is the trading event stream (`tokens/events.py`, `tokens/views/trading_events.py`). Background work is still Procrastinate on PostgreSQL |

The per-address sign-in limit is 10 attempts in a rolling hour, shared by all
backend workers through `CACHES["default"]`, which reserves each attempt
atomically in Redis using Redis's clock. Successful and unsuccessful credential
checks both consume an attempt; requests over the limit return 429 with
`Retry-After`. The count survives backend restarts; Redis data loss or a cache
clear resets it. Redis is required for sign-in: an unreachable cache returns 503
before checking credentials, and the backend and worker containers wait for the
Redis healthcheck. The same cache holds the Transak access token and the other
DRF rate limits, which keep DRF's approximate counting; the strict atomic
windows apply to `auth_email` and uploads. Test settings use `LocMemCache`.

## Auth cookies and tokens

| Variable | Default | Required |
| --- | --- | --- |
| `COOKIE_ACCESS_NAME` | `access` | No |
| `COOKIE_REFRESH_NAME` | `refresh` | No |
| `COOKIE_DOMAIN` | unset | No; also scopes `csrftoken`. Leave empty for localhost, set the shared parent domain when dashboard and API are on different subdomains |
| `COOKIE_SECURE` | the opposite of `DEBUG` | No |
| `ACCESS_TOKEN_LIFETIME` | `604800` seconds | No |
| `REFRESH_TOKEN_LIFETIME` | `604800` seconds | No |

The seven-day access token carries its refresh jti (`rjti`) and every request
checks the session is still live, so revocation is immediate.

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
anchor so the three cannot drift. The same anchor points them at the stack's
own chain: `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CHAIN_ID`, `BLOCKCHAIN_OPERATOR_KEY`,
the three contract addresses and `LOCAL_CHAIN_FINALITY_DEPTH`, described in
[the local stack's chain](chains.md#the-local-stacks-chain). These are
`environment:` entries, so they win over `backend/.env`: a `STORAGE_BACKEND=s3`,
a `DEBUG=false`, a custom `REDIS_URL` or other chain settings in that file are
silently ignored inside the local stack. The local
stack explicitly selects debug mode; uploaded evidence uses private storage
and authenticated routes in both debug modes.

`backend/.env` is still needed: `SECRET_KEY` and `POSTGRES_PASSWORD` come only
from it, and no committed file can supply them. Without it `postgres` refuses to
initialise and `migrate` dies on `KeyError: 'SECRET_KEY'` before anything
serves requests. Run `make init-local` first; `make dev-up` checks.

## Clients

Client variables are public build configuration. They are embedded in the
bundle and must never hold a secret.

The `site/` package serves the public landing page and website. Dashboard and
mobile links retain the existing `VITE_MARKETING_URL` and
`EXPO_PUBLIC_MARKETING_URL` environment names for that site's public URL.

| File | Variables |
| --- | --- |
| `dashboard/.env` | `VITE_API_URL`, `VITE_MARKETING_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `site/.env` | `VITE_LEDOVA_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `mobile/.env` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEV_API_HOST`, `EXPO_PUBLIC_MARKETING_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_APP_STORE_URL` |

The production images never read these files: `.dockerignore` keeps every
`.env` out of the build context. Pass the public origins as build arguments
instead:
- `dashboard/.deployment/Dockerfile.prod` takes `VITE_API_URL` and
  `VITE_MARKETING_URL`.
- `site/.deployment/Dockerfile.prod` takes `VITE_LEDOVA_URL`, the dashboard
  origin that its Register and Sign in links open.

Each defaults to its local address, so a build without them links to
`localhost`.

Mobile Release builds require HTTPS. Native Debug accepts loopback, the Android
emulator host, and one private LAN IPv4 explicitly selected with
`EXPO_PUBLIC_DEV_API_HOST` before prebuild. Set the API/site URLs to that
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
load it if you did.

| Variable | Used by |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` (secret) | the `localhost` and `baseSepolia` account lists; [key management](chains.md#key-management) says why it must be the backend's operator key |
| `LOCALHOST_RPC_URL`, `LEDOVA_DEPLOY_ENV_FILE` | the `localhost` network URL (default `http://127.0.0.1:8545`) and where `deploy-all.ts` writes the deployed addresses (default `../.deployed-contracts.env`) |
| `BASE_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, `REPORT_GAS` | network URL, contract verification, gas reporting |
| `FACTORY_ADDRESS`, `STABLECOIN_ADDRESS`, `SHARE_TOKEN_ADDRESS`, `RELAYER_ADDRESS`, `TOKEN_NAME`, `TOKEN_SYMBOL`, `COMPANY_ACN`, `AUTHORIZED_SHARES`, `INITIAL_MINT` | inputs to the individual deploy scripts |

## Row-level security roles

`shared/0002_database_guards` creates `ledova_app` and `ledova_operator` when
they are absent, with no password, grants them what they need and installs the
helpers and a policy on every tenant table. Whoever applies it needs superuser
rights, because `ALTER ROLE ... BYPASSRLS` requires them; without them the roles
come out without the attributes the policies assume, which `check_rls_roles`
then refuses. The deployment requirements are:

- Provision the roles and their credentials out of band and point the aliases
  at them with `RLS_APP_DB_USER`, `RLS_APP_DB_PASSWORD`, `RLS_OPERATOR_DB_USER`
  and `RLS_OPERATOR_DB_PASSWORD`. The migration never sets a password. Local
  work uses `POSTGRES_HOST_AUTH_METHOD=trust`, which `docker-compose.yml` sets
  on the `postgres` service.
- `POSTGRES_HOST_AUTH_METHOD` is read by `initdb` on the first start only. A
  cluster initialised without it authenticates `scram-sha-256` for anything but
  loopback, and the compose bridge is not loopback, so the two passwordless
  roles are refused there. On an existing volume, give the roles the password
  the settings expect rather than recreating the database:

  ```sql
  ALTER ROLE ledova_app      LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ALTER ROLE ledova_operator LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ```

  `DATABASES["app"]["PASSWORD"]` falls back to `POSTGRES_PASSWORD` when
  `RLS_APP_DB_PASSWORD` is unset, so that is the value the connection sends;
  `manage.py check_rls_roles` says so when a connection is refused.
- Use session-level connection pooling or none. The principal is a session-level
  `SET`, which a transaction-pooled handover does not carry; the symptom is one
  request reading another user's principal, not an error.
- Run `manage.py check_rls_roles` immediately after `migrate` and before the
  first command that touches the ORM, as the compose `migrate` service does. It
  connects on each alias and asserts that the app role lacks `BYPASSRLS` and
  owns no table, the operator role has it, the migrate role owns the tables and
  a fresh app connection carries no principal.
- Put the subcommand before `--settings`: `manage.py runserver --settings=x`.
  With a global option first, `manage.py` sets the operator ambient alias and
  the server refuses to start, reporting `RLS_AMBIENT_ALIAS is 'operator'`.
