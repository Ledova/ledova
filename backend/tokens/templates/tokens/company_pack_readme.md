{% load company_pack_text %}{% autoescape off %}# Company pack: {{ company.name|md }} (ACN {{ company.acn|md }})

## 1. What this is

This archive holds the records Ledova kept for {{ company.name|md }} as at {{ as_at }} (UTC). It was produced on the written instruction or compelling document referenced as "{{ instruction|md }}", for {{ recipient|md }}.

The stored register in this pack is the company's register of members. Where a share class is also on a blockchain, the chain is a mirror of the register and not the register itself.

The pack carries the company, its share classes, each class's register of members with the history of entries behind it, the approvals and authority behind those entries, and the contract information needed to continue on chain. It does not carry members' email addresses, phone numbers, dates of birth, citizenship, financial details, account numbers, identity-verification evidence or platform account ids: those are what members gave Ledova, not what the register records. Nor does it carry investors' classification claims and evidence, their payslips, orders that have not settled, or Ledova's own records of who took copies of the register.

## 2. How to read it

| File | What it holds |
| --- | --- |
| `README.md` | This document |
| `manifest.json` | The format name and version, the company, the as-at time, the instruction and recipient, each share class's register sequence and head hash, and every other file's path, size in bytes and SHA-256 |
| `company.json` | The company as Ledova holds it, the name of the account that instructs for it, and its business-register checks |
| `approvals.json` | The company's registry addresses; each wallet approval with its status, its expiry and whether it was listed at the as-at time; and each change to an approval, with its action, expiry, authority, status and transaction |
| `wallet_links.json` | Each request to link a wallet to a member of the company: its authority, terms, evidence and decision |
| `classes/<class id>/class.json` | One share class: its terms, authorised shares, status, contract address and register head, with each capital increase and each pause |
| `classes/<class id>/register.csv` | The class's register of members, present once its register has been opened |
| `classes/<class id>/entries.json` | Every entry in the class's register, in order, each with the exact text its hash was computed over |
| `classes/<class id>/authority.json` | The class's register openings, imports, corrections and register instructions: each one's authority, terms, evidence and decision |
| `classes/<class id>/issues.json` | Under `issues`, each issuance request with the issuance it produced and the subscription it allotted; under `awaiting_allotment`, each subscription with a payment recorded and no shares allotted. Each subscription carries its payment as recorded |
| `classes/<class id>/former_members.json` | The former members in `register.csv`, each with the date until which it must be kept |
| `classes/<class id>/reconciliations.json` | Each comparison of the register with the chain, with its discrepancies and their acknowledgements |
| `classes/<class id>/waiting.json` | Completed issues and settled transfers not yet entered in the register |
| `classes/<class id>/due.json` | Share certificates and notice figures still owed for the register's entries |
| `contracts/contracts.json` | The chain, each contract's address, the owner each share class was deployed with, the two signing domains and the compiler settings |
| `contracts/<Name>.json` | The interface (ABI) of each contract: `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` |

The share classes:

| Class id | Symbol | Name | Status | Register entries | Head hash |
| --- | --- | --- | --- | --- | --- |
{% for share_class in classes %}| `{{ share_class.token.pk }}` | {{ share_class.token.symbol|md }} | {{ share_class.token.name|md }} | {{ share_class.token.status }} | {{ share_class.sequence }} | `{{ share_class.head_hash }}` |
{% endfor %}
### Checking the files

1. `manifest.json` lists every other file in the archive. Check that each listed file is present, that its size in bytes and its SHA-256 (lowercase hexadecimal) are the ones listed, and that the archive holds no file the manifest does not list.
2. Ledova recorded the SHA-256 of `manifest.json` when it produced this pack. Because the manifest fixes every other file, that one digest identifies the whole pack, even if the files are later zipped again.

### Reading `register.csv`

The file has three sections of different widths, separated by an empty row. Read each by its headers, not by column position.

1. Current members, under a header row that starts with "Member ID": each member's name, residential address, linked wallets, holder type, class, shares held, percentage of issued supply, balance and identity sources, date entered, each wallet's approval status and amount paid. Amount paid is blank where it cannot be established exactly.
2. The supply summary: issued supply, the total held by listed members, any completed effects still waiting to be recorded, and the latest reconciliation with the chain.
3. Former members, under the heading "Former members (retained under s169(3) of the Corporations Act)" and a header row of their own, with the time the former-member history was last read.

A value that begins with `=`, `+`, `-`, `@`, a tab or a carriage return carries a leading apostrophe, so a spreadsheet does not run it as a formula.

### Checking a register's history

Each entry in `entries.json` carries `preimage`, the exact text Ledova's database computed the entry's hash over. For each share class:

1. For every entry in order, the SHA-256 of its `preimage`, encoded as UTF-8 and written in lowercase hexadecimal, is its `entry_hash`.
2. The `preimage` is a JSON array of twelve values: the text `ledova-register-v1`, then the entry's `uuid`, `register`, `operation_id`, `sequence`, `kind`, `effective_on`, `changes` and `corrects`, then the number of the platform account that recorded it, then its `previous_hash` and `created_at`. Each value except the account number equals the entry's field of that name. The account number is opaque and appears nowhere else.
3. The first entry's `previous_hash` is sixty-four zeros, and every later entry's `previous_hash` is the `entry_hash` of the entry before it. Entries are numbered from 1 without gaps.
4. The number of entries is the class's `sequence` in `manifest.json`, and the last entry's `entry_hash` is its `head_hash`. A class with no entries has sequence 0 and a head of sixty-four zeros.
5. Start every member at zero and add each change's `shares`, in entry order. The members left with a positive total, and their totals, are exactly the current members in `register.csv`, matched by Member ID and Shares held.

### Reading the authority records

Each record in `authority.json` and `wallet_links.json` carries its `authority` (`director_resolution` or `court_order`), the `approving_director` for a resolution, the `authority_reference` and `reason` the company gave, and its terms. Its `status` is the decision: `submitted` while it waits, `applied` or `rejected` once a Ledova reviewer decided it, with the reviewer's name, the time and any reason for rejection. `evidence` names the company document the record relies on, and the SHA-256 and size in bytes of the copy Ledova kept when it was submitted.

An applied opening or correction names its `entry`: the entry in the class's `entries.json` whose `operation_id` is the record's `uuid`, of kind `opening` or `correction`. A correction's `corrects` is that entry's `corrects`.

### Reading `issues.json`

Under `issues`, each issuance request carries its recipient, shares, status and reviewer, the `issuance` it produced once executed, and the `subscription` it allotted where it came from an offering.

Under `awaiting_allotment` is each subscription to the class with a payment recorded against it and no issuance request yet: `paid` in full and awaiting allotment, or `awaiting_payment` with part of the money received. Each carries the subscriber's name and the wallet the shares would go to, the shares asked for and the `allotment` still to be made, the price, the amount due, the dates and the payment. The company must allot or refund each one.

A subscription's `payment` has the `basis` `recorded`: Ledova staff entered the amount, the date received and the reference they saw on the statement, or the transfer hash for a stablecoin payment. It is not proof that the money moved.

## 3. What the evidence proves and does not

| Record | Proves | Does not prove |
| --- | --- | --- |
| A register entry's hash and its link to the previous entry | The entry is unchanged since the database wrote it, and its place in the order | That the entry is right or authorised. The authority is the linked instruction and its document |
| Payment received on a subscription | Who entered what amount, and when | That money moved |

Each authority record names its evidence document by SHA-256 and size. The documents themselves are not in this pack.

## 4. Restrictions in force

### Who may hold and transfer

Each share class's contract moves shares only between wallets that the company's registry lists with an approval that has not expired. A holder whose approval expired or was removed can neither send nor receive until it is renewed, so their holding is frozen. The registry holds each wallet's expiry: read it with `expiresAt(address)`. At the as-at time `approvals.json` recorded:

{% if approvals %}| Wallet | Registry | Status | Expires (UTC) | Listed |
| --- | --- | --- | --- | --- |
{% for approval in approvals %}| `{{ approval.wallet }}` | `{{ approval.registry }}` | {{ approval.status }} | {% if approval.expires_at %}{{ approval.expires_at|date:"c" }}{% else %}never{% endif %} | {% if approval.listed %}yes{% else %}no: frozen while it holds shares{% endif %} |
{% endfor %}{% else %}No wallet approval is recorded for this company.
{% endif %}
### Paused classes

{% for share_class in classes %}{% if share_class.token.status == "paused" %}- {{ share_class.token.symbol }} is paused on chain, and no transfer of it settles until it is unpaused. Its `class.json` lists each pause and unpause.
{% endif %}{% endfor %}{% if not paused %}No share class is paused.
{% endif %}
### Completed effects waiting to be recorded

A completed issue or settled transfer is entered in the register only once its wallets are linked to members and the directors' written instruction covers it. Each class's `waiting.json` lists those still waiting under `effects`, in the order they will be recorded, with the reason each waits.

{% for share_class in classes %}- {{ share_class.token.symbol }}: {% if share_class.waiting is None %}not established, so `effects` is `null`: the register has no opening Ledova can place completed effects against, or one of them needs attribution{% elif share_class.waiting %}{{ share_class.waiting|length }} waiting{% else %}none waiting{% endif %}.
{% endfor %}
### Former members

Each former member must stay on the register for seven years after the date they ceased (s169(3) of the Corporations Act). That obligation passes to whoever keeps the register next. Each class's `former_members.json` gives the date until which each must be kept.

{% if former %}| Class | Name | Ceased on | Keep until |
| --- | --- | --- | --- |
{% for share_class in classes %}{% for row in share_class.former %}| {{ share_class.token.symbol }} | {{ row.name }} | {{ row.ceased_on|date:"Y-m-d" }} | {{ row.retain_until|date:"Y-m-d" }} |
{% endfor %}{% endfor %}{% else %}No former member is recorded.
{% endif %}
## 5. Authority on chain

The contracts are on chain id {{ contracts.chain_id }}.

| Contract | Address | Owner it was deployed with |
| --- | --- | --- |
{% for share_class in contracts.classes %}| Share class {{ share_class.symbol|md }} | {% if share_class.address %}`{{ share_class.address }}`{% else %}not deployed{% endif %} | {% if share_class.owner_at_deployment %}`{{ share_class.owner_at_deployment }}`{% else %}not recorded{% endif %} |
{% endfor %}{% for registry in contracts.registries %}| The company's registry | `{{ registry.address }}` | The owner of its share classes |
{% endfor %}| Share class factory | {% if contracts.factory.address %}`{{ contracts.factory.address }}`{% else %}not configured{% endif %} | Ledova's operator |
| Settlement (swap) contract | {% if contracts.swap.address %}`{{ contracts.swap.address }}`{% else %}not configured{% endif %} | Ledova's operator |
{% if not contracts.registries %}
No registry address is recorded for this company. Read it from the share class factory with `registryOf("{{ company.acn|md }}")`.
{% endif %}
Ledova's operator key deploys every share class and owns it. The factory created the company's registry with the same owner as its first share class, and every later class must share that owner and that registry. No Ledova code transfers that ownership. A share class is bound to its registry permanently.

To continue with another provider, the company instructs Ledova's operator in writing to:

1. wait until every operation Ledova has in flight for the company has finished;
2. call `setShareTokenApproval(shareToken, false)` on the settlement contract for each share class, so its relayer can no longer settle trades in that class;
3. call `transferOwnership(newOwner)` on each share class contract and on the company's registry.

Whoever owns the registry then decides who may hold and transfer the company's shares. This pack explains the handover and does not perform it.

Two signing domains are in use, both version `1`, and `contracts/contracts.json` lists each with its chain id and address. "Ledova Trading" is verified at each share class's own address and covers signed order actions. "LedovaAtomicSwap" is verified at the settlement contract, and both parties to a settlement sign under it: their signed order is the instrument of transfer.

The contracts were compiled with Solidity 0.8.24, EVM version `paris`, the optimizer at 200 runs and `viaIR` on, against OpenZeppelin 5.4.0. Those settings are needed to verify the deployed bytecode.

## 6. The company's filings

- Moving the register to a place other than the company's registered office or principal place of business needs notice to ASIC of where it is kept, within 7 days (s172(2)).
- Where the register is stored on a computer at a place other than where it is inspected, a change of either place needs notice to ASIC within 14 days (s1301(4)).
- Certificates and notices of share issues and member changes that are still due remain the company's obligations, whoever keeps the register. Each class's `due.json` lists those Ledova had not prepared at the as-at time; one the company prepared elsewhere is still listed.

{% if due %}| Class | Entry | Kind | Owed | Due on | Overdue |
| --- | --- | --- | --- | --- | --- |
{% for share_class in classes %}{% for row in share_class.due %}| {{ share_class.token.symbol }} | {{ row.sequence }} | {{ row.kind }} | {{ row.output }} | {{ row.due_on|date:"Y-m-d" }} | {% if row.overdue %}yes{% else %}no{% endif %} |
{% endfor %}{% endfor %}{% else %}None was outstanding in Ledova's records.
{% endif %}
- Money received for shares not yet allotted is the company's to allot against or refund, whoever keeps the register. Each class's `issues.json` lists those subscriptions under `awaiting_allotment`:

{% for share_class in classes %}  - {{ share_class.token.symbol }}: {% with count=share_class.awaiting_allotment|length %}{% if count %}{{ count }} subscription{{ count|pluralize }} awaiting allotment or refund{% else %}none{% endif %}{% endwith %}.
{% endfor %}
## 7. What this pack grants

The company, and a provider it names in writing, may use the records and the contract interface files in this pack to operate and move the company's own register and contracts.
{% endautoescape %}