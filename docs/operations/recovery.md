# Recovery

[Operations](README.md) · [Documentation](../README.md)

What to do when work is left unresolved, family by family, and how to verify that stored registers
and publications are intact. It is for platform staff and operators. Each section names the sweep,
the admin action and what never to do; every sweep follows the
[outgoing signing](../engineering/chain.md#outgoing-signing-foundation) invariants and runs on the
[schedule](jobs-and-storage.md#schedule).

- [Before recovering anything](#before-recovering-anything)
- [Deployment and issuance](#deployment-and-issuance)
- [Capital increases](#capital-increases)
- [Whitelist changes](#whitelist-changes)
- [Pause and unpause](#pause-and-unpause)
- [Wallet transfers and trading](#wallet-transfers-and-trading)
- [Stale registers](#stale-registers)
- [Private files, notifications and providers](#private-files-notifications-and-providers)
- [Verifying stored records](#verifying-stored-records)

## Before recovering anything

Start with the affected record and its durable evidence. Restart a stopped worker with current code
and let the five-minute sweeps run; a timeout or a missing provider response does not prove a
transaction was never submitted. Staff recover an exact admitted operation and never decide a new
company action ([how a company decision works](../business/README.md#how-a-company-decision-works)):
a technical retry keeps the original actor, company source and signed history and supplies no new
mandate. When a client lost a reply, replay the original company command with its body and key and
read its receipt. Backups that hold signed payloads hold transactions that can be broadcast.

Base's Flashblocks-enabled RPC can return a provisional receipt with an all-zero block hash before
the block is sealed
([Flashblocks RPC specification](https://specs.optimism.io/protocol/flashblocks.html#flashblock-json-rpc-apis)).
Such a receipt completes nothing: recovery keeps the signed bytes, claim and nonce until the receipt
and canonical block agree across rereads, and a canonical receipt is still separate from the
finalized head. Normal recovery preserves terminal outcomes, so an older terminal record left with
an all-zero block hash needs an audited metadata correction that independently establishes the
original signed intent, canonical receipt and expected events, then updates the inclusion metadata
atomically. Never reset the status, release the nonce, redeploy a contract or replace that signed
attempt merely to replace the placeholder.

## Deployment and issuance

- Empty deployment (`check_pending_token_deployments`). Applying a company deployment admits the
  original job; it does not establish a deployed contract. After an unsigned technical failure, use
  Retry Deployment on the share class in admin: the confirmation binds the original class,
  deployment and failed claim, and the worker keeps the deployment and operation identities while
  admitting a new claim. A retry renews no company authority, and a legacy deployment without a
  company source cannot obtain a fresh signature; there is no reapproval route. A queue job marked
  succeeded can have returned an unresolved result, so read the deployment journal and the class's
  actual outcome before calling it complete. Retry approval on the same page reopens a failed
  [automatic swap approval](../engineering/chain.md#automatic-swap-approval).
- Share issuance (`check_executing_issuance_requests`, bounded batches). A company chain grant
  admits the private issuance execution; completion waits for the finality policy, and the register
  may still leave the effect [waiting](../business/register.md#why-a-completed-effect-waits). A
  known unsigned failure or a policy-final original revert allows Retry Execute on the request,
  bound to that exact failed claim ([share issuances](../engineering/chain.md#share-issuances)).
- Import-opened registers admit no issuance execution, failed retry or unsigned signing; their
  retained requests and journals remain.
- Settlement-asset and yield-token mints (`recover_mint_requests`). Use Recover on a request whose
  outcome is unresolved and Retry after a recorded failure or revert, tied to the claim the form
  shows ([mint requests](../engineering/chain.md#mint-requests)).

## Capital increases

`recover_capital_increases` processes admitted work in bounded batches. A company capital increase
commits its request and job before chain access. A known unsigned failure or original revert
exposes Retry Execute on the request, bound to that exact failed attempt; an old form cannot
authorise another. Do not clear public status or notes to bypass a hold for attribution, and do not
read a matching current cap, a failure label, a deleted request or a missing hash as proof that the
approved transaction executed or was never sent
([capital increases](../engineering/chain.md#capital-increases)).

## Whitelist changes

`recover_whitelist_changes` processes at most 100 unresolved commands each run, oldest update first,
broadcasting only original signed bytes. `refresh_whitelist_approvals` submits only REMOVE under a
retained cause, and `refresh_whitelist_targets` keeps retrying a deleted wallet's removal
([refreshing an approval](../engineering/chain.md#refreshing-an-approval)). Current membership, a
missing receipt or elapsed time releases nothing, and an opposite change waits for the original to
resolve.

Never replace a UUID, infer chain approval from applied status, alter a job to impersonate another
actor or mark an uncertain outcome complete. Verify actual absence on chain before retiring a
blocked removal job ([whitelist changes](../engineering/chain.md#whitelist-changes)).

## Pause and unpause

`check_pending_pause_changes` runs the admitted job and recovers up to 100 incomplete commands
untouched for ten minutes, oldest update first, keeping the original signed bytes and nonce or
finishing an already recorded outcome without provider access. Approval alone admits no execution;
what a pending result does and does not mean is in
[pausing and unpausing a class](../business/issuing-shares.md#pausing-and-unpausing-a-class). The
company's pause-change API returns the original proposal with its recorded execution outcome. A
completed failure permits a deliberate new company preparation
([pause and unpause](../engineering/chain.md#pause-and-unpause)).

## Wallet transfers and trading

Use the recorded journal and the matching [EVM](../engineering/wallet-protocols.md#evm-transfers)
or [Bitcoin](../engineering/wallet-protocols.md#bitcoin-transfers) protocol. Receipt confirmation
and balance reconciliation are separate: a five-minute sweep requeues durable
[balance repair](../engineering/wallet-protocols.md#balance-repair) even after a transaction's
status changes. Do not infer compensation from timeouts;
[transaction evidence](../engineering/wallet-protocols.md#wallet-chain-observations) explains
receipt, canonicality and finality limits. [Order submissions](../engineering/trading-protocols.md)
and [swap settlement](../engineering/trading-protocols.md#swap-settlement-context) describe their own
recovery.

## Stale registers

`fold_every_share_class` reads through the provider's finalized block. A class it cannot read keeps
its last fold and fails the job, and a fold older than 24 hours, or never completed, is marked stale
([former-member fold](../engineering/records.md#former-member-fold)). Check provider availability
and retry the job. [Former members](../business/register.md#former-members) explains what the fold
can and cannot reconstruct.

## Private files, notifications and providers

Private files and their database references must remain consistent; hosted rebuild procedures are
maintained in private
[Ledova/infra](https://github.com/Ledova/infra/blob/main/docs/deployment.md#fresh-database-rebuilds).
`python manage.py reconcile_private_media --check` reports stray local uploads
([repairing stray uploads](jobs-and-storage.md#repairing-stray-uploads)).

Notification senders only defer a job, so the in-app inbox stays empty until a worker drains the
queue ([notifications](../engineering/backend.md#notifications)). Check the provider's
[configuration](configuration.md) before retrying a review or an extraction. A 200 from
`GET /health/` proves nothing beyond the process
([hosted instance checks](https://github.com/Ledova/infra/blob/main/docs/deployment.md#hosted-instance-checks)).

## Verifying stored records

These operator commands run from `backend/` on the operator connection; application connections
read only their company's rows. None signs a transaction, and only `register_snapshot` and
`register_reconcile` read the chain provider.

### Verifying the stored register

```bash
python manage.py register_foundation verify --token TOKEN_UUID
```

The command replays a share class's stored event chain, rechecking each entry's hash and the
holdings projection, and prints the register and token ids, event count, positive-holding member
count, issued supply and head hash. Success proves storage integrity with the chain unavailable; it
proves neither chain reconciliation nor director approval.

### Inspecting a canonical chain snapshot

```bash
python manage.py register_snapshot --token TOKEN_UUID > snapshot.json
```

The read-only command inspects an attributed deployment on the configured local or testnet provider
and writes the reconciled state at one finality boundary: company, class, deployment transaction,
network, contract, block number, hash and date, finality policy, issued and authorised supply,
positive holdings and the canonical transfer history it folded, as exact integer strings with no
names or addresses. Rather than substituting current balances, it refuses an unattributed legacy
contract, a network without an approved finality policy, a provider that cannot serve historical
calls and logs at a block hash, duplicate or noncanonical logs, inconsistent quantities, a reorg and
unavailable finality. Matching balances cannot prove that every historical log was returned, so it
exports no event history, entry dates or evidence of complete membership.

### Classifying completed inclusions

```bash
python manage.py register_inclusions --token TOKEN_UUID
```

The read-only command prints a share class's captured boundary, classifies each completed issuance
and settlement against it under the
[classification rule](../engineering/records.md#recording-completions-after-the-opening) and flags
whether each is already `recorded` in the register. Where completions cannot be classified it
prints the refusal or a null boundary.

### Reconciling a register on demand

`reconcile_every_register` reconciles every opened share class every six hours
([what reconciliation compares](../business/register.md#reconciliation-with-the-chain)). To
reconcile one class now:

```bash
python manage.py register_reconcile --token TOKEN_UUID
```

It reads the chain, writes only the reconciliation record and prints it: status, block, register
sequence, discrepancies and any failure. A class without an applied chain opening, which includes
every import-opened register, is refused. Discrepancies are logged at error level, which is the
alert. The scheduled job tries every class and then fails if any could not be reconciled; a class
whose run raised keeps its previous result in the CSV summary, so the failed job is the signal to
look at.

### Verifying publications

```bash
python manage.py publications verify --publication PUBLICATION_UUID
```

Leaving `--publication` out checks every publication. The command recomputes each publication's
frozen roll and prints its row count and digest, failing and naming the publication whose roll no
longer matches what it recorded. That proves the audience a publication was addressed to has not
changed since, not that the register is sound, which `register_foundation verify` answers.

For a resolution the command also replays its event chain and prints the number of events, the
head hash, the number of ballots and the tally, `null` until it has closed. For a dividend it
replays its payment records, rechecks the arithmetic and prints the number of events, the head
hash, the number of standing payment records and the undistributed amount. It fails, naming the
publication, on any fault listed under
[verifying publications](../engineering/records.md#verifying-publications). Nothing the application
does can cause these faults: they mean someone with the schema owner's rights rewrote the chain.

Next: [jobs and storage](jobs-and-storage.md),
[outgoing signing](../engineering/chain.md#outgoing-signing-foundation) or
[operator console](operator-console.md).
