# Operations

[Documentation](../README.md)

Use these guides to run a synthetic local or public-testnet instance. Start with
[getting started](../getting-started.md) for a new checkout. Operator procedures
assume the API, worker and database run compatible code.

Companies run their registers through appointments
([who runs what](../architecture/register.md#who-runs-what)); staff work the
queues below. Do not grant company users platform-staff permissions.

| Task                                                                              | Guide                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Set environment variables and database roles                                      | [Configuration](configuration.md)                                           |
| Configure email, KYC, market data or extraction                                   | [Integrations](integrations.md)                                             |
| Deploy local/testnet contracts and align signer ownership                         | [Chains and keys](chains.md)                                                |
| Read the current company-scoped approval controls and their dated bypass evidence | [Approval controls](approval-controls.md)                                   |
| Verify a real Keystone wallet using a Mac camera and separate synthetic data      | [Keystone on a Mac](keystone-mac.md)                                        |
| Seed data, configure the operator record and work the remaining staff queues      | [Operator console](operator-console.md)                                     |
| Follow the current staff workflow for publishing on company instruction           | [Publishing to members](publications.md)                                    |
| Run the register commands and prepare register outputs on written instruction     | [Register runbook](register-foundation.md)                                  |
| Produce a company's records as one archive for a successor or a lawful request    | [Producing a company pack](register-foundation.md#producing-a-company-pack) |
| Configure private storage, scanning and retention                                 | [Uploads](uploads.md)                                                       |
| Start workers and inspect schedules                                               | [Background jobs](jobs.md)                                                  |
| Recover unresolved work                                                           | [Recovery](recovery.md)                                                     |
| Rebuild an older database for the fresh migrations, or apply a release            | [Upgrades](upgrades.md)                                                     |

## Before using a configured instance

1. Use a clean, reviewed commit with its required CI checks passing.
2. Configure PostgreSQL roles, Redis, origin/CSRF settings and the integrations
   needed for the flow. Redis is required even with trading disabled.
3. Apply migrations and the role checks, then run the seed commands in the
   [operator guide](operator-console.md#seeding).
4. Confirm `GET /health/` answers 200 and anonymous `GET /api/operator/` answers
   401. The health route does not test database or provider readiness.
5. Open the operator console and resolve its configuration warnings. Confirm a
   worker is running and scheduled work advances.
6. Confirm `trading_enabled` matches this deployment's intent: it is seeded on,
   and an operator can disable it in Django admin. See
   [trading boundaries](../architecture/trading.md).

Before a native release, run the [native and physical-device checks](../development/native-probes.md).
The [legal positions](../legal/positions.md) describe unresolved assumptions before any real use.

The [11 October essential journey](evidence/essential-register-2026-10-11.md)
records the fresh-schema company/member observation and its substitutions.
The [earlier demonstration](evidence/demonstration-journey-2026-09.md) remains
dated historical evidence.
