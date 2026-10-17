# Operator console

[Operations](README.md) · [Documentation](../README.md)

How platform staff configure the operator record, read the operator console and the market pages,
seed reference data, and work the review queues that remain staff work. It is for platform staff
and whoever runs an instance. Company decisions are company-run through appointments
([how a company decision works](../business/README.md#how-a-company-decision-works)); the
demonstration data is described under [demo data](../getting-started.md#demo-data).

The operator record is a singleton that represents the platform operator organisation and its
technical configuration; staff accounts are individual people working within their granted
permissions. Neither makes an employee a company-appointed register administrator or director. The
console's Company registers card still names the operator as the keeper of each active company's
register; that is a legacy label, not the allocation of the register to the company and its
appointees, and it does not decide who carries the section 168 obligation.

## Operator configuration

Enter through `/admin/operators/operator/`. It creates the singleton if missing and opens the
console, with a link to `/admin/operators/operator/1/change/`. Opening the change URL alone on a
fresh installation redirects to the admin index. `GET /api/operator/` also creates the row lazily,
using `OPERATOR_NAME`. The console needs the operator's view or change permission, as the
configuration page does; any other staff member gets the admin's refusal and nothing is created.
Adding the row by hand also needs the add permission, and the row cannot be deleted.

| Admin section | Fields |
| --- | --- |
| Identity | `name`, `legal_name`, `abn`, `contact_email`, `website` |
| Payments | `bank_account_name`, `bank_bsb`, `bank_account_number`, `payment_reference_prefix`, `receiving_wallet_address`, `receiving_wallet_chain`, `issued_stablecoin`, `supported_settlement_assets` |
| Eligibility | `investor_kyc_required` (default on), `issuer_kyc_required` (default off) |

The model normalises the ABN, the BSB and the EVM receiving address. The payment-reference prefix
is 2 to 10 letters or digits, uppercased, leaving room for an eight-character code within the
18-character reference limit.

The bank-transfer and stablecoin payment instructions and staff-attested subscription receipts are
retained controls; new integrated AUD payment work is deferred
([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)).
Externally arranged capital is recorded by the company under
[external allotments](../business/issuing-shares.md#external-investor-allotments).

Settlement assets must be stablecoins with an active contract deployment on
`receiving_wallet_chain`; the form refuses any other. Order creation needs exactly one active,
deployed asset in `supported_settlement_assets`: with none or several, order messages and
executions are refused until the list holds one, and every created order records that asset.

What the flags require is in [account readiness](../business/participants.md#account-readiness)
(`investor_kyc_required`) and the
[representative identity requirement](../business/companies.md#representative-identity-requirement)
(`issuer_kyc_required`). Turn on `issuer_kyc_required` only with a
[KYC provider configured](configuration.md#identity-verification-providers).

The authenticated operator API (`GET /api/operator/`) exposes the identity, settlement assets,
eligibility flags and `paymentInstructions`. Payment instructions are non-null only for staff or
for investors eligible with at least one company; anonymous requests get 401. Configure the payment
fields and investor eligibility together.

## The operator console

The configuration health strip checks the operator's identity fields, `SHARE_TOKEN_FACTORY_ADDRESS`,
the payment-reference prefix and the settlement deployments before an offering opens. An empty
settlement asset set is reported; it leaves only bank-transfer payment available.

The worklists count company applications waiting, investor classifications awaiting verification,
offerings awaiting review and offerings at their cap and still open, subscriptions awaiting
payment, paid and not allotted, or with an unresolved mint, pending whitelist approvals, whitelist
entries needing [holder standing review](recovery.md#holder-standing-review),
share issuance and capital increase requests needing attention, share classes stuck deploying, and
two register identity queues. Each opens the matching admin list. They read the database without
contacting RPC providers.

The two register identity queues count completed allotment addresses, using current whitelist and
profile identity: addresses with two wallets, so no member can be named, and addresses with no
member behind them. They can include former holders and miss transfer-only holders or identities
available only from a retained stamp, so they are not a complete register audit. Both open the
unfiltered whitelist changelist, because missing entries cannot be represented by a filter. Use the
company's register view to locate the address, then resolve duplicates or link the correct named
wallet ([register identity](../business/register.md#members-holder-types-and-identity)).

### The market

The console's Orders and Settlements buttons open the admin's transfer orders and swap orders, and
the Order submissions admin page lists every signed request to place an order, refused ones
included. All three are read-only, because an order changes only through its owner's signed actions
and the worker. An order links to its share class, owner, wallet, signed actions and settlements; a
settlement links to both orders and shows the relayed transaction with its status, block and the
participants' approvals. The admin runs on the operator connection, so these pages show every
trader's records; like the worklists, they read only the database.

## Seeding reference data

From `backend/`, the Compose `migrate` service runs the following; run them once when starting
outside Docker too:

```sh
python manage.py migrate --noinput
python manage.py check_rls_roles
python manage.py sync_monitoring_rules
python manage.py sync_procedure_templates
python manage.py asset_sync --seed-only
python manage.py admit_local_signer
```

The last command admits the operator signer for the local chain (31337) and refuses any other
chain id; outside Docker, run it only when the backend points at a local chain
([local chain admission](../engineering/chain.md#local-chain-admission)). The seed
commands are idempotent. `sync_monitoring_rules` seeds the monitoring rules, whose amounts are AUD;
without them no rule raises an alert. `sync_procedure_templates` seeds the alert procedure
templates. The public compliance seed is not a deployment's private monitoring policy. Run them
before the demo seed, whose alerts link to the monitoring rules when they exist.

`asset_sync --seed-only` upserts the supported assets and their chain deployments and touches no
network; without it, supported native assets stay unverified and unpriced. It preserves disabled
deployments and existing native contract and decimal settings. Invalid native configuration stays
unavailable until repaired; a missing or unavailable deployment is not a zero balance. An empty
`STABLECOIN_CONTRACT_ADDRESS` does not erase an existing AUDY deployment
([asset identity](../engineering/chain.md#asset-identity-and-allowlisting)).

## Staff review queues

The Document operations group is created empty. Assign only the active platform staff who need
evidence review: it grants view permissions on documents, extractions and investor
classifications, not classification approval or editing. Company owners and accounts with company
roles cannot use cross-customer document review even with document permissions.
[Read audit](../engineering/security.md#read-audit) explains the review permissions and audit
writes. Attached payslips supplement human review; extraction never
verifies a claim.

Staff keep the technical controls on companies (warning, suspension, delisting, registry retry,
resolving a warning and reinstatement) described under
[staff registry controls](../business/companies.md#staff-registry-controls). Offering review,
recorded payments and the publishing, output and company-pack procedures that staff perform on a
company's written instruction are described with their business process:
[offerings](../business/issuing-shares.md#offerings),
[publishing to members](../business/publications.md#publishing-on-the-companys-instruction),
[notice figures](../business/member-records.md#preparing-notice-figures),
[the due list](../business/member-records.md#working-the-due-list) and
[the company pack](../business/member-records.md#producing-the-broader-pack-in-admin).
The holder standing queue is worked under
[recovery](recovery.md#holder-standing-review).

Next: [recovery](recovery.md), [configuration](configuration.md)
or [demo data](../getting-started.md#demo-data).
