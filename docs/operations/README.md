# Operations

[Documentation](../README.md)

Product settings, local development services and application administration. Start with
[getting started](../getting-started.md) for a local checkout. Hosting, installation, release and
mobile distribution procedures are maintained in private
[Ledova/infra](https://github.com/Ledova/infra).

Company appointments authorise register decisions; platform-staff permissions do not
([how a company decision works](../business/README.md#how-a-company-decision-works)).
Staff procedures that carry out a business workflow on a company's written instruction belong
with that workflow.

| Reference | Guide |
| --- | --- |
| Software settings, database roles and provider inputs | [Configuration](configuration.md) |
| Local chains, contract ownership and finality | [Chains and keys](chains.md) |
| Local workers, job schedule, private files, scanner and upload behaviour | [Jobs and storage](jobs-and-storage.md) |
| Operator console, local reference seeds and review queues | [Operator console](operator-console.md) |
| Unresolved application work and record verification | [Application recovery](recovery.md) |
| Publishing on a company's written instruction | [Publishing to members](../business/publications.md#publishing-on-the-companys-instruction) |
| Notice figures, due list and company pack on written instruction | [Notice figures](../business/member-records.md#preparing-notice-figures), [due list](../business/member-records.md#working-the-due-list), [company pack](../business/member-records.md#producing-the-broader-pack-in-admin) |
| Product image builds and publication | [Image publication](../engineering/README.md#image-publication) |
| Native builds and physical-device acceptance | [Mobile checks](../engineering/mobile-releases.md) |

## ledova.io

ledova.io is run from the private [Ledova/infra](https://github.com/Ledova/infra) repository.

## Evidence

Dated records of what an instance or a check actually did. They are historical evidence, not
descriptions of current behaviour.

| Record                                                                                     | What it records                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Essential journey, 11 October 2026](evidence/essential-register-2026-10-11.md)            | The fresh-schema company and member observation and its substitutions                          |
| [Demonstration journey, September 2026](evidence/demonstration-journey-2026-09.md)         | The original synthetic chain journey                                                           |
| [Approval controls](approval-controls.md)                                                  | The company-scoped approval controls, the bypass review and the fresh-start redeploy rehearsal |
| [Base Sepolia observations, 25 September 2026](evidence/base-sepolia-2026-09-25/README.md) | Checksummed public-chain snapshots behind the approval-control evidence                        |

Next: [configuration](configuration.md), [chains and keys](chains.md) or
[application recovery](recovery.md).
