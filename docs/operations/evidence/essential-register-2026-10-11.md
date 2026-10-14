# Essential company and member journey, 11 October 2026

[Implementation index](../../plans/company-managed-registers/README.md) · [#873](https://github.com/Ledova/ledova/issues/873)

This joined dashboard/company and iOS/member observation used fresh PostgreSQL,
two ordinary signups and synthetic records. The 23 customer record families
started empty; only reference data was seeded. Neither user had staff,
superuser, group or direct platform permissions. Company authority came from
the representative's declaration and scoped appointments. All customer changes
used the ordinary UI: no admin screen, manual customer SQL or API-only submission.

## Observed journey

The representative completed signup, retained authority evidence and activated
the company. Admission first refused while identity was pending, then succeeded
after a bound provider result passed the actual normalizer. A temporary
`read_register` invitation let the participant read the company register without
preparation actions; revocation removed that access.

The company separately prepared, approved and applied the opening, award-linked
grant, external allotment and direct transfer. An award and recorded vesting
created no shares by themselves. The receipt was company-attested external
capital, with no collection or payment-provider verification.

| Stage | Issued total | Actual holdings and entitlement |
| --- | ---: | --- |
| Opening | 100 | Alice 100 |
| Award and vesting | 100 | Bob promised 30, vested 25, issued 0 |
| Separate approved grant | 125 | Alice 100, Bob 25; award gross issued 25 |
| Fully paid external allotment | 150 | Alice 100, Bob 50; company recorded AUD250 |
| Direct transfer of 10 | 150 | Alice 100, Bob 40, Carol 10 |

The company sent one member-specific invitation; Bob accepted once on web.
His own records showed 40 shares, history `+25, +25, -10`, and award quantities
30 promised, 25 vested, 25 gross issued, zero available. Other members'
particulars and company evidence were absent from his own view. Company-reviewed
particulars requests were exercised from both web and native; each needed a
separate evidenced company instruction, approval and application. Final native
Refresh showed the second applied change with ownership unchanged.

## Outputs and reconciliation

Five actual downloads were inspected: current CSV, instructed inspection CSV,
recipient-only unsigned certificate, company transfer certificate and core ZIP.
Every PDF page rendered readably. The ZIP's 35 listed files matched their
manifest sizes and hashes. It retained four linked opening/issue/issue/transfer
entries, their sequence/head and the actual company sources.

The member requested receiving ISSUE entry 2; the company previewed and fulfilled
it, retaining the real file. Native opened the iOS share sheet and cancelled
without choosing a destination. The 30,564-byte PDF exactly matched web and
stored fulfilment bytes, SHA256
`accc6428fdb7234769f8d85eb16024facbd8f9675b2a53ee859352ff9822913d`.
Outputs were captured before the second particulars change; the fulfilled file
remained byte-identical afterwards.

The final read-only snapshot reconciled ledger deltas, issued supply and holdings
to **150 = 100 + 40 + 10**, including each member's balance and retained hash
links. Wallet, chain, deployment, outgoing-operation and signed-attempt counts
were zero. Normal application-login role and catalogue checks passed. This
operator snapshot is reconciliation evidence; the existing five real-login
tenant tests provide the separate API/database isolation controls.

## Source, corrections and limits

The API served `d8965b2c5cd9f0df1825c65b75e5e2f75543c0ad` throughout; later
frontend/test/docs changes left its backend bytes unchanged. The original
dashboard build took 7.051 seconds. The repaired build at
`247c27f223e8a4e37bebd9822d1a8227f3c89ed0` took 6.321 seconds; served assets
matched that build. It corrected stale member selectors after grant/allotment
refresh and made a prepared particulars change appear without reloading.
Existing fixture props were updated without adding cases.

The iOS participant paths matched the consumed Metro bundle and seven mapped
runtime source files. The signed arm64 Debug binary was preserved from the
earlier native build; no new native build or complete transitive/Pods audit was
performed. A temporary system password sheet blocked earlier input; later
ordinary controls worked. The reviewed temporary XCTest draft was never built
or run. Failed driver attempts and original local observations were retained
at the time of this observation.

Identity and ABR transports supplied two exact synthetic identities and one
company tuple; their normalizers/parsers remained real. Console email codes
replaced external delivery. The scanner accepted only eight exact harmless PDF
hashes through the actual upload/scanner protocol. Provider authenticity, real
malware detection, external email, payments, chain operation, legal signing and
session persistence were not established. Physical-device, Release, Android and
live human acceptance remain under [#624](https://github.com/Ledova/ledova/issues/624).

The original web journey took about 13m27s including driver pauses; this is not
a CI timing. Final preflight/CI timings and unchanged suite counts are recorded
on the PR. Protected source/build, action, output and cleanup receipts were kept
outside Git. On 14 October the owner authorised removal of all local journey
artefacts under the [signup simplification decision](../../decisions.md#simple-signup-documents-and-team-after-registration);
this dated observation and its Git history remain.
