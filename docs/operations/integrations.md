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
(`http://host.docker.internal:8545`) and has the same problem.

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

Transaction confirmed and failed events, the KYC review outcome and every
company application transition defer
`users.tasks.notifications.send_push_notification`, which is what writes the
`Notification` row (`users/tasks/notifications.py`). A company transition
records nothing at transition time: `companies/services/company.py` only defers
the job. The in-app inbox (the dashboard bell, the mobile inbox) therefore needs
a running Procrastinate worker — with no worker the transition succeeds and the
inbox stays empty until one drains the queue.

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
