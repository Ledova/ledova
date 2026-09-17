# Reviewed intent and recovery

[Reference](README.md) · [Documentation](../README.md)

The immutable record of what a matched swap's parties reviewed and signed, and
of how an uncertain outcome is recovered. One contract, frozen in PostgreSQL by
the migrations named below. These controls do not enable trading.

The owner's decision of 16 September 2026 stands: V1 is the signed protocol —
the EIP-712 `SwapOrder` typed data over the `LedovaAtomicSwap` domain — and no
new protocol is introduced. V0 history stays held for operator attribution and
is never adopted, replayed or re-signed by this contract.

## The reviewed intent

A newly matched swap captures its settlement context before anything is signed:
the typed domain (name, version, `chainId`, `verifyingContract`) and message
(seller, buyer, share token, payment token, share amount, payment amount,
nonce, deadline), the parties bound to their exact order, account, wallet and
payment asset, the deployment that priced the payment, the digest, and the
`order_hash`. `capture_settlement_context` refuses a share token whose recorded
deployment names a chain other than the domain about to be signed — including
one whose deployment row cannot be read — with the terminal
`settlement_chain_disagreement` refusal. Newly matched swaps use the
owner-selected 15-minute signing window (`SWAP_ORDER_EXPIRY_HOURS`, 0.25);
every recorded deadline and issued signature predating that decision keeps its
own. Two deliberate orders with equal terms remain two submissions, two orders
and two swaps. Order creation resolves the operator's single active, deployed,
supported settlement asset, so two signed orders form a swap.

The captured context is what the parties review. Signing and approval requests
must name it exactly — the swap, order, account, wallet and, after the first
lookup, the recorded full settlement digest — and every stage re-checks it
under its locks through [the settlement admission
matrix](swap-settlement.md#the-settlement-admission-matrix).

## What PostgreSQL freezes

| Migration | Freezes |
| --- | --- |
| `tokens/0039` | The settlement context, digest and `order_hash` cannot be replaced, and the fifteen-field swap identity (parents, wallets, token, payment asset, addresses, amounts, nonce, expiry, creation) is immutable; new swaps must carry protocol 1 and name both parent orders with matching tokens, types, wallets and addresses; a recorded settlement identity cannot be deleted |
| `tokens/0040` | Each order's owner identity (uuid, account, wallet, address) cannot change, and a referenced parent order cannot be replaced; a captured party's signature is permitted through either currently authorized participant while the other order and wallet stay private |
| `tokens/0056` | Every V0 row is held: all UPDATE and DELETE attempts on it, including operator writes and parent cascades, are rejected |
| `tokens/0057` | Execution admission is frozen: exact addresses, supported exact integers, both original 65-byte signatures and the original chain; transaction identity, admission and arguments are immutable, the first receipt summary, first submission time and original nonce are retained, and historical transactions gain no new signing authority; admission requires its original actor and participant, its original V1 order, arguments equal to the original settlement and signatures, an unclaimed ready order and an empty journal; failure requires proof that the original operation never signed |
| `tokens/0058` | Fresh swaps start without signatures or execution claims; claimed swaps retain their journal, signatures and execution hash; `executing` becomes `completed` only with a confirmed admitted journal, its confirmed operation, a matching hash and a completion time, or `failed` only with a reverted journal; `completed` and `failed` are terminal; signed swaps remain held until finality |
| `blockchain/0004` | Outgoing transaction history cannot be changed or deleted; signer identity and reserved nonces cannot be rewound; outgoing operation identity cannot be changed |
| `blockchain/0007` | An admitted swap transaction binds exactly one outgoing operation (one-to-one, protected), and at most one admitted swap transaction exists per swap |

Adjacent guarantees carry related, narrower rules: `tokens/0037` freezes order
submission identity and terminal outcomes, `tokens/0055` and `tokens/0060` the
recordable refusal codes, `tokens/0059` the participant approval journal. They
are named here for the map, not folded into the intent freeze above.

## The recovery contract

An admitted execution binds to `swap-execution:<transaction UUID>` in the
[outgoing foundation](../architecture/outgoing-signing.md): the common signed
bytes, hash and nonce reservation commit before any send, competing workers
recover the same operation, and a lost response, process stop or missing
receipt cannot authorize a second transaction or nonce. The original bytes are
replayed exactly; this adapter never restarts its original claim, including
after a revert. Before each resend, recovery reads the relayer's mined
transaction count; a nonce someone else has spent holds the swap for operator
attribution with nothing resent. A finalized outcome that contradicts the
first-seen one holds the same way. Receipt depth, canonicality and reorg
policy are [transaction evidence](transaction-evidence.md) concerns and remain
open hardening work.

## What this contract does not establish

Finality and canonicality policy, aggregate fund or share reservations, and
any public order-book behaviour are not established here; they stay on their
issues. Trading remains disabled by default, signer admission remains closed,
and no live migration or activation is implied. V0 rows keep their hold with
no operator attribution or re-enabling endpoint.
