# Operator setup and daily work

[Operations](README.md) · [Documentation](../README.md)

## Operator configuration

Enter through `/admin/operators/operator/`. It creates the singleton if missing
and opens the console, with a link to `/admin/operators/operator/1/change/`.
Opening the change URL alone on a fresh installation redirects to the admin index.
`GET /api/operator/` also creates the row lazily, using `OPERATOR_NAME` when needed.

| Admin section | Fields |
| --- | --- |
| Identity | `name`, `legal_name`, `abn`, `contact_email`, `website` |
| Deployment | `deployment_mode`: `registry` (default) or `single_issuer` |
| Payments | `bank_account_name`, `bank_bsb`, `bank_account_number`, `payment_reference_prefix`, `receiving_wallet_address`, `receiving_wallet_chain`, `issued_stablecoin`, `supported_settlement_assets` |
| Eligibility | `investor_kyc_required` (default on), `issuer_kyc_required` (default off) |

The model normalizes ABN, BSB and the EVM receiving address. The payment-reference
prefix is **2–10 letters or digits**, uppercased, leaving room for an eight-character
code within the 18-character reference limit.

Settlement assets must be stablecoins with an active contract deployment on
`receiving_wallet_chain`. The resolver is `operators/settlement.py`; do not use
`Asset.contract_address`, which can select another chain's deployment. Order
creation needs exactly one active, deployed asset in `supported_settlement_assets`:
with none or several configured, order messages and executions are refused until
the list holds one, and every created order records that asset.

`investor_kyc_required` is enforced by investor/account eligibility.
`issuer_kyc_required` stops an owner whose identity is unverified from submitting
a company for review, and stops staff from activating it once approved. Resolving
a warning and reinstating are not affected. Turn it on only with a KYC provider
configured ([integrations](integrations.md#kyc-providers)): an owner becomes
verified only through the provider, so with none configured every submission is
refused.
Single-issuer mode disables the supporting-payslip store; switching is refused
while unpurged payslips exist. Classification evidence and review remain available.
See [eligibility](../architecture/companies-and-eligibility.md) and
[file retention](../architecture/files-and-retention.md).

The authenticated operator API exposes identity, deployment mode, settlement
assets, eligibility flags and `paymentInstructions`. Payment instructions are
non-null only for staff or investors eligible for at least one company. Anonymous
requests receive 401. Configure payment fields and investor eligibility together.

## The operator console

The health strip checks operator identity, the factory address, reference
prefix and settlement deployments before an offering opens. An empty settlement
asset set is reported; it leaves only bank-transfer payment available.

Worklists cover company and classification reviews, offering review/capacity,
unpaid/paid/unresolved-mint subscriptions, pending company approvals, issuance and capital
requests, stale deployments and register identity problems. They read the database
without contacting RPC providers. The page also states deployment mode and who
keeps each active company's register; it does not assign the legal obligation.

The two register queues count **completed allotment addresses**, using current
whitelist/profile identity. They can include former holders and miss transfer-only
holders or identities available only from a retained stamp. They are not a complete
register audit. Both open the unfiltered whitelist changelist because
missing entries cannot be represented by a filter. Use the issuer's register view
to locate the address, then resolve duplicates or link/add the correct named wallet.
See [register identity](../architecture/register.md).

## Seeding

From `backend/`, the Compose migration service runs the following. Run them once
when starting outside Docker too:

```sh
python manage.py migrate --noinput
python manage.py check_rls_roles
python manage.py sync_monitoring_rules
python manage.py sync_procedure_templates
python manage.py asset_sync --seed-only
```

The seed commands are idempotent. Missing monitoring seeds leave no rules to raise
alerts; missing asset seeds leave supported native assets unverified/unpriced.
`--seed-only` touches no network. The public compliance seed is not a deployment's
private monitoring policy. Run them before [demo data](#demo-data): the demo's
alerts link to the monitoring rules when they exist.

Asset seeding preserves disabled deployments and existing native contract/decimal
settings. Invalid native configuration stays unavailable until repaired; a missing
or unavailable deployment is not a zero balance. An empty stablecoin address setting
does not erase an existing AUDY deployment. See [asset identity and pricing](../architecture/wallets-and-valuations.md).

## Demo data

From `backend/`, `python manage.py seed_demo` creates a browser-ready local demo. It
requires DEBUG; `--force` is only for a throwaway database deliberately running
without DEBUG. It is never part of the Compose migration chain. `make dev-seed`
runs it in the Compose stack: it stops the worker first, so no periodic job acts
on rows the seed is still writing, and starts it again afterwards, also when the
seed fails.

The password comes from `--password`, `LEDOVA_DEMO_PASSWORD`, or a generated value
printed by the command. Every run applies the resolved password to every seeded
account: the testers, the synthetic staff and the synthetic people.

Every run refreshes the tester accounts. The investor and founder are
`investor@ledova.io` and `founder@ledova.io`; the superuser is
`admin@demo.ledova.test`. The command adopts any existing account at
those addresses and resets its password, active flag and email verification. For
the investor and founder it also overwrites the profile, role and status and adds
a verified wallet; the founder becomes the demo company's owner, and the investor
gets a verified classification and a whitelist entry. Check that nobody uses the
two `ledova.io` addresses on an environment before seeding it. A database seeded before the two
addresses moved from `demo.ledova.test` still has its demo company owned by
`founder@demo.ledova.test`, and the command refuses; rename the two accounts
first, then rerun it:

```bash
python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
User.objects.filter(email='founder@demo.ledova.test').update(email='founder@ledova.io')
User.objects.filter(email='investor@demo.ledova.test').update(email='investor@ledova.io')
"
```

The first run on a database also adds a synthetic population with six months of
history. A fixed random seed generates it, so every fresh database gets the same
people, companies and amounts, dated relative to the day of the run:

- Reference data: the countries in use; the operator's legal name, ABN and contact
  email where they are blank (the ABN is eleven zeros, obviously not real); daily
  prices for BTC, ETH, USDC and USDT over the six months; and a USD to AUD rate. The
  settlement asset is left unconfigured.
- Staff: a compliance officer, a document reviewer in the "Document operations"
  group and an operations officer, each with the model permissions their queues
  need, and a deactivated former staff member.
- Investors, 60 unless `--investors` asks for another number (at least 20), who
  joined at a growing rate. Most are verified, classified and active; others never
  confirmed their email, stopped part-way through signing up, are waiting for or
  failed an identity check, or were rejected, suspended or terminated. They carry
  risk assessments, financial profiles, wallets on Base, Ethereum and Bitcoin
  testnet (most verified with signatures over real challenges, some on
  Keystone-style hardware derivations), wallet transactions and holdings, device
  tokens, notifications, preferences, payslips with extraction results, and
  classification claims in every status and category.
- Companies: Demo Robotics and two more active companies, each with full details,
  every document type uploaded and verified by the document reviewer, an
  officeholder attestation and a passed ABR check recorded from a synthetic
  observation; one more company with information requested and one submitted for
  review.
- Compliance work: alerts in every status and several types, most closed with an
  outcome, one with a suspicious matter report.

The testers get the richest data. The investor has seven wallets on the three
networks (Hardhat development accounts 1 to 4 and two Bitcoin testnet wallets), a
classification history, payslips, and more than a page of notifications and
wallet activity. The founder has a full profile and Demo Robotics' review history.

A later run finds the population, adds nothing and says so. To start over, run
`make dev-clean`, then `make dev-up` and `make dev-seed`. Synthetic people use
`@demo.ledova.test` addresses, ACMA fictional phone numbers and made-up addresses;
the companies use ACNs in the unissued 9xx range with matching ABNs; wallet keys
come from a namespaced hash, except the testers' public Hardhat development
accounts. The seed sends nothing and queues no job: no email, push notification,
identity check or ABR lookup.

It writes no chain transactions. The investor's whitelist entry is an identity
row with no company approval; [chain setup](chains.md), deploying the class and
approving the wallet for the company are still needed.
The testers' primary wallet addresses are Hardhat accounts 0 and 1. Once the
configured chain answers, the worker's hourly wallet sync replaces the seeded
Base balances with what the chain reports.

## Company and document review

[Registry integration](integrations.md#company-registry-verification) owns ABR
configuration and the approval/recovery procedure. [File access](../architecture/files-and-retention.md)
explains document review permissions and audit writes. The Document operations
group is initially empty: assign only the active platform staff who need evidence
review; it grants view permissions, not classification approval or editing.
Company owners and accounts with company roles cannot use cross-customer document
review even with document permissions. Attached payslips supplement human review;
extraction never verifies a claim.
