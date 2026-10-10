# Company information and documents

[Implementation index](README.md) · [Company authority](authority-requests.md)

Delivered by [PR #911](https://github.com/Ledova/ledova/pull/911) under
[#862](https://github.com/Ledova/ledova/issues/862).

A current company administrator can read and edit the company's basic information
and manage its company documents on web and mobile. Open **Company** from the
signed-in navigation, including an investor account's navigation. If several
companies are available, select the company explicitly before opening an action.
The screen reads every company-list page and the selected company's full document
record; a partial or failed read does not establish that the company is absent.

The **Manage company information and team** permission is the personal `admin`
capability of a current appointment for that company. Delegatable scope alone,
shareholding, a global company account role or platform staff access does not
grant it. The screen uses current company access returned by the API. Revoked or
expired appointments and inactive or unverified accounts cannot start a new
administrative effect. Before initial admission, an active, email-verified owner
may prepare their draft company under the
[draft setup exception](authority-requests.md#boundaries), which admission or
legacy-owner history closes permanently.

## What the company does

1. Select the company and read its current name, address, contact information and
   status. The company provides this information and remains responsible for it.
2. Choose **Edit company** to change the permitted fields. The registered name
   remains editable only during draft or information-requested application states.
   Save changes and wait for a confirmed receipt and refreshed information.
3. Read the required and additional company documents. View a permitted retained
   file, upload a checked replacement or additional document, or confirm removal
   of an eligible document. Document receipt IDs must belong to the selected
   company. A document retained by a published offering cannot be removed.
4. Open **Company team** for invitations and appointments. Initial admission,
   subsequent delegation and permanent revocation follow the
   [authority guide](authority-requests.md#web-and-mobile).

A failed refresh preserves an open draft or selected upload while disabling its
actions. Refresh before retrying. Changing the account or selected company closes
old forms; an old confirmation, transport request or delayed receipt cannot act
for the newly selected company. Cancellation requires fresh confirmation. Mobile
uses the existing private document-copy and share flow with its session cleanup.

## Boundaries

[Company activation](company-activation.md) and share-class
[deployment](company-deployments.md) are company-run through their own
appointments and checks; share-class creation, offerings and publications keep
their existing owner and account-role conditions. Basic draft preparation does
not grant activation authority, and managing company information does not
itself instruct activation, issue shares, approve a payment or publish an
offering. Platform document review and retained identity/provider outcomes keep
their existing checks and history; platform staff access supplies no company
mandate.

An owner with the existing company account role can still select the company and
read its basic metadata after their administrative appointment ends. This read
does not restore administration: private company documents and contact records
remain hidden, and company edits, file access, uploads and deletion still require
current administrative access. Owner business actions retain their own existing
checks. An appointee's administration does not grant the owner's business scope.

Company administrators receive bounded company contact and document information.
This access does not expose another representative's private declaration or
identity and financial evidence. Existing private-file authorisation, upload
validation, retention and company isolation remain enforced by the server.

The clients check both the current company list and the selected company detail
before using administration or owner business access. A refreshed list can
withdraw either access while the detail remains cached. Private contact and
document displays stop with administration access, and an open document removal
confirmation closes. Local edit and upload drafts remain available with their
submission disabled. Loss of owner access or the company account role disables
an open share-class draft without substituting administration authority.
