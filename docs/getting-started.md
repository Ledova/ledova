# Local setup and first use

[Documentation](README.md)

Start a synthetic local instance. You need Docker with Compose and Python 3.13.
Node/npm are needed only when running client or contract commands on the host.
The native toolchain is covered separately in [mobile builds](development/mobile-builds.md).

This guide starts the current stack. Company onboarding, authority and register
workflows run from the dashboard and mobile app; platform staff still review
offerings, record payments and publish to members, as the
[capability boundaries](product.md#current-capability-boundaries) list.

## Start the stack

From the repository root:

```bash
python3 scripts/init-local-env.py
docker compose up --build
```

The initializer copies templates into owner-only, gitignored environment files
and generates development secrets without printing them. It does not overwrite
existing files. `make init-local` runs the initializer; `make dev-up` checks
the files exist and runs `docker compose up --build`.

Compose runs migrations, checks database roles and reconciles the compliance,
procedure and asset seeds before serving the application. Before any of that it
starts a local chain and deploys the core contracts on it (on later starts it
checks them instead), and the migration step ends by admitting the operator's
signer for that chain, so authorised actions such as company empty deployment sign
real transactions; see [the local chain](#the-local-chain). PostgreSQL runs the
job queue; Redis handles request quotas and trading events. ClamAV must finish
loading signatures before uploads work. See [upload setup](operations/uploads.md).

| Surface                                | Address                 |
| -------------------------------------- | ----------------------- |
| Dashboard                              | <http://localhost:5174> |
| Marketing                              | <http://localhost:5173> |
| API and admin                          | <http://localhost:8000> |
| Local chain (JSON-RPC, chain id 31337) | <http://127.0.0.1:8545> |

Rebuild changed services: the dashboard is a built image with no source volume,
so restarting alone does not pick up edited code. Keep API and worker builds
consistent. To stop or reset the stack, see [stop and clean up](#stop-and-clean-up).

## First sign-in

Signup requires an emailed six-digit code. The local debug stack prints the
verification message to `docker compose logs -f backend`; use the code within
ten minutes and five attempts, or request another. Dashboard cookie-authenticated
writes require its origin in `DJANGO_CSRF_TRUSTED_ORIGINS`; the template includes
`http://localhost:5174`.

For a prepared local demo, run `make dev-seed`, which stops the worker, runs:

```bash
docker compose exec backend python manage.py seed_demo
```

and starts the worker again. The command prints generated credentials and
refreshes a synthetic operator, superuser, company, investor, wallets,
classification and share class; rerunning applies a password again. The first
run on a fresh database also seeds six months of synthetic history;
[demo data](operations/operator-console.md#demo-data) describes it and why its
chain and market layer is historical evidence rather than a fresh-seed claim.

For issuance beyond the seed, the stack has already deployed the core contracts
and admitted the signer. Use the Register for the company-authorised chain
actions listed in the [implementation index](plans/company-managed-registers/README.md);
the [issuance guide](architecture/contracts-and-issuance.md) explains how the
company's decision, technical execution and chain confirmation stay distinct.

## The local chain

The stack's chain is Anvil on chain id 31337, published at
<http://127.0.0.1:8545> for browser wallets and scripts on the host. To use it
from a browser wallet, add a network with that RPC URL, chain id `31337` and
currency `ETH`, then import accounts from the public test mnemonic
`test test test test test test test test test test test junk`. Account #0 is
the operator, which the backend signs with, and the demo company's wallet;
account #1 is the demo investor's wallet. Each starts with 10,000 test ether;
`make dev-seed` leaves accounts #1, #2 and #4 the ether their seeded history
leaves them, and account #0 keeps its test ether for the operator's gas. Their
keys are public, so never send anything of value to them.

The chain keeps its contracts, blocks and balances across `make dev-down`, and
every start checks that the core contracts are the ones it deployed
([the local stack's chain](operations/chains.md#the-local-stacks-chain) says what
it checks and what to do when a check refuses). While the stack is up the chain
holds port 8545, so give the chain smoke test another one:
`make chain-test CHAIN_TEST_PORT=8546`.

## Stop and clean up

- `make dev-down` runs `docker compose down`: it stops the stack and removes its
  containers. The database, the chain, Redis data, uploads and virus signatures
  stay in their volumes for the next start.
- `make dev-clean` asks first, then also deletes those volumes and the images
  the stack built. The chain goes with the database, so the next start deploys
  the core contracts on a new chain and migrates a new database; run
  `make dev-seed` again for the demo. Compose names the project `ledova`, so
  from any checkout this deletes that one local stack's data; a
  `COMPOSE_PROJECT_NAME` in the environment points it at that project instead.
- `make docker-prune` reclaims space across every project on the machine:
  dangling images, unused unnamed volumes and the build cache. Docker describes
  each step and asks before running it.

## Run individual components

| Component                    | Command from the repository root                |
| ---------------------------- | ----------------------------------------------- |
| Dashboard/shared development | `npm ci && npm run dev:dashboard`               |
| Backend dependencies         | `make install-backend`                          |
| Backend server               | `cd backend && make run`                        |
| Worker                       | `cd backend && make worker`                     |
| Contract compilation         | `cd contracts && npm ci && npx hardhat compile` |
| Mobile development server    | `cd mobile && make install && make start`       |

Backend commands require a filled environment and reachable PostgreSQL/Redis.
Outside Compose, apply migrations, role checks and seeds using the
[seeding procedure](operations/operator-console.md#seeding) before starting it.
Optional providers remain unavailable until configured; native policy testing
requires a Ledova build rather than Expo Go.

Next: [configuration](operations/configuration.md), [testing](development/testing.md)
or [troubleshooting](development/troubleshooting.md).
