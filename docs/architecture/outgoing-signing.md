# Outgoing signing foundation

[Architecture](README.md) · [Documentation](../README.md)

Settlement-asset and yield-token `MintRequest` execution uses the operator signing
foundation. Signer admission remains closed.

The foundation now requires explicit signer admission. Existing and new
`SigningAccount` rows start `closed`, and a missing row is also closed. A nonce
counter, successful legacy status or inventory capture never grants admission.
There is no activation command or admin edit surface; admitted synthetic test
fixtures establish a test precondition only. Other production writers remain outside
this foundation and keep their existing behavior. Share issuance has its own older
mint journal; it is separate from the `MintRequest` adapter described below.

`close_signer_admission(chain_id=..., sender=...)` is an operator-only service
that closes an account and advances its admission generation. It preserves
claims, outcomes, counters and every signed payload. Missing accounts are created
closed. Closure blocks preparation RPC, new signing and exact-byte broadcast;
receipt reconciliation remains available. Preparation records the generation,
and signing checks it again under the operation and signer locks. A delayed
preparer cannot survive a close/reopen cycle. The maximum signed 64-bit generation
is reserved for closure, so an admitted account can always close; further
advancement at that maximum is refused without wrap or reset.

Broadcast admission takes a short operation-then-signer lock and commits before
RPC. A call that crossed this boundary before closure may still send and record
its result afterward. Closure is a drain barrier, not instant cancellation or
credential revocation. Already signed reservations and exact-byte recovery must
survive that interval.

Before a later adapter is activated, every old same-key process and signing tool
must drain and lose credential access. Recapture history after that drain, bind
trusted authorization and intent, and import reservations or quarantine unresolved
signers. Every remaining same-key writer must use the foundation or be disabled
without legacy fallback. Old binaries do not consult this admission guard.
Provider absence, terminal history or today's key and chain cannot establish
historical authorization or release a nonce. App-role handoff and each adapter's
durable transaction boundary still require proof. After signed activity, rollback
cannot restore legacy sending with that key. Admission and the staged inventory
do not establish a global nonce guarantee or resolve old business operations.

Callers provide a stable operation key and immutable intent: chain, sender,
target, value and calldata. Reusing a key with different terms is refused.
`prepare_operation` reads the endpoint, pending nonce, gas price and gas estimate
outside database transactions. `sign_operation` then locks the operation followed
by the chain-and-sender account, allocates a nonce from the greater of the observed
pending nonce and the durable counter, and signs locally without RPC. The signed
bytes, fixed hash, nonce reservation and operation pointer commit together before
`broadcast_operation` can submit anything. All service entry points refuse an
enclosing database transaction or disabled autocommit.

Signing an already prepared claim returns the winning attempt once another
worker has signed, provided the signer remains admitted at the same generation.
Restarting an unsigned failed attempt changes its claim identifier and fences out
delayed workers. Once signed, uncertainty never authorizes another nonce: retries
validate and broadcast the saved bytes, and missing receipts, provider errors,
already-known responses and nonce errors leave the operation unresolved. Receipt
updates require the same claim and hash. A recorded revert permits a new claim
and nonce while retaining the immutable earlier attempt. Here `confirmed` means
a successful receipt was observed; confirmation depth, replacement detection and
reorg repair remain part of the separate finality work.

This initial API signs EIP-155 legacy gas-price transactions, including contract
creation. Chain IDs and gas limits fit a positive signed 64-bit database integer;
allocated nonces stop one below its maximum so the next counter still fits.
Transaction value and gas price accept unsigned 256-bit values. PostgreSQL
enforces immutable attempts, monotonic signer counters and guarded operation
transitions. All three tables deny application-role access, even with a user
principal; operator access is required. They have no admin or serializer surface.
Signed payloads are broadcast capabilities and belong in protected backups;
errors retain a category rather than provider or database exception text.

For existing databases, read [outgoing history and cutover constraints](../reference/outgoing-history.md).

## Mint requests

The asset mint page, yield-token mint page and request execution page all use
`tokens.services.mint_service`. A mint form retains a submission UUID across a
repeated POST. Reusing it with different terms or another actor is refused; a
fresh form represents a deliberate new mint. The service checks current active
staff and the entry point's model permission before admitting work. It refuses
application authority and enclosing transactions. Admission commits the token,
deployment, chain, signer, recipient, raw amount, calldata and executing actor
before opening an outgoing operation. Later recovery is operator-owned accepted
work, even if the original actor subsequently loses permission.

Every new request has a dispatch UUID. Its outgoing key includes both request
and dispatch UUIDs. PostgreSQL freezes admitted terms and operation association,
requires a confirmed matching operation and original transaction projection for
completion, and refuses deletion of admitted requests. Execution checks current
deployment eligibility, signer configuration and on-chain minter permission
before signing. Signed recovery uses the recorded intent after configuration
changes; it never silently switches the recorded signer or deployment.

A missing receipt or lost send acknowledgement leaves the request **Outcome
unresolved**. Use **Recover** on the same request. The five-minute
`recover_mint_requests` task selects at most 100 admitted unresolved requests,
oldest update first, using operator authority. It does not admit pending requests
or automatically restart terminal attempts. A recorded pre-signing failure or
revert permits an explicit **Retry** tied to the claim shown on that form;
replaying an old form cannot authorize a later attempt. Every signed attempt
survives, and recovery updates the transaction projection from its operation.
The generic transaction monitor excludes those projections. Here **Executed**
means a successful receipt was observed, with finality still governed by #7's
remaining work.

Migration `tokens/0042` leaves every old request's dispatch UUID null, preserving
all statuses and transaction references. An old binary inserting after migration
also leaves it null. These requests are historical work requiring operator
attribution, with no automatic retry, generation backfill or legacy sender
fallback. The migration refuses reversal once any request has been admitted.
Deploying this adapter does not authorize signer activation: the drain,
attribution and all-writer cutover requirements above still apply.
