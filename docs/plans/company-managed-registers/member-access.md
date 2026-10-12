# Member invitations and own records

[Implementation index](README.md) · [Owner decision](../../decisions.md#member-invitations-and-account-association)

The company invites one exact member-specific recipient. The signed-in person
accepts with their own account and confirmed intended email. Member access gives
no company appointment, holding, wallet link or investment eligibility.

## Company and member journey

On web, Settings → **Member access** opens **Invite and manage member access**
in Register; on mobile this sits in the Company section. Both let a current company
administrator select a named company member or award recipient and supply the
intended recipient email. The exact member UUID is retained internally. An award-only recipient can be invited before any shares are
issued. The invitation retains the company's member identity and authority,
expires after the displayed deadline and returns a one-time private code. The
company supplies that code to the recipient; Ledova does not send an email in
this increment. A retry of the recorded invitation returns its record without
exposing the original code again.

**Dashboard** is the web personal home; **My shares** remains the native home.
Both show associated own holdings and awards. Web uses compact panels for one
company, with issued shares separate from award entitlements and a status bar
for unvested, vested but unissued, and issued award quantities. Issued award
shares already belong to the holding. Available certificates, recent own
changes and request status are visible; **Documents** focuses own certificates
and receiving-entry requests. Particulars and longer history stay reachable;
optional wallet holdings stay under Wallets. Enter the company-supplied
code and confirm acceptance using the current signed-in account. The verified
email must match the invitation. Acceptance binds one current account to one
member in that company. An expired invitation, changed recorded identity,
revoked issuer appointment, foreign account or conflicting association refuses.
A company administrator can revoke access with an attributable reason; a new
invitation is needed to link again.

An accepted member reads their own company-recorded particulars, share-class
balances, relevant entry deltas and employee-award terms, recorded vesting and
separately issued quantities. Company totals, other members, private mandates,
financial documents and original multi-party entry payloads are excluded. An
award is an entitlement, not a holding; no wallet or whitelist is required for
these own records. Profile edits do not change the company's register.

## Requests and company decisions

A member with a retained issued record can confirm and submit requested name
and residential address changes. Submission changes no particulars or holding.
The company request queue requires a current personal appointment. A preparer
adds supporting evidence, reason and an as-at date to the existing particulars
instruction; company approval and application remain separate.
The request retains its association and exact proposed particulars, while its
status follows the actual prepared, approved, applied or rejected instruction.
Revoked associations or changed source records block a new linked instruction
or application. The original active, verified requester can still read retained
request status after revocation; own-record access and new member writes stop.
Award-only particulars requests are unsupported until a genuine issued member
exists.

Members can request a certificate for a supported positive receiving ISSUE or
TRANSFER and withdraw it before fulfilment. A company reader can preview and
retain one recipient-only PDF under the written instruction; its status then
becomes fulfilled. The member downloads or shares the digest-verified file
through current access. Request status remains readable after revocation, while
file access stops. See [register outputs](register-outputs.md). There is no
automatic signing or legal recognition claim.

Keep the original operation and request after an uncertain response. Retry the
original action and recover its recorded outcome before starting another.
Current account, session, association and company authority are checked again
for actions; failed authoritative refreshes hide cached private records and
prevent delayed responses from filling a different or revoked session.

## PostgreSQL and verification

Fresh migrations install the association and append-only invitation, revocation
and request records, exact principal/appointment guards, RLS policies and grants.
The nullable request provenance on existing particulars instructions preserves
older unlinked instruction digests and behaviour. No older-database adoption or
historical migration rewind is restored.
The existing [trusted operator transaction boundary](register-grants.md#boundaries)
applies; the guarantee covers normal bounded commands, not arbitrary operator
transaction control.

One core API journey, the existing five real-app-login tenant controls and one
flow in each client guard the essential recipient, privacy, revocation and
recovery boundaries. PostgreSQL role/catalogue checks and the strict canonical
API snapshot remain required under the [minimum-test policy](../../development/testing.md).
