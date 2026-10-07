# Company wallet nominations and instructions

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** Second #867 increment in progress, dependent on the empty-deployment
increment. The owning pull request records the final source, independent review,
executed checks and limits. Full company issuance, capital and pause conversion
remain later increments.

Wallet possession, participant eligibility and company wallet approval are
separate facts. A company appointment supplies the mandate to approve a wallet
for that company's share operations. It supplies no crypto on-ramp purchase
permission, payment receipt, issue authority or register-member/account link.

## Participant selection and proof

The participant opens their own eligibility request, selects one own Base wallet
and confirms sharing that address with the exact company. Historical evidence
summary consent does not share a wallet directory. Company readers see only the
selected nomination's address, chain, eligibility source, proof completion time,
expiry and readiness. Other wallets, account/profile/verifier identifiers,
balances and private proof bytes remain private.

The existing wallet verification producer retains the actual successfully signed
challenge, issued time, signature, completion and exact associations before
clearing its mutable challenge. A legacy or admin-overridden VERIFIED status does
not manufacture a retained proof. The existing challenge/signature journey can
refresh proof for a VERIFIED wallet; no additional verification endpoint is
needed. Challenge expiry remains the existing verification rule, without a new
proof-age policy or historical proof backfill.

Nomination requires the exact current accepted GENERAL eligibility decision and
its actual source, account and identity conditions. One command selects one
wallet; this does not establish a maximum nomination count, independent withdrawal
or replacement policy. Browser and mobile bind the selected request, wallet and
company to the current account/session through preview, local signing,
authentication refresh and actual transport. Mobile also binds the session epoch.

## Company decisions

A current personal `admin` appointment can prepare, approve, apply and reject.
The existing narrower step capabilities remain; rejection uses `approve`.
Ownership, platform staff status and participant wallet ownership do not supply
that company mandate. Minimal nominated-wallet reads have their own register-read
boundary; they do not widen private eligibility evidence access.

ADD prepares from an exact retained nomination. The instruction freezes the
company, chain, registry, address, eligibility/proof source, finite expiry and
technical transaction intent. Expiry cannot exceed the captured current
eligibility expiry and uses the registry's whole-second representation. The
company must already have an actual on-chain registry. Missing or unavailable
registry data never establishes readiness.

REMOVE prepares from a genuine retained CONFIRMED or UNCHANGED ADD journal,
including a historical journal with no new company-source link. This original
target survives deletion of the mutable wallet, entry and approval rows. An
approval-only historical row with no genuine ADD journal is not promoted into
invented command history. REMOVE does not need a newly proved wallet or current
participant eligibility; its own company mandate and exact target remain checked.

Application consumes the exact retained approval, admits one original
`WhitelistChange` and queues existing execution atomically. It does not establish
chain permission. Proposal, human decision, change, outgoing operation, claim and
transaction identifiers remain distinct. The original source link is nullable
for historical work, without fabricated legacy actors or approvals.

## Execution and recovery

The existing target advisory lock precedes company/source locks and the outgoing
operation/signer. New unsigned signatures recheck the original approving and
applying mandates, exact proof/nomination and GENERAL source, configuration and
terms inside the durable signing transaction. Default-deferred guards recheck
authority and effect at the actual clock under normal constraint mode.

Temporary contention keeps the original unsigned claim with no new signature,
attempt or nonce. Permanent loss on genuinely never-signed work conditionally
fails the original claim and projects that real failure, freeing its target for
genuine eligibility-loss removal. It does not create a withdrawal or deletion
cause. If another worker has already signed, recovery uses that original first.
Proof refresh is not a fabricated cause for removing an earlier signed approval.

SIGNED and CONFIRMED work retain original bytes, attribution, nonce, technical
signer admission, receipt and finality safeguards after source loss. `unchanged`
records an actual no-transaction observation; `executing` alone cannot distinguish
unsigned preparation from a signature awaiting confirmation. The nested original
operation and transaction receipt provide that distinction. A missing mutable
approval cannot redirect recovery to another wallet.

An uncertain nomination, preparation or decision keeps its exact original body
and key. Receipt comparison precedes fresh source admission, while current
audience/company read access remains required. Changed retries conflict. Lost
access or unavailable reads retain the original request within its current
session; they do not promise process-persistent replay or a new source renewal,
restart or replacement command.

## Replacement and retained boundaries

Fresh staff participant ADD/REMOVE admissions and the subscription-admin whitelist
action are replaced by this company workflow. Genuine subscription, receiving
wallet and evidence records remain. Technical eligibility invalidation/removal,
private histories, original signed recovery and existing target/finality guards
remain independently attributable.

The old synthetic no-key employee-trust treasury cannot provide participant
possession proof. Its unsupported fresh-admission caller is retired without
inventing a treasury exception, proof or GENERAL participant. Historical treasury
records, chain controls and the earlier staff-assisted journey remain evidence.
New treasury policy, broader eligibility, populated-register mirroring, member
binding and undecided payment mechanics are separate work.

## Verification

The increment owns meaningful ordinary/scoped/SQL controls for actual proof
production, private nomination, current company authority, source loss, exact
replay, atomic queue admission, deferred expiry, distinct-session lock contention,
safe never-signed failure/removal and original signed recovery. Migration checks
preserve legacy identities/bytes and refuse reversal with retained new history.
Both clients exercise explicit selected-wallet sharing, real proof refresh,
retired-session transport guards and truthful original receipts.

Required complete current-main CI, roles/catalogue/schema/source/client/native
and isolated real-chain whitelist checks, plus independent review, precede merge.
The pull request records actual results and unresolved limits. These checks do
not establish a live operation, complete #867 or the final #873 journey.
