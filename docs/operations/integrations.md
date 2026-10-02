# Provider configuration

[Operations](README.md) · [Documentation](../README.md)

Configure only the integrations needed for the test flow you are exercising. Credentials stay server-side.

## Market data and chain providers

| Variable | Default | Required |
| --- | --- | --- |
| `ALCHEMY_ETH_URL`, `ALCHEMY_BTC_URL`, `ALCHEMY_BASE_URL` | empty | Only for provider-backed sync |
| `ALCHEMY_WEBHOOK_SIGNING_KEY` | empty | Yes to accept `/webhooks/alchemy/` |
| `COINGECKO_API_KEY` | empty | No |
| `COINGECKO_BASE_URL` | `https://api.coingecko.com/api/v3` | No |
| `COINGECKO_TIMEOUT` | `10` seconds | No |
| `BLOCKSTREAM_API_URL` | `https://blockstream.info/testnet/api` | No |
| `BLOCKSTREAM_TIMEOUT` | `30` seconds | No |

Alchemy wallet webhooks must include `event.network`, as supplied by the
[Address Activity payload](https://www.alchemy.com/docs/reference/address-activity-webhook).
`BASE_SEPOLIA` is accepted only with `BLOCKCHAIN_CHAIN_ID=84532`, and
`ETH_SEPOLIA` only with `ETHEREUM_CHAIN_ID=11155111`. Missing, unknown, mainnet,
or locally mismatched networks receive HTTP 400 after signature verification.
Accepted events enqueue each matching wallet on that network, including both
transfer participants and separate accounts sharing an address. Receipt workers
fetch chain state themselves; webhook balances and block numbers are not settlement
evidence.

## KYC providers

Disabled until configured. With `KYC_PROVIDER` blank the integration answers
`503 Service not configured`.

| Variable | Default | Required |
| --- | --- | --- |
| `KYC_PROVIDER` | empty | Yes to enable identity verification |
| `KYCAID_API_TOKEN`, `KYCAID_BASE_URL`, `KYCAID_FORM_ID` | empty | Yes for KYCAID |
| `KYCAID_CRYPTO_MONITORING_ENABLED` | `false` | No |
| `SUMSUB_API_KEY`, `SUMSUB_SECRET_KEY`, `SUMSUB_BASE_URL` | empty | Yes for Sum&Sub |
| `SUMSUB_LEVEL_NAME` | `basic-kyc-level` | No |
| `SUMSUB_WEBHOOK_SECRET` | empty | Yes to accept `/webhooks/sumsub/` |
| `CRYPTO_RISK_THRESHOLD_MEDIUM` | `0.25` | No |
| `CRYPTO_RISK_THRESHOLD_HIGH` | `0.6` | No |

Crypto screening never approves without a score. A provider result counts only
when it is a JSON object whose risk score (`riskScore`, or `result.risk_score` in
a `/webhooks/kycaid/crypto/` callback) is a finite, non-negative number. Anything
else is kept on the screening's raw response for staff and leaves it pending; a
submission reply that is not an object fails it, and the callback refuses one
with HTTP 400. A KYCAID submission reply without a score therefore waits,
pending, for the callback, and alerts follow the thresholds above when it
arrives. A completed result is final: a repeated or late callback, a retry and a
provider error after it leave it unchanged. A provider that cannot screen, such
as Sum&Sub today, fails every screening, and the address rule reports it as
unverified.

### Identity results

Both providers write the same profile fields: `verification_status`, one of
`init`, `pending`, `queued`, `prechecked`, `onHold` and `completed`;
`review_result`, which is `GREEN`, `RED` or `YELLOW`, or null while there is no
result (never an empty string); `rejection_labels`; the identity document's
type and country; and, for an approval, the PEP type the risk policy reads.

| The provider reports | KYCAID | Sum&Sub |
| --- | --- | --- |
| Not started | `unused`, recorded as `init` | `init`, from the created webhook |
| In progress, no result | `pending` | `pending`, `queued`, `prechecked` or `onHold`, from the pending and on-hold webhooks too |
| Finished | `completed`: `verified` true is `GREEN`, false is `RED`, null is no result | `completed` with its `reviewAnswer` |
| A status poll | the applicant's last verification: `pending`; `valid` is `completed` and `GREEN`; `invalid` is `completed` and `RED` | the review status, read as a webhook is |
| Reasons | each check's `decline_reasons` and the applicant's, once each | `reviewResult.rejectLabels` |
| Identity document | the type of the applicant's latest valid identity document; no country | `fixedInfo` or `info.idDocs` when the payload carries them |
| PEP evidence | the applicant's `pep` flag, or a failed `pep` check | the `PEP` reject label or the `pep` explanatory button, both only with `RED` |

A result counts only once the provider reports the check completed. Sum&Sub says
so of `reviewAnswer`, so an answer reported beside another status, such as a
provisional `GREEN` while `awaitingService`, is not recorded, and a status poll
that brings no result writes nothing. KYCAID's `verified` is read as a JSON
boolean or the string `true` or `false`; anything else is no result. A
verification status KYCAID does not document is recorded as `pending` with no
result, and a status-changed callback carrying one changes nothing; both are
logged. Sum&Sub's created, pending and on-hold webhooks record their status in
`verification_status`, the field the apps read, as well as in
`sumsub_verification_status`, unless the profile has since moved to KYCAID. A
data migration in the users app rewrote rows stored before this mapping: an empty
result became null and `unused` became `init`.

KYCAID's document objects carry a type, a number, dates and an issuing authority
but no country, and nothing else KYCAID sends names the document's country, so
the foreign-passport risk factor is never set for a KYCAID applicant. Sum&Sub's
document details are in its applicant data, which neither its webhooks nor its
review status carry.

No provider names a PEP category in its documented data: KYCAID reports a PEP as
a yes-or-no flag, and Sum&Sub as the `PEP` reject label and the `pep` button of a
rejection. Both providers' PEP evidence goes through one classifier,
`integrations/kyc/pep.py`, which reads category words (family or relative,
associate, international or intl_org, foreign, domestic) and counts any other PEP
mention as foreign. The risk policy is unchanged: foreign,
international-organisation, family and associate PEPs are rejected, and a
domestic PEP is accepted with a higher customer risk score, which today only a
compliance officer's own risk assessment records. Sum&Sub records the PEP status
of an applicant it approves, for example one a compliance officer cleared there,
in the applicant's risk labels and AML case, which this integration does not
read.

Applicants never see a screening reason. The identity status and the profile
show `UNABLE_TO_VERIFY` in place of the reject labels and decline reasons that
report a list match (`PEP`, `SANCTIONS`, `COMPROMISED_PERSONS`, `ADVERSE_MEDIA`,
`CRIMINAL`, `BLOCKLIST` and `RESTRICTED_PERSON` from Sum&Sub, `COMPROMISED_PERSON`
from KYCAID), once, and every other reason as it is. The stored labels keep every
reason, staff see them in the admin, and the identity notifications name none.

A KYCAID approval whose callback does not carry the applicant is applied only
after the applicant record, with its PEP flag, has been read. If that read fails
the callback answers 500, KYCAID retries it, and the user's next status poll
applies the result as well.

KYCAID's `DATABASE_SCREENING` callback reports a match that its monitoring finds
on a sanctions, PEP, wanted, lost-or-stolen-document or internal list. Each one
raises a compliance alert under rule `KYC-SCREEN` for staff review, and the
account, the identity result and the risk assessment are left as they are. A
sanctions match is a critical `sanctions_match`, a wanted-list match a critical
`watchlist_match`, a PEP match a high `pep_match`, and any other list a high
`watchlist_match`. The alert keeps the list types, the databases, the accuracy,
the verification and document ids and the matched person's details. A callback
repeating a match already raised, whatever that alert's status, raises nothing:
the account is locked while the alert is looked for, so retried or concurrent
deliveries raise one alert. The callback is authenticated as every KYCAID
callback is.

Sources, read on 2 October 2026: KYCAID's
[Verification completed](https://docs.kycaid.com/callbacks/verification-completed),
[Verification status changed](https://docs.kycaid.com/callbacks/verification-status-changed),
[Database screening](https://docs.kycaid.com/callbacks/database-screening),
[callbacks overview](https://docs.kycaid.com/callbacks/overview),
[form integration](https://docs.kycaid.com/guides/form-integration),
[decline reasons](https://docs.kycaid.com/decline-reasons) and the
[legacy API reference](https://docs-v1.kycaid.com/) for the verification,
applicant and document objects and database screening; Sum&Sub's
[Get applicant review status](https://docs.sumsub.com/reference/get-applicant-review-status),
[applicant statuses](https://docs.sumsub.com/docs/applicant-statuses),
[rejection labels](https://docs.sumsub.com/docs/rejection-labels),
[rejection explanatory buttons](https://docs.sumsub.com/reference/rejected),
[AML screening](https://docs.sumsub.com/docs/aml-how-it-works),
[applicant risk labels](https://docs.sumsub.com/docs/applicant-risk-labels) and
[AML case data](https://docs.sumsub.com/reference/get-aml-case-data).

## Email

| Variable | Default | Required |
| --- | --- | --- |
| `DEFAULT_FROM_EMAIL` | `noreply@localhost` | No |
| `SENDGRID_API_KEY` | empty | Yes outside `DEBUG` |
| `SENDGRID_API_URL` | empty | With SendGrid |
| `SENDGRID_TIMEOUT` | `10` seconds | No |

The email backend follows `DEBUG`: the console backend when `DEBUG=true`, SMTP
otherwise. With `DEBUG=true` the sign-up verification code is printed to the
backend log.

## On-ramp

| Variable | Default | Required |
| --- | --- | --- |
| `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, `TRANSAK_API_URL`, `TRANSAK_API_GATEWAY_URL` | empty | Yes to enable the widget |
| `TRANSAK_REFERRER_DOMAIN` | `localhost` | No |
| `TRANSAK_THEME_COLOR` | `6366f1` | No |

## Document extraction

| Variable | Default | Required |
| --- | --- | --- |
| `LLM_BASE_URL` | `http://host.docker.internal:11434/v1` | No |
| `LLM_MODEL` | `qwen2.5vl:7b` | No |
| `LLM_EXTRA_HOSTS` | empty | No |

**The default points at a service on the host, and a host firewall that drops
bridge-to-host traffic makes it unreachable from the containers.** `ufw` does
this by default on Arch and Ubuntu: `host.docker.internal` and the bridge
gateway (`172.17.0.1`) both time out from the worker, with no route error to
say why. `BLOCKCHAIN_RPC_URL` in `backend/.env.example` defaults the same way
(`http://host.docker.internal:8545`) and has the same problem wherever that file
applies; the local stack overrides it with its own `chain` service.

Two remedies, either of which works for both: run the service **inside the
compose network** and point the variable at its service name, or open the
bridge to the host port (`ufw allow in on docker0 to any port 11434`). The
first is preferred, and it is what the [chain setup guide](chains.md) assumes.

**`LLM_EXTRA_HOSTS` is what makes the first remedy expressible, and it is
empty by default.** `_validate_local_base_url` admits `localhost`,
`127.0.0.1`, `::1` and `host.docker.internal` and nothing else until an
operator names a hostname in `LLM_EXTRA_HOSTS` — a comma-separated list, so
`LLM_EXTRA_HOSTS=ollama` with `LLM_BASE_URL=http://ollama:11434/v1` points
extraction at a sibling container. **The default is unchanged and the opt-in
is the whole control**: the allowlist is what makes *a document never leaves
this machine* true, and a compose service name is a weaker statement than a
loopback address, because `ollama` resolves to whatever is on that network.
Name only hosts you control, and only on a deployment where you know what
else is on the network. Entries are hostnames — no scheme, no port, no path —
because the value is compared against the URL's host and nothing else. **There
is no wildcard**: `LLM_EXTRA_HOSTS=*` admits a host literally named `*` and so
admits nothing, and `*.internal` likewise. There is no way to open this to a
range, which is deliberate — every admitted host is one an operator typed.

Installing the service on the host is **not sufficient on such a host**: an
operator who installs Ollama and sees the same failure has fixed the first
cause and not the second. Operator diagnostics name the settings to inspect —
`LLM_BASE_URL` and `LLM_MODEL` — and not their values,
because `_validate_local_base_url` checks the scheme, host, userinfo, query
and fragment and **never the path**, so a value like
`http://127.0.0.1:11434/v1/sk-proj-…` passes it and would otherwise reach the
uploader's screen. The member API derives its failure message from the extraction
status and never sends the stored diagnostic, including on historical attempts.
The operator can read that diagnostic in the extraction admin.

Connection failures, timeouts, rate limits and upstream server errors are retried
by the extraction task, up to three attempts spaced thirty seconds apart. SDK
retries are disabled so each recorded attempt makes one upstream request, and its
client connection is closed after the call. Invalid requests, model/configuration
errors and invalid extracted output stop after one attempt. Each attempt remains
in the extraction history. After correcting a terminal failure, the operator can
select its failed attempt in the extraction admin and re-run it. Unclassified
storage or rendering failures require that operator action; they are not assumed
to be transient.

## Company registry verification

`ABR_AUTH_GUID` is blank by default. Obtain the free authentication GUID through
[ABR Web Services](https://abr.business.gov.au/Tools/WebServices) and configure it
server-side. With no GUID, review records a pending, unconfigured attempt without
contacting ABR. All test and development inputs must remain synthetic.

Start Review uses each company's confirmation page and POST action; bulk review
is unavailable. Start Review and Retry Registry Check record each ABR attempt,
its input, time and selected entity response. Lookup uses the application
ABN, or its ACN when ABN is blank. Each lookup has a 15-second whole-call deadline,
including DNS and response reads, in a supervised subprocess with a 1 MiB streamed
response cap. The authentication GUID travels through its input pipe, not its
command line or inherited application environment. A discovered ABN is recorded
in the attempt; it does not replace the application identifier. Registered company
names must match after Unicode, case and whitespace normalization. Trading names and fuzzy
matches do not establish identity. Suppressed or unknown responses, missing
records, mismatches, cancelled registrations and provider failures cannot pass.

Company type must match the [ABR entity-type code](https://abr.business.gov.au/documentation/referencedata):
Proprietary Limited requires `PRV`; Public Company and Unlisted Public Company
require `PUB`. ABR does not distinguish listed from unlisted public companies, so
this check does not verify listing status. Missing, ambiguous or unsupported
types remain pending; a contradictory `PRV` or `PUB` result fails verification.

Approval requires a named officeholder declaration, board-resolution reference
and explicit operator attestation. Only operator review pages expose these
details and attempt history. ABR checks the entity's ABN registration; the
officeholder declaration is separate. Correct a registered name during DRAFT or
after Request Information, then resubmit for review. ACN, ABN and company type
remain editable only in DRAFT.

Activate, Resolve Warning and Reinstate each run a fresh lookup outside database
transactions and require a matching pass. Failure retains the attempt and leaves
the prior company status in place; retry the action after resolving the cause.
Legacy APPROVED, WARNING and SUSPENDED companies without an attestation receive
the declaration fields on the same action form. The staff status API accepts
`declarant_name`, `board_resolution_reference` and `attest_officeholder` for
approval and this recovery. Existing ACTIVE companies retain their status when
the migration runs, and a registry retry does not automatically suspend them.
There is no manual registry override or stale-pass fallback.

## Notifications and push

The application writes every `Notification` row through
`NotificationService.notify_user` (`users/services/notifications.py`), from one of
two tasks in `users/tasks/notifications.py`:
- confirmed and failed transactions defer `send_transaction_notification`;
- every other sender defers `send_push_notification`.

A sender records nothing when its change happens; it only defers the job. The
in-app inbox (the dashboard bell, the mobile inbox) therefore needs a running
Procrastinate worker. With no worker, the change succeeds and the inbox stays
empty until a worker drains the queue.

Staff can also add, change and delete rows in the Django admin
(`users/admin/notification.py`); a row added there sends no push.

Each notice names its kind as `type` in its `data`, and the dashboard bell opens
that kind's page:

| Kind (`data.type`) | Sent by | The bell opens |
| --- | --- | --- |
| `company` | `companies/services/company.py`, on each notified application transition | Application |
| `offering` | `offerings/services/offering.py`, on each notified offering transition | Offerings |
| `publication` | `shareholders/services/publications.py`, when a publication is announced | Notices |
| `transaction` | `wallets/services/transaction_confirmation.py`, when a transaction is confirmed or fails | Activity |
| `identity` | `users/services/identity.py`, when the identity check's result changes | Profile |

A notice of any other kind stays where it is. That includes identity notices
sent before they carried a type. The mobile inbox opens only publication
notices.

Company transitions notify the owner as: submit, resubmit, start_review,
request_info (carrying the reason), approve, reject (carrying the reason),
activate and withdraw. Warning, resolve-warning, suspend, reinstate and delist
notify nobody. Only the Issue Warning action says so in its admin copy
(`companies/admin/company.py`); resolve-warning and reinstate have no intro copy
at all.

Push registration needs `extra.eas.projectId` in `mobile/app.json`, which is
not set in this repository. On Android, remote push is unavailable in Expo Go
from SDK 53 onward and needs a development or production build; see the
[SDK 54 notification documentation](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/).
The inbox works without push configuration.
