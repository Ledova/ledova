# Provider configuration

[Operations](README.md) · [Documentation](../README.md)

Configure only the integrations needed for the test flow you are exercising. Credentials stay server-side.

## Market data and chain providers

| Variable                                                 | Default                                | Required                           |
| -------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| `ALCHEMY_ETH_URL`, `ALCHEMY_BTC_URL`, `ALCHEMY_BASE_URL` | empty                                  | Only for provider-backed sync      |
| `ALCHEMY_WEBHOOK_SIGNING_KEY`                            | empty                                  | Yes to accept `/webhooks/alchemy/` |
| `COINGECKO_API_KEY`                                      | empty                                  | No                                 |
| `COINGECKO_BASE_URL`                                     | `https://api.coingecko.com/api/v3`     | No                                 |
| `COINGECKO_TIMEOUT`                                      | `10` seconds                           | No                                 |
| `BLOCKSTREAM_API_URL`                                    | `https://blockstream.info/testnet/api` | No                                 |
| `BLOCKSTREAM_TIMEOUT`                                    | `30` seconds                           | No                                 |

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

| Variable                                                 | Default           | Required                            |
| -------------------------------------------------------- | ----------------- | ----------------------------------- |
| `KYC_PROVIDER`                                           | empty             | Yes to enable identity verification |
| `KYCAID_API_TOKEN`, `KYCAID_BASE_URL`, `KYCAID_FORM_ID`  | empty             | Yes for KYCAID                      |
| `KYCAID_CRYPTO_MONITORING_ENABLED`                       | `false`           | No                                  |
| `SUMSUB_API_KEY`, `SUMSUB_SECRET_KEY`, `SUMSUB_BASE_URL` | empty             | Yes for Sum&Sub                     |
| `SUMSUB_LEVEL_NAME`                                      | `basic-kyc-level` | No                                  |
| `SUMSUB_WEBHOOK_SECRET`                                  | empty             | Yes to accept `/webhooks/sumsub/`   |
| `CRYPTO_RISK_THRESHOLD_MEDIUM`                           | `0.25`            | No                                  |
| `CRYPTO_RISK_THRESHOLD_HIGH`                             | `0.6`             | No                                  |

Crypto screening never approves without a score. A provider result counts only
when it is a JSON object whose risk score (`riskScore`, or in a
`/webhooks/kycaid/crypto/` callback `result.risk_score`, which KYCAID's reference
table spells `result.riskscore`; both are read) is a finite, non-negative number.
KYCAID documents a result without a score as no risk found; this deployment still
leaves such a result pending for staff rather than approving it. Anything
else is kept on the screening's raw response for staff and leaves it pending; a
submission reply that is not an object fails it, and the callback refuses one
with HTTP 400. A KYCAID submission reply without a score therefore waits,
pending, for the callback, and alerts follow the thresholds above when it
arrives. A completed result is final: a repeated or late callback, a retry and a
provider error after it leave it unchanged. A provider that cannot screen, such
as Sum&Sub today, fails every screening, and the address rule reports it as
unverified.

A screening names the provider that screens it. One recorded while
`KYCAID_CRYPTO_MONITORING_ENABLED` is off is sent nowhere and fails with
"Crypto monitoring is disabled"; it names the configured `KYC_PROVIDER`, or
`disabled` when that is blank. Retrying it from the screening admin once
screening is on sends it to the configured provider and records that provider,
which is the one the KYCAID callback looks it up by.

KYCAID answers an address check with `data.service_request_id` and delivers the
result later in a `SERVICE_RESULT` callback that carries the same
`service_request_id`, as its
[address verification](https://docs.kycaid.com/risks-check/crypto) and
[result callback](https://docs-v1.kycaid.com/#crypto-result-callback) references
describe. The screening records that id as its provider id when KYCAID answers,
and the callback finds the screening by it. The result's `signals` are shares by
category, and only a sanctions share above zero makes the alert a
sanctioned-address one. What the monitoring rules compare is under
[transaction monitoring](../architecture/wallets-and-valuations.md#transaction-monitoring).

Both providers write the same profile fields; see
[identity verification](../architecture/identity-verification.md) for how each
provider's statuses, reasons, documents and PEP evidence are mapped.

## Email

| Variable             | Default             | Required            |
| -------------------- | ------------------- | ------------------- |
| `DEFAULT_FROM_EMAIL` | `noreply@localhost` | No                  |
| `SENDGRID_API_KEY`   | empty               | Yes outside `DEBUG` |
| `SENDGRID_API_URL`   | empty               | With SendGrid       |
| `SENDGRID_TIMEOUT`   | `10` seconds        | No                  |

The email backend follows `DEBUG`: the console backend when `DEBUG=true`, SMTP
otherwise. With `DEBUG=true` the sign-up verification code is printed to the
backend log.

## On-ramp

The on-ramp is an optional personal investor feature outside the register.
Companies must not buy cryptocurrency through it: the API and both clients admit
only a current `investor` or `both` personal account
([#920](https://github.com/Ledova/ledova/issues/920)), and configuring Transak
selects no AUD share-payment provider
([decision](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments)).

| Variable                                                                              | Default     | Required                 |
| ------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`, `TRANSAK_API_URL`, `TRANSAK_API_GATEWAY_URL` | empty       | Yes to enable the widget |
| `TRANSAK_REFERRER_DOMAIN`                                                             | `localhost` | No                       |
| `TRANSAK_THEME_COLOR`                                                                 | `6366f1`    | No                       |

## Document extraction

| Variable          | Default                                | Required |
| ----------------- | -------------------------------------- | -------- |
| `LLM_BASE_URL`    | `http://host.docker.internal:11434/v1` | No       |
| `LLM_MODEL`       | `qwen2.5vl:7b`                         | No       |
| `LLM_EXTRA_HOSTS` | empty                                  | No       |

The default points at a service on the host. A host firewall that drops
bridge-to-host traffic, as `ufw` does by default on Arch and Ubuntu, makes
`host.docker.internal` and the bridge gateway time out from the worker with no
route error to say why. `BLOCKCHAIN_RPC_URL` in `backend/.env.example` defaults
the same way; the local stack overrides it with its own `chain` service. Two
remedies: run the service inside the compose network and name it in the
variable, or open the bridge to the host port
(`ufw allow in on docker0 to any port 11434`). The first is preferred and is
what the [chain setup guide](chains.md) assumes.

`LLM_EXTRA_HOSTS` is the allowlist that makes the first remedy expressible.
`_validate_local_base_url` admits `localhost`, `127.0.0.1`, `::1` and
`host.docker.internal` and nothing else until an operator names a hostname
there: `LLM_EXTRA_HOSTS=ollama` with `LLM_BASE_URL=http://ollama:11434/v1`
points extraction at a sibling container. Entries are bare hostnames, compared
against the URL's host only, and there is no wildcard; name only hosts you
control. The check never reads the path, so operator diagnostics name the
settings to inspect, `LLM_BASE_URL` and `LLM_MODEL`, and not their values. The
member API never sends the stored diagnostic; the operator reads it in the
extraction admin.

Connection failures, timeouts, rate limits and upstream server errors are
retried by the extraction task, up to three attempts thirty seconds apart, each
making one upstream request. Invalid requests, model or configuration errors and
invalid extracted output stop after one attempt. Each attempt stays in the
extraction history. After correcting a terminal failure, select the failed
attempt in the extraction admin and re-run it; storage or rendering failures
need that operator action too.

## Company registry verification

Company activation is instructed by a current personal company administrator
through the [activation workflow](../plans/company-managed-registers/company-activation.md),
which records the representative's declaration, appointment, identity snapshot,
company revision and a distinct ABR attempt, and describes the retained staff
controls. The provider configuration is below.

`ABR_AUTH_GUID` is blank by default. Obtain the free authentication GUID through
[ABR Web Services](https://abr.business.gov.au/Tools/WebServices) and configure it
server-side. Without a GUID, activation retains a pending, unconfigured attempt
without contacting ABR and leaves the company unchanged. All development inputs
must remain synthetic.

Lookup uses the supplied ABN, or its ACN when ABN is blank. Each lookup has a
15-second whole-call deadline, including DNS and response reads, in a supervised
subprocess with a 1 MiB streamed response cap. The authentication GUID travels
through its input pipe, not its command line or inherited application environment.
A discovered ABN is recorded in the attempt; it does not replace the supplied
identifier. Registered company names must match after Unicode, case and whitespace
normalization. Trading names and fuzzy matches do not establish identity.
Suppressed or unknown responses, missing records, mismatches, cancelled registrations
and provider failures cannot pass.

Company type must match the [ABR entity-type code](https://abr.business.gov.au/documentation/referencedata):
Proprietary Limited requires `PRV`; Public Company and Unlisted Public Company
require `PUB`. ABR does not distinguish listed from unlisted public companies, so
this check does not verify listing status. Missing, ambiguous or unsupported
types remain pending; a contradictory `PRV` or `PUB` result fails verification.

The provider runs outside database transactions, and a passing result is applied
only after the exact company, actor, appointment, company revision and attempt
are locked and rechecked. Staff keep technical warning, suspension, delisting,
registry retry, Resolve Warning and Reinstate controls; a registry retry does
not change status, and recovery to ACTIVE runs a fresh matching lookup. There is
no manual override or stale-pass fallback.

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

| Kind (`data.type`) | Sent by                                                                                                                                                      | The bell opens |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `company`          | Retained application history; its sender is retired, administrator activation creates no notice, and warning, suspend, reinstate and delist stay silent | Activation     |
| `offering`         | `offerings/services/offering.py`, on each notified offering transition                                                                                       | Offerings      |
| `publication`      | `shareholders/services/publications.py`, when a publication is announced                                                                                     | Notices        |
| `transaction`      | `wallets/services/transaction_confirmation.py`, when a transaction is confirmed or fails                                                                     | Activity       |
| `identity`         | `users/services/identity.py`, when the identity check's result changes                                                                                       | Profile        |

A notice of any other kind stays where it is. That includes identity notices
sent before they carried a type. The mobile inbox opens only publication
notices.

Push registration needs `extra.eas.projectId` in `mobile/app.json`, which is
not set in this repository. On Android, remote push is unavailable in Expo Go
from SDK 53 onward and needs a development or production build; see the
[SDK 54 notification documentation](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/).
The inbox works without push configuration.
