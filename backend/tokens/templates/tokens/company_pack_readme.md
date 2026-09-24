{% load company_pack_text %}{% autoescape off %}# Company pack: {{ company.name|md }} (ACN {{ company.acn|md }})

## 1. What this is

This archive holds the records Ledova kept for {{ company.name|md }} as at {{ as_at }} (UTC). It was produced on the written instruction or compelling document referenced as "{{ instruction|md }}", for {{ recipient|md }}.

The stored register in this pack is the company's register of members. Where a share class is also on a blockchain, the chain is a mirror of the register and not the register itself.

The pack carries the company, its share classes, each class's register of members with the history of entries behind it, the approvals and authority behind those entries, the transactions Ledova sent for each class and the settlements it executed, the company's documents with the copy Ledova kept of the evidence behind each approval, what the company published to its members with the roll each was addressed to, the record of each resolution's ballots and result and of each dividend's payment records, and the contract information needed to continue on chain. It does not carry members' email addresses, phone numbers, dates of birth, citizenship, financial details, account numbers, identity-verification evidence or platform account ids: those are what members gave Ledova, not what the register records. Nor does it carry investors' classification claims and evidence, their payslips, orders that have not settled, Ledova's own records of who took copies of the register, the signed bytes of any transaction, how any member voted, or which member opened which publication.

## 2. How to read it

| File | What it holds |
| --- | --- |
| `README.md` | This document |
| `manifest.json` | The format name and version, the company, the as-at time, the instruction and recipient, each share class's register sequence and head hash, each publication's number of events and head hash, and every other file's path, size in bytes and SHA-256 |
| `company.json` | The company as Ledova holds it, the name of the account that instructs for it, and its business-register checks |
| `approvals.json` | The company's registry addresses; each wallet approval with its status, its expiry and whether it was listed at the as-at time; and each change to an approval, with its action, expiry, authority, status and transaction |
| `wallet_links.json` | Each request to link a wallet to a member of the company: its authority, terms, evidence and decision |
| `documents.json` | Each document the company gave Ledova: its type, name, media type, validity, whether Ledova verified it, and the file that holds it or the address the company gave instead |
| `documents/<document id>` | The bytes of each company document Ledova holds, as uploaded, named by the document's id with the extension of its media type |
| `documents/evidence/<record id>` | The copy Ledova kept of the document an authority record relied on, as it was when the record was submitted, named by the record's id with the extension of its media type |
| `classes/<class id>/class.json` | One share class: its terms, authorised shares, status, contract address and register head, with each capital increase and its execution, and each pause with the transaction it was for or the state it found |
| `classes/<class id>/register.csv` | The class's register of members, present once its register has been opened |
| `classes/<class id>/entries.json` | Every entry in the class's register, in order, each with the exact text its hash was computed over |
| `classes/<class id>/authority.json` | The class's register openings, imports, corrections and register instructions: each one's authority, terms, evidence and decision, and for an opening the chain boundary it was reviewed against |
| `classes/<class id>/chain.json` | The class's deployment record, and every transaction Ledova prepared or signed for the class, with its operator key or its settlement relayer's: its purpose, the unsigned transaction, its status and receipt, and each signed attempt's hash, nonce, signer and chain id |
| `classes/<class id>/settlements.json` | Each settlement of the class that Ledova executed: the order both parties signed with its signing domain, the order hash, both signatures, the transaction and its finalized receipt, and the register entry that recorded it |
| `classes/<class id>/issues.json` | Under `issues`, each issuance request with the issuance it produced, the execution that sent it and the subscription it allotted; under `awaiting_allotment`, each subscription with a payment recorded and no shares allotted. Each subscription carries its payment as recorded |
| `classes/<class id>/former_members.json` | The former members in `register.csv`, each with the date until which it must be kept |
| `classes/<class id>/reconciliations.json` | Each comparison of the register with the chain, with its discrepancies and their acknowledgements |
| `classes/<class id>/waiting.json` | Completed issues and settled transfers not yet entered in the register |
| `classes/<class id>/due.json` | Share certificates and notice figures still owed for the register's entries |
| `contracts/contracts.json` | The chain, each contract's address, the owner each share class was deployed with and the settlement contract it was approved on, the registry's owner, the two signing domains and the compiler settings |
| `contracts/<Name>.json` | The interface (ABI) of each contract: `ShareToken`, `WhitelistRegistry`, `ShareTokenFactory` and `AtomicSwap` |
| `publications/<publication id>/publication.json` | One thing the company published to its members: its kind, title and class, the record date, the instruction and the company document that authorised it, the point in the register its roll was taken from, the roll's number of rows and digest, the document's path, media type and SHA-256, a resolution's question, kind, voting basis and window or a dividend's rate, currency, dates, declared total and undistributed remainder, and how many times it was opened |
| `publications/<publication id>/roll.json` | The members it was addressed to, as at its record date: each row's id, register member, name, holder type, identity source, shares and, for a dividend, entitlement |
| `publications/<publication id>/events.json` | A resolution's ballots and close, or a dividend's payment records and their withdrawals, in order, each with its hashes. Every event but a ballot is carried in full, with the exact text its hash was computed over |
| `publications/<publication id>/document.<extension>` | The document as it was published to members |
| `publications/<publication id>/payments/<record id>.<extension>` | The remittance evidence the company supplied for a payment record |

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

Each record in `authority.json` and `wallet_links.json` carries its `authority` (`director_resolution` or `court_order`), the `approving_director` for a resolution, the `authority_reference` and `reason` the company gave, and its terms. Its `status` is the decision: `submitted` while it waits, `applied` or `rejected` once a Ledova reviewer decided it, with the reviewer's name, the time and any reason for rejection. `evidence` names the company document the record relies on, the SHA-256 and size in bytes of the copy Ledova kept when it was submitted, and `path`, where that copy is in this pack.

An applied opening or correction names its `entry`: the entry in the class's `entries.json` whose `operation_id` is the record's `uuid`, of kind `opening` or `correction`. A correction's `corrects` is that entry's `corrects`.

An opening's `boundary` is the state of the class's contract that Ledova read when the opening was reviewed, or `null` before then: the block (`number`, `hash`, `timestamp` and `date`), the finality `policy` it satisfied, the issued and authorised supply, each wallet's holding, and the transactions behind them. An applied opening's entry holds exactly those holdings, each added to the member its wallet is mapped to in `mapping`, and takes effect on the block's `date`.

### Reading `issues.json`

Under `issues`, each issuance request carries its recipient, shares, status and reviewer, the `issuance` it produced once executed, and the `subscription` it allotted where it came from an offering.

Under `awaiting_allotment` is each subscription to the class with a payment recorded against it and no issuance request yet: `paid` in full and awaiting allotment, or `awaiting_payment` with part of the money received. Each carries the subscriber's name and the wallet the shares would go to, the shares asked for and the `allotment` still to be made, the price, the amount due, the dates and the payment. The company must allot or refund each one.

A subscription's `payment` has the `basis` `recorded`: Ledova staff entered the amount, the date received and the reference they saw on the statement, or the transfer hash for a stablecoin payment. It is not proof that the money moved.

An issuance carries its `transaction` hash. An issue's `execution` is how Ledova sent it: its status, the unsigned terms (`intent`), the `operation` in `chain.json` that sent it, its transaction, and the `finalized_receipt` once the approved finality policy was satisfied. A capital increase's `execution` in `class.json` carries the same, with any `attribution_evidence` Ledova held when the contract's state did not identify it, and a pause carries its unsigned terms and its `operation`, or, where the contract was already in the state it asked for, the block at which that was `observed`.

### Reading `chain.json`

`deployment` is the class's deployment record, or `null` where Ledova has none: the terms it was deployed with (`intent`), the `operation` that sent it, its transaction and the address it created, and `swap_approval`, the approval of the class on the settlement contract, with its terms, outcome, operation and transaction, or the block at which it was observed already in place.

`operations` lists every transaction Ledova prepared or signed for the class, with its operator key or, for a settlement, its relayer's, oldest first. Each has its `key`, its `purpose` (`deployment`, `swap_approval`, `issuance`, `capital_increase`, `pause` or `settlement`) and the `record` it was for, which names it by that key: the deployment record, an issue's or capital increase's `execution`, a pause, or a settlement. `intent` is the unsigned transaction: chain id, sender, target, value and calldata. `status` is `preparing` or `signed` while its outcome is unresolved, `confirmed` once a successful receipt was observed, `reverted` once a failed one was, and `failed` for a failure before signing. `receipt` is the first receipt seen for the current attempt. `attempts` lists every signed attempt, oldest first, with its transaction hash, nonce, signer and chain id, and `current_attempt` is the hash of the one the status describes; an earlier attempt reverted or failed before the operation was tried again.

The signed bytes of an attempt are not in this pack. A mined transaction's bytes can be fetched from any node by its hash, and an unmined transaction's bytes could still be broadcast.

### Reading `settlements.json`

Each settlement is the instrument of a transfer. `typed_data` is the order both parties signed, in the form EIP-712 signs: `domain` names the settlement contract, its chain id, name and version, and `message` the seller, buyer, share and payment tokens, amounts, nonce and deadline. `digest` is what each party signed and `order_hash` the order's hash without the domain. `seller_signature` and `buyer_signature` are the two signatures. `transaction` is the settlement's transaction, `operation` the operation in `chain.json` that sent it, and `finalized_receipt` the block at which the approved finality `policy` was satisfied. A settlement recorded in the register names its `entry`, the transfer in `entries.json` whose `operation_id` is the settlement's `uuid`; one still waiting names none.

### Reading the documents

`documents.json` lists every document the company gave Ledova, oldest first: its `uuid`, `type`, `name` and `mime_type`, the dates it is `valid_from` and `valid_until`, whether Ledova `verified` it and when (`verified_at`), when it was uploaded (`uploaded_at`), its `external_url` if the company gave one, and `path`, the file under `documents/` that holds its bytes as uploaded. A document the company gave only as an address has `path` `null`: Ledova did not fetch it, so this pack does not carry it.

`documents/evidence/` holds the copy Ledova kept of the document each authority record relied on, one for each record in `authority.json` and `wallet_links.json`, named by the record's id. The record's `evidence` names the copy by `path`. Check that the copy's size in bytes and SHA-256 are the ones `evidence` records: Ledova checked them when it produced this pack. The document the copy was taken from may have changed or gone since, so a copy can differ from the file of the same document under `documents/`.

{% if documents %}| Document | Type | Name | Verified |
| --- | --- | --- | --- |
{% for document in documents %}| {% if document.path %}`{{ document.path }}`{% else %}not carried: {{ document.external_url|default:"no address given"|md }}{% endif %} | {{ document.type }} | {{ document.name|md }} | {% if document.verified %}yes{% else %}no{% endif %} |
{% endfor %}{% else %}The company gave Ledova no documents.
{% endif %}
This pack carries {{ copies }} evidence cop{{ copies|pluralize:"y,ies" }}.

Verification evidence Ledova holds for members is not in this pack: identity checks, investor classification claims and their evidence, and payslips. Each person gave it to Ledova to be verified, and it is not a record of the company. It runs on its own retention clock, and a verification does not carry over to another company or provider, which verifies members itself.

### Reading the publications

{% if publications %}| Publication id | Kind | Title | Class | Record date | Events | Head hash |
| --- | --- | --- | --- | --- | --- | --- |
{% for row in publications %}| `{{ row.publication.pk }}` | {{ row.publication.kind }} | {{ row.publication.title }} | {{ row.publication.token_symbol }} | {{ row.publication.record_date|date:"Y-m-d" }} | {{ row.events }} | `{{ row.head_hash }}` |
{% endfor %}{% else %}The company published nothing to its members through Ledova.
{% endif %}
Each publication is something the company published to its members through Ledova on its written instruction: a holding statement, a meeting notice, a resolution put to members, or a dividend. `publication.json` names the company document that authorised it (`authority_document`, listed in `documents.json`) and the point in the class's register its roll was taken from: `register.sequence` and `register.head_hash` are an entry's number and `entry_hash` in the class's `entries.json`. `document` names the file at `document.path` and the SHA-256 Ledova recorded when it stored it. Ledova checked, when it produced this pack, that the file still has that SHA-256.

`roll.json` is the roll frozen when the publication was made: one row for each member holding shares of the class on the record date, largest holding first, with the register member (`member`, as in `register.csv` and `entries.json`), the name, holder type and identity source as at that moment, the shares held and, for a dividend, the `entitlement`, which is the shares times the rate, rounded down to the cent. Rows name no platform account. `member_rows` and `audience_digest` are the row count and digest the publication recorded, and Ledova checked, when it produced this pack, that the roll still has them. The digest also covers the platform account each row resolved to, which is not in this pack, so you can count the rows but cannot recompute the digest.

A dividend's `distribution` carries the rate per share, the currency, the dates it was declared and is payable, the total the company declared, and the `undistributed` amount that rounding each entitlement down left over. The entitlements and the undistributed amount add up to the declared total.

#### Checking a publication's events

A resolution records its ballots and then its close. A dividend records payment records and their withdrawals. For each publication:

1. Events are numbered from 1 without gaps. The first event's `previous_hash` is sixty-four zeros, and every later event's `previous_hash` is the `entry_hash` of the event before it.
2. The number of events is the publication's `events` in `manifest.json`, and the last event's `entry_hash` is its `head_hash`. A publication with no events has 0 and a head of sixty-four zeros.
3. Every event except a ballot carries `preimage`, the exact text Ledova's database computed its hash over. Its SHA-256, encoded as UTF-8 and written in lowercase hexadecimal, is its `entry_hash`.
4. A close's `preimage` is a JSON array of fifteen values: the text `ledova-publication-event-v1`; the event's `uuid`; the publication's `uuid`; the company's `uuid` from `manifest.json`; the event's `sequence`, `kind` and `recipient`, which is `null`; an empty choice and `null` shares; the number of the platform account that recorded it, which is `null` for a close; its `staff_entered`, `authority` and `payload`; and its `previous_hash` and `created_at`.
5. A payment record's or withdrawal's `preimage` is a JSON array of twenty values: the text `ledova-publication-event-v2`; the same twelve values that follow the text in a close, where the platform account is the Ledova staff member who entered it; its `paid_on` and `reference`; the name Ledova stored the evidence under; the evidence's `sha256` and `mime_type`, both empty for a withdrawal; and its `previous_hash` and `created_at`.
6. Each value except the account number and the storage name equals the field of that name. Those two are opaque and appear nowhere else.
7. A payment record's or withdrawal's `recipient` is the `uuid` of a row in `roll.json`. A payment record's `evidence.path` holds the remittance evidence the company supplied, and its SHA-256 is `evidence.sha256`, which is inside the hash.

A payment record is the company's statement that it paid a member, with the date and reference it gave, entered by Ledova staff with what they relied on as its `authority`. A withdrawal withdraws the record standing before it for that row, with the reason as its `authority`, and a new record may follow. Neither shows that money moved.

#### The result of a resolution

A close's `payload` is the tally Ledova's database counted from the ballots when voting closed: the shares and members `for`, `against` and abstaining (`abstain`), the shares and members on the roll (`eligible`), the voting `basis`, the `resolution_kind`, and whether it `carried`. An ordinary resolution is carried when the shares voted for exceed the shares voted against. A special resolution is carried when at least one share was voted for or against and the shares for are at least three quarters of those. Abstentions are counted but are not votes cast.

You can check that `eligible` is the roll's shares and rows, that the members counted for, against and abstaining add up to the ballots on the chain, that the shares counted do not exceed the roll's, and that `carried` follows from the shares for and against. You cannot recount the tally, because the ballots are withheld. How the shares divided rests on the close's hash, which the database wrote when it counted, and on Ledova's own verifier, which recounts the tally from the stored ballots.

#### What is withheld, and why

The company sees the result of each resolution and how many members opened each publication, never how a member voted or who opened what. That is the rule for what a company sees of its members' participation, and this pack keeps it.

- A ballot carries only its `sequence`, `kind`, `previous_hash` and `entry_hash`, with `withheld` set to true. Its member, choice, shares, the account that cast it, whether staff entered it, when it was cast and its preimage are not in this pack, because the preimage holds the choice. You can check its links, to the event before it and from the event after it, but not recompute its hash. The close's preimage covers the last ballot's hash, so a ballot removed or added breaks the numbering, a link, the head in `manifest.json` or the count of ballots in the tally.
- `reads` in `publication.json` counts how many times the document was opened by members, by the company and by Ledova staff (`document`), how many of the roll's members opened it at least once (`members_who_opened`), and how many times Ledova staff opened a payment record's remittance evidence (`remittance_evidence`). It does not say who.
- A tally can still show how members voted. Set against the holdings in `roll.json`, the shares counted each way may fit only one set of members, as they often do when few members vote or their holdings differ. The company sees the same tally and the same roll through Ledova already, so this pack shows it nothing more.

## 3. What the evidence proves and does not

| Record | Proves | Does not prove |
| --- | --- | --- |
| A register entry's hash and its link to the previous entry | The entry is unchanged since the database wrote it, and its place in the order | That the entry is right or authorised. The authority is the linked instruction and its document |
| The finalized receipt on an issue or settlement | One provider reported the transaction in that block, with the named finality policy satisfied | Independent consensus |
| An outgoing operation marked `confirmed` | A successful receipt was observed | Confirmation depth, replacement or reorg repair |
| The two signatures on a settlement | The key for each address signed that order under that domain | Who the person is. Identity is the register's resolution, recorded with its source |
| An opening's boundary | One provider reported those holdings and that supply at that block, with the named finality policy satisfied | Independent consensus |
| A pause or settlement approval observed already in place | The contract was read in that state at that block | Which transaction put it there. The record is an observation, never transaction attribution |
| Payment received on a subscription | Who entered what amount, and when | That money moved |
| A publication event's hash and its link to the event before it | The event is unchanged since the database wrote it, and its place in the order | That the event is right or authorised. A ballot's own hash cannot be recomputed from this pack, because its content is withheld |
| A resolution's close | The tally the database counted from the ballots when voting closed | How any member voted. The ballots are withheld, so the tally cannot be recounted from this pack |
| A payment record on a dividend | Who at Ledova entered the company's statement that it paid, when, and the SHA-256 of the remittance evidence the company supplied | That money moved, or that the remittance is genuine |

Each authority record names its evidence by SHA-256 and size, and `documents/evidence/` carries the copy with those digests. That shows the copy is the one Ledova kept when the record was submitted, not that the document is genuine. In the same way, each publication's document and each payment record's remittance evidence is carried with the SHA-256 Ledova recorded when it stored the file: that shows the file is the one stored, not that it is genuine.

## 4. Restrictions in force

### Who may hold and transfer

Each share class's contract moves shares only between wallets that the company's registry lists with an approval that has not expired. A holder whose approval expired or was removed can neither send nor receive until it is renewed, so their holding is frozen. The registry holds each wallet's expiry: read it with `expiresAt(address)`. At the as-at time `approvals.json` recorded:

{% if approvals %}| Wallet | Registry | Status | Expires (UTC) | Listed |
| --- | --- | --- | --- | --- |
{% for approval in approvals %}| `{{ approval.wallet|md }}` | `{{ approval.registry }}` | {{ approval.status }} | {% if approval.expires_at %}{{ approval.expires_at|date:"c" }}{% else %}never{% endif %} | {% if approval.listed %}yes{% else %}no: frozen while it holds shares{% endif %} |
{% endfor %}{% else %}No wallet approval is recorded for this company.
{% endif %}
### Paused classes

{% for share_class in classes %}{% if share_class.token.status == "paused" %}- {{ share_class.token.symbol|md }} is paused on chain, and no transfer of it settles until it is unpaused. Its `class.json` lists each pause and unpause.
{% endif %}{% endfor %}{% if not paused %}No share class is paused.
{% endif %}
### Completed effects waiting to be recorded

A completed issue or settled transfer is entered in the register only once its wallets are linked to members and the directors' written instruction covers it. Each class's `waiting.json` lists those still waiting under `effects`, in the order they will be recorded, with the reason each waits.

{% for share_class in classes %}- {{ share_class.token.symbol|md }}: {% if share_class.waiting is None %}not established, so `effects` is `null`: the register has no opening Ledova can place completed effects against, or one of them needs attribution{% elif share_class.waiting %}{{ share_class.waiting|length }} waiting{% else %}none waiting{% endif %}.
{% endfor %}
### Former members

Each former member must stay on the register for seven years after the date they ceased (s169(3) of the Corporations Act). That obligation passes to whoever keeps the register next. Each class's `former_members.json` gives the date until which each must be kept.

{% if former %}| Class | Name | Ceased on | Keep until |
| --- | --- | --- | --- |
{% for share_class in classes %}{% for row in share_class.former %}| {{ share_class.token.symbol|md }} | {{ row.name|md }} | {{ row.ceased_on|date:"Y-m-d" }} | {{ row.retain_until|date:"Y-m-d" }} |
{% endfor %}{% endfor %}{% else %}No former member is recorded.
{% endif %}
## 5. Authority on chain

The contracts are on chain id {{ contracts.chain_id }}. Ledova reads no chain to produce this pack, so each owner below is the one Ledova's records state: the key a share class was deployed with. No Ledova code transfers that ownership. Read `owner()` on each contract to confirm it before acting.

| Contract | Address | Owner in Ledova's records |
| --- | --- | --- |
{% for share_class in contracts.classes %}| Share class {{ share_class.symbol|md }} | {% if share_class.address %}`{{ share_class.address }}`{% else %}not deployed{% endif %} | {% if share_class.owner_at_deployment %}`{{ share_class.owner_at_deployment }}`{% else %}not recorded{% endif %} |
{% endfor %}{% for registry in contracts.registries %}| The company's registry | `{{ registry.address }}` | {% if registry.owner %}`{{ registry.owner }}`, the owner of its share classes{% else %}the owner of its share classes, which Ledova's records do not establish{% endif %} |
{% endfor %}| Share class factory | {% if contracts.factory.address %}`{{ contracts.factory.address }}`{% else %}not configured{% endif %} | Ledova's operator |
| Settlement (swap) contract | {% if contracts.swap.address %}`{{ contracts.swap.address }}`{% else %}not configured{% endif %} | Ledova's operator |
{% if not contracts.registries %}
No registry address is recorded for this company. Read it from the share class factory with `registryOf("{{ company.acn|md }}")`.
{% endif %}
Ledova's operator key deploys every share class and owns it. The factory created the company's registry with the same owner as its first share class, and every later class must share that owner and that registry. A share class is bound to its registry permanently.

### Handing over control

To continue with another provider, the company instructs Ledova's operator in writing to do the following, in this order, from the owner named above. This pack explains the handover and does not perform it.

1. Wait until nothing Ledova has admitted for the company is unresolved: no class still `deploying`, no settlement approval `pending` or `executing`, no issue's execution `queued` or `executing`, no capital increase `executing`, no pause `pending` or `executing`, no settlement `executing`, and no approval change in `approvals.json` `pending` or `executing`. {% if unresolved %}At the as-at time these were unresolved:

   | Class | What | Record | Status |
   | --- | --- | --- | --- |
{% for row in unresolved %}   | {% if row.symbol %}{{ row.symbol|md }}{% else %}all{% endif %} | {{ row.purpose }} | {% if row.record %}`{{ row.record }}`{% else %}not recorded{% endif %} | {{ row.status }} |
{% endfor %}
{% else %}Nothing was unresolved at the as-at time.
{% endif %}2. Withdraw each deployed share class from the settlement contract, so its relayer can no longer settle trades in it:
{% for share_class in contracts.classes %}{% if share_class.address %}{% if share_class.approved_on %}   - {{ share_class.symbol|md }}: on `{{ share_class.approved_on }}`, call `setShareTokenApproval({{ share_class.address }}, false)`.
{% else %}   - {{ share_class.symbol|md }}: Ledova recorded no approval of it on a settlement contract. If `approvedShareTokens({{ share_class.address }})` is true on {% if contracts.swap.address %}`{{ contracts.swap.address }}`{% else %}a settlement contract{% endif %}, call `setShareTokenApproval({{ share_class.address }}, false)` there.
{% endif %}{% endif %}{% endfor %}3. Transfer each deployed share class:
{% for share_class in contracts.classes %}{% if share_class.address %}   - {{ share_class.symbol|md }}: on `{{ share_class.address }}`, call `transferOwnership(newOwner)`.
{% endif %}{% endfor %}4. Transfer the company's registry:
{% for registry in contracts.registries %}   - on `{{ registry.address }}`, call `transferOwnership(newOwner)`.
{% empty %}   - read its address with `registryOf("{{ company.acn|md }}")` on the share class factory, and call `transferOwnership(newOwner)` on it.
{% endfor %}
Whoever owns the registry then decides who may hold and transfer the company's shares.

Two signing domains are in use, both version `1`, and `contracts/contracts.json` lists each with its chain id and address. "Ledova Trading" is verified at each share class's own address and covers signed order actions. "LedovaAtomicSwap" is verified at the settlement contract, and both parties to a settlement sign under it: their signed order is the instrument of transfer, and each settlement in `settlements.json` carries the domain it was signed under.

The contracts were compiled with Solidity 0.8.24, EVM version `paris`, the optimizer at 200 runs and `viaIR` on, against OpenZeppelin 5.4.0. Those settings are needed to verify the deployed bytecode.

## 6. The company's filings

- Moving the register to a place other than the company's registered office or principal place of business needs notice to ASIC of where it is kept, within 7 days (s172(2)).
- Where the register is stored on a computer at a place other than where it is inspected, a change of either place needs notice to ASIC within 14 days (s1301(4)).
- Certificates and notices of share issues and member changes that are still due remain the company's obligations, whoever keeps the register. Each class's `due.json` lists those Ledova had not prepared at the as-at time; one the company prepared elsewhere is still listed.

{% if due %}| Class | Entry | Kind | Owed | Due on | Overdue |
| --- | --- | --- | --- | --- | --- |
{% for share_class in classes %}{% for row in share_class.due %}| {{ share_class.token.symbol|md }} | {{ row.sequence }} | {{ row.kind }} | {{ row.output }} | {{ row.due_on|date:"Y-m-d" }} | {% if row.overdue %}yes{% else %}no{% endif %} |
{% endfor %}{% endfor %}{% else %}None was outstanding in Ledova's records.
{% endif %}
- Money received for shares not yet allotted is the company's to allot against or refund, whoever keeps the register. Each class's `issues.json` lists those subscriptions under `awaiting_allotment`:

{% for share_class in classes %}  - {{ share_class.token.symbol|md }}: {% with count=share_class.awaiting_allotment|length %}{% if count %}{{ count }} subscription{{ count|pluralize }} awaiting allotment or refund{% else %}none{% endif %}{% endwith %}.
{% endfor %}
## 7. What this pack grants

The company, and a provider it names in writing, may use the records and the contract interface files in this pack to operate and move the company's own register and contracts.
{% endautoescape %}