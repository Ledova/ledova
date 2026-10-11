# Share splits and consolidations

[Architecture](README.md) · [Contracts and issuance](contracts-and-issuance.md) · [Register of members](register.md)

A design, not a mechanism. No model, service, endpoint, register entry kind or
contract function for a split or a consolidation exists. The owner decided on
23 September 2026 that the design lands in
[#649](https://github.com/Ledova/ledova/issues/649#issuecomment-5789320596) and
that any implementation belongs to a later issue; the 9 October essential scope
does not include it ([decision](../decisions.md#splits-and-consolidations)).
A later implementation would be prepared and approved by appointed company users
under the delivered authority model, and company authority cannot substitute for
holder signatures where the contract requires them. #649 holds the route
comparison, cap sequencing, rounding policy, record shape and open questions.
This page records what the deployed contracts and the stored register allow and
refuse today.

## What each one is here

A split multiplies every holding in a share class by one ratio; a consolidation
divides them by one ratio. Neither moves value between members or changes any
member's proportion of the class. Both change issued supply, so both run into
the authorized cap.

Shares are whole units at every layer, enforced rather than assumed:

| Layer          | What fixes whole units                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract       | [`ShareToken.decimals()`](../../contracts/contracts/ShareToken.sol) is `pure` and returns `0`                                               |
| Share class    | `decimals` has a zero-only validator and the `share_token_whole_units` check constraint (`backend/tokens/models/share_token.py`)             |
| Register       | `RegisterPosition.shares` and `ShareRegister.issued_supply` are `DecimalField(decimal_places=0)` (`backend/tokens/models/register.py`)       |
| Register event | The register entry guard (`tokens/database_guards.py`) requires every change's `shares` to be a whole, non-zero, signed integer              |

So there is no fractional share to round into, no cash rail to pay a fraction
out with, and a corporate action that produces a remainder cannot be recorded
at all. `RegisterInstructionKind` has `issue` and `transfer` only, and the entry
kinds are `opening`, `issue`, `transfer`, `cessation` and `correction`: none
records a split, a `cessation` must take a member to exactly zero, and a
`correction` must be the exact inverse of an earlier entry, so no existing kind
can reduce a holding partially.

## Why neither can be a function on a live class

[`ShareToken.sol`](../../contracts/contracts/ShareToken.sol) is the whole of what
a deployed class can do:

| Member                                      | Effect                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `authorizedShares`                          | The cap, readable by anyone                                                                                      |
| `mint(address, uint256)`                    | `onlyOwner`, `whenNotPaused`, reverts `ExceedsAuthorizedShares` when `totalSupply() + amount > authorizedShares` |
| `setAuthorizedShares(uint256)`              | `onlyOwner`, refuses any amount below `totalSupply()`                                                            |
| `pause` / `unpause`                         | `onlyOwner`; the pause reaches every movement through `ERC20Pausable._update`                                    |
| `burn` / `burnFrom` (from `ERC20Burnable`)  | Holder-side: `burn` destroys the caller's own shares, `burnFrom` spends an allowance the holder granted           |
| `_update`                                   | Refuses a recipient the company registry does not list, and a sender it does not list, on every movement         |

There is no rebase, balance scaling factor, owner-initiated burn, snapshot
extension or supply-wide write, and the factory deploys with `new ShareToken(...)`
behind no proxy, so a deployed class is its bytecode permanently; the compiler
settings and OpenZeppelin pin are themselves
[a contract](../decisions.md#contracts-compiler-and-toolchain). A split is
therefore executable today only as one issuance per holder, sequenced after a
capital increase that lifts the cap to at least the post-split supply: `mint`
and the issuance preflight both refuse beyond the cap, so an unsequenced split
stops part-way with the register and the chain still agreeing. A consolidation
is not executable today at all. Nothing can reduce a holder's shares:
`ERC20Burnable` gives only the holder-side `burn` and `burnFrom`,
`ERC20Pausable` blocks both while paused, the platform holds no investor keys,
and the only holder-authorised chain action it relays is an EIP-712 swap
settled by `AtomicSwap`, which moves shares and destroys none. Until a class can
destroy shares under company authority, a register entry kind can reduce a
holding without ending the membership, and there is an answer for the holder
who will not cooperate, a consolidation is refused rather than attempted.

Next: [contracts and issuance](contracts-and-issuance.md),
[the register](register.md) and the [register foundation runbook](../operations/register-foundation.md).
