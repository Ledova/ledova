# Getting started

[Documentation](README.md)

Start a synthetic local instance, sign in, load the demo data and fix the common setup failures. It
is for anyone with a new checkout. You need Docker with Compose and Python 3.13; Node and npm are
needed only for client or contract commands on the host. The native toolchain is covered in
[mobile builds](engineering/mobile-releases.md).

- [Start the stack](#start-the-stack)
- [First sign-in](#first-sign-in)
- [The local chain](#the-local-chain)
- [Demo data](#demo-data)
- [Stop and clean up](#stop-and-clean-up)
- [Run individual components](#run-individual-components)
- [Troubleshooting](#troubleshooting)

## Start the stack

From the repository root:

```bash
python3 scripts/init-local-env.py
docker compose up --build
```

The initialiser (`make init-local`) creates the owner-only environment files with generated
secrets, without printing them or overwriting existing files
([environment files](operations/configuration.md#environment-files)); `make dev-up` checks them and
runs `docker compose up --build`.

Compose starts a local chain and deploys the core contracts on it (on later starts it checks them
instead), then runs the migrations, checks the database roles, reconciles the compliance,
procedure and asset seeds, and admits the operator's signer for that chain, so authorised actions
such as a company's empty deployment sign real transactions. ClamAV must finish loading signatures
before uploads work ([malware scanning](operations/jobs-and-storage.md#malware-scanning)).

| Surface                                | Address                 |
| -------------------------------------- | ----------------------- |
| Dashboard                              | <http://localhost:5174> |
| Site                                   | <http://localhost:5173> |
| API and admin                          | <http://localhost:8000> |
| Local chain (JSON-RPC, chain id 31337) | <http://127.0.0.1:8545> |

## First sign-in

Signup requires an emailed six-digit code. The local debug stack prints the verification message to
`docker compose logs -f backend`; use the code within ten minutes and five attempts, or request
another. Dashboard cookie-authenticated writes require its origin in `DJANGO_CSRF_TRUSTED_ORIGINS`;
the template includes `http://localhost:5174`.

Beyond the demo data, use the Register for the company-authorised chain actions listed in the
[implementation index](plans/company-managed-registers/README.md); the
[issuance data flow](engineering/chain.md#issuance-data-flow) explains how the company's decision,
technical execution and chain confirmation stay distinct.

## The local chain

The stack's chain is Anvil on chain id 31337 at <http://127.0.0.1:8545>. It keeps its contracts,
blocks and balances across `make dev-down` and checks its core contracts on every start
([the local stack's chain](operations/chains.md#the-local-stacks-chain)). Its accounts' keys are
public, so never send anything of value to them;
[using the local chain from a browser wallet](operations/chains.md#using-the-local-chain-from-a-browser-wallet)
gives the network settings and the demo's accounts.

## Demo data

`make dev-seed` stops the worker, so no periodic job acts on rows the seed is still writing, runs
`docker compose exec backend python manage.py seed_demo`, and starts the worker again, also when
the seed fails. Outside Compose, run `python manage.py seed_demo` from `backend/` after the
[seed commands](operations/operator-console.md#seeding-reference-data). The command requires
`DEBUG`; `--force` is only for a throwaway database deliberately running without it. It is never
part of the Compose migration chain.

The password comes from `--password`, `LEDOVA_DEMO_PASSWORD`, or a generated value the command
prints. Every run applies it to every seeded account: the testers, the synthetic staff and the
synthetic people.

Every run refreshes the tester accounts, and sets demo bank details and the `DEMO` reference
prefix on the operator record when it has no bank details. The investor and founder are
`investor@ledova.io` and `founder@ledova.io`; the superuser is `admin@demo.ledova.test`. The command
adopts any existing account at those addresses and resets its password, active flag and email
verification. For the investor and founder it also overwrites the profile, role and status and adds
a verified wallet: the founder becomes the owner of the active Demo Robotics company with a draft
share class, and the investor gets a verified classification and a whitelist entry. Check that
nobody uses the two `ledova.io` addresses on an environment before seeding it.

The first run on a database also adds a synthetic population with six months of history. A fixed
random seed generates it, so every fresh database gets the same people, companies and amounts,
dated relative to the day of the run. The modules under
[`backend/shared/seeds/synthetic/`](../backend/shared/seeds/synthetic) are the description of
record; the main ones:

| Module                       | What it adds                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference.py`               | Countries, the operator's blank identity fields with an eleven-zero ABN, six months of BTC, ETH, USDC and USDT prices and a USD to AUD rate                                                                                                          |
| `staff.py`                   | A compliance officer and a document reviewer, both in the Document operations group, an operations officer who can open the operator console, and a deactivated former staff member                                                                  |
| `people.py`, `identities.py` | 60 investors unless `--investors` asks for at least 20, in every signup, identity, standing and classification state, with wallets on Base, Ethereum and Bitcoin testnet, transactions, holdings, inactive device tokens, notifications and payslips |
| `companies.py`               | Demo Robotics and two more active companies with verified documents, officeholder attestation and a passed ABR check from a synthetic observation, one company with information requested and one submitted                                          |
| `eligibility.py`             | Company eligibility decisions                                                                                                                                                                                                                        |
| `alerts.py`                  | Alerts in every status, one with a suspicious matter report, with AUD amounts the rules compare and activation dates that make only customers in their first 30 days new                                                                             |

The founder's wallet is development account #0, the operator's
signer. The investor has seven wallets on the three networks, two unverified: development accounts
#1 to #4 and two Bitcoin testnet addresses. The investor also has a classification history,
payslips, and more than a page of notifications and wallet activity; the founder has a full
profile and Demo Robotics' review history.

A later run finds the population, adds nothing and says so. Synthetic people use
`@demo.ledova.test` addresses, ACMA fictional phone numbers and made-up addresses; the companies use
ACNs in the unissued 9xx range with matching ABNs; wallet keys come from a namespaced hash, except
the testers' development accounts. The seed sends nothing and queues no job: no email, push
notification, identity check or ABR lookup. To start over, run `make dev-clean`, then `make dev-up`
and `make dev-seed`; a run that stopped part-way says to start over.

The chain layer ([`seeds/synthetic/chain/`](../backend/shared/seeds/synthetic/chain)) and the market
layer ([`seeds/synthetic/market/`](../backend/shared/seeds/synthetic/market)) are retained code; on
a fresh database both report `skipped` with the reason. Even with a reachable local chain, the
chain layer's issuance plan includes the companies' employee share trust addresses, which have no
held signing key, and fresh treasury approval is unsupported, so it adds no chain records or
transactions; the market layer runs only after a present chain layer. Their earlier output is
historical evidence, not a fresh-seed claim.

Wallet balances follow the worker's hourly sync wherever it can read a chain: on the local chain a
synthetic wallet reads zero and a development account its test ether. Ethereum and Bitcoin wallets
keep their seeded balances until the
[provider URLs](operations/configuration.md#market-data-and-chain-providers) are set; then the sync
replaces them with what the wallets hold on the public testnets, normally nothing. Unattached
payslips are purged 30 days after upload, as in production, so the seeded ones, uploaded up to 26
days before the run, disappear over the following weeks; a rerun does not bring them back.

For a development database only, `register_foundation load-synthetic-opening` opens a share
class's register from a JSON file with synthetic member UUIDs and whole-share amounts, attributed
to an active staff user, then verifies it. Loading the same file twice records one opening; invalid
input rolls back the opening and the member references it created. A loaded opening initialises
the register the HTTP routes serve for that class. From `backend/`:

```json
{
  "operation_id": "78e39ef6-4c7c-4b38-8311-268ac67086b5",
  "effective_on": "2026-09-20",
  "holdings": [{ "member": "b0169d39-35b2-4f97-aa0a-fb027c1b167f", "shares": "100" }]
}
```

```bash
python manage.py register_foundation load-synthetic-opening --token TOKEN_UUID --actor STAFF_USER_ID --input opening.json
```

## Stop and clean up

- `make dev-down` runs `docker compose down`: it stops the stack and removes its containers. The
  database, the chain, Redis data, uploads and virus signatures stay in their volumes for the next
  start.
- `make dev-clean` asks first, then also deletes those volumes and the images the stack built, so
  the next start deploys the core contracts on a new chain and migrates a new database; run
  `make dev-seed` again for the demo. Compose names the project `ledova`, so from any checkout this
  deletes that one local stack's data; a `COMPOSE_PROJECT_NAME` in the environment points it at
  that project instead.
- `make docker-prune` reclaims space across every project on the machine: dangling images, unused
  unnamed volumes and the build cache. Docker asks before each step.

## Run individual components

| Component                    | Command from the repository root                |
| ---------------------------- | ----------------------------------------------- |
| Dashboard/shared development | `npm ci && npm run dev:dashboard`               |
| Backend dependencies         | `make install-backend`                          |
| Backend server               | `cd backend && make run`                        |
| Worker                       | `cd backend && make worker`                     |
| Contract compilation         | `cd contracts && npm ci && npx hardhat compile` |
| Mobile development server    | `cd mobile && make install && make start`       |

Backend commands require a filled `backend/.env` and reachable PostgreSQL and Redis. Outside
Compose, run the [seed commands](operations/operator-console.md#seeding-reference-data) (migrations
and role checks included) before starting the server. Optional providers stay unavailable until
configured; native policy testing requires a Ledova build rather than Expo Go.

## Troubleshooting

Check the environment and the command's actual outcome before changing code.

| Symptom                                                                                       | Check and remedy                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard serves old code after restart                                                       | Rebuild its image; Compose has no dashboard source volume. Keep the backend and worker images aligned too.                                                                                                                                                             |
| Signup has no email                                                                           | On the local debug stack, read the code in the backend log; otherwise check the [email configuration](operations/configuration.md#email).                                                                                                                              |
| Cookie writes return CSRF 403                                                                 | Put the dashboard origin in `DJANGO_CSRF_TRUSTED_ORIGINS`; clearing localStorage does not clear cookies.                                                                                                                                                               |
| PostgreSQL refuses `ledova_app` or `ledova_operator` on an existing volume                    | The volume was initialised without trust authentication; set the roles' passwords as [row-level security roles](operations/configuration.md#row-level-security-roles) shows.                                                                                           |
| Backend tests cannot start                                                                    | Start PostgreSQL and supply the isolated test database and role settings; the backend suites run on PostgreSQL only.                                                                                                                                                   |
| Backend `make lint` reports _No module named black_ (or isort, flake8)                        | The lint tools are host development requirements, not in the backend image: run `make install-backend`, then `cd backend && make lint` ([backend verification](engineering/testing.md#backend-verification)).                                                          |
| Type-check cannot find Expo configuration                                                     | Install mobile dependencies inside `mobile/`, or run `make check`. A root package copy is not proof Metro can resolve it.                                                                                                                                              |
| Many unrelated PostgreSQL failures                                                            | Check alias and principal selection, role credentials and another runner sharing the same test database before blaming a policy. Use a separate database per worktree.                                                                                                 |
| Missing rows only with `select_related`                                                       | Check parent policy visibility ([policy catalogue](engineering/security.md#policy-catalogue)).                                                                                                                                                                         |
| Database transaction remains aborted after a caught error                                     | A caught permission or integrity error still aborts PostgreSQL's transaction. Verify the connection and the savepoint or rollback boundary.                                                                                                                            |
| A test hangs in JSON rendering                                                                | A mock probably returned another mock. Supply a concrete response value and inspect a faulthandler dump.                                                                                                                                                               |
| All assertions pass but the test process fails                                                | Inspect the exit status and teardown: leaked React queries, unmounted components or unresolved promises can fail after assertions finish.                                                                                                                              |
| Upload returns 503                                                                            | Check Redis and ClamAV readiness and signature loading; there is no scanner bypass. `UPLOAD_PROCESS_MEMORY_BYTES` or `UPLOAD_PROCESS_CPU_SECONDS` below 1 refuses every upload.                                                                                        |
| Backend logs `Upload workers run without RLIMIT_AS`                                           | Expected on macOS; on Linux it is a fault to investigate ([upload limits](operations/jobs-and-storage.md#upload-limits)).                                                                                                                                              |
| LLM or a chain node on the host times out from a container                                    | Check bridge-to-host reachability, and prefer a service on the Compose network ([document extraction](operations/configuration.md#document-extraction)).                                                                                                               |
| `make chain-test` says `CHAIN_TEST_PORT=8545 is already in use`                               | The stack's chain holds 8545: run `make chain-test CHAIN_TEST_PORT=8546`, or any free port.                                                                                                                                                                            |
| `chain-deploy` exits 1, and `migrate`, `backend`, `worker` and `dashboard` never start        | Its message names the difference, for example contracts built from other sources after a change to `contracts/`. Reset the chain and database together: `make dev-clean`, then `make dev-up` ([the local stack's chain](operations/chains.md#the-local-stacks-chain)). |
| `migrate` stops at `admit_local_signer` with _the chain was reset, or lost its latest blocks_ | The database recorded transactions the chain no longer has: the chain volume was deleted alone or Anvil was killed between state writes. `make dev-clean` resets both.                                                                                                 |
| `chain` exits at once with _invalid value '/state/state.json' for '--state'_                  | A hard kill interrupted Anvil while it was rewriting its state file in place. The chain cannot be recovered: `make dev-clean`.                                                                                                                                         |

For native build and device failures, use
[native probes](engineering/mobile-releases.md#native-probes). For a pending issuance, transfer or
retained file, use [recovery](operations/recovery.md).

Next: [configuration](operations/configuration.md),
[testing](engineering/testing.md) or [operations](operations/README.md).
