# Company-authorised empty share-class deployment

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** First #867 increment implemented. This page describes empty deployment;
wallet approvals, company issuance, capital and pause conversion remain later
increments. Each pull request on [#867](https://github.com/Ledova/ledova/issues/867)
records its independent review and required checks before delivery.

A company appointment authorises deployment of an empty share class. The existing
technical signer creates its contract; deployment issues no shares, receives no
payment and changes no register holding. The captured issuer address is contract
metadata, separate from the technical sender, gas payer and any future recipient.
Company share operations grant no crypto on-ramp purchase permission.

## Company workflow

An appointee opens the class from the company's Register. A current personal
`admin` appointment can prepare, approve, apply and reject. Narrower appointments
retain their existing step capabilities; rejection uses `approve`. Ownership,
shareholding, account audience and platform staff access grant no company mandate.

Preparation captures the company-provided company/class information, whole-share
cap and identifier, selected issuer address, exact chain/factory/transaction
intent and register state. The company reviews that snapshot before approving it.
Application consumes the exact approval and admits one original deployment job.
An applied proposal means admitted, not a deployed contract.

A missing register, an uninitialised register and an initialised zero register are
separate states. Unknown or unavailable data is never zero. Positive issued
supply refuses empty deployment. An existing zero register keeps its entries,
head, holdings and provenance; deployment neither resets it nor creates a second
opening. Mirroring a populated register remains separate design work.

New signatures require the original approving and applying mandates, captured
wallet association, configuration, terms and register state to remain applicable.
The original selected address is checked rather than replaced by a newer wallet.
Temporary contention or lost source authority holds unsigned work under its
original identity; this bounded increment supplies no automatic replacement,
reapproval or renewal route. Technical nonce, signer-generation, receipt and
finality safeguards remain.

Already signed work retains its original bytes and attribution after company
source loss. Receipt recovery and projection do not invent a new company decision.
Both clients distinguish admission, unsigned holds, signed uncertainty,
confirmation awaiting projection and the original projected outcome. A contract
address alone does not establish attributed completion.

## Register and issuance boundary

Once company deployment is admitted, pending original projection fences register
head advances, including imports and compensating corrections. The applied
proposal is resolved through the original deployment identifier before a lazy
journal exists. After projection, a genuinely new opening must bind the actual
company-approved chain opening and the original confirmed deployment boundary.
A matching-holdings particulars import after that opening retains its existing
meaning.

An initialised imported zero book still has history and cannot obtain a second
opening merely because its contract exists. Existing register-instruction refusal
for import-origin books remains. The same genuine import-origin predicate also
refuses new issuance execution admission, failed retries and unsigned signing;
retained requests and journals remain. Already signed/confirmed original issuance
recovers without inventing a missing register entry. Imported-baseline chain
attribution is not delivered by this deployment increment.

## Records, privacy and recovery

The proposal identifier is the original preparation operation identifier. It is
separate from deployment, outgoing operation, claim and transaction identifiers.
The retained consumed approval identifies the actual decision used by application.

The public review snapshot contains company/class/register/transaction facts and
the selected address. Internal captured wallet/account/profile/user association
identifiers remain private. Current register access controls proposal reads;
class metadata access grants no access to existing private issuer histories or
unconverted issue/capital/pause actions.

An uncertain preparation or decision retains its exact original body and key.
Recovery checks that original receipt under current register access, including
when the original step appointment has expired or the proposal has changed stage.
Changed retries conflict. A receipt replay creates no new effect. Client state is
scoped to the current account/session; mobile also checks its current session
epoch and final document-share boundary. Component state alone does not promise
exact request replay after process loss.

## API and retained execution

The bounded family is `/api/v1/tokens/register-deployments/`: create, list, detail,
`decision-preview` and `decide`. Creation takes `operation_id`, `appointment` and
`token`; there is no upload, wallet picker or separate receipt/restart route.
Responses provide a typed review snapshot, intent digest, company decision
history, original deployment association and execution requirements/receipt.

Fresh owner/staff deployment admissions and direct-deploy client controls are
replaced by this workflow. Historical journals, nullable legacy source/principal
records and meaningful original-ID technical recovery remain. The private-company
register and optional investor crypto integration remain separate.

## Verification

Focused ordinary/scoped/SQL controls exercise tenant and capability boundaries,
exact replay, queue rollback and visibility before commit, actual expiry and
source locks, absent/zero/positive/unknown register state, both grant/deployment
race orders, pending import/correction refusal, genuine chain-opening positives
and signed recovery. Historical-model controls preserve original NULL-source
journals/signatures and refuse reversal with retained company history. Both
clients exercise uncertain original receipts, owner-form scope and retired-session
transport/callback boundaries.

Pull requests record actual commands, failures, repairs and remaining limits.
Required combined-head CI, role/catalogue/schema/source/client/native and
isolated-chain evidence and wholly nonauthor review precede merge. These controls
do not establish a live operation or the complete company/member journey in #873.
