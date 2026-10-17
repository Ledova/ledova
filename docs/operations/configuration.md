# Configuration

[Operations](README.md) · [Documentation](../README.md)

Every environment variable a Ledova instance reads, the PostgreSQL roles it needs, and the operating
notes for each provider. It is for whoever configures a local or public-testnet instance. Run only
with synthetic data, configure only the integrations the flow you are exercising needs, and keep
credentials server-side.

- [Environment files](#environment-files)
- [Django core and Redis](#django-core-and-redis)
- [Sessions and cookies](#sessions-and-cookies)
- [Database](#database)
- [Row-level security roles](#row-level-security-roles)
- [Chain](#chain)
- [Storage, uploads and retention](#storage-uploads-and-retention)
- [Market data and chain providers](#market-data-and-chain-providers)
- [Identity verification providers](#identity-verification-providers)
- [Email](#email)
- [On-ramp](#on-ramp)
- [Document extraction](#document-extraction)
- [Company registry lookup](#company-registry-lookup)
- [Push notifications](#push-notifications)
- [Clients](#clients)
- [Contracts](#contracts)
- [Process variables](#process-variables)

## Environment files

`backend/.env.example` is the backend template. `make init-local` (`python3
scripts/init-local-env.py`) copies it and the dashboard, site and mobile templates to owner-only
(0600), gitignored `.env` files and fills `SECRET_KEY` and `POSTGRES_PASSWORD` with generated
secrets. It never overwrites an existing file. `make dev-up` first runs the same script with
`--check`, which refuses to start when a file is missing or either secret is blank. The backend
variables below are read in `backend/ledova_backend/settings/` unless a row says otherwise.

`DEBUG`, `COOKIE_SECURE` and `EVM_ASSET_TRANSFER_HISTORY_ENABLED` go through `read_bool`, which
strips and lowercases the value, so `true`, `TRUE` and ` true ` are all accepted; anything other
than `true` or `false` raises `ImproperlyConfigured` at startup. `KYCAID_CRYPTO_MONITORING_ENABLED`
is lowercased and compared with `true`, and anything else is off.

Inside the local stack, `docker-compose.yml` gives the `migrate`, `backend` and `worker` services
one `x-backend-environment` anchor, so the three cannot drift: `POSTGRES_HOST=postgres`,
`REDIS_URL=redis://redis:6379/0`, `UPLOAD_SCANNER_HOST=clamav`, `STORAGE_BACKEND=local`,
`DEBUG=true`, and the stack's own chain (`BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CHAIN_ID`,
`BLOCKCHAIN_OPERATOR_KEY`, the three contract addresses and `LOCAL_CHAIN_FINALITY_DEPTH`, described
under [the local stack's chain](chains.md#the-local-stacks-chain)). These are
`environment:` entries, so they win over `backend/.env`: an `s3` storage backend, `DEBUG=false`, a
custom `REDIS_URL` or other chain settings in that file are silently ignored inside the stack.

`backend/.env` is still needed, because `SECRET_KEY` and `POSTGRES_PASSWORD` come only from it and
no committed file supplies them. Without it `migrate` stops on `KeyError: 'SECRET_KEY'` before
anything serves requests. Run `make init-local` first.

## Django core and Redis

| Variable | Default | Required |
| --- | --- | --- |
| `SECRET_KEY` | none | Yes; startup fails without it |
| `DEBUG` | `false` | No |
| `DJANGO_ALLOWED_HOSTS` | empty | Yes outside local use; comma separated |
| `DJANGO_CORS_ALLOWED_ORIGINS` | empty | Yes; comma separated; must list the dashboard origin |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | empty | Yes; comma separated; cookie-authenticated writes from an unlisted origin get `403 CSRF Failed` |
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | No |
| `OPERATOR_NAME` | `Ledova operator` | No; used only when the operator row is created |
| `REDIS_URL` | `redis://redis:6379/0` | Yes |

`REDIS_URL` is `CACHES["default"]`, which holds the sign-in and upload quotas, the Transak access
token and the other DRF rate limits, and it carries the trading event stream (`tokens/events.py`,
`tokens/views/trading_events.py`). Background work is Procrastinate on PostgreSQL, not Redis. Redis
is required even with trading disabled: with the cache unreachable, sign-in answers 503 before
checking credentials and uploads answer 503, and the backend and worker containers wait for the
Redis healthcheck.

How the per-address sign-in limit (`auth_email`) counts is in
[authentication and sessions](../engineering/security.md#authentication-and-sessions); the upload
quotas are in [upload limits](jobs-and-storage.md#upload-limits).

## Sessions and cookies

| Variable | Default | Required |
| --- | --- | --- |
| `COOKIE_ACCESS_NAME` | `access` | No |
| `COOKIE_REFRESH_NAME` | `refresh` | No |
| `COOKIE_DOMAIN` | unset | No; also scopes `csrftoken`. Leave it empty for localhost; set the shared parent domain when the dashboard and API are on different subdomains |
| `COOKIE_SECURE` | the opposite of `DEBUG` | No |
| `ACCESS_TOKEN_LIFETIME` | `604800` seconds | No |
| `REFRESH_TOKEN_LIFETIME` | `604800` seconds | No |

How sessions are transported, checked and revoked is in the
[authentication model](../engineering/security.md#authentication-and-sessions).

## Database

| Variable | Default | Required |
| --- | --- | --- |
| `POSTGRES_HOST` | none | Yes |
| `POSTGRES_PORT` | none, so libpq's own default applies | No |
| `POSTGRES_DB` | none | Yes |
| `POSTGRES_USER` | none | Yes; the migration role, which owns the tables |
| `POSTGRES_PASSWORD` | none | Yes |
| `POSTGRES_SSLMODE` | `prefer` | No |

Every connection uses a 10-second connect timeout and TCP keepalives. The default (migration) and
operator aliases keep connections for 300 seconds (`CONN_MAX_AGE`); the scoped app alias disables
connection reuse. How the three aliases are chosen is in
[tenancy](../engineering/security.md#roles-and-principal).

## Row-level security roles

| Variable | Default | Required |
| --- | --- | --- |
| `RLS_APP_DB_USER` | `ledova_app` | No |
| `RLS_APP_DB_PASSWORD` | `POSTGRES_PASSWORD` | Outside local trust authentication |
| `RLS_OPERATOR_DB_USER` | `ledova_operator` | No |
| `RLS_OPERATOR_DB_PASSWORD` | `POSTGRES_PASSWORD` | Outside local trust authentication |
| `RLS_AMBIENT_ALIAS` | `app` | Never set it by hand: `manage.py` sets `operator` for every command but `runserver`, and the worker entrypoint sets it too |

`shared/0002_database_guards` creates `ledova_app` and `ledova_operator` when they are absent, with
`LOGIN` and no password, grants them what they need and installs the helpers and a policy on every
tenant table. Whoever applies it needs superuser rights, because `ALTER ROLE ... BYPASSRLS` requires
them; without them the roles come out without the attributes the policies assume, and
`check_rls_roles` refuses them. The deployment requirements are:

- Provision the roles' credentials out of band and point the aliases at them with the variables
  above. The migration never sets a password. Local work uses `POSTGRES_HOST_AUTH_METHOD=trust`,
  which `docker-compose.yml` sets on the `postgres` service.
- `POSTGRES_HOST_AUTH_METHOD` is read by `initdb` on the first start only, and changing it later
  does not rewrite the cluster's authentication. A cluster initialised without it authenticates
  `scram-sha-256` for anything but loopback, and the Compose bridge is not loopback, so the two
  passwordless roles are refused there; a successful loopback connection proves nothing about the
  bridge. On an existing volume, give the roles the password the settings send rather than
  recreating the database:

  ```sql
  ALTER ROLE ledova_app      LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ALTER ROLE ledova_operator LOGIN PASSWORD '<the POSTGRES_PASSWORD in backend/.env>';
  ```

  Both role passwords fall back to `POSTGRES_PASSWORD`, so that is the value each connection sends;
  `manage.py check_rls_roles` prints these statements when a connection is refused.
- Use session-level connection pooling or none. The principal is a session-level `SET`, which a
  transaction-pooled handover does not carry; the symptom is one request reading another user's
  principal, not an error.
- Run `manage.py check_rls_roles` immediately after `migrate` and before the first command that
  touches the ORM, as the Compose `migrate` service does. It connects on each alias and asserts
  that the app role lacks `BYPASSRLS` and owns no table, the operator role has `BYPASSRLS`, the
  migration role owns the tables and a fresh app connection carries no principal.
  `manage.py check_rls_catalogue` asserts that the installed policies and helpers are the ones
  `shared/db/policies.py` describes.
- Put the subcommand before `--settings`: `manage.py runserver --settings=x`. With a global option
  first, `manage.py` sets the operator ambient alias and the server refuses to start, reporting
  `RLS_AMBIENT_ALIAS is 'operator'`.

## Chain

| Variable | Default | Required |
| --- | --- | --- |
| `BLOCKCHAIN_RPC_URL` | `ALCHEMY_BASE_URL` if set, else `http://localhost:8545` | Yes for any chain call |
| `BLOCKCHAIN_CHAIN_ID` | `84532` | No; must be 1337, 31337, 84532 or 11155111, or startup fails |
| `ETHEREUM_CHAIN_ID` | `11155111` | No; same allowed set |
| `BITCOIN_NETWORK` | `test` | No; `test` or `regtest` only |
| `EVM_ASSET_TRANSFER_HISTORY_ENABLED` | `false` | No; enables provider-backed EVM asset transfer history |
| `BLOCKCHAIN_OPERATOR_KEY` | empty | Yes to deploy, mint, whitelist and pause; see [key management](chains.md#key-management) |
| `SHARE_TOKEN_FACTORY_ADDRESS` | empty | Yes for issuance |
| `ATOMIC_SWAP_ADDRESS` | empty | Only for settlement |
| `STABLECOIN_CONTRACT_ADDRESS` | empty | Only for stablecoin payment; seeds the `AUDY` deployment on `base` |
| `SWAP_ORDER_EXPIRY_HOURS` | `0.25` (15 minutes) | No; finite fractional hours are accepted |
| `LOCAL_CHAIN_FINALITY_DEPTH` | empty | No; a positive block depth at which an issuance, swap or register opening on a local chain (1337, 31337) is final. The local stack sets `1`. Refused for any other chain id |
| `SIGNING_CHALLENGE_TTL_SECONDS` | `300` | No; lifetime of a wallet signing challenge |
| `SIGNING_CHALLENGE_RETENTION_SECONDS` | `86400` | No; how long after expiry an unspent challenge is kept before `purge_signing_challenges` deletes it |

Malformed and non-finite values are refused at settings import. Which chains are allowed and how
finality is decided are under
[allowed chains and finality](chains.md#allowed-chains-and-finality).

## Storage, uploads and retention

| Variable | Default | Required |
| --- | --- | --- |
| `STORAGE_BACKEND` | `local` | No; `local`, `s3` or `gcs`, and forced to `local` whenever `DEBUG` is on |
| `AWS_STORAGE_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=s3` |
| `AWS_S3_REGION_NAME` | `ap-southeast-2` | No |
| `GS_BUCKET_NAME` | none | Yes when `STORAGE_BACKEND=gcs` |
| `CLASSIFICATION_EVIDENCE_RETENTION_DAYS` | `2557` | No; `0` retains indefinitely and purges nothing; changing it needs a new guard migration ([retention clocks](../engineering/security.md#retention-clocks)) |
| `UNATTACHED_DOCUMENT_RETENTION_DAYS` | `30` | No; lifetime of an unattached payslip from upload; `0` retains indefinitely; changing it needs a new guard migration ([retention clocks](../engineering/security.md#retention-clocks)) |
| `FORMER_MEMBER_RETENTION_DAYS` | `2557` | No; a value below 2557, including `0`, raises `ImproperlyConfigured` and refuses the fold and the purge |

What each retention clock measures from and what each purge removes is stated once in
[data retention](../engineering/security.md#retention-clocks). Private storage, scanning and the
sixteen `UPLOAD_*` limits are in
[jobs and storage](jobs-and-storage.md#upload-limits).

## Market data and chain providers

| Variable | Default | Required |
| --- | --- | --- |
| `ALCHEMY_ETH_URL`, `ALCHEMY_BTC_URL`, `ALCHEMY_BASE_URL` | empty | Only for provider-backed sync |
| `ALCHEMY_WEBHOOK_SIGNING_KEY` | empty | Yes to accept `/webhooks/alchemy/` |
| `COINGECKO_API_KEY` | empty | No |
| `COINGECKO_BASE_URL` | `https://api.coingecko.com/api/v3` | No |
| `COINGECKO_TIMEOUT` | `10` seconds | No |
| `BLOCKSTREAM_API_URL` | `https://blockstream.info/testnet/api` | No |
| `BLOCKSTREAM_TIMEOUT` | `30` seconds | No |

Alchemy wallet webhooks must include `event.network`, as the
[Address Activity payload](https://www.alchemy.com/docs/reference/address-activity-webhook)
supplies. `BASE_SEPOLIA` is accepted only with `BLOCKCHAIN_CHAIN_ID=84532`, and `ETH_SEPOLIA` only
with `ETHEREUM_CHAIN_ID=11155111`. Missing, unknown, mainnet or locally mismatched networks get
HTTP 400 after signature verification. Accepted events enqueue each matching wallet on that
network, including both transfer participants and separate accounts sharing an address. Receipt
workers fetch chain state themselves; webhook balances and block numbers are not settlement
evidence.

While `ALCHEMY_ETH_URL` and `ALCHEMY_BTC_URL` are empty, Ethereum and Bitcoin wallets keep their
stored balances and the hourly wallet sync logs a warning for each of them.

## Identity verification providers

| Variable | Default | Required |
| --- | --- | --- |
| `KYC_PROVIDER` | empty | Yes to enable identity verification; `kycaid` or `sumsub` |
| `KYCAID_API_TOKEN`, `KYCAID_BASE_URL`, `KYCAID_FORM_ID` | empty | Yes for KYCAID |
| `KYCAID_CRYPTO_MONITORING_ENABLED` | `false` | No |
| `SUMSUB_API_KEY`, `SUMSUB_SECRET_KEY`, `SUMSUB_BASE_URL` | empty | Yes for Sum&Sub |
| `SUMSUB_LEVEL_NAME` | `basic-kyc-level` | No |
| `SUMSUB_WEBHOOK_SECRET` | empty | Yes to accept `/webhooks/sumsub/` |
| `CRYPTO_RISK_THRESHOLD_MEDIUM` | `0.25` | No |
| `CRYPTO_RISK_THRESHOLD_HIGH` | `0.6` | No |

Identity verification is off until configured: with any other `KYC_PROVIDER` value, blank
included, the integration answers `503 Service not configured`. The operator's
`issuer_kyc_required` needs a configured provider
([operator configuration](operator-console.md#operator-configuration)).

Only KYCAID screens addresses; under Sum&Sub every screening fails
([transaction monitoring](../business/participants.md#transaction-monitoring)). With
`KYCAID_CRYPTO_MONITORING_ENABLED` off, screenings fail with "Crypto monitoring is disabled"; after
turning it on, retry them from the screening admin
([crypto address screening](../engineering/backend.md#crypto-address-screening)). How each
provider's results, scores and callbacks are read is in
[identity verification](../engineering/backend.md#identity-providers).

## Email

| Variable | Default | Required |
| --- | --- | --- |
| `DEFAULT_FROM_EMAIL` | `noreply@localhost` | No |
| `SENDGRID_API_KEY` | empty | Yes outside `DEBUG` unless an SMTP server is reachable |
| `SENDGRID_API_URL` | empty | With `SENDGRID_API_KEY`; an `https` URL, or `http` to a local host, with no credentials, query or fragment |
| `SENDGRID_TIMEOUT` | `10` seconds | No |

With `SENDGRID_API_KEY` set, mail goes to SendGrid; an invalid or missing `SENDGRID_API_URL` then
fails each send and logs the error. Without a key, mail goes through Django's email backend, which
follows `DEBUG`: the console backend with `DEBUG=true`, which prints the sign-up verification code
to the backend log, and SMTP with Django's defaults otherwise.

## On-ramp

The on-ramp is an optional personal investor feature outside the register. Companies must not buy
cryptocurrency through it: the API and both clients admit only a current `investor` or `both`
personal account ([#920](https://github.com/Ledova/ledova/issues/920)), and configuring Transak
selects no AUD share-payment provider
([decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)).

| Variable | Default | Required |
| --- | --- | --- |
| `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, `TRANSAK_API_URL`, `TRANSAK_API_GATEWAY_URL` | empty | Yes to enable the widget |
| `TRANSAK_REFERRER_DOMAIN` | `localhost` | No |
| `TRANSAK_THEME_COLOR` | `6366f1` | No |

## Document extraction

| Variable | Default | Required |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://host.docker.internal:11434/v1` | No |
| `LLM_MODEL` | `qwen2.5vl:7b` | No |
| `LLM_EXTRA_HOSTS` | empty | No; comma-separated bare hostnames |

The default points at a service on the host. A host firewall that drops bridge-to-host traffic, as
`ufw` does by default on Arch and Ubuntu, makes `host.docker.internal` and the bridge gateway time
out from the worker with no route error to say why; a chain node on the host fails the same way.
Two remedies: run the service inside the Compose network and name it in the variable, or open the
bridge to the host port (`ufw allow in on docker0 to any port 11434`). The first is preferred.

`LLM_EXTRA_HOSTS` makes the first remedy expressible. `_validate_local_base_url` admits
`localhost`, `127.0.0.1`, `::1` and `host.docker.internal` and nothing else until an operator names
a hostname there: `LLM_EXTRA_HOSTS=ollama` with `LLM_BASE_URL=http://ollama:11434/v1` points
extraction at a sibling container. Entries are compared with the URL's host only, and there is no
wildcard; name only hosts you control. Operator diagnostics name the settings to inspect,
`LLM_BASE_URL` and `LLM_MODEL`, never their values, and the member API never sends the stored
diagnostic; the operator reads it in the extraction admin.

Connection failures, timeouts, rate limits and upstream server errors are retried by the extraction
task, up to three attempts thirty seconds apart, each making one upstream request. Invalid
requests, model or configuration errors and invalid extracted output stop after one attempt. Every
attempt stays in the extraction history. After correcting a terminal failure, select the failed
attempt in the extraction admin and re-run it; storage and rendering failures need that operator
action too. Extraction supplements human review and never verifies a claim.

## Company registry lookup

`ABR_AUTH_GUID` is blank by default. Obtain the free authentication GUID through
[ABR Web Services](https://abr.business.gov.au/Tools/WebServices) and configure it server-side.
Without it, company activation retains a pending, unconfigured attempt without contacting ABR and
leaves the company unchanged. Development inputs must stay synthetic.

Each lookup has a 15-second whole-call deadline, DNS and response reads included, in a supervised
subprocess with a 1 MiB streamed response cap. The GUID travels through the subprocess's input
pipe, never its command line or inherited environment. What a lookup must match is in
[how the registry check matches](../business/companies.md#how-the-registry-check-matches), and the
staff controls that remain are in
[staff registry controls](../business/companies.md#staff-registry-controls).

## Push notifications

Push registration needs `extra.eas.projectId` in the Expo configuration (`mobile/app.json`), which
is not set in this repository. On Android, remote push is unavailable in Expo Go from SDK 53 onward
and needs a development or production build; see the
[SDK 54 notification documentation](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/).
The in-app inbox works without push configuration but needs a running worker
([notifications](../engineering/backend.md#notifications)).

## Clients

Client variables are public build configuration. They are embedded in the bundle and must never
hold a secret. Dashboard and mobile keep the `VITE_MARKETING_URL` and `EXPO_PUBLIC_MARKETING_URL`
names for the public site's URL.

| File | Variables |
| --- | --- |
| `dashboard/.env` | `VITE_API_URL`, `VITE_MARKETING_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `site/.env` | `VITE_LEDOVA_URL`, `VITE_HOST`, `VITE_PORT`, `VITE_ALLOWED_HOSTS` |
| `mobile/.env` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEV_API_HOST`, `EXPO_PUBLIC_MARKETING_URL`, `EXPO_PUBLIC_SUPPORT_EMAIL`, `EXPO_PUBLIC_APP_STORE_URL` |

The production images never read these files: the `.dockerignore` files keep every `.env` out of
the build context. Pass the public origins as build arguments instead:

- `dashboard/.deployment/Dockerfile.prod` takes `VITE_API_URL` and `VITE_MARKETING_URL`.
- `site/.deployment/Dockerfile.prod` takes `VITE_LEDOVA_URL`, the dashboard origin its Register and
  Sign in links open.

Each defaults to its local address, so a build without them links to `localhost`. Mobile Release
builds require HTTPS; which hosts a native Debug build may reach, and how
`EXPO_PUBLIC_DEV_API_HOST` selects one LAN address before prebuild, is in
[mobile transport](../engineering/mobile.md#native-transport).

## Contracts

Hardhat loads nothing from a file: `contracts/hardhat.config.ts` and the deploy scripts read
`process.env` directly, and the package has no dotenv loader. Export the values you need in the
deploying shell. `contracts/.env.example` is a checklist of the names, not a file Hardhat reads;
`scripts/init-local-env.py` does not create `contracts/.env`, and nothing would load it.

| Variable | Used by |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` (secret) | the `localhost` and `baseSepolia` account lists; [key management](chains.md#key-management) says why it must be the backend's operator key |
| `LOCALHOST_RPC_URL` | the `localhost` network URL (default `http://127.0.0.1:8545`) |
| `LEDOVA_DEPLOY_ENV_FILE` | where `deploy-all.ts` writes the deployed addresses (default `../.deployed-contracts.env`) |
| `BASE_SEPOLIA_RPC_URL` | the `baseSepolia` network URL (default `https://sepolia.base.org`) |
| `ETHERSCAN_API_KEY`, `REPORT_GAS` | contract verification and gas reporting (`REPORT_GAS=1`) |
| `FACTORY_ADDRESS`, `STABLECOIN_ADDRESS`, `SHARE_TOKEN_ADDRESS`, `RELAYER_ADDRESS`, `TOKEN_NAME`, `TOKEN_SYMBOL`, `COMPANY_ACN`, `AUTHORIZED_SHARES`, `INITIAL_MINT` | inputs to the individual deploy scripts ([a chain of your own](chains.md#a-chain-of-your-own)) |
| `FRESH_SIGNER_*` | the fresh-signer manifest of a [fresh-start redeploy](chains.md#fresh-start-redeploy) |

## Process variables

| Variable | Read by | Default |
| --- | --- | --- |
| `PORT` | `ledova_backend/worker_entrypoint.py`, for its health endpoint | `8080` |
| `LEDOVA_DEMO_PASSWORD` | `seed_demo`, when `--password` is not given ([demo data](../getting-started.md#demo-data)) | a generated password, printed |
| `CHAIN_TEST_PORT` | `make chain-test` and `make contracts-deploy-local` | `8545` |

Next: [chains and keys](chains.md),
[jobs and storage](jobs-and-storage.md) or
[bring up an instance](README.md#bring-up-an-instance).
