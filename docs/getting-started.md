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
procedure and asset seeds before serving the application. PostgreSQL runs the
job queue; Redis handles request quotas and trading events. ClamAV must finish
loading signatures before uploads work. See [upload setup](operations/uploads.md).

| Surface | Address |
| --- | --- |
| Dashboard | <http://localhost:5174> |
| Marketing | <http://localhost:5173> |
| API and admin | <http://localhost:8000> |

Stop with `docker compose down` or `make dev-down`. Rebuild changed services:
the dashboard is a built image with no source volume, so restarting alone does
not pick up edited code. Keep API and worker builds consistent.

## First sign-in

Signup requires an emailed six-digit code. The local debug stack prints the
verification message to `docker compose logs -f backend`; use the code within
ten minutes and five attempts, or request another. Dashboard cookie-authenticated
writes require its origin in `DJANGO_CSRF_TRUSTED_ORIGINS`; the template includes
`http://localhost:5174`.

For a prepared local demo, run:

```bash
docker compose exec backend python manage.py seed_demo
```

The command prints generated credentials and creates a synthetic operator,
superuser, issuer, investor, wallets, classification and draft share class.
It is idempotent; rerunning resolves and applies a password again. It writes
nothing to a chain. The seeded whitelist entry has no company approval, so the wallet is on no registry.
See [demo details](operations/operator-console.md#demo-data).

For issuance, continue with [local chain setup](operations/chains.md). Then open
the [operator console](operations/operator-console.md), configure the contract
addresses/payment rail, and exercise the [issuance flow](architecture/contracts-and-issuance.md).

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
