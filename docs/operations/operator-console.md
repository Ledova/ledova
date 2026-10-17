# Operator console

[Operations](README.md) · [Documentation](../README.md)

How platform staff configure the operator record, read the operator console and the market pages,
seed reference data and work the review queues that remain staff work. It is for platform staff
and whoever runs an instance.

The operator record is a singleton for the platform operator organisation and its technical
configuration; staff accounts are people working within their granted permissions. Neither makes an
employee a company appointee. The console's Company registers card still names the operator as the
keeper of each active company's register: a legacy label that neither allocates the register nor
decides who carries the section 168 obligation.

## Operator configuration

Enter through `/admin/operators/operator/`, which creates the singleton if missing and opens the
console, with a link to `/admin/operators/operator/1/change/`; the change URL alone on a fresh
installation redirects to the admin index. `GET /api/operator/` also creates the row lazily, using
`OPERATOR_NAME`. The console needs the operator's view or change permission, as the configuration
page does; other staff get the admin's refusal and nothing is created. Adding the row by hand also
needs the add permission, and the row cannot be deleted.

| Admin section | Fields                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | `name`, `legal_name`, `abn`, `contact_email`, `website`                                                                                                                                      |
| Payments      | `bank_account_name`, `bank_bsb`, `bank_account_number`, `payment_reference_prefix`, `receiving_wallet_address`, `receiving_wallet_chain`, `issued_stablecoin`, `supported_settlement_assets` |
| Eligibility   | `investor_kyc_required` (default on), `issuer_kyc_required` (default off)                                                                                                                    |

The model normalises the ABN, the BSB and the EVM receiving address. The payment-reference prefix
is 2 to 10 letters or digits, uppercased, leaving room for an eight-character code within the
18-character reference limit.

The bank-transfer and stablecoin payment instructions and staff-attested subscription receipts are
retained controls; new integrated AUD payment work is deferred
([9 October decision](../decisions.md#essential-registry-and-development-workflow-priority)).
Externally arranged capital is recorded by the company as an
[external allotment](../business/issuing-shares.md#external-investor-allotments).

Settlement assets must be stablecoins with an active contract deployment on
`receiving_wallet_chain`; the form refuses any other. Order creation needs exactly one active,
deployed asset in `supported_settlement_assets`: with none or several, order messages and
executions are refused until the list holds one, and every created order records that asset.

What the flags require is in [account readiness](../business/participants.md#account-readiness)
(`investor_kyc_required`) and the
[representative identity requirement](../business/companies.md#representative-identity-requirement)
(`issuer_kyc_required`). Turn on `issuer_kyc_required` only with a
[KYC provider configured](configuration.md#identity-verification-providers).

`GET /api/operator/` returns `paymentInstructions` as null except to staff and to holders of a
current secondary-market eligibility decision from at least one company, and 401 to anonymous
requests, so configure the payment fields and investor eligibility together.

## The operator console

The configuration health strip checks the operator's identity fields, `SHARE_TOKEN_FACTORY_ADDRESS`,
the payment-reference prefix and the settlement deployments before an offering opens. An empty
settlement asset set is reported, leaving only bank-transfer payment.

The worklists count company applications waiting, investor classifications awaiting verification,
offerings awaiting review and offerings at their cap and still open, subscriptions awaiting
payment, paid and not allotted, or with an unresolved mint, pending whitelist approvals, whitelist
entries needing [holder standing review](#holder-standing-review),
share issuance and capital increase requests needing attention, share classes stuck deploying, and
two register identity queues. Each opens the matching admin list and reads the database without
contacting RPC providers.

The two register identity queues count completed allotment addresses by current whitelist and
profile identity: addresses with two wallets, so no member can be named, and addresses with no
member behind them. They can include former holders and miss transfer-only holders or identities
only a retained stamp holds, so they are not a complete register audit. Both open the unfiltered
whitelist changelist, since a filter cannot show missing entries. Locate the address in the
company's register view, then resolve duplicates or link the correct named wallet
([register identity](../business/register.md#members-holder-types-and-identity)).

### The market

The console's Orders and Settlements buttons open the admin's transfer orders and swap orders, and
the Order submissions page lists every signed request to place an order, refused ones included.
All three are read-only: an order changes only through its owner's signed actions and the worker.
An order links to its share class, owner, wallet, signed actions and settlements; a settlement links
to both orders and shows the relayed transaction with its status, block and the participants'
approvals. Running on the operator connection, these pages show every trader's records, read from
the database only.

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
([local chain admission](../engineering/chain.md#local-chain-admission)). The seed commands are
idempotent. `sync_monitoring_rules` seeds the monitoring rules, whose amounts are AUD; without them
no rule raises an alert. `sync_procedure_templates` seeds the alert procedure templates. The public
compliance seed is not a deployment's private monitoring policy. Run them before the demo seed,
whose alerts link to the monitoring rules when they exist.

`asset_sync --seed-only` upserts the supported assets and their chain deployments and touches no
network; without it, supported native assets stay unverified and unpriced. It preserves disabled
deployments and existing native contract and decimal settings. Invalid native configuration stays
unavailable until repaired; a missing or unavailable deployment is not a zero balance. An empty
`STABLECOIN_CONTRACT_ADDRESS` does not erase an existing AUDY deployment
([asset identity](../engineering/chain.md#asset-identity-and-allowlisting)).

## Staff review queues

The business tasks staff still perform, with their procedures, are listed under
[who does what](../business/README.md#who-does-what).

The Document operations group is created empty. Assign only the active platform staff who need
evidence review: it grants view permissions on documents, extractions and investor
classifications, not classification approval or editing. Company owners and accounts with company
roles cannot use cross-customer document review even with document permissions.
[Read audit](../engineering/security.md#read-audit) explains the review permissions and audit
writes. Attached payslips supplement human review; extraction never verifies a claim.

### Holder standing review

The console's Whitelist entries needing holder standing review counts investor accounts with an
inactive login, or a rejected, suspended or terminated investment standing, that still hold a live
or uncertain company approval, each once, from the last observation and without reading the chain;
the approval inline keeps the last observed company status and expiry. A removed or expired
approval stays listed while a live company decision remains and standing is not refused, so inspect
the company and current eligibility before acting; the worklist authorises nothing.
Self-deletion disables login and keeps evidence without terminating the account or revoking an
approval: review the account and decisions, record the staff decision, then use the attributed
refresh or the company's removal. Treasury and company-only accounts are outside this queue.

Next: [recovery](recovery.md), [configuration](configuration.md)
or [demo data](../getting-started.md#demo-data).
