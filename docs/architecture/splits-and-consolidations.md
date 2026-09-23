# Share splits and consolidations

[Architecture](README.md) · [Contracts and issuance](contracts-and-issuance.md) · [Register of members](register.md)

A design, not a mechanism. No model, service, endpoint, register entry kind or
contract function for a split or a consolidation exists. The owner decided on
23 September 2026 that the design lands in
[#649](https://github.com/Ledova/ledova/issues/649#issuecomment-5789320596) and
that any implementation belongs to a later issue. This page records what the
deployed contracts and the stored register already allow, what they refuse, and
what an implementation would therefore have to add. See
[the decision](../decisions.md#splits-and-consolidations).

## What each one is here

A split multiplies every holding in a share class by one ratio; a consolidation
divides them by one ratio. Neither moves value between members and neither
changes any member's proportion of the class. Both change issued supply, so both
run into the authorized cap.

Shares are whole units at every layer, and this is enforced rather than assumed:

| Layer | What fixes whole units |
| --- | --- |
| Contract | [`ShareToken.decimals()`](../../contracts/contracts/ShareToken.sol) is `pure` and returns `0` (`:56-58`) |
| Share class | `decimals` has a zero-only validator and the `share_token_whole_units` check constraint (`backend/tokens/models/share_token.py:47`, `:85`) |
| Register | `RegisterPosition.shares` and `ShareRegister.issued_supply` are `DecimalField(decimal_places=0)` (`backend/tokens/models/register.py:26`, `:52`) |
| Register event | The entry guard requires every change's `shares` to match `^-?[1-9][0-9]{0,77}$` — a whole, non-zero, signed integer (`backend/tokens/migrations/0062_register_foundation.py:89`) |

Three consequences follow, and they decide most of this page. There is no
representation of a fractional share to round into, so a ratio that does not
divide a holding exactly has nowhere to put the remainder. There is no cash rail
to pay a fraction out with. And a corporate action that produces a remainder
cannot be recorded at all: the guard above refuses a fractional change before any
service sees it.

## Why neither can be a function on a live class

[`ShareToken.sol`](../../contracts/contracts/ShareToken.sol) is the whole of what
a deployed class can do:

| Member | Effect |
| --- | --- |
| `authorizedShares` (`:12`) | The cap, readable by anyone |
| `mint(address, uint256)` (`:34-40`) | `onlyOwner`, `whenNotPaused`, reverts `ExceedsAuthorizedShares` when `totalSupply() + amount > authorizedShares` |
| `setAuthorizedShares(uint256)` (`:42-46`) | `onlyOwner`, refuses any amount below `totalSupply()` |
| `pause` / `unpause` (`:48-54`) | `onlyOwner`; the pause reaches every movement through `ERC20Pausable._update` |
| `burn` / `burnFrom` (from `ERC20Burnable`) | Holder-side: `burn` destroys the caller's own shares, `burnFrom` spends an allowance the holder granted |
| `_update` (`:60-66`) | Refuses a recipient the company registry does not list, and a sender it does not list, on every movement including a mint |

There is no rebase, no balance scaling factor, no owner-initiated burn, no
snapshot extension and no supply-wide write of any kind. The factory deploys with
`new ShareToken(...)`
([`ShareTokenFactory.sol:47`](../../contracts/contracts/ShareTokenFactory.sol)),
a direct create behind no proxy: `proxy`, `upgradeab`, `UUPS`, `initializer`,
`ERC20Snapshot`, `ERC20Votes` and `rebase` match nothing in `contracts/`. The
compiler settings and the OpenZeppelin pin are themselves
[a contract](../decisions.md#contracts-compiler-and-toolchain), so even a new
contract version is a deliberate bytecode change.

A deployed class is therefore its bytecode, permanently. That rules out three
things an implementation might otherwise reach for: scaling every balance in one
transaction; the company destroying a holder's shares; and adding any function to
a class that is already on chain. Three routes remain.

| Route | Covers | What it needs |
| --- | --- | --- |
| Issue to every holder pro rata | A split only | A cap increase first, then one mint per holder through the existing issuance path |
| Redeploy the class and re-anchor its register | Both | A new class at the new ratio, holdings mirrored onto it, the old class paused — the machinery [#647 deferred as part 3](https://github.com/Ledova/ledova/issues/647#issuecomment-5772293439) |
| Add a split function to `ShareToken.sol` | Classes deployed after the change | A contracts change, its own issue, and an estate that is split-capable in part |

The first route reuses machinery that is proven end to end. The second is the
only one that covers a consolidation, and its prerequisite — a `tokenise`
instruction approving mints that mirror each member's stored holding with no new
shares and no issue entries, then an anchoring opening — is deferred until an
imported class first needs to go on chain. It also does not preserve the class's
identity: the factory refuses a second class under the same `<acn>:<symbol>`
identifier (`ShareTokenFactory.sol:34`) and the database refuses a second class
under the same company and symbol (`unique_company_symbol`,
`backend/tokens/models/share_token.py:86-89`), so the replacement carries a
different symbol, and it carries a different register, because
`ShareRegister.token` is one-to-one (`backend/tokens/models/register.py:22`). The
third route is the cheapest per action and the closest fit to what the action is,
and it divides the estate into classes that can split and classes that cannot,
with the second route as the only way across. It belongs to a contracts issue
rather than to this one.

So: a split is executable today as an issuance, sequenced after a cap increase;
a consolidation is not executable today at all.

## The cap

A split multiplies issued supply, so it must be sequenced around a capital
increase, and the ordering is the load-bearing part of this design.

`mint` refuses anything that would carry `totalSupply()` past `authorizedShares`
(`ShareToken.sol:35-36`), and execution refuses before signing: `_preflight`
reads `authorizedShares()` and `totalSupply()` from the chain and raises
`EXCEEDS_AUTHORIZED` rather than broadcasting
(`backend/tokens/services/issuance_execution.py:316-321`). So an unsequenced
split does not revert on chain; it stops part-way. The mints that fit the
existing cap complete and the rest fail as refused requests, leaving a class
where some members have been multiplied and others have not. The register and
the chain still agree with each other — reconciliation compares them, not the
ratio — so nothing raises a discrepancy. The only record of the fault is the
holdings themselves.

The increase must therefore be executed to `new_authorized_total` at least the
post-split supply, and must be complete before the first mint.
`one_capital_increase_in_flight_per_token`
(`backend/tokens/models/capital_increase.py:55-61`) allows one increase per class
at a time, and an increase approved against a superseded cap is refused on that
ground, so a split cannot borrow headroom from a second increase running
alongside. Note that `ShareToken.total_supply` in the database is the authorized
cap, not the issued supply: it is written from `intent["new_authorized_total"]`
on execution (`backend/tokens/services/capital_execution.py:503-505`). Issued
supply is `ShareIssuance.objects.completed_supply()`, the register's
`issued_supply`, or the chain's `totalSupply()`.

A consolidation reverses the order. `setAuthorizedShares` refuses any amount
below `totalSupply()` (`:43`), so the cap can only follow the reduction down,
and only once every reduction has landed. A split is cap-change-first; a
consolidation is cap-change-last.

## Rounding

A 3-for-2 split of a holding of 5 shares is 7.5 shares, which does not exist at
any layer. The same arises for any ratio expressed as N-for-M with M greater
than one, and for every consolidation.

| Policy | What it costs |
| --- | --- |
| Round up | Issues shares nobody subscribed for, by an amount that depends on who holds what; needs its own authority and its own consideration story |
| Round down and pay the fraction out | Needs a cash rail to the holder, which does not exist |
| Refuse a ratio that does not divide every holding exactly | One check before the action, and no rounding or fraction machinery anywhere |

**Refuse.** Before anything is approved, the service compares the ratio against
every stored position in the class and refuses the instruction if any holding
carries a remainder, naming the members whose holdings do. Odd lots are then
settled off the platform, by transfer or by the company, and the action is
instructed again against the register as it then stands. This keeps the platform
from inventing shares it cannot account for or owing money it has no way to pay,
and it is the only policy that needs nothing built to support it.

A split by a whole number never has this problem, because multiplying a whole
number by a whole number is exact. The check is still run for both, because the
ratio is entered rather than derived.

## Who does what, and what the register records

A split is an operator process on the company's instruction, not a company-facing
action and not an automatic one. It follows the shape the register already uses
for issues and transfers: the company owner submits an instruction naming the
approving director, the authority and its evidence; staff review and apply it;
and the reviewer becomes the recorder of what the register then holds
([register instructions](../operations/register-foundation.md#register-instructions-for-issues)).
`RegisterInstructionKind` has `issue` and `transfer` only
(`backend/tokens/models/register_instruction.py:12-14`), and its guard enumerates
the kinds in SQL, so a corporate-action instruction is a new kind plus a
migration that rewrites that guard — the shape
`backend/tokens/migrations/0076_transfer_instructions.py:43` used to add
`transfer`.

The register entry kinds that exist are `opening`, `issue`, `transfer`,
`cessation` and `correction` (`backend/tokens/models/register.py:9-14`). None
records a split. The kinds are also enumerated in the entry guard
(`backend/tokens/migrations/0062_register_foundation.py:77`), which further
constrains their shapes: an `issue` or a `cessation` carries exactly one change,
a `transfer` exactly two summing to zero, a `correction` exactly the inverse of
the entry it names (`:110-127`). Adding a kind is a model change, a guard
rewrite, and a decision about each output that switches on kind —
`NOTICE_ENTRY_KINDS` and `CERTIFICATE_ENTRY_KINDS`
(`backend/tokens/services/register.py:147-148`), the certificate refusal
(`:600-601`) and the period rows the notice figures print.

The two routes produce different records, and this is the clearest argument
between them.

- **Issue to every holder pro rata.** One `ShareIssuanceRequest` per holder, one
  chain transaction each, one `issue` entry each. No new entry kind is needed and
  no new instruction kind is strictly needed, since each mint is an issue. In
  exchange the register shows a split as N unrelated issues rather than one
  event, each dated the day it is recorded rather than the day the action took
  effect; a member the register carries with no linked wallet cannot be minted to
  at all; and a member whose company approval has expired cannot receive, because
  `_update` checks the recipient on a mint and `isWhitelisted` is
  `expiresAt > block.timestamp`
  ([`WhitelistRegistry.sol:21-23`](../../contracts/contracts/WhitelistRegistry.sol)).
  Amount paid also stops being reportable for the touched holdings, because it is
  shown only for a holding that is still its paid allotments.
- **One entry for the action.** A new kind, say `reclassification`, carrying one
  change per member and dated the day the action takes effect. The projection
  applies every change in an entry uniformly and maintains positions and issued
  supply from them
  (`backend/tokens/migrations/0062_register_foundation.py:139-163`), so no
  projection code changes and the register records the action as the single event
  it was. It costs the guard rewrite, the output decisions above, and — for a
  split — a reconciliation story that matches the N mints the chain actually saw
  against the one entry the register holds.

Either way the reconciliation rule is unchanged and unforgiving: it compares each
member's stored position against the chain balances of that member's linked
wallets, and the register's issued supply against the chain's
(`backend/tokens/services/register_reconciliation.py:188-210`). A split recorded
in the register but not executed on chain raises a `member` discrepancy for every
holder and a `supply` discrepancy for the class. Recording a corporate action the
chain did not perform is therefore not an option, only a defect.

## A consolidation is not executable today

Nothing can reduce a holder's shares. The company owns the class and can mint,
but `ERC20Burnable` gives only `burn`, which destroys the caller's own shares,
and `burnFrom`, which spends an allowance the holder granted. Neither is
available to the operator on a holder's behalf, and `ERC20Pausable` blocks both
while the class is paused, so pausing first does not help. The platform holds no
investor keys; the only holder-authorised chain action it relays is an EIP-712
swap order settled by `AtomicSwap`, which moves shares between two parties and
destroys none. A consolidation that depended on each holder granting an allowance
could not be completed against a holder who declined, which is the opposite of
what a consolidation is.

The stored register cannot express one either, independently of the chain. A
`cessation` must take a member to exactly zero and a `correction` must be the
exact inverse of an earlier entry
(`backend/tokens/migrations/0062_register_foundation.py:104-105`, `:116-127`),
so no existing kind can reduce a holding partially.

Executing one therefore needs, at minimum: a way for the class to destroy shares
under the company's authority, which is a contracts change on a class that does
not yet exist, or the redeploy-and-re-anchor route and its deferred
prerequisite; a register entry kind that can reduce a holding without ending the
membership; and an answer for the holder who will not cooperate. Until those
exist, a consolidation is refused rather than attempted.

## What this design does not settle

An implementation issue decides these; this page does not.

- Which route a split takes, and whether the contracts change is made first so
  that both actions share one mechanism.
- Whether the register records one entry for the action or one per holder, and
  which outputs the new kind joins — notices, certificates, or neither.
- How a certificate is expressed for a holding that a corporate action changed
  rather than issued or transferred.
- What the effective date of a split is when the mints land across several days,
  and whether the entry may be dated before the register's latest entry, which
  issues and transfers are refused for doing.
- Whether an in-flight offering, subscription or settlement blocks a corporate
  action on the class, and what happens to an order priced in pre-split shares.
- How holders are told, and what the investor-facing history shows so that a
  holding that multiplied does not read as a gift.
- Whether the operator may act without a director's instruction in any case.

Next: [contracts and issuance](contracts-and-issuance.md),
[the register](register.md) and the [register foundation runbook](../operations/register-foundation.md).
