# Company information and documents

[Implementation index](README.md) · [Company authority](authority-requests.md)

Delivered by [PR #911](https://github.com/Ledova/ledova/pull/911) under
[#862](https://github.com/Ledova/ledova/issues/862).

A current company administrator can read and edit the company's basic information
and manage its company documents on web and mobile. Web dashboard **Settings**
separates **Company details and share classes**, **Company documents** and
**Team and appointments**. Mobile **Settings → Company settings** reaches the
existing company details/documents and team screens. Signup requires no file;
optional supporting documents are added here afterwards. If several
companies are available, select the company explicitly before opening an action.
The screen reads every company-list page and the selected company's full document
record; a partial or failed read does not establish that the company is absent.

The **Manage company information and team** permission is the personal `admin`
capability of a current appointment for that company; the
[authority guide](authority-requests.md#boundaries) defines it and the draft
setup exception.

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
4. Open **Team and appointments** on web or **Company team** on mobile for
   invitations and appointments. Initial admission,
   subsequent delegation and permanent revocation follow the
   [authority guide](authority-requests.md#web-and-mobile).

A failed refresh preserves an open draft or selected upload while disabling its
actions. Refresh before retrying. Changing the account or selected company closes
old forms; an old confirmation, transport request or delayed receipt cannot act
for the newly selected company. Cancellation requires fresh confirmation. Mobile
uses the existing private document-copy and share flow with its session cleanup.

## Boundaries

[Company activation](company-activation.md) and share-class
[deployment](company-deployments.md) run through their own appointments and
checks; managing company information does not itself instruct activation, issue
shares, approve a payment or publish an offering.

An owner with the existing company account role can still select the company and
read its basic metadata after their administrative appointment ends; private
documents and contact records stay hidden, and edits, file access, uploads and
deletion still require current administrative access. Company administrators
see bounded contact and document information, never another representative's
private declaration or evidence. Clients re-check the company list and detail
before administration actions.
