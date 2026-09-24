{% autoescape off %}# Company pack: {{ company.name }} (ACN {{ company.acn }})

## 1. What this is

This archive holds the records Ledova kept for {{ company.name }} as at {{ as_at }} (UTC). It was produced on the written instruction or compelling document referenced as "{{ instruction }}", for {{ recipient }}.

The stored register in this pack is the company's register of members. Where a share class is also on a blockchain, the chain is a mirror of the register and not the register itself.

The pack carries the company, its share classes, each class's register of members with the history of entries behind it, and the contract information needed to continue on chain. It does not carry members' email addresses, phone numbers, dates of birth, identity-verification evidence or platform account ids: those are what members gave Ledova, not what the register records.

## 2. How to read it

| File | What it holds |
| --- | --- |
| `README.md` | This document |
| `manifest.json` | The format name and version, the company, the as-at time, the instruction and recipient, each share class's register sequence and head hash, and every other file's path, size in bytes and SHA-256 |
| `company.json` | The company as Ledova holds it, the name of the account that instructs for it, and its business-register checks |
| `classes/<class id>/class.json` | One share class: its terms, authorised shares, status, contract address and register head |
| `classes/<class id>/register.csv` | The class's register of members, present once its register has been opened |
| `classes/<class id>/entries.json` | Every entry in the class's register, in order, each with the exact text its hash was computed over |
| `contracts/contracts.json` | The chain, each contract's address, the owner each share class was deployed with, the two signing domains and the compiler settings |
| `contracts/<Name>.json` | The interface (ABI) of each contract: `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` |

The share classes:

| Class id | Symbol | Name | Status | Register entries | Head hash |
| --- | --- | --- | --- | --- | --- |
{% for share_class in classes %}| `{{ share_class.token.pk }}` | {{ share_class.token.symbol }} | {{ share_class.token.name }} | {{ share_class.token.status }} | {{ share_class.sequence }} | `{{ share_class.head_hash }}` |
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

## 3. What the evidence proves and does not

| Record | Proves | Does not prove |
| --- | --- | --- |
| A register entry's hash and its link to the previous entry | The entry is unchanged since the database wrote it, and its place in the order | That the entry is right or authorised. The authority is the linked instruction and its document |

The instructions and documents behind each entry are not in this pack.

## 4. Restrictions in force

- **Who may hold and transfer.** Each share class's contract moves shares only between wallets that the company's registry lists with an approval that has not expired. A holder whose approval expired or was removed can neither send nor receive until it is renewed, so their holding is frozen. The registry holds each wallet's expiry: read it with `expiresAt(address)`.
- **Paused classes.** A share class with status `paused` in the table above is paused on chain, and no transfer of it settles until it is unpaused.
- **Completed effects waiting to be recorded.** A "Completed effects waiting to be recorded" row in a class's `register.csv` counts issues or settled transfers that completed on chain and are not yet in the register. Each is entered only once its wallets are linked to members and the directors' written instruction covers it.
- **Former members.** Each former member in a class's `register.csv` must stay on the register for seven years after the date they ceased (s169(3) of the Corporations Act). That obligation passes to whoever keeps the register next.

## 5. Authority on chain

The contracts are on chain id {{ contracts.chain_id }}.

| Contract | Address | Owner it was deployed with |
| --- | --- | --- |
{% for share_class in contracts.classes %}| Share class {{ share_class.symbol }} | {% if share_class.address %}`{{ share_class.address }}`{% else %}not deployed{% endif %} | {% if share_class.owner_at_deployment %}`{{ share_class.owner_at_deployment }}`{% else %}not recorded{% endif %} |
{% endfor %}{% for registry in contracts.registries %}| The company's registry | `{{ registry.address }}` | The owner of its share classes |
{% endfor %}| Share class factory | {% if contracts.factory.address %}`{{ contracts.factory.address }}`{% else %}not configured{% endif %} | Ledova's operator |
| Settlement (swap) contract | {% if contracts.swap.address %}`{{ contracts.swap.address }}`{% else %}not configured{% endif %} | Ledova's operator |
{% if not contracts.registries %}
No registry address is recorded for this company. Read it from the share class factory with `registryOf("{{ company.acn }}")`.
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
- Certificates and notices of share issues and member changes that are still due remain the company's obligations, whoever keeps the register.

## 7. What this pack grants

The company, and a provider it names in writing, may use the records and the contract interface files in this pack to operate and move the company's own register and contracts.
{% endautoescape %}