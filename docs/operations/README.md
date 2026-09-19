# Operations

[Documentation](../README.md)

Use these guides to run a synthetic local or public-testnet instance. Start with
[getting started](../getting-started.md) for a new checkout. Operator procedures
assume the API, worker and database run compatible code.

| Task | Guide |
| --- | --- |
| Set environment variables and database roles | [Configuration](configuration.md) |
| Configure email, KYC, market data or extraction | [Integrations](integrations.md) |
| Deploy local/testnet contracts and align signer ownership | [Chains and keys](chains.md) |
| Seed data, configure the operator and work review queues | [Operator console](operator-console.md) |
| Configure private storage, scanning and retention | [Uploads](uploads.md) |
| Start workers and inspect schedules | [Background jobs](jobs.md) |
| Recover unresolved work | [Recovery](recovery.md) |
| Upgrade an existing database or release | [Upgrades](upgrades.md) |

## Before using a configured instance

1. Use a clean, reviewed commit with its required CI checks passing.
2. Configure PostgreSQL roles, Redis, origin/CSRF settings and the integrations
   needed for the flow. Redis is required even with trading disabled.
3. Apply migrations and the role checks, then run the seed commands in the
   [operator guide](operator-console.md#seeding).
4. Confirm `GET /health/` answers 200 and anonymous `GET /api/operator/` answers
   401. The health route does not test database or provider readiness.
5. Open the operator console and resolve configuration warnings relevant to the
   selected payment rail. Confirm a worker is running and scheduled work advances.
6. Confirm `trading_enabled` matches this deployment's intent: it is seeded on,
   and an operator can disable it in Django admin. See
   [trading boundaries](../architecture/trading.md).

Before a native release, run the [native and physical-device checks](../development/native-probes.md).
The [legal positions](../legal/positions.md) describe unresolved assumptions before any real use.
