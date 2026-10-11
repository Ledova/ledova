# Operator setup and daily work

[Operations](README.md) · [Documentation](../README.md)

This guide describes the operator record's configuration, the console and the
demo data. Register decisions are company-run under the
[company-managed register plan](../architecture/company-managed-registers.md);
the staff workflows below are the ones that remain.

The singleton represents the platform operator organisation and its technical
configuration; staff accounts are individual people working within its granted
permissions. Neither makes an employee a company-appointed register
administrator or director. The register worklist still labels active
companies with the operator's identity as keeper; that is a legacy label, not
the allocation to each company and its appointees.

## Operator configuration

Enter through `/admin/operators/operator/`. It creates the singleton if missing
and opens the console, with a link to `/admin/operators/operator/1/change/`.
Opening the change URL alone on a fresh installation redirects to the admin index.
`GET /api/operator/` also creates the row lazily, using `OPERATOR_NAME` when needed.
The console needs the operator's view or change permission, as the configuration
page does; any other staff member gets the admin's refusal, and nothing is created.
Adding the row by hand also needs the add permission. In the demo data the
operations officer and the superuser can open the console.

| Admin section | Fields                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | `name`, `legal_name`, `abn`, `contact_email`, `website`                                                                                                                                      |
| Payments      | `bank_account_name`, `bank_bsb`, `bank_account_number`, `payment_reference_prefix`, `receiving_wallet_address`, `receiving_wallet_chain`, `issued_stablecoin`, `supported_settlement_assets` |
| Eligibility   | `investor_kyc_required` (default on), `issuer_kyc_required` (default off)                                                                                                                    |

The model normalizes ABN, BSB and the EVM receiving address. The payment-reference
prefix is **2–10 letters or digits**, uppercased, leaving room for an eight-character
code within the 18-character reference limit.

The existing bank-transfer and stablecoin payment instructions and staff-attested
subscription receipts are retained controls; new integrated AUD payment work is
deferred ([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)).
Externally arranged capital is recorded under
[external allotments](../plans/company-managed-registers/external-allotments.md).

Settlement assets must be stablecoins with an active contract deployment on
`receiving_wallet_chain`. The resolver is `operators/settlement.py`; do not use
`Asset.contract_address`, which can select another chain's deployment. Order
creation needs exactly one active, deployed asset in `supported_settlement_assets`:
with none or several configured, order messages and executions are refused until
the list holds one, and every created order records that asset.

`investor_kyc_required` is enforced by investor/account eligibility.
`issuer_kyc_required` requires a company representative's identity to be
verified: it gates initial self-declaration admission and invitation
acceptance, company activation, and every company decision made through an
appointment, including register commands
(`tokens/services/register_authority.py`) and eligibility decisions
(`users/services/company_eligibility.py`). Staff technical recovery of a
company is not affected. Turn it on only with a KYC provider configured
([integrations](integrations.md#kyc-providers)): a representative becomes
verified only through the provider, so with none configured every company
decision is refused. Supporting payslips and classification evidence are
available on every instance under the same private-access and retention
controls; company appointees decide eligibility
([company eligibility](../plans/company-managed-registers/company-eligibility.md)).
See [eligibility](../architecture/companies-and-eligibility.md) and
[file retention](../architecture/files-and-retention.md).

The authenticated operator API exposes identity, settlement
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
without contacting RPC providers.

The two register queues count **completed allotment addresses**, using current
whitelist/profile identity. They can include former holders and miss transfer-only
holders or identities available only from a retained stamp. They are not a complete
register audit. Both open the unfiltered whitelist changelist because
missing entries cannot be represented by a filter. Use the company's register view
to locate the address, then resolve duplicates or link/add the correct named wallet.
See [register identity](../architecture/register.md).

### The market

The console's **Orders** and **Settlements** buttons open the admin's transfer
orders and swap orders, and **Order submissions** lists every signed request to
place an order, refused ones included. They show the whole market read-only,
because an order changes only through its owner's signed actions and the
worker. An order links to its share class, owner, wallet, signed actions and
settlements; a settlement links to both orders and shows the relayed
transaction with its status, block and the participants' approvals. The admin
runs on the operator connection, so these pages show every trader's records;
like the worklists, they read only the database.

## Seeding

From `backend/`, the Compose migration service runs the following. Run them once
when starting outside Docker too:

```sh
python manage.py migrate --noinput
python manage.py check_rls_roles
python manage.py sync_monitoring_rules
python manage.py sync_procedure_templates
python manage.py asset_sync --seed-only
python manage.py admit_local_signer
```

The last command admits the operator signer for the local chain (31337) and
refuses any other chain id; outside Docker, run it only when the backend points
at a local chain. See [local chain admission](../architecture/outgoing-signing.md#local-chain-admission).
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
two `ledova.io` addresses on an environment before seeding it.

The first run on a database also adds a synthetic population with six months of
history. A fixed random seed generates it, so every fresh database gets the same
people, companies and amounts, dated relative to the day of the run. The
modules under [`backend/shared/seeds/synthetic/`](../../backend/shared/seeds/synthetic/)
are the description of record: `reference.py` (countries, the operator's blank
identity fields with an eleven-zero ABN, six months of BTC, ETH, USDC and USDT
prices and a USD to AUD rate), `staff.py` (a compliance officer, a document
reviewer in the "Document operations" group, an operations officer and a
deactivated former staff member), `people.py` and `identities.py` (60
investors unless `--investors` asks for at least 20, in every signup, identity,
standing and classification state, with wallets on Base, Ethereum and Bitcoin
testnet, transactions, holdings, inactive device tokens, notifications and
payslips), `companies.py` (Demo Robotics and two more active companies with
verified documents, officeholder attestation and a passed ABR check from a
synthetic observation, one company with information requested and one
submitted), `eligibility.py` (company eligibility decisions) and
`alerts.py` (alerts in every status, one with a suspicious matter report, with
AUD amounts the rules compare and activation dates that make only customers in
their first 30 days new).

The testers get the richest data. The founder's wallet is development account 0
of the public test mnemonic, which is also the operator's signer, and the
investor has seven wallets on the three networks: development accounts 1 to 4 of
the same mnemonic and two Bitcoin testnet addresses. The investor has a
classification history, payslips, and more than a page of notifications and
wallet activity; the founder has a full profile and Demo Robotics' review history.

A later run finds the population, adds nothing and says so. To start over, run
`make dev-clean`, then `make dev-up` and `make dev-seed`. Synthetic people use
`@demo.ledova.test` addresses, ACMA fictional phone numbers and made-up addresses;
the companies use ACNs in the unissued 9xx range with matching ABNs; wallet keys
come from a namespaced hash, except the testers' development accounts of the
public test mnemonic. The seed sends nothing and queues no job: no email, push
notification, identity check or ABR lookup.

The chain layer ([`seeds/synthetic/chain/`](../../backend/shared/seeds/synthetic/chain/))
and the market layer ([`seeds/synthetic/market/`](../../backend/shared/seeds/synthetic/market/))
are retained code, and on a fresh database both report `skipped` with the
reason printed. Without a reachable local chain the chain layer says to get
one; with one, the issuance plan it builds includes the companies' employee
share trust addresses, which have no held signing key, and fresh treasury
approval is unsupported, so no chain records or transactions are added. The
market layer runs only after a present chain layer. What the first run writes
today is the database population above, and that population is what a fresh
seed claims; the layers' earlier output is historical evidence, not a fresh-seed
claim. A run that stopped part-way says to start over.

Wallet balances follow the worker's hourly sync wherever it can read a chain: on
the local chain a synthetic wallet reads zero and a development account its test
ether. Ethereum and Bitcoin wallets keep their seeded balances while
`ALCHEMY_ETH_URL` and `ALCHEMY_BTC_URL` are empty, and the worker logs a warning
for each of them every hour; with those set, the sync reads the public testnets
and replaces the seeded balances with what the wallets hold there, normally
nothing. Unattached payslips are purged 30 days after upload, as in production,
so the seeded ones, uploaded up to 26 days before the run, disappear over the
following weeks; a rerun does not bring them back.

## Company and document review

[Registry integration](integrations.md#company-registry-verification) owns ABR
configuration and the approval/recovery procedure. [File access](../architecture/files-and-retention.md)
explains document review permissions and audit writes. The Document operations
group is initially empty: assign only the active platform staff who need evidence
review; it grants view permissions, not classification approval or editing.
Company owners and accounts with company roles cannot use cross-customer document
review even with document permissions. Attached payslips supplement human review;
extraction never verifies a claim.

## Transaction monitoring

`sync_monitoring_rules` seeds the rules; amounts are AUD. What the rules compare
and when a customer counts as new is under
[transaction monitoring](../architecture/wallets-and-valuations.md#transaction-monitoring).
