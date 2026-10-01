# Local setup and first use

[Documentation](README.md)

Start a synthetic local instance. You need Docker with Compose and Python 3.13.
Node/npm are needed only when running client or contract commands on the host.
The native toolchain is covered separately in [mobile builds](development/mobile-builds.md).

## Start the stack

From the repository root:

```bash
python3 scripts/init-local-env.py
docker compose up --build
```

The initializer copies templates into owner-only, gitignored environment files
and generates development secrets without printing them. It does not overwrite
existing files. `make init-local` and `make dev-up` perform the same steps.

Compose runs migrations, checks database roles and reconciles the compliance,
procedure and asset seeds before serving the application. Before any of that it
starts a local chain and deploys the core contracts on it (on later starts it
checks them instead), and the migration step ends by admitting the operator's
signer for that chain, so staff actions such as deploying a share class sign
real transactions; see [the local chain](#the-local-chain). PostgreSQL runs the
job queue; Redis handles request quotas and trading events. ClamAV must finish
loading signatures before uploads work. See [upload setup](operations/uploads.md).

| Surface | Address |
| --- | --- |
| Dashboard | <http://localhost:5174> |
| Marketing | <http://localhost:5173> |
| API and admin | <http://localhost:8000> |
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
refreshes a synthetic operator, superuser, issuer, investor, wallets,
classification and share class; rerunning resolves and applies a password
again. The first run on a fresh database also adds six months of synthetic
history: staff, about sixty investors in every sign-up and verification state,
four more companies, wallets and their transactions, notifications and
compliance alerts. With the stack's chain up, it then adds a chain layer, signing
about 130 transactions there in under a minute: share classes deployed, wallets
approved, each company's register issued, opened from the chain and imported,
closed offerings allotted, and offerings, applications, issuance requests and
capital increases in every state. Without a configured local chain it writes
nothing to any chain and says why; a later `make dev-seed` adds the layer. Later
runs leave both alone; `make dev-clean` starts over.
See [demo details](operations/operator-console.md#demo-data).

For issuance beyond the seed, the stack has already deployed the core
contracts, configured their addresses and admitted the signer. Open the
[operator console](operations/operator-console.md) and exercise the
[issuance flow](architecture/contracts-and-issuance.md): deploying a share
class, approving a wallet for its company and minting each sign a transaction on
the local chain.

## The local chain

The stack's chain is Anvil on chain id 31337, published at
<http://127.0.0.1:8545> for browser wallets and scripts on the host. To use it
from a browser wallet, add a network with that RPC URL, chain id `31337` and
currency `ETH`, then import accounts from the public test mnemonic
`test test test test test test test test test test test junk`. Account #0 is
the operator, which the backend signs with, and the demo issuer wallet;
account #1 is the demo investor's wallet. Each starts with 10,000 test ether,
until `make dev-seed` gives accounts #0, #1, #2 and #4, the demo testers' Base
wallets, the ether their seeded history leaves them, between about 0.3 and 2 ETH,
which pays for gas there. Their keys are public, so never send anything of value
to them.

The chain keeps its contracts, blocks and balances across `make dev-down`, and
on every start the stack checks that the core contracts are still the ones it
deployed. [The local stack's chain](operations/chains.md#the-local-stacks-chain)
says what it checks, why transactions are final as soon as they are mined, and
what to do when a check refuses. While the stack is up the chain holds port
8545, so give the real-chain tests another one:
`make chain-test CHAIN_TEST_PORT=8546`.

## Stop and clean up

| Command | Effect |
| --- | --- |
| `make dev-down` | Runs `docker compose down`: stops the stack and removes its containers. The database, the chain, Redis data, uploads and virus signatures stay in their volumes for the next start. |
| `make dev-clean` | Asks first, then also deletes those volumes and the images the stack built. The chain goes with the database, so the two always start over together: the next start deploys the core contracts on a new chain, migrates a new database and, when online, refreshes ClamAV's signatures before the scanner starts; run `make dev-seed` again for the demo. Compose names the project `ledova` (the file's `name:`), so from any checkout or worktree this deletes that one local stack's data; a `COMPOSE_PROJECT_NAME` set in the environment overrides the name and points the deletion at that project instead. |
| `make docker-prune` | Reclaims space across every project on the machine: dangling images, unnamed volumes no container uses (on Docker 23 or later; earlier versions also take unused named volumes), and the build cache. Docker describes each step and asks before running it. |

## Run individual components

| Component | Command from the repository root |
| --- | --- |
| Dashboard/shared development | `npm ci && npm run dev:dashboard` |
| Backend dependencies | `make install-backend` |
| Backend server | `cd backend && make run` |
| Worker | `cd backend && make worker` |
| Contract compilation | `cd contracts && npm ci && npx hardhat compile` |
| Mobile development server | `cd mobile && make install && make start` |

Backend commands require a filled environment and reachable PostgreSQL/Redis.
Outside Compose, apply migrations, role checks and seeds using the
[seeding procedure](operations/operator-console.md#seeding) before starting it.
Optional providers remain unavailable until configured; native policy testing
requires a Ledova build rather than Expo Go.

Next: [configuration](operations/configuration.md), [testing](development/testing.md)
or [troubleshooting](development/troubleshooting.md).
