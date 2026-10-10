# Company wallet nominations and instructions

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #942](https://github.com/Ledova/ledova/pull/942).

Wallet possession, participant eligibility and company wallet approval are
separate facts. A company appointment supplies the mandate to approve a wallet
for that company's share operations. It supplies no crypto on-ramp purchase
permission, payment receipt, issue authority or register-member/account link.

## What the participant does

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

Nomination requires the exact current accepted
[general eligibility decision](company-eligibility.md#general-associated-person-and-product-value-decisions)
and its actual source, account and identity conditions. One command selects one
wallet; this does not establish a maximum nomination count, independent
withdrawal or replacement policy. Browser and mobile bind the selected request,
wallet and company to the current account/session through preview, local
signing, authentication refresh and actual transport. Mobile also binds the
session epoch.

## What the company does

A current `admin` appointment may prepare, approve, apply and reject, with
`prepare`, `approve` and `apply` as the narrower delegate capabilities, under
the [owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence);
ownership, platform staff status and participant wallet ownership supply no
company mandate. Minimal nominated-wallet reads have their own register-read
boundary; they do not widen private eligibility evidence access.

ADD prepares from an exact retained nomination. The proposal freezes the
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
chain permission. Proposal, approval, change, outgoing operation, claim and
transaction identifiers remain distinct. The original source link is nullable
for historical work, without fabricated legacy actors or approvals.

## API

Participant routes use `/api/v1/whitelist/wallet-nominations/`: list, detail,
`preview/` and creation. Company routes use
`/api/v1/whitelist/company-wallet-nominations/` for nomination reads,
`/api/v1/whitelist/company-wallet-instructions/` for creation, list, detail,
`decision-preview/` and `decide/`, and
`/api/v1/whitelist/company-wallet-targets/` for the retained CONFIRMED or
UNCHANGED ADD targets a REMOVE can name.

## What is recorded

Fresh unsigned signatures recheck the original approving and applying mandates,
exact proof/nomination and general source, configuration and terms inside the
durable signing transaction. Unsigned holds, never-signed permanent loss, signed
work after source loss and uncertain replies follow the
[whitelist change rules](../../architecture/outgoing-signing.md#whitelist-changes).
Proof refresh is not a fabricated cause for removing an earlier signed approval.
Lost access or unavailable reads retain the original request within its current
session; they do not promise process-persistent replay or a new source renewal,
restart or replacement command.

## Boundaries

Fresh platform-staff participant ADD/REMOVE admissions and the
subscription-admin whitelist action are replaced by this company workflow.
Genuine subscription, receiving wallet and evidence records remain. Technical
eligibility invalidation/removal, private histories, original signed recovery
and existing target/finality guards remain independently attributable.

The old synthetic no-key employee-trust treasury cannot provide participant
possession proof. Its unsupported fresh-admission caller is retired without
inventing a treasury exception, proof or general-eligibility participant.
Historical treasury records, chain controls and the earlier staff-assisted
journey remain evidence. New treasury policy, broader eligibility,
populated-register mirroring, member binding and undecided payment mechanics
are separate work.
