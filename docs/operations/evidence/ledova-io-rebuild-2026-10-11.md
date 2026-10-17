# ledova.io rebuild, 11 October 2026

[Operations](../README.md) · [Documentation](../../README.md)

The dated record of the owner-authorised fresh-database rebuild and release of the private test
deployment at ledova.io, under [#979](https://github.com/Ledova/ledova/issues/979). The procedure it
followed is [rebuild a database](../README.md#rebuild-a-database); the authorisation
is the [11 October release decision](../../decisions.md#ledovaio-rebuild-and-release-authorisation).

## Outcome

The cutover served fresh release `7cba7ace27a555d715c2f4651eb310770c6b54ce` at 05:33 UTC. It kept
the selected sign-ins and basic company setup, installed the fresh PostgreSQL guards, and passed the
recorded system, role and catalogue, core API, runtime and public HTTP checks. Unused resources
belonging to the operation were removed; existing protected backups and operational evidence remain
private. The owner's password login and physical-device acceptance were not exercised.

## The interrupted first attempt

The first attempt completed the fresh migrations, the selected-record import and the reference and
role checks, then failed on an unsupported Compose option before fresh public access opened. The
old release was restored. The corrected serving retry took 68 seconds, reusing the verified fresh
database; its migration phase took 140 seconds separately. These measurements, including the
initial interruption, are recorded privately; they are not a promised future downtime.

## What was not included

Member access ([#985](https://github.com/Ledova/ledova/pull/985)) and register outputs
([#986](https://github.com/Ledova/ledova/pull/986)), which came later, were not deployed in this
cutover. Their initial migration graph needs another fresh rebuild to adopt from this pre-member
release; there is no in-place adoption command. The owner directed that no further backup work was
needed for the completed operation. Signer activation and real-funds use remain separate decisions.
