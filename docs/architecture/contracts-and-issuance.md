# Contracts and share issuance

[Architecture](README.md) · [Documentation](../README.md)

How a share class is deployed and shares are minted within its authorized cap.

## Company authority and technical execution

The [company-managed plan](company-managed-registers.md#existing-gates-to-replace)
makes the company decision and the technical signer distinct. Company-appointed
users must authorise supported whitelist, issue/allotment and capital changes
within their mandates; a backend signing key or privileged connection grants no
human company authority. [Empty deployment](../plans/company-managed-registers/company-deployments.md)
now uses a company decision family in both clients. Explicit
[wallet nomination and company approval](../plans/company-managed-registers/company-wallet-approvals.md)
and [non-paid chain grants](../plans/company-managed-registers/company-register-issues.md)
have their own bounded company workflows. [Capital increases](../plans/company-managed-registers/company-capital-increases.md)
use exact company preparation, approval and application. Paid issuance and pause
conversion remain later #867 increments; their current checks stay effective
until their service and database guards are replaced together.

The lifecycle below describes current code. Preserve whole-share arithmetic,
authorised headroom, wallet possession and company registry approval for chain
actions, original signed bytes, finality and atomic register recording. A
non-paid employee grant must record its actual terms and authority rather than
invent a paid subscription. An import-origin register
cannot issue or transfer through chain register instructions. The
[non-paid grant workflow](../plans/company-managed-registers/register-grants.md)
records genuine company-approved ledger issues without deployment or a wallet.
[Direct non-paid transfers](../plans/company-managed-registers/register-transfers.md)
also record genuine ledger effects with instruments, named approval and retained
exit/return history. Later tokenisation needs additional execution work.
Non-chain changes must retain real ledger authority without fake chain receipts;
later tokenisation mirrors those holdings without issuing them twice.
Changing company authority does not by itself change deployed contract ownership
or bytecode, and must not be presented as such.

## Contracts

The current contracts are Solidity 0.8.24, OpenZeppelin-based, and operator-key owned.

| Contract                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhitelistRegistry.sol` | One company's allowlist. `setExpiry(address, uint64)` is the only write and is owner-only; `expiresAt(address)` is the stored expiry; `isWhitelisted(address)` is `expiresAt > block.timestamp`. Zero removes a wallet and `type(uint64).max` never expires. It has no pause: the token pause is the incident lever                                                                                                                                                                 |
| `ShareToken.sol`        | One share class. ERC-20 with 0 decimals, burnable, pausable, bound at construction to its company's registry. `authorizedShares` is the cap; `mint` reverts unless the cap holds; `_update` refuses any movement to a wallet the registry does not list and any transfer from one, so an expired or removed holder can neither receive nor send, directly or through `transferFrom`. Burning one's own shares is not checked. `setAuthorizedShares` cannot go below `totalSupply()` |
| `ShareTokenFactory.sol` | `createShareToken(name, symbol, identifier, acn, authorizedShares, owner)`, `getTokenByIdentifier(identifier)` and `registryOf(acn)`. The identifier is the deduplication key and must be the company's own, `<acn>:<symbol>`, which the factory checks. A company's first class creates its `WhitelistRegistry`, owned by the class owner, and emits `WhitelistRegistryCreated(acn, registry)`; its later classes share that registry and must have the same owner                 |
| `AtomicSwap.sol`        | EIP-712 swap settlement between an approved share token and an approved payment token, executed by an authorised relayer. It holds no registry: the share token's own `_update` checks both parties                                                                                                                                                                                                                                                                                 |
| `AUDY.sol`              | Minter-gated AUD stablecoin, 2 decimals, the payment token. Its `assets.Asset` row plus its `AssetChainDeployment` on the operator's receiving chain are the only representation of a settlement token; `operators/settlement.py` resolves them                                                                                                                                                                                                                                     |
| `AUSG.sol`              | NAV-bearing token with a redemption queue; not part of the issuance flow                                                                                                                                                                                                                                                                                                                                                                                                            |

`deploy-all.ts` deploys `ShareTokenFactory`, `AtomicSwap` and `AUDY` and writes
their addresses to `.deployed-contracts.env` at the
repository root. `network-safety.ts` refuses any chain id outside
`{1337, 31337, 84532}`.

**The compiler settings are a contract, not a default.** Solidity 0.8.24 with
`evmVersion: "paris"`, the optimizer at 200 runs and `viaIR` on. OpenZeppelin is
pinned at 5.4.0. Any change to those four moves the generated bytecode of every
contract, so a dependency update that needs one of them is not a dependency
update.

A compiler target or library change needs a deliberate bytecode/toolchain review.
Why the pin stays, what would reopen it, and why the contracts package's
advisories need their own reading are recorded in the
[contracts toolchain decision](../decisions.md#contracts-compiler-and-toolchain).
See [testing](../development/testing.md) for compilation, chain checks and advisory review.

## Data flow of an issuance

1. An operator or issuer creates a `ShareToken` in `DRAFT` with a name, symbol
   and `total_supply` (the authorized cap). The historical API key `totalSupply`
   is this same cap; `issuedSupply` and the contract's `totalSupply()` are
   shares actually issued. Shares use whole units: model validation and the
   `share_token_whole_units` database constraint require `ShareToken.decimals`
   to be zero, matching the contract. Settlement assets keep their own decimals.
   Through the API, a new symbol is 3–5 letters, stored in capitals. Neither
   the API nor admin accepts a new or changed symbol that a supported asset
   uses (`SUPPORTED_ASSETS`: BTC, ETH, USDC, USDT, AUDY, AUSG), in any letter
   case, preventing new symbol collisions with crypto or payment assets.
   Existing classes keep their symbols.
2. `/api/v1/tokens/register-deployments/` provides company preparation, preview,
   approval, application and rejection. A draft requires an active company, the
   existing selected issuer wallet and proven empty register state. Preparation
   freezes company/class/issuer metadata, the factory intent and register boundary.
   Application consumes the exact approval; its original deployment UUID,
   `DEPLOYING` status and actual applying-principal job commit together. Exact
   request replay returns its retained receipt without a new effect. The former
   owner deploy action and fresh staff deploy admission are retired.
3. The worker materialises a private `TokenDeployment` under the original applied
   source and intent, including when source loss now holds unsigned work. Its
   immutable nullable source association preserves legacy journals without
   inventing company approval. The identifier is `<acn>:<symbol>`; a company
   may have several share classes. An existing factory address without an
   attributable local deployment remains pending for operator attribution.
4. The shared outgoing journal commits the signed bytes, nonce, hash and token
   association before broadcast. Recovery uses the original transaction and
   matching factory event. Unknown outcomes remain `DEPLOYING`; a signed admin
   confirmation may retry a definite unsigned failure or revert with the same
   intent, subject to the original company source for fresh signing. The
   five-minute sweep recovers admitted work. Deployment mints
   nothing: the contract's `totalSupply()` starts at zero. See
   [deployment persistence](#deployment-persistence).
5. A participant proves possession of their selected wallet and explicitly
   nominates it against current GENERAL eligibility for the exact company.
   Company appointees approve its finite registry expiry and admit the original
   ADD journal. Possession, eligibility and company approval remain separate.
   `WhitelistEntry` is the one identity row per wallet: it either points at a
   `Wallet` or carries a bare `address` plus a `label` for an operator-held
   treasury address; a database constraint requires one of the two and makes
   bare addresses unique. Each company approval is a `WhitelistApproval` row for
   that entry and company, mirroring the company registry's expiry. See
   [whitelist changes](outgoing-signing.md#whitelist-changes).
6. `/api/v1/tokens/register-issues/` provides company preparation, preview,
   approval, application and rejection for one exact non-paid chain grant.
   It requires a genuine CHAIN opening, exact member link, current nomination
   and finite company ADD. Preparation retains authority, terms and any required
   acceptance evidence and freezes one request under the existing `UNDER_REVIEW`
   state. Human approval remains separate; application makes the request approved
   and admits its original execution atomically. No paid subscription or receipt
   is created. The old direct owner issue POST is retired. Genuine paid allotments
   retain their current
   [register instruction](../operations/register-foundation.md#register-instructions-for-issues)
   that lists them, and execution admission is separate. Admission retains the
   approved terms and matching job in a private command. Before signing,
   execution checks whitelist membership, the cap and pause state. A known
   refusal in the paid or legacy path becomes a definite unsigned failure with a
   safe explanation. An unsigned company grant retains its original recoverable
   intent during source contention, temporary technical refusal or provider
   failure. Permanent loss of its captured source can terminalise only its
   original never-signed allocation; signed originals retain their recovery.
7. The worker durably claims the request before opening its shared outgoing
   operation. Its public `ShareIssuance` uses `issuance-request:<uuid>` as the
   idempotency key. Signed bytes, hash, nonce and the transaction association
   commit together before broadcast. The existing network finality policy and
   original receipt/mint-event verification precede atomic completion of the
   issuance, request and linked subscription. A first receipt alone leaves it
   executing; a mined revert also waits for finality before failure permits retry.
   `check_executing_issuance_requests` recovers interrupted work every five
   minutes. Unknown sends retain the original identity; a confirmed failure
   requires a fresh confirmation naming that failed attempt.
   A company grant records its original member's ISSUE once after the outcome
   transaction. An executed but unentered original remains reserved until that
   entry exists; chain completion alone does not establish register recording.
   [Share-issuance boundaries](outgoing-signing.md#share-issuances) describe
   queued refunds, public guards and historical recovery.
8. A capital increase calls `setAuthorizedShares(new_authorized_total)` and
   mints nothing. A current company appointee prepares the exact current cap,
   positive delta and target with retained authority evidence. Approval alone
   admits no execution; application commits the original request, immutable private
   intent and background job before any chain call. Network work runs outside
   database transactions; an unresolved request retains the existing per-token
   in-flight slot. The shared signing journal preserves the original bytes, hash
   and nonce. Completion requires the original transaction's successful receipt
   and its `AuthorizedSharesUpdated` event matching both approved cap values.
   A matching current cap alone never establishes execution.
   The five-minute `recover_capital_increases` task repairs admitted work.
   Fresh signing rechecks the exact source and consumed personal authority.
   Temporary source or lock unavailability retains unsigned work; explicit
   revocation or expiry of its consumed appointment retires a genuinely never-signed
   original and releases its slot. Signed work recovers the original receipt.
   Definite unsigned or reverted failures need a fresh technical confirmation of
   that exact failed attempt and current company source. Retained historical
   supersession and attribution remain separate; no company authority is backfilled.
   See [capital recovery boundaries](outgoing-signing.md#capital-increases).
9. Pause and unpause read `paused()` first and reconcile the database when the
   chain is already in the target state.
10. Deployment writes a verified `assets.Asset` (`tokenized_security`,
    `decimals` 0) and an `AssetChainDeployment` at the address the factory
    attests; completing an issuance writes the recipient's `Holding` from
    `balanceOf`. Share tokens deployed before this existed are bridged by
    `manage.py bridge_share_assets`, which is idempotent and never runs on its
    own.

Reviewers write `review_notes`; execution attempts append timestamped entries to
`execution_notes` in the database, so an older request object cannot overwrite
an intervening attempt. Successful execution adds its outcome to that same log
after earlier refusals (`ReviewRequest.mark_executed` in
`backend/tokens/models/review_request.py`), so the history does not stop at the
last failure. Reviewer notes are omitted from the issuer serializers and from
the client type in `packages/shared/src/types/domain/company-token.ts`; issuers
receive execution notes and rejection or supersession reasons. Issuance and capital recovery retain transaction identity and safe error
categories in operator records; provider URLs and exception text do not enter
public responses or recovery diagnostics.

Issuers read their requests through `GET /api/v1/tokens/issuance-requests/`,
filtered by token, company or status; the endpoint is read-only. List and detail
reads retain company ownership checks even when the database allows a subscriber
to read the linked request for withdrawal checks. Submitting an approval request
writes database state without opening a chain connection; chain checks belong to
execution of an approved request.

## Deployment persistence

`backend/tokens/services/deployment.py` admits one immutable `TokenDeployment`
for each queued submission. Its UUID snapshots preserve token/company/issuer
identity; new journals also retain their exact company proposal and consumed
approval. Captured wallet/account/profile/user identifiers remain private JSON
associations rather than customer-deletion foreign keys.
Historical rows retain null submission identities and their original hashes and
records; they are not automatically attributed or imported into the outgoing journal.

The shared outgoing journal's local signing callback commits `SignedAttempt`
bytes, the reserved nonce, the `BlockchainTransaction` and the public token's
hash/transaction association in one durable operator transaction. It refuses
surrounding transactions, competing bindings and changed admitted terms. Inside
that transaction a narrow source-lock context precedes outgoing/signer/journal
locks and rechecks the exact consumed approval, approving/applying mandates,
captured wallet, configuration and register state immediately before signing.
Temporary contention or source loss holds the original unsigned operation without
a signed attempt or nonce. Operator recovery reconciles already-signed originals
after company source loss; legacy NULL-source work cannot obtain a fresh signature.

Unknown sends and lost commit acknowledgements recover the original signed
bytes, hash and nonce. Definite preparation failures and reverts retain their
intent; an explicit retry names the failed claim, so stale jobs and forms cannot
reopen a later terminal attempt. A retry records the previous transaction's
revert before reopening its operation. New transaction projections are excluded from
the legacy hash monitor. Only the original operation's receipt, with a factory
creation event matching identifier, symbol and cap, can establish the contract.
An identifier lookup or current share cap cannot substitute for attribution.

Projection checks the current token/submission/company and chain/factory before
writing public state. A failed asset bridge stays recoverable after the token's
contract is recorded. The bounded sweep rotates unresolved work by update time
and repairs interrupted revert projections without opening another attempt.
Once their transaction projection is complete, terminal failures await explicit
retry. Successful projection atomically queues a separate immutable swap approval
phase on the private deployment record. Approval failure leaves the token deployed;
its own recovery follows the original signed transaction. Complete
same-key cutover, historical attribution and finality remain outstanding. Signer
admission remains closed by default. See [outgoing signing](outgoing-signing.md).

Next: [offerings](offerings.md), [subscriptions](subscriptions.md), and [chain setup](../operations/chains.md).
