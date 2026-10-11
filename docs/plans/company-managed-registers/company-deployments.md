# Company-authorised empty share-class deployment

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #941](https://github.com/Ledova/ledova/pull/941).

A company appointment authorises deployment of an empty share class. The existing
technical signer creates its contract; deployment issues no shares, receives no
payment and changes no register holding. The captured `issuer` address is
contract metadata, separate from the technical sender, gas payer and any future
recipient.
Company share operations grant no crypto on-ramp purchase permission.

## What the company does

An appointee opens the class from the company's Register and prepares a
proposal. Preparation captures the company-provided company/class information,
whole-share cap and identifier, selected `issuer` address, exact
chain/factory/transaction intent and register state. The company reviews that
snapshot before approving it. Application consumes the exact approval and admits
one original deployment job. An applied proposal means admitted, not a deployed
contract. Authority follows the
[owner's rules](../../decisions.md#company-run-register-authority-and-evidence).

A missing register, an uninitialised register and an initialised zero register are
separate states. Unknown or unavailable data is never zero. Positive issued
supply refuses empty deployment. An existing zero register keeps its entries,
head, holdings and provenance; deployment neither resets it nor creates a second
opening. Mirroring a populated register remains
[planned](register-grants.md#planned-tokenising-an-imported-register).

## What is recorded

The proposal identifier is the original preparation operation identifier,
separate from the deployment, outgoing operation, claim and transaction
identifiers. The retained consumed approval identifies the decision used by
application. The public review snapshot contains company/class/register/
transaction facts and the selected address; the captured
wallet/account/profile/user association identifiers remain private. Current
register-read capability controls proposal reads; class metadata access grants
no access to private legacy owner histories or to company issue, capital or
pause decisions.

New signatures require the original mandates, captured wallet association,
configuration, terms and register state; the original selected address is
checked rather than replaced by a newer wallet. Unsigned holds and signed work
after authority loss follow the
[automatic swap approval rules](../../architecture/outgoing-signing.md#automatic-swap-approval),
and uncertain replies the
[company decision rule](../../architecture/outgoing-signing.md#company-decisions-and-signer-authority).
Both clients distinguish admission, unsigned holds, signed uncertainty,
confirmation awaiting projection and the original projected outcome; a contract
address alone does not establish attributed completion.

## API

The family is `/api/v1/tokens/register-deployments/`: create, list, detail,
`decision-preview` and `decide`. Creation takes `operation_id`, `appointment` and
`token`; there is no upload, wallet picker or separate receipt/restart route.
Responses provide a typed review snapshot, intent digest, company decision
history, original deployment association and execution requirements/receipt.

## Boundaries

An admitted deployment fences register head advances, including imports and
corrections, until its projection completes. An import-origin book, including an
imported zero book, cannot obtain a second opening because its contract exists
and cannot use chain issuance. Imported-baseline chain attribution is not
delivered by this increment.

Fresh deployment admissions under ownership and platform-staff permissions and
the direct-deploy client controls are replaced by this workflow; historical
journals and original-ID technical recovery remain.
