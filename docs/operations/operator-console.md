# Operator setup and daily work

[Operations](README.md) · [Documentation](../README.md)

This guide describes the current implementation. The accepted
[company-managed register plan](../architecture/company-managed-registers.md)
retires routine platform-staff register gates as replacement company tools are
implemented. Product-mode selection is already removed; the remaining
configuration and staff workflows below describe current behaviour.

The [product priority](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)
is the private-company share register and share workflows. Crypto on-ramp
purchases are optional personal investor activity; company purchases must be
refused, with the current restriction gap tracked in
[#920](https://github.com/Ledova/ledova/issues/920). This does not remove company
share-wallet operations or their authority, execution and recovery safeguards.

The singleton represents the platform operator organisation and its technical
configuration; staff accounts are individual people working within its granted
permissions. Neither makes an employee a company-appointed register
administrator or director. The current register worklist labels active
companies with the operator's identity as keeper. That reflects the legacy
staff-operated allocation, not the target allocation to each company and its
appointed users. Private hosting does not require a separate product mode.

## Operator configuration

Enter through `/admin/operators/operator/`. It creates the singleton if missing
and opens the console, with a link to `/admin/operators/operator/1/change/`.
Opening the change URL alone on a fresh installation redirects to the admin index.
`GET /api/operator/` also creates the row lazily, using `OPERATOR_NAME` when needed.
The console needs the operator's view or change permission, as the configuration
page does; any other staff member gets the admin's refusal, and nothing is created.
Adding the row by hand also needs the add permission. In the demo data the
operations officer and the superuser can open the console.

| Admin section | Fields |
| --- | --- |
| Identity | `name`, `legal_name`, `abn`, `contact_email`, `website` |
| Payments | `bank_account_name`, `bank_bsb`, `bank_account_number`, `payment_reference_prefix`, `receiving_wallet_address`, `receiving_wallet_chain`, `issued_stablecoin`, `supported_settlement_assets` |
| Eligibility | `investor_kyc_required` (default on), `issuer_kyc_required` (default off) |

The model normalizes ABN, BSB and the EVM receiving address. The payment-reference
prefix is **2–10 letters or digits**, uppercased, leaving room for an eight-character
code within the 18-character reference limit.

The current operator bank-transfer and stablecoin payment instructions and
staff-attested subscription receipts remain implementation details. AUD must be
a valid payment option for share purchases, rather than only a price currency or
AUDY settlement asset. Company-managed primary payments belong to
[#868](https://github.com/Ledova/ledova/issues/868); secondary payment and
settlement work belongs to [#869](https://github.com/Ledova/ledova/issues/869).
The new rail/provider, verification, reconciliation, refund and secondary
settlement design are not yet chosen; existing operator settings do not decide
them or authorise a live service.

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
Supporting payslips, classification evidence and review are available on every
instance under the same private-access and retention controls. The legacy mode
field and evidence-only restrictions are
[removed](upgrades.md#one-registry-product); no hosting or capability flag replaces them.
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
without contacting RPC providers. The page also states who keeps each active
company's register; it does not assign the legal obligation. Company keeper
attribution remains part of the planned register-authority transition.

The two register queues count **completed allotment addresses**, using current
whitelist/profile identity. They can include former holders and miss transfer-only
holders or identities available only from a retained stamp. They are not a complete
register audit. Both open the unfiltered whitelist changelist because
missing entries cannot be represented by a filter. Use the issuer's register view
to locate the address, then resolve duplicates or link/add the correct named wallet.
See [register identity](../architecture/register.md).

### The market

The console's **Orders** and **Settlements** buttons open the admin's transfer
orders and swap orders, and appear only to a staff member allowed to view them.
With **Order submissions**, every signed request to place an order, refused ones
included with the reason, they show the whole market read-only: no one can add,
change or delete a row on these pages, whatever their permissions, because an
order changes only through its owner's signed actions and the worker. An order
links to its share class, owner, wallet, signed admission, cancel and modify
actions and settlements. A settlement links to both orders, their wallets and
their owners, and shows the relayed transaction with its status and block, and
the participants' approvals. The admin runs on the operator connection, so these
pages show every trader's records, which row-level security keeps from everyone
else. Like the worklists, they read only the database.

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
  settlement asset is left to the chain layer below.
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
  tokens (all inactive, so the worker never pushes to them), notifications,
  preferences, payslips with extraction results, and classification claims in
  every status and category.
- Companies: Demo Robotics and two more active companies, each with full details,
  every document type uploaded and verified by the document reviewer, an
  officeholder attestation and a passed ABR check recorded from a synthetic
  observation; one more company with information requested and one submitted for
  review.
- Compliance work: alerts in every status and several types, most closed with an
  outcome, one with a suspicious matter report. Their amounts are the AUD values
  the rules compare, and each account that was ever active is dated from its
  identity check, so only customers in their first 30 days count as new.

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

When the local chain is configured, the first run on a database then adds a
chain layer: chain id 31337 answering at `BLOCKCHAIN_RPC_URL` with the core
contracts deployed and the operator signer admitted, as in the stack
`make dev-up` starts ([its chain](chains.md#the-local-stacks-chain)). The layer
signs and sends real transactions there, about 130 in under a minute, one at a
time, and calls each service and the task the worker would have run, so the
worker stays stopped and no job is queued. Without such a chain it writes
nothing to any chain and prints why, and a later `make dev-seed` adds it. It
likewise leaves alone an operator already set to settle in anything but AUDY on
Base, and names the fields to clear. Like the population it runs once per
database: a later run says it is present, and a run that stopped part-way, a
balance the node would not set included, says to start over. It adds:

- Settlement: AUDY becomes the operator's settlement asset on Base, with a
  receiving wallet and its par price, so payment instructions show both rails and
  every health check above passes.
- Share classes: Demo Robotics' ordinary and seed preference shares, Wattlefield's
  and Coralgum's ordinary shares and Coralgum's convertible preference shares,
  deployed with their share assets, the last paused afterwards by its issuer; and
  two drafts, Demo Robotics' Series A preference shares and Saltbush's ordinary
  shares.
- Approvals: each Base wallet that holds shares, or whose application reached a
  payment instruction, is approved for its company until the expiry the
  classification refresh would set, that is the latest expiry of the holder's
  live claims, to the second, or none; the founders' wallets and the employee
  share trusts' addresses never expire. No suspended, terminated or rejected
  account is approved.
- Registers: each company's existing register (founders, directors, an employee
  share trust held at a custodian address with no key behind it, and investors
  from earlier rounds) is issued on chain through issuance requests that one
  applied register instruction approves, and each closed offering is allotted.
  Each class's register is then opened from the chain by a company-run opening,
  its particulars are imported with names, dates entered back to the founding,
  amounts paid and a few pre-platform former members, and it is reconciled with
  the chain and folded. Every opened register has at least ten members and no
  effect waiting.
- Offerings in every status: three closed and allotted, one of them scaled back
  with the excess refunded; one open and close to its cap; one approved to open
  twelve days after the run; one submitted, one under review, one draft, one
  rejected and one withdrawn, all priced in AUD and made under section 708
  exemptions, except Wattlefield's, which are for wholesale clients under section
  761G. About 60 applications on both rails cover every application status, with
  references from the operator's prefix and payment due dates still ahead. Each
  offering carries an information memorandum generated from its own terms,
  verified by the document reviewer when the round was approved, and its
  company's risk disclosure statement; eligible investors open those of the
  approved and closed rounds from the Directory.
- Issuance requests submitted, under review, approved, rejected and executed (a
  top-up of Demo Robotics' employee share trust after its register opened, which
  the register records under its instruction), and capital increases executed
  (raising Demo Robotics' authorised shares), submitted, rejected and draft.

Database-only steps (offerings, applications up to payment, reviews) are dated
over the six months. Everything a chain transaction completes, from deployments
to allotments and register entries, carries the day of the run, so a register
opens that day and shows each member's imported date entered. The investor
tester holds four classes in three companies across development accounts 1, 2
and 4, two of them through allotted applications, and has applications awaiting
payment and paid; the founder's growth round, still open, has applications in
every status but allotted, and the founder's offerings together cover all nine.
The console's warning and information rows have work in them and its danger rows
stay at zero. No periodic job signs or removes anything, and none changes a
seeded row other than the founder's Base ether below: the registry sync and
refresh, reconciliation, fold, expiry and recovery jobs leave every seeded row
as it is.

Once the chain layer is present, the first run then adds a market layer on the
same chain, likewise once per database with its own marker: a later run says it
is present, and one that stopped part-way says to start over. It skips, and says
why, when the chain is unreachable, when the operator settles in anything but
AUDY on Base, or when a deployed class has no code on the node. It signs about
40 more operator transactions and about 25 from the investors' own wallets,
whose keys the seed derives as it derived their addresses, through the services
and tasks the worker would run. It adds:

- AUDY deposits: one for each buyer, recorded and minted by the operations
  officer through the mint service to cover the buyer's bids, dated by the day
  the bank deposit arrived; two more recorded and not yet minted, and two
  rejected with their reason. Every AUDY holding matches the chain.
- An order book in each deployed class (Demo Robotics' ordinary and seed
  preference shares, Wattlefield's and Coralgum's ordinary shares): For sale and
  Wanted orders at several prices around the class's offering price, each signed
  by its wallet and dated over the eighteen days before the run. Some were
  cancelled by a signed cancellation, and three were matched and left unsigned
  until the match lapsed: the order that had been resting returned to the book
  and the one that took it was held back from the book. Two of those traders
  then cancelled; the third, a seed preference sale at the best bid, is still
  held back, because it crosses the bid it lapsed against and the sweep never
  pairs them again. Its trader sees it as Held Back, and the seed's summary
  names them.
- About 20 trades settled on the day of the run, each a signed order against a
  resting one, with the seller's and buyer's one-time approvals, both settlement
  signatures, the relayed swap and its finality; each class then shows a last
  price. One buyer is approved for the company first, and one buys an odd lot of
  eight shares.
- Registers: each company enters its first-time buyers' wallets as members under
  a reviewed wallet link and records the day's transfers under one applied
  transfer instruction per class, so every register reconciles matched with
  nothing waiting. Each deposit writes its recipient's AUDY holding and each
  settled trade the buyer's and the seller's share and AUDY holdings from the
  chain, as they do outside the seed, and each investor's ether goes back to its
  seeded balance after their approvals paid for gas.
- Notices to members: 27 publications across the four classes, each with the
  day of the run as its record date, because each register opened that day:
  holding statements; meeting notices; three dividends in AUD, recorded as paid
  to every member (each payment with generated evidence), to some, and to none
  yet, the last leaving the odd-lot holder less than a cent; and resolutions not
  yet open, open with and without ballots, and five circular resolutions put to
  the morning's members with a short voting window that closes during the run,
  two carried and three not. Members with an account get a notification, never a
  push or an email. The seed's own generated documents are the only files that
  skip the malware scan, so seeding does not wait for ClamAV.

The investor tester has an order in four of the statuses the market's panels
show (open, partially filled, filled and cancelled), sold Wattlefield shares,
bought seed preference shares into the Trading wallet, which held none, voted on
two resolutions with others waiting under Needs you, and has more than a page of
notices. One state is left out: a trade awaiting signatures lapses fifteen
minutes after its match (`SWAP_ORDER_EXPIRY_HOURS`), so it would expire before
anyone looked. The periodic jobs leave the market as it is: no match lapses, the
held order stays held, no resolution closes, nothing is signed and the wallet
sync reads the balances already recorded.

Wallet balances follow the worker's hourly sync wherever it can read a chain.
Base balances come from the local chain, so the chain layer sets each seeded
Base wallet's balance there to the ether its history leaves it, the investor
tester's development accounts 1, 2 and 4 included, and the sync keeps them.
Development account 0, the founder's wallet, is also the operator's signer, so
the layer leaves its test ether for the operator's gas, and the first sync
replaces the founder's seeded Base ether with that balance. Without the chain
layer a synthetic wallet reads zero there and a development account its test
ether.
Ethereum and Bitcoin wallets keep their seeded balances while `ALCHEMY_ETH_URL`
and `ALCHEMY_BTC_URL` are empty, and the worker logs a warning for each of them
every hour; with those set, the sync reads the public testnets and replaces the
seeded balances with what the wallets hold there, normally nothing. Unattached
payslips are purged 30 days after upload, as in production, so the seeded ones,
uploaded up to 26 days before the run, disappear over the following weeks; a
rerun does not bring them back.

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

The rules `sync_monitoring_rules` seeds state their amounts in AUD, and each is
compared with a transaction's AUD value: MON-001 at AUD 10,000; MON-003 for three
transactions of AUD 8,000 to 9,999 within 168 hours; MON-006 at AUD 10,000 for a
new customer without source-of-funds documents; MON-007 at AUD 50,000 within 30
days; MON-008 at AUD 5,000 after 90 days without activity; MON-009 against the
customer's 90-day average; and MON-010 for three multiples of AUD 5,000 within
30 days. The address rules, MON-004 and MON-005, screen a transaction of AUD
5,000 or more, and any transaction by a high-risk or new customer.

Each transaction is valued as it is recorded: the USD value is the amount at
the asset's USD price at the block time, and the AUD value is that converted at
the USD/AUD rate stored at that moment. A transfer sent from the app is recorded
before it is mined, so it is valued at the price and rate of the moment it is
sent; wallet sync later finds the same hash already recorded and skips it, so it
counts once. `sync_exchange_rates` refreshes the rate every 10 minutes, and the
per-transaction rules check only transactions whose block time is less than an
hour old, or that are not mined yet, so for them it is the rate in effect when
they happened. No USD/AUD history is kept. History imported
later, such as a newly verified wallet's past transfers, is converted at the
rate stored when it is imported, and migration `wallets/0023` converted the
transactions already recorded at the rate stored when it ran. An asset with an
AUD par, AUDY, is valued at par: 5,000 AUDY is AUD 5,000 whatever rate its USD
price was taken at. Any other transaction with no USD price, or recorded while
no rate was stored, has no AUD value, and no amount rule counts it.

The windows run on when a transaction happened: its block time, or for a
transfer not mined yet, when it was recorded. That holds for MON-002's hour,
MON-003's 168 hours, MON-007's and MON-010's 30 days, MON-009's 90-day baseline
and the previous transaction MON-008 measures inactivity from. So the history a
newly verified wallet imports counts when it happened, not as a burst of recent
activity.

A customer is new for 30 days after their account first became active. The
account records that moment once, whichever path activates it: the identity
check passing, staff changing its status in the admin, or the demo seed.
Suspending and reactivating it keeps the first date, and the admin shows the
date read-only. The database enforces it: an update can never clear the date or
move it later, so of two activations at the same moment the earlier stamp
stands. It can still move earlier, which is how the demo seed dates its testers
from their identity check. Migration `users/0029` dated the active, suspended and
terminated accounts that already existed from the earliest evidence of their
activation: the first automated risk assessment, which the identity check
completes as it activates the account, or the time the identity was verified.
It trusts that evidence only for a profile whose identity check is a completed
GREEN result, and leaves every other account undated, so it counts as new: one
activated by staff without an identity check, one activated on a result that
never completed (the KYCAID mapping once read any truthy `verified` as a pass),
or one whose check was reviewed again since. An undated active account is dated
the next time it is saved active, for example when staff edit it in the admin,
and counts as new for 30 days from then.
