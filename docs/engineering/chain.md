# Contracts and chain

[Engineering](README.md) · [Documentation](../README.md)

For engineers working on the contracts and the backend's chain and wallet records. Who decides each
action is in [issuing shares](../business/issuing-shares.md) and
[participants](../business/participants.md); user-signed transfers are in
[wallet protocols](wallet-protocols.md), swap settlement in [trading protocols](trading-protocols.md),
and keys, deployment scripts, their addresses and allowed chain ids in
[chain setup](../operations/chains.md#allowed-chains-and-finality).

## Contracts

The OpenZeppelin-based Solidity contracts in `contracts/contracts/` are owned by the operator key
(the backend's signing address); company decisions change neither ownership nor bytecode.

| Contract                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhitelistRegistry.sol` | One company's allowlist. `setExpiry(address, uint64)` is the only write and is owner-only; `isWhitelisted(address)` is `expiresAt(address) > block.timestamp`. Zero removes a wallet and `type(uint64).max` never expires. No pause: the token pause is the incident lever                                                                                                                                                                                                                                                          |
| `ShareToken.sol`        | One share class: ERC-20 with 0 decimals, burnable and pausable, bound at construction to its company's registry (`whitelist()`). `mint` reverts with `ExceedsAuthorizedShares` above the `authorizedShares` cap; `setAuthorizedShares` cannot go below `totalSupply()` and emits `AuthorizedSharesUpdated(oldAmount, newAmount)`                                                                                                                                                                                                    |
| `ShareTokenFactory.sol` | `createShareToken(name, symbol, identifier, acn, authorizedShares, owner)`, `getTokenByIdentifier(identifier)` and `registryOf(acn)`. The identifier is the deduplication key and must begin with the company's `<acn>:`; the backend sends `<acn>:<symbol>`. A company's first class creates its `WhitelistRegistry`, owned by the class owner (`WhitelistRegistryCreated(acn, registry)`); later classes share it and must have the same owner. Each class emits `ShareTokenCreated(token, identifier, symbol, authorizedShares)` |
| `AtomicSwap.sol`        | EIP-712 settlement (domain `LedovaAtomicSwap`, version 1) between an approved share token and an approved payment token, executed by an authorised relayer. It holds no registry: the share token's `_update` checks both parties                                                                                                                                                                                                                                                                                                   |
| `AUDY.sol`              | Minter-gated AUD stablecoin with 2 decimals, the payment token. A settlement token is only its `assets.Asset` row and `AssetChainDeployment` on the operator's receiving chain, which `backend/operators/settlement.py` (`deployment_for`, `require_deployment`) resolves; the asset API's `contractAddress` is only an asset's single active deployment, possibly on another chain                                                                                                                                                 |
| `AUSG.sol`              | NAV-bearing token with 6 decimals, a redemption queue and `NAVUpdated` events; not part of issuance                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Compiler and toolchain pin

Solidity 0.8.24 with `evmVersion: "paris"`, the optimiser at 200 runs and `viaIR` on
(`contracts/hardhat.config.ts`), and OpenZeppelin 5.4.0 (`contracts/package.json`) are part of the
contract: changing any of them moves every contract's bytecode and needs a deliberate bytecode and
toolchain review. Why the pin stays, what would reopen it and how the contracts package's advisories
are read are in the [toolchain decision](../decisions.md#contracts-compiler-and-toolchain);
compilation and the manual chain check are in [testing](testing.md).

### What the contracts allow and refuse

These bytecode properties, from
[the bypass review](../operations/approval-controls.md#the-bypass-review), hold whatever the backend does.

- `_update` is the single enforcement point: a direct `transfer`, a delegated `transferFrom` or a
  swap settlement is refused when either party is expired or removed, as is a mint to an unapproved
  recipient. Expiry is exclusive: a movement is allowed in the last second an approval names and
  refused in the second the expiry names.
- Burns are not checked, having no recipient. A holder may burn their own shares, by the owner's
  decision, and register reconciliation reports it. `burnFrom` by an approved spender succeeds even
  against an expired or removed holder, whose allowance was granted while approved; that spender's
  `transferFrom` is refused, as is `burnFrom` without an allowance.
- A swap settlement is refused with both nonces preserved when the seller was never approved or has
  expired, with the nonce preserved when either party is removed, and with no payment moved when the
  buyer has expired.
- One registry per ACN: one approval covers all of a company's classes, one removal freezes them
  all, and an approval grants nothing on another company's token, directly or through a swap.
- Only the registry's owner can call `setExpiry` (not the factory's owner), and only the token's
  owner can pause; a paused token refuses transfer, mint, delegated transfer, burn and swap
  settlement. `renounceOwnership` freezes a registry for good, so approvals only lapse and holdings
  freeze with them; on a token it freezes minting, cap changes and the pause lever, while the
  registry still governs transfers.
- A token the factory did not create, once the swap's owner approves it, moves through a swap with no
  approval check, because the swap relies on the token's `_update` (a `ShareToken` deployed outside
  the factory still enforces its given registry). The backend never approves one: swap approvals
  are built from a `TokenDeployment`, and a deployment from a factory other than the configured one
  is never projected. That is a backend rule, not a contract one.

### Why splits and consolidations cannot run on a live class

The rule and deferral are in [issuing shares](../business/issuing-shares.md#splits-and-consolidations)
and the [decision](../decisions.md#splits-and-consolidations). No model, service, endpoint, entry
kind or contract function for either exists, and shares are whole units at every layer:

| Layer          | What fixes whole units                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract       | [`ShareToken.decimals()`](../../contracts/contracts/ShareToken.sol) is `pure` and returns `0`                                                                             |
| Share class    | `decimals` has a zero-only validator and the `share_token_whole_units` check constraint (`backend/tokens/models/share_token.py`)                                          |
| Register       | `RegisterPosition.shares` and `ShareRegister.issued_supply` are `DecimalField(decimal_places=0)` (`backend/tokens/models/register.py`)                                    |
| Register event | The register entry guard (`tokens_guard_register_entry` in `backend/tokens/database_guards.sql`) requires every change's `shares` to be a whole, non-zero, signed integer |

`RegisterInstructionKind` has `issue` and `transfer` only; a `cessation` must reach exactly zero, a
`correction` must exactly invert an earlier entry, and `backend/tokens/database_mirror_guards.sql`
confines a `mirror_correction`'s signed differences to an imported register's applied snapshot
before deployment and any entry other than the opening and earlier mirror corrections. No kind can
reduce a holding partially on a live class. `mint`, `setAuthorizedShares` and `pause` are
`onlyOwner` (`mint` also `whenNotPaused`), burns are holder-side only (`ERC20Burnable`, blocked
while paused), there is no rebase, scaling factor, owner-initiated burn, snapshot extension or
supply-wide write, and the factory deploys with `new ShareToken(...)` behind no proxy, so a class is
its bytecode permanently. `mint` and the issuance preflight refuse beyond the cap, so a split run
as per-holder issues before a capital increase stops part-way with register and chain agreeing. The platform
holds no investor keys and relays only `AtomicSwap` settlements, which destroy no shares, so a
consolidation is refused until a class can destroy shares under company authority, an entry kind can
reduce a holding without ending the membership, and a holder who will not cooperate has an answer.

## Issuance data flow

1. The company owner creates a `ShareToken` in `DRAFT` through `POST /api/v1/tokens/` with a name,
   symbol and `total_supply`, the authorised cap (also the API key `totalSupply`; `issuedSupply` and
   the contract's `totalSupply()` count shares issued); settlement assets keep their own decimals. A
   new API symbol is 1 to 5 ASCII letters, stored in capitals
   ([class codes](../business/issuing-shares.md#share-classes)), and the API and admin refuse a new or
   changed symbol, in any case, that a supported asset uses (`SUPPORTED_ASSETS` in
   `backend/assets/services/sync.py`: BTC, ETH, USDC, USDT, AUDY, AUSG); existing classes keep theirs.
2. Each later step is a [signing family](#signing-families).
3. Deployment writes a verified `assets.Asset` (`tokenized_security`, `decimals` 0) and an
   `AssetChainDeployment` at the address the factory attests through `getTokenByIdentifier`
   (`bridge_share_asset` in `backend/tokens/services/share_token_service.py`); completing an
   issuance writes the recipient's `Holding` from `balanceOf`. `manage.py bridge_share_assets`
   bridges classes deployed before the bridge existed; it is idempotent and never runs on its own.

An import-origin register never takes chain issues, even after its zero book is deployed, and a
later tokenisation must mirror its holdings without issuing them twice
([planned](../business/issuing-shares.md#planned-tokenising-an-imported-register)).

### Request notes and reads

Reviewers write `review_notes`; each execution attempt, and finally success, appends a timestamped
entry to `execution_notes` in the database, so an older request object cannot overwrite an
intervening attempt (`ReviewableRequest.mark_executed` in `backend/tokens/models/review_request.py`).
Company-facing serializers and the generated `ShareIssuanceRequest` client type omit reviewer notes;
the company receives execution notes and rejection or supersession reasons.

`GET /api/v1/tokens/issuance-requests/` (filters `token`, `company`, `status`) applies the
company-owner check; `GET /api/v1/tokens/capital-increases/` lists retained private capital requests
under the same owner scope.

## Outgoing signing foundation

`backend/blockchain/services/outgoing.py` is the one journal through which the operator key
(`BLOCKCHAIN_OPERATOR_KEY`) signs and sends for every [signing family](#signing-families).
Participant-signed swap approvals, whose key the backend never holds, are the one settlement writer
outside it, journaled and replayed as exact bytes
([participant approvals](trading-protocols.md#participant-approvals)); user-signed wallet transfers
have [their own journals](wallet-protocols.md).

### Locks, holds and recovery

Every family takes its source and class locks before the outgoing operation and signer locks, and
makes chain calls outside them. New unsigned work rechecks the current company, capability,
mandates, sources, configuration, register state and exact terms immediately before the local
signature, and a known refusal becomes a definite unsigned failure. Temporary contention or loss of
an unsigned source holds the unsigned claim with no signature, attempt or nonce. Only explicit
revocation or database-clock expiry of the consumed approval can fail a genuinely never-signed
claim, releasing the family's in-flight slot and keeping its intent and journal; it does not
recategorise a definite preparation failure or signed work. Signed work recovers its original bytes,
nonce and receipt under operator authority alone; revocation never permits discarding or replacing a
signed transaction. The generic transaction monitor takes over none of these projections.

### Signer admission

`SigningAccount` rows start `closed`, as does a missing row, and only explicit admission opens one:
a nonce counter, legacy success or inventory capture never does. The
[fresh Base Sepolia bootstrap](#fresh-base-sepolia-admission) and
[local chain admission](#local-chain-admission) are the only first admissions, on a public testnet
and the local chain; neither reopens a signer or authorises legacy cutover, and there is no admin
edit surface. A public-network signer stays closed until the owner authorises activation and the
bootstrap runs in a fresh environment; company self-service relaxes neither that nor the drain and
cutover requirements below. Admitted synthetic test fixtures are a test precondition only.

Operator-only `close_signer_admission(chain_id=..., sender=...)` closes an account (creating it
closed if missing) and advances its generation, keeping claims, outcomes, counters and signed
payloads; it blocks preparation RPC, new signing and exact-byte broadcast, not receipt
reconciliation. Signing rechecks the generation preparation recorded under the operation and signer
locks, so a delayed preparer cannot survive a close and reopen. The maximum signed 64-bit generation
is reserved for closure, so an admitted account can always close; going past it is refused, with
no wrap or reset. Broadcast
admission takes a short operation-then-signer lock and commits before RPC, so a call that crossed it
before closure may still send and record its result: closure is a drain barrier, not cancellation or
credential revocation.

Activating a later adapter first needs every old same-key process and signing tool drained and cut
off from the credential, history recaptured, authorisation and intent bound, and reservations
imported or unresolved signers quarantined. Every remaining same-key writer must use the foundation
or be disabled without fallback, since old binaries skip this guard and the standalone Hardhat
deployment scripts send outside it. Provider absence, terminal history or today's key and chain
establish no historical authorisation and release no nonce; app-role handoff and each adapter's
durable transaction boundary still need proof; after signed activity, rollback cannot restore legacy
sending with that key. Admission and the [legacy inventory](https://github.com/Ledova/infra/blob/main/docs/deployment.md#legacy-signer-inventory)
give no global nonce guarantee and resolve no old business operation.

`inventory_outgoing_history` never signs, contacts a provider, changes a journal or status, or
reserves or releases a nonce. Its optional recorded capture commits private evidence and append-only
cutover holds atomically; an unchanged capture id replays the original batch, while changed source
needs a new id. Later captures never rewrite an observation or clear a hold. Reports always say
`cutover_authorized: false`. Raw payloads and source snapshots are operator-only, application
connections and enclosing transactions are refused, and PostgreSQL denies UPDATE or DELETE on the
inventory tables. An inventory capture never authorises activation or proves that offline or
old-binary key use has stopped.

### Fresh Base Sepolia admission

`bootstrap_fresh_signer --manifest PATH` (`backend/blockchain/services/fresh_signer.py`) admits the
operator key on Base Sepolia from the five transactions that deployed the core contracts, reading
the chain without signing; when to run it is in
[fresh signer admission](https://github.com/Ledova/infra/blob/main/docs/deployment.md#public-testnet-environments).

The version-1 JSON manifest has exactly `version` (integer `1`), `chain_id` (integer `84532`),
`operator_address`, `environment_id` and `authorization_reference` (nonempty, at most 200 and 500
characters), `attestations` (`fresh_key`, `isolated_environment` and `producers_stopped`, each
literal `true`), `contracts` (`share_token_factory`, `stablecoin` and `atomic_swap`, distinct nonzero
lowercase or checksummed addresses) and `transactions` (five distinct hashes in deployment order);
unknown or duplicate keys are refused, and the canonical digest lowercases addresses and hashes.

The verifier checks the configuration and the key's address, reads the provider's chain id without
the client cache, and requires this zero-value sequence from that sender: nonce 0 creates
`ShareTokenFactory(sender)`, 1 `AUDY(sender)`, 2 calls `AUDY.addMinter(sender)`, 3 creates
`AtomicSwap(sender)` and 4 calls `AtomicSwap.setPaymentTokenApproval(AUDY, true)`. Creation bytes
come from the local Hardhat artifacts bound to their build-info, and addresses must match the
sender-and-nonce CREATE derivation. Every receipt must succeed with complete canonical evidence under
the configured `evm:84532` finalized policy (no depth fallback), refetched after evidence collection.
Runtime bytecode must match the build outside compiler-declared immutable slots, whose
initialisation the exact constructor bytes bind; contract owners, the AUDY minter, the swap relayer
and the payment-token approval must match; and latest and pending sender nonces must both be five.
Provider uncertainty, missing artifacts or mismatched evidence leaves admission closed.

The command refuses legacy source rows, unattributed chain transactions, imported outgoing evidence,
current outgoing operations or attempts, other signer state and any substantive inventory hold. It
needs the stopped-producer attestation because opening an unsigned operation takes no signer lock
and it cannot prove another process or offline key holder has stopped. Its final transaction takes a
deployment-wide admission lock, then locks the signer and rechecks history, so two fresh keys cannot
both admit against one apparently empty database; only a missing signer, or a closed
generation-zero, nonce-zero row, enters generation one with next nonce five. The unique bootstrap
receipt (manifest digest, artifact and build identities, chain evidence) commits with admission,
operator-only and protected from UPDATE or DELETE. An exact manifest replay, recognised before the
history and nonce checks, returns unchanged only while the same signer stays admitted at generation
one, keeping an advanced nonce; nothing here undoes closure, an earlier admission or a different
manifest.

### Local chain admission

`admit_local_signer` admits the configured `BLOCKCHAIN_OPERATOR_KEY` address on the local chain
(id 31337) only; the local Compose stack runs it last in `migrate`, after `chain-deploy` verifies the
core contracts ([the local chain](../operations/chains.md#the-local-stacks-chain)). Outside any
transaction it reads the database's signer record before the provider's chain id and mined nonce, so
a transaction mined and recorded between the reads cannot look missing, then admits under the signer
lock on an autocommit operator connection.

The configured chain id must be the integer 31337, the key valid and the provider answering 31337, or
nothing is admitted. A missing signer, or a closed one never admitted (generation zero), enters
generation one with its nonce counter unchanged; an admitted signer is returned unchanged
(idempotent), and one closed after admission stays closed. Each run refuses a chain that lost what
the database recorded: every nonce from the chain's mined count to the signer's next nonce must
belong to a signed transaction awaiting its receipt, or the chain was reset or lost blocks and
signing would leave a nonce gap the node never mines past. It prints one JSON object naming the
chain, address, generation and whether anything changed.

### Preparing, signing and broadcasting

Callers provide a stable operation key and immutable intent (chain, sender, target, value,
calldata); reusing a key with different terms is refused. `prepare_operation` reads the endpoint,
pending nonce, gas price and estimate outside database transactions. `sign_operation` locks the
operation, then the chain-and-sender account, takes the greater of the observed pending nonce and the
durable counter, and signs locally without RPC; the signed bytes, fixed hash, nonce reservation and
operation pointer commit together before `broadcast_operation` can submit anything. Each entry
point refuses an enclosing transaction or disabled autocommit.

Signing a prepared claim returns the winning attempt once another worker has signed, if the signer
is still admitted at the same generation. Restarting an unsigned failed attempt changes its claim
identifier, fencing delayed workers out. Signed work only rebroadcasts its saved bytes: missing
receipts, provider errors, already-known responses and nonce errors leave it unresolved and never
authorise another nonce.

The API signs EIP-155 legacy gas-price transactions, contract creation included. Chain ids and gas
limits fit a positive signed 64-bit integer, and allocated nonces stop one below its maximum so the
next counter fits. Value and gas price take unsigned 256-bit values.

### Receipts and outcomes

Receipt updates need the same claim and hash. A terminal success or revert needs a receipt naming
a nonzero block hash that matches the canonical block at its number; the service rereads both and
checks the endpoint's chain before and after. Missing, provisional (such as Base's all-zero block
hash, [recovery](../operations/recovery.md#before-recovering-anything)), changed or noncanonical
evidence leaves the attempt unresolved. These reads finish before the recording transaction, which
rechecks the claim and attempt fences under the lock.

A recorded revert permits a new claim and nonce, keeping the immutable earlier attempt, unless the
adapter refuses restart (swap execution does). `confirmed` means a successful receipt with
canonical inclusion was observed; the foundation applies no confirmation depth, replacement
detection or reorg repair. Share issuances, swap settlement and chain register openings also wait
for the network finality policy
([wallet chain observations](wallet-protocols.md#wallet-chain-observations)); the other families
complete on the canonical receipt and their own event checks.

### Journal storage and guards

PostgreSQL enforces immutable attempts, monotonic signer counters and guarded transitions.
`OutgoingOperation`, `SignedAttempt` and `SigningAccount` deny application-role access, even with a
user principal, and have no admin or serializer surface. The
[company pack](records.md#chain-evidence) carries each operation's intent, status and receipt and
each attempt's hash, nonce, signer and chain id, never the signed payload. Signed payloads are
broadcast capabilities for protected backups only; errors keep a category, not provider or database
exception text.

`shared/0002_database_guards` installs every family's guards on a fresh database from each app's
`database_guards.sql`. A row without a dispatch UUID or company source is historical work needing
operator attribution, never imported into the outgoing journal, with no automatic retry, fresh
signature or legacy sender fallback; ledova.io holds none
([decision](../decisions.md#backend-migration-baseline)).

## Signing families

Each family ends in one outgoing operation. The company decision pattern and route prefixes are in
the [company workflow API](backend.md#company-workflow-api), routes and fields in the
[OpenAPI schema](../../backend/schema/openapi.json), and operator procedures in
[recovery](../operations/recovery.md).

| Family                                                   | Private journal                      | Recovery task                                           |
| -------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| [Share-class deployment](#share-class-deployment)        | `TokenDeployment`                    | `check_pending_token_deployments`                       |
| [Automatic swap approval](#automatic-swap-approval)      | Approval fields on `TokenDeployment` | `recover_swap_approval`, `check_pending_swap_approvals` |
| [Whitelist change](#whitelist-changes)                   | `WhitelistChange`                    | `recover_whitelist_changes`                             |
| [Capital increase](#capital-increases)                   | `CapitalIncreaseExecution`           | `recover_capital_increases`                             |
| [Share issuance](#share-issuances)                       | `ShareIssuanceExecution`             | `check_executing_issuance_requests`                     |
| [Pause and unpause](#pause-and-unpause)                  | `PauseChange`                        | `check_pending_pause_changes`                           |
| [Mint request](#mint-requests) (staff)                   | `MintRequest`                        | `recover_mint_requests`                                 |
| [NAV update](#nav-updates) (staff)                       | `NAVUpdate`                          | `check_pending_nav_updates`                             |
| [Swap execution](trading-protocols.md#durable-execution) | `BlockchainTransaction` admission    | `resolve_executing_swaps`                               |

Recovery tasks run every five minutes ([schedule](../operations/jobs-and-storage.md#schedule)). The
company-decided families share this mechanism, and their sections give only what differs:

- Preparation freezes the exact inputs, appointment, evidence fingerprints and transaction intent;
  the review snapshot keeps captured account, profile, user and wallet identifiers private.
  Preparation and approval open no journal, job, signature, nonce or chain connection.
- Application consumes the exact current approval and commits the private journal and durable job,
  with any public state, in one transaction under the original proposal UUID: applied means
  admitted, not executed. An exact replay returns the retained receipt; changed terms conflict.
- Proposal, consumed approval, journal, outgoing operation, claim and transaction identities stay
  separate. Private journals are operator-only, public reads keep their shape, and class metadata
  access exposes no private legacy owner history, participant wallet or company issue, capital or
  pause decision. Fresh owner or staff admission is retired; a journal's
  nullable immutable source link keeps historical rows and their actors without inventing an
  approval.
- Only the original operation's canonical successful receipt with the family's event, where it has
  one, and the projection, complete the work: current chain state never substitutes, missing or duplicate events
  stay unresolved, and a contradiction is held for operator attribution. The API reports approval,
  admission, unsigned holds, signed uncertainty and the projected outcome apart.

### Share-class deployment

Company steps: [deploying an empty class](../business/issuing-shares.md#deploying-an-empty-class).

The issuer, contract metadata separate from the technical sender and gas payer, is the company's
operator wallet or verified owner wallet on Base; there is no upload, wallet picker, or separate
receipt or restart route. Preparation freezes company, class and issuer metadata, factory intent and
register boundary, and the proposal identifier is the preparation operation identifier; register-read
capability controls proposal reads. Application commits `DEPLOYING` with the applying principal's
job, and the deployment fences register head advances until its projection completes.

`backend/tokens/services/deployment.py` materialises one immutable private `TokenDeployment` per
admitted job, also when source loss holds unsigned work. Its UUID snapshots keep token, company and
issuer identity and new journals their proposal and consumed approval; captured wallet, account,
profile and user identifiers are private JSON associations, not customer-deletion foreign keys. A
fresh signature checks the original selected address, never a newer wallet.

The signing callback commits the `SignedAttempt` bytes, reserved nonce, `BlockchainTransaction` and
the public token's hash and transaction link in one operator transaction. Only the original receipt
with a factory `ShareTokenCreated` matching identifier, symbol and cap establishes the contract (not
an identifier lookup or current cap), and a factory address without an attributable local deployment
stays pending for operator attribution; unknown outcomes stay `DEPLOYING`. Projection checks the
current token, submission, company, chain and factory before writing public state, and a failed
asset bridge stays recoverable after the contract is recorded.

### Automatic swap approval

After the token projection and asset bridge succeed, one bounded operator transaction commits
`projected_at`, a frozen approval disposition and the exact `recover_swap_approval` job on the
`TokenDeployment`. This technical approval, separate from the company's deployment approval and
actor, runs asynchronously, never reverses a successful deployment, and has its own intent, outcome,
operation and transaction fields, never reusing the factory evidence. `check_pending_swap_approvals`
selects pending or executing approvals independently of deployment recovery.

Admission captures the deployment's chain and signer, the attributed share-token address, the
configured swap target and the calldata. A missing, malformed or zero swap address records
`not_configured` with no approval authority, and historical projected deployments keep blank fields;
later settings cannot admit, enable or retarget either, and fresh signing needs the configuration to
match the original intent.

A verified initial `approvedShareTokens` reading at a recorded block can produce
`observed_approved`, an observation with block and time evidence, never attribution. A false reading
commits an executing decision before opening the operation, after which current approval state
cannot replace the transaction's result, even from a late observer. The original successful receipt
with a unique matching `ShareTokenApproved(token, true)` from the admitted contract confirms it; a
retained revert can be projected while the provider is down. The admin **Retry approval** action
needs current active staff with token change permission and a signed form naming the actor,
deployment and exact completed failed claim; the previous receipt survives, and replay acknowledges
accepted work without another claim.

### Whitelist changes

Rules: [nominating a wallet](../business/participants.md#nominating-a-wallet) and
[company wallet instructions](../business/participants.md#company-wallet-instructions).

`WhitelistEntry` is the one identity row per wallet: it points at a `Wallet` or carries a bare
`address` and `label` for an operator-held treasury address, and a database constraint requires one
of the two and makes bare addresses unique. Each company approval is a `WhitelistApproval` for that
entry and company, mirroring the registry's expiry. `company-wallet-targets/` lists the retained
CONFIRMED or UNCHANGED ADD journals a REMOVE can name.

A nomination binds one own Base wallet's retained possession proof to the company and its current
GENERAL eligibility source; the proof, nominee associations and signature bytes are operator-only,
and historical VERIFIED status is not backfilled into a proof. ADD's registry is the one the
factory's `registryOf(acn)` reports, and its expiry is in the registry's whole seconds. REMOVE
freezes a retained CONFIRMED or UNCHANGED ADD journal, historical NULL-source ADDs included, which
survives deletion of the wallet, entry or approval; an approval-only historical row is not promoted
into command history.

The one write is `setExpiry(address, uint64)`, the finite expiry for ADD and zero for REMOVE, and a
database trigger binds the change's company, address, action and expiry into that calldata. Staff
keep retained private entry reads, sync and export and original technical recovery. The target
advisory lock precedes the company and source locks, and a fresh signature also rechecks the
captured nomination, proof, GENERAL source and expiry. Permanent source loss on never-signed work
fails the claim and projects that failure, releasing its target so a genuine eligibility-loss REMOVE
is not stranded behind it; it invents no withdrawal or wallet-deletion cause.

A change's `pending` and `executing` are unresolved (the nested operation tells PREPARING from
SIGNED); `confirmed` records the original successful transaction, `unchanged` a real no-transaction
observation and `failed` a known never-signed failure or revert. The initial observation compares
`expiresAt` with the intended effect; a signed change completes only on the original canonical
successful receipt alone (no `ExpirySet` check), never by later membership. An unresolved change serialises its chain, registry and address target,
so an opposite change waits. Terminal outcome, projection and target release commit together, and
terminal replay cannot overwrite newer membership. Projection checks the original company, chain,
registry and address and the current entry association, and cannot recreate a deleted entry or
redirect a receipt to its replacement.

Every registry read before acting asks the class's own registry through the token's `whitelist()`,
as issuance execution and order creation do; stablecoin wallet sends have no registry and use stored
approvals ([stablecoin approval check](wallet-protocols.md#stablecoin-approval-check)).
`GET /api/v1/trading/whitelist/<token>/<address>/status/` answers the registry question for the
class at contract `<token>`, for any signed-in user and address.

A `WhitelistApproval` is `pending` while an admitted change is unresolved, `active` when the last
observation listed the wallet with this expiry (`is_listed` and the `live` queryset still apply the
clock), `removed` when it found zero (`sync_all_entries` no longer re-observes it) and `failed` when
the last change failed or reverted, logged at error level; `failed` is terminal for that command, so
the refresh submits a new one, and the thirty-minute `sync_all_entries` replaces it with what the
registry holds. Every read treats `pending` and `failed` as not approved, and order creation and
signing refuse at once. Failing closed has a limit: until a removal lands, a direct contract call can
still move shares, and pausing the token is the operator's lever.

### Refreshing an approval

`whitelist.services.refresh` keeps technical eligibility invalidation. It submits only REMOVE, under
the exact recorded company decision or the actual retained standing, identity or wallet-loss cause,
and never adds or renews approval, authorises a company instruction or treats a possession-proof
refresh as wallet deletion. A current exact-company GENERAL source can explain why no removal is
needed; absence of a genuine cause is diagnostic, not permission to write. The sweep reads the
registry's expiry (an expired address needs no write) and recovers an unresolved predecessor first;
missing receipts, time or membership never release a signed operation.

Source or request withdrawal, company decision revocation, expiry and evidence purge keep their
decision cause; standing, identity or wallet verification loss or wallet deletion keep the actual
prior facts and any actor, independent of any new company instruction. Deleting a wallet captures
its company, registry and address targets before the entry and approval cascade and queues their
removal after commit. The `refresh_whitelist_targets` job retries those removals every five minutes,
with no attempt ceiling, until they finish, never substituting an actor or granting approval; it
must stay, because the approval sweep (`refresh_whitelist_approvals`) cannot rediscover deleted
targets. Unavailable providers, actors, causes or workers stay pending or diagnostic rather than
inventing authority. Legacy accountless treasury entries get no fabricated eligibility or possession
source, and their chain history is no treasury-admission policy. Normal intervals do not guarantee a
removal during a provider outage or an unresolved chain outcome.

### Capital increases

Company steps:
[raising the authorised shares](../business/issuing-shares.md#raising-the-authorised-shares).

Preparation retains the authority copy and an immutable before-cap, delta and target against one
existing capital request in `UNDER_REVIEW`, refusing non-increasing or incoherent terms; the
read-only chain and captured-cap preflight runs before the decision transaction, outside its locks.
Application commits the `CapitalIncreaseExecution` with public `executing` state. The execution calls
`setAuthorizedShares(new_authorized_total)`, its immutable intent holding the token, company, actor,
chain, signer, contract, approved target and prior recorded cap. PostgreSQL guards freeze public
identity and non-draft terms and block cap or identity edits while a request executes; pause and
unpause stay available. The per-token in-flight constraint is the hold; reads, signing preparation
and broadcast do not hold the token lock.

Recovery keeps the original terminal receipt before verifying its
`AuthorizedSharesUpdated(oldAmount, newAmount)` event, and replay cannot lower a later cap.
Contradictory cap observations keep immutable private attribution evidence and the public hold. A
delayed preparer assists a peer's signed transaction rather than treating its cap change as unknown,
and an unavailable read or changed cap never justifies a different retry.

An unsigned failure or confirmed revert permits **Retry Execute** on the exact failed claim, needing
`change_capitalincreaserequest` permission and a signed confirmation binding request, dispatch, actor
and claim; it supplies no company decision, and reacquires the public slot and records the claim
before enqueueing. A genuinely superseded predecessor keeps its figures and attribution; a known
failed request overtaken by a later cap can retire, an unresolved signed one cannot. New and retry
admission check legacy request states and unexplained same-contract capital transactions, orphaned
and hashless ones included, exempting only hashes from the admitted operations' signed attempts; this
fence cannot establish absent historical authority or drain an external same-key writer.

### Share issuances

Company steps: [non-paid chain grants](../business/issuing-shares.md#non-paid-chain-grants); who
reads proposals and files: [rules every issue follows](../business/issuing-shares.md#rules-every-issue-follows).

A chain grant's preparation binds the CHAIN opening, the same-company member LINK, the participant's
current nomination and the finite company ADD it names, with authority, terms and any required
acceptance evidence, freezing one `ShareIssuanceRequest` in `UNDER_REVIEW` without reserving shares
or creating a receipt.

Application approves the request and admits its execution: `tokens.services.issuance_execution`
binds the applied `RegisterInstruction` ISSUE, the consumed approval, the request, a private
`ShareIssuanceExecution` and the job, reserving the allocation once. Positive whole-share, cap and
reservation checks remain; issued supply, holdings, the cap and reservations are separate
quantities.

The worker commits executing state and its public `ShareIssuance` (keyed `issuance-request:<uuid>`)
before opening the operation. A definite unsigned failure or policy-final revert permits
**Retry Execute** on that exact claim. Execution checks registry membership, the cap and pause
state, and the fresh-signature recheck covers the member, nomination, finite wallet approval and
evidence.

PostgreSQL guards freeze approved terms, dispatch identity and share quantities, and token identity
stays fixed while new work can execute.

Recovery keeps the first receipt, then holds the issuance executing until the
`WALLET_CHAIN_FINALITY_POLICIES` rule for its network is met, read with the canonical-block evidence
collector swap settlement uses; missing or invalid policy, unavailable evidence, a changing head or
an orphaned receipt keeps the command pending. Before completion it rereads the
transaction and verifies the finalised inclusion, sender, contract and, for success, one matching
zero-address `Transfer` for the approved recipient and amount. A same-outcome reinclusion may
complete at its new block, which the public transaction and issuance record while the journal keeps
the first; a changed outcome is held for operator attribution.

The locked projection rechecks claim, attempt and policy; private completion, public issuance and
request commit atomically, terminal replay preserves them, and a holding
refresh uses the admitted contract address. After the completion commits, `record_completed_effects`
records each entry in its own transaction, and register recording may wait for the opening, wallet
link, attribution or applied instruction
([recording completions](records.md#recording-completions-after-the-opening),
[waiting effects](records.md#waiting-effects)). A grant records its member's ISSUE once, after the
outcome transaction, through the existing wallet-to-member LINK, never inferring a member from names
or addresses. An executed but
unentered allocation stays reserved until its entry exists, and entry dates stay distinct from
allotment dates.

### Pause and unpause

Company steps and what an outcome means:
[pausing and unpausing a class](../business/issuing-shares.md#pausing-and-unpausing-a-class).

A current personal appointment prepares a strict boolean target, reason, authority reference and
private AUTHORITY evidence; the proposal also freezes the configured contract, signer and a copied
evidence snapshot. Application admits one source-bound PENDING `PauseChange`, refused before the
proposal is consumed while the target is unresolved. Company proposal reads and decision retries
retain the original actor, company, class, UUID and direction; workers recover only admitted commands.

A verified initial boolean at a recorded block may produce `observed` (block number and hash,
observation time; no operation, signature or nonce). The decision is serialised against an executing
peer. `confirmed` needs a unique matching `Paused` or `Unpaused` from the admitted contract and
sender in the original receipt, and completed projection; no finality policy applies, and a
`completedAt` value cannot stand in. The incomplete command reserves its chain and contract until
projection, observed or confirmed outcomes included. Projection locks target, company, class, source
and journal on one operator alias under the original company operation. The API reports the
requested state and the observation or receipt separately from the class's current state.

### Mint requests

The asset mint, yield-token mint and request execution pages all use `tokens.services.mint_service`.
Minting an active stablecoin on Base can precede enabling it for settlement; unsupported receiving
chains have no mint action, and direct mint-page requests for them are refused before a request
exists. A mint form keeps a submission UUID across a repeated POST: reuse with different terms or
another actor is refused, and a fresh form is a deliberate new mint. The service checks current
active staff and the entry point's model permission, and admission commits the token, deployment,
chain, signer, recipient, raw amount, calldata and executing actor before opening an operation.

Every new request has a dispatch UUID, and its outgoing key includes both UUIDs. PostgreSQL freezes
admitted terms and the operation association, requires a confirmed matching operation and
transaction projection for completion, and refuses deletion of admitted requests. Execution checks
deployment eligibility, signer configuration and on-chain minter permission before signing; signed
recovery keeps the recorded intent, signer and deployment after configuration changes. An executed
settlement-asset mint [writes its AUDY holdings](#holdings-written-from-the-chain), logging one it
cannot write and staying executed; a yield-token mint writes none.

A missing receipt or lost acknowledgement shows **Outcome unresolved**. `recover_mint_requests`
selects at most 100 admitted unresolved requests, oldest update first, and neither admits pending
requests nor restarts terminal attempts; it also repairs a projection a stopped worker missed,
without provider access or another signed attempt. **Retry** after a recorded pre-signing failure
or revert is tied to the claim on its form, so an old form cannot authorise a later attempt.
**Executed** means a canonical successful receipt was observed; mints apply no finality policy.

### NAV updates

The staff YieldToken **Update NAV** form requires `tokens.change_yieldtoken`. Its signed form
identifier belongs to that staff member and token: retrying returns the original outcome, changed
values, mode or actor are refused, and **Start a new NAV update** opens a fresh form. Metadata edits
save only the edited fields, so an older form cannot overwrite a NAV completed while it was open.

Local-only updates need no chain configuration and commit the NAV audit row, token valuation,
same-symbol asset and daily snapshot together. Chain updates first commit a private `NAVUpdate` and
its recovery job, then sign after checking current staff permission, target, signer and contract
units. The original successful receipt must contain exactly one `NAVUpdated` from the admitted
contract with the admitted NAV and reserve value; a matching chain value is not enough, because even
an equal-value update changes the contract timestamp. An unresolved chain update reserves the token
and contract against every competing submission, local-only included, until projection; the NAV
audit page shows its status, transaction hash and completion. Scheduled NAV price sync locks and
rereads the token before the asset, so an old quote cannot overwrite a newer NAV. Historical NAV
rows stay outside this adapter.

## Wallets

The business rules are in
[participants](../business/participants.md#wallet-nominations-and-company-wallet-approvals).

### Wallet ownership and signing

`VERIFIED` means someone held the private key, not that a hardware device did. The server issues a
plain-text challenge naming the address, a timestamp and a nonce, then recovers the signer and
compares it with the stored address. `complete_wallet_verification`
(`backend/wallets/services/verification.py`) locks the row, refuses a challenge older than
`WALLET_VERIFICATION_CHALLENGE_MINUTES` (five minutes, boundary included) and clears it on success
so a signature cannot be replayed; a new challenge replaces the nonce and restarts the window.
Success retains the possession proof nominations need. Master fingerprint, derivation path and xpub
play no part, so a Keystone signature and a script's are indistinguishable, and the self-declared,
client-writable `signing_preference` informs no backend authorisation.

`verify_wallet_signature` (`backend/wallets/services/wallets.py`) dispatches on chain: ETH, ETHEREUM
and BASE use standard EIP-191 (`encode_defunct`, `recover_message`, lowercase compare); BTC and
BITCOIN take a base64 compact signature through `bmt.verify_message`, re-derive the address from the
recovered key by the header byte and compare case-sensitively, refusing an address whose prefix does
not match `BITCOIN_NETWORK` (`m`, `n`, `2` or `tb1` for `test`, `bcrt1` for `regtest`, nothing
otherwise). `parse_bitcoin_network` in `backend/ledova_backend/chain_safety.py` refuses to start the
process unless that setting is `test` or `regtest`.

The web app no longer signs wallet challenges: its Keystone QR exchange and on-device seed-phrase
signer went with the wallet pages ([decision](../decisions.md#wallets-removed-from-the-web-app)).
The backend still verifies a signature from any client, as above, and the last client
implementation is in Git history.

### Network identity

Wallet identity is `(account, network, address)`: an account can register one EVM address on
Ethereum and Base, each with its own UUID, verification, holdings and transactions. EVM case
variants are one identity within an account and network; Bitcoin addresses keep their case. Address
filters need an explicit `chain`, or for transactions a visible `wallet` UUID that implies it;
unfiltered queries can span networks, and chain filters accept the supported names and aliases.

Share-token and whitelist operations use the application's Base registry network;
`receiving_wallet_chain` selects the settlement network without retargeting that registry. Registry
address identity, issuance holdings and admin wallet selection therefore use Base wallets, and
several accounts with one Base address stay ambiguous. A company needs its selected operator wallet,
or a verified owner wallet, on the requested network; Ethereum wallets do not stand in for Base.
Historical whitelist rows linked to another network stay visible to operations, keep their wallet
ownership and are excluded from registry address resolution.

## Assets and valuation

### Asset identity and allowlisting

Asset identity is `(chain, contract_address)` through `AssetChainDeployment`. An unknown contract is
recorded as an unverified `Asset` under a symbol no other row owns, compared case-insensitively (the
declared symbol, or it plus a growing hex prefix of the address).

- Unverified rows are invisible to customers: the asset list, wallet holdings, transactions, market
  values and price sync all filter on `is_verified`. A quarantined row is never priced, and its
  transaction is kept for audit without opening a `Holding`.
- Allowlist a token with the asset admin's **Mark selected assets as verified (allowlist a
  quarantined token)** action.
- Switch a contract off by deactivating its chain deployment; its transfers are then skipped and
  logged, never booked.
- The same address on another chain is a different contract with its own unverified row; add a
  second chain's deployment to a verified row by hand in the admin.

### A share holding names its class

A deployed class becomes an asset (`bridge_share_asset`) named after the company and class, whose
Base deployment, the class contract, is the only link between them. `GET /api/wallets/{uuid}/holdings/`
resolves each row's `shareClass` (`uuid`, `name`, `symbol`, `companyName`) from that contract inside
the holdings query, under the caller's policies (`with_share_class` in
`backend/wallets/querysets/share_class.py`), in one SQL statement beside the route's separate
deployment and yield reads. No Base deployment, an unmatched contract or a class hidden by policy
(another company's class off the market, for an investor; its owner still reads it) leaves
`shareClass` null and keeps the holding under the asset's combined name. Renames appear on the next
read without rewriting the asset's name ([decision](../decisions.md#the-signed-in-app)).

Asset symbols are unique, so a second company's class with the same symbol is stored as the symbol
plus its company's ACN (`ORD.123456782`), or part of its contract address when that is taken too.
The stored symbol stays the asset's identity in the API's `assetSymbol`, the asset admin, the staff
transactions filter and the account export. Each transaction row (`GET /api/transactions/`) resolves
`shareClass` the same way, so transaction amounts, transaction notices and the staff holdings and
transactions lists show the class's own symbol with its company (`40 ORD`, "100 ORD (Example Pty
Ltd)"); crypto, and a class the reader cannot see, keep the asset symbol.

### Holdings written from the chain

A holding is written from the chain (`balanceOf`) wherever the platform moves shares or its
settlement asset: the recipient's shares when an issuance completes, the recipient's AUDY when a
deposit's mint executes (each verified Base wallet at that address), and both parties' shares and
AUDY when a trade settles. Each write runs after the moving work commits, so a node failure then
leaves the issuance, mint or trade complete and the holding unwritten; none creates a zero holding.

The wallet sync (`sync_all_wallets` hourly, and **Sync balances**) refreshes every verified holding,
then reads balances without one: the deployed classes of companies that have approved the wallet,
live or not, since a share contract credits only registry addresses, and the settlement asset when
the operator settles in exactly one verified asset and the wallet is on its settlement chain. Each
positive balance is written, recovering a missed write or tokens sent from outside the platform; an
unreadable balance is skipped without failing the sync, and pending transfers can cap a refresh
([balance repair](wallet-protocols.md#balance-repair)).

### Valuation sources

Portfolio values and new asset snapshots use USD. Price writes record `market` for provider or
manual quotes, `nav` for NAV updates, or `par` for the configured par reference. AUDY is one AUD per
token divided by the stored USD/AUD rate (seed-only creates no FX quote), so sync exchange rates
before asset prices: without a positive finite rate a new AUDY holding stays unpriced. A provider
outage keeps the last valid cached quote, as for market prices; this is not live pricing. Manual
quotes in another currency need a stored conversion rate. A cached price of unknown source is left
out of current valuations until a producer refresh or the admin **Update prices for selected
assets** action records it; price, currency and source fields are read-only in the admin.

### Transaction values and monitoring windows

What is valued and counted, and when, is in
[transaction monitoring](../business/participants.md#transaction-monitoring).
`transaction_values` (`backend/assets/services/valuation.py`) values each wallet transaction in USD
and AUD when recorded, imported or sent from the app, at the block-time USD price and the USD/AUD
rate stored then; `sync_exchange_rates` refreshes the rate every 10 minutes and keeps no history.
Wallet sync skips the hash of a transfer the app recorded before mining. Rule windows use the block
time or, before mining, the recorded time. `TRANSACTION_MONITORING_WINDOW_HOURS` and `NEW_CUSTOMER_DAYS` are in
`backend/compliance/constants.py`. The `users_keep_first_activation` trigger keeps an account's
earliest activation date through suspension and reactivation; it can still move earlier, which is
how the demo seed dates its testers from their identity decision.

### Portfolio history

None exists. A `Holding` carries only its current quantity, which the hourly sync, history imports
and transfer confirmation rewrite without a dated series; no past-date valuation, snapshot route,
holding snapshot or value-series service exists, and the portfolios API only groups wallets.

Next: [wallet protocols](wallet-protocols.md), [trading protocols](trading-protocols.md),
[chain setup](../operations/chains.md) and [recovery](../operations/recovery.md).
