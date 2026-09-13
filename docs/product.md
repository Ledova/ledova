# Product and terminology

[Documentation](README.md)

Private-company issuance, ownership records, onboarding and payments often use
disconnected systems and manual administration. Ledova brings them into one
platform that a company can operate itself or use through a registry provider.
The intended investor experience supports AUD and stablecoins without requiring
crypto expertise. The intended lifecycle is
company onboarding → share class → offering → subscription → payment → allotment
→ register of members. Secondary transfers extend that lifecycle when their
remaining hardening is complete.

## Roles and deployment modes

| Term | Meaning |
| --- | --- |
| Operator | Runs the deployment, Django admin, review queues and operator signer |
| Issuer | The company offering and issuing shares; “company” names the entity |
| Investor | A person investing through their account and verified wallets |
| Account | The person's customer account, linked to one profile |
| Wallet | An account's address on a specific network; the same EVM address on two networks is two wallet records |

One operator exists per deployment. **Registry** mode hosts multiple companies
and is the default. **Single issuer** mode represents a company operating its
own instance. Both use the same tenancy boundary. Single issuer also disables
supporting-payslip storage and its API/admin surfaces; classification evidence
and human review remain available. See [operator setup](operations/operator-console.md).

## Current capability boundaries

This is the repository's experimental implementation, not a claim that it can
operate a real market. Keep all identities, companies, payments and assets synthetic.

| Capability | Current boundary |
| --- | --- |
| Company onboarding and share classes | Application/review flow, company and token screens exist; operator approval and chain configuration are required |
| Tokenized shares | Whole-share issuance, authorized caps and recipient whitelist are enforced on chain |
| Investor classification | Claim/evidence submission and review status exist in both clients; staff review is in admin; eligibility scopes discovery and subscriptions |
| Primary offerings and subscriptions | Investor directory, subscription and payment instructions are available in the dashboard; the mobile investor flow is scheduled for Phase 4 |
| AUD and stablecoin payments | Operator records receipt, refunds and allotment in admin; bank-feed and stablecoin-watcher reconciliation is planned |
| Register | Current members are derived from chain data; former members are retained records; a fully authoritative stored current register and durable export audit remain future work |
| Portfolios and crypto wallets | Holdings, valuations, history, verified-address flows and supported test-network transfers exist; unpriced shares do not imply a market valuation |
| Secondary trading | Code and client screens exist, but trading action/event route prefixes remain disabled by default pending hardening |
| Mobile | Wallets, portfolio, company/token screens, eligibility and supporting-document flows exist; native security needs a Ledova build, with separate device acceptance checks |
| Fiat conversion | An optional on-ramp integration exists; there is no off-ramp |

The [roadmap](roadmap.md) records remaining outcomes and the scheduled mobile
investor work. A feature flag or configured provider does not establish safety
or regulatory compliance.

## Terms that must stay distinct

- A **share class** is an issuer's equity instrument. A generic **asset** is a
  tracked coin/token; a **settlement asset** is an approved payment token.
- **Authorized shares** are the issuance cap; **issued shares** are the minted
  supply. The [issuance reference](architecture/contracts-and-issuance.md)
  explains the historical API names.
- **Eligibility** concerns whether an investor qualifies for an offering.
  The on-chain **whitelist** determines which addresses can receive share tokens.
- The **directory** advertises share classes offered to eligible investors.
  The secondary **market** concerns trading existing shares. Neither is a list
  of investors.
- **Payment received**, **allotted**, **broadcast**, **confirmed** and **finalized**
  are separate states. An accepted broadcast is not evidence of mining; receipt
  evidence does not itself establish finality.

Next: [system architecture](architecture/README.md), [local setup](getting-started.md),
and the [reasons behind product choices](decisions.md).
