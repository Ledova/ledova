# Backend apps and layers

[Architecture](README.md) · [Documentation](../README.md)

Where backend code belongs and how its layers interact.

## Company-managed implementation direction

The app and layer catalogue below describes current code. Company authority is
recorded by retained requests, scoped appointments, invitations and revocations in
`companies`; `Company.owner` and `RegisterMember` do not substitute for these
appointments. The [accepted plan](company-managed-registers.md#delivery-sequence)
extends that authority to dependent register workflows. Team web/mobile screens
and the legacy-owner migration are available. Basic company information and private
company-document operations now use current personal administration; activation
and action-specific company approvals remain planned.
Place company authority with the company concern and pass an explicit actor and
company command into shared workflow services. Client actions and exceptional
admin support must call those services rather than duplicate decision logic.

Routine activation, offering decisions, register changes, payment/allotment and
shareholder administration move to company-authorised workflows. The `operators`
configuration row and privileged automation remain technical infrastructure;
neither establishes a human company appointment. New customer entry points need
the service, policy, trigger and worker changes in the plan, rather than reuse of
global admin permissions. Preserve the admin permission checks below for the
current and exceptional staff surfaces.

Company list/detail/basic edits and company-document upload, private-file reads
and deletion use the actor-bound functions in `companies/services/administration.py`,
`editing.py` and `documents.py`. Services lock the company before the live account,
profile, operator identity requirement, appointments and affected document or
wallet. They check the actual clock after waits. Personal `admin` authorises these
operations; delegatable `admin`, staff status, shareholder membership and retained
ownership do not replace it. A current active, email-verified owner may set up an unrooted draft
before its initial appointment. Any retained request-sourced initial appointment
or legacy-owner source permanently consumes that exception, including after
expiry, revocation or an owner change. A pending request alone does not consume it.

Company responses carry `is_owner` as relationship metadata and
`administrative_access` as current personal capabilities plus `draft_setup`.
The PATCH response is a complete `CompanyDetail`, expanding the former write-field
subset so clients can validate an edit receipt. Existing identifier, status,
reviewed-name and verified-wallet restrictions remain. Contact serialization
returns only the existing owner's name and email after an exact bounded resource
check; it does not admit raw profiles, accounts or wallets.

App-role company and company-document writes are closed. Bounded services restore
the principal and company-command settings they use on the operator connection;
`companies.0020` guards the exact actor, company, permitted fields and current
personal authority at persistence. The schema-owning migration connection remains
the maintenance boundary. Document update/delete statements and command-scoped
association removals acquire the company boundary before row locks. For
`document_delete`, statement guards lock all offerings of the declared company
before either document or association rows and recheck authority after that wait.
The deletion service uses
a document lock that permits foreign-key attachment checks, then locks attached
offerings and rechecks current authority and published retention. Public company
discovery uses a separate fixed-search-path UUID helper with the existing
active/open or deployed/nonempty-address terms; private resource access remains
separate. Provider projections and the existing owner submission,
staff lifecycle review and content-bound document verification retain their
specific checks through bounded callers. Status API review requires current active
staff, while admin review additionally requires its existing model change
permission. Document verification retains its model permission and exact content
confirmation. Generic admin add/delete and document
metadata writes are closed. These retained staff workflows do not grant basic
administration or deliver the later company-managed workflow conversions.

Company API metadata reads admit the exact current active owner alongside current
personal administration. An owner without that administration receives no contact
name/email or private document inventory, and cannot edit company information or
files. Raw Company access retains the separate administration/public policy.
Existing owner-domain reads and writes remain independent of personal
administration: `app_visible_company_ids()` and `app_manageable_company_ids()` keep
their exact owner UUID bodies and become fixed-search-path definers only after
migration 0020. Child, participant, subscriber, profile, account and wallet policy
terms remain unchanged. Historical installation and reversal restore the original
invoker attributes. Owner API selectors bind the actual request owner; offering
and capital effects recheck the live owner and active actor under company-first
locks. Private documents supplied to offering actions separately require current
personal administration. Offering updates and document attachment lock the exact
offering before that check, so expiry during the row wait prevents a new private
document reference. Share-class creation accepts only its existing validated
fields and rechecks its selected owner and active actor under the same lock order.
Personal administration supplies no mandate for these retained owner workflows.
Historical policy installation waits for required columns, and the new
administration migration reverses before the earlier policy installer is removed.

Retained publication list and file routes use the existing operator-action pattern
with an explicit company-owner or named-recipient queryset before personal
annotations and file lookup. They preserve publication access after a share-class
pause without granting basic company administration. Ballots and summaries retain
their existing app-role paths. The direct file service retains its existing active
staff read and audit; the customer file route still excludes unrelated staff.

## Backend apps

One Django app per bounded concern. `backend/ledova_backend/settings/` is a
package of per-concern modules re-exported by `settings/__init__.py`.

| App              | Owns                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`      | The single `Operator` configuration row, `GET /api/operator/`, and the operator console: `worklist()` and `configuration_health()` rendered by `OperatorAdmin.changelist_view`                                                                                        |
| `authentication` | `CustomUser`, the `AuthViewSet`, JWT sessions, email verification codes                                                                                                                                                                                               |
| `users`          | Profiles, accounts, preferences (the transaction-alerts switch, on one `UserPreferences` row), financial profiles, device tokens, notifications, `InvestorClassification` and the investor-eligibility predicate                                                      |
| `companies`      | `Company`, its application lifecycle, `CompanyDocument`, and representative-authority request, appointment, invitation and retained revocation records                                                                                                                |
| `tokens`         | `ShareToken`, `ShareIssuanceRequest`, `ShareIssuance`, `CapitalIncreaseRequest`, `MintRequest`, `YieldToken`, and the trading models                                                                                                                                  |
| `shareholders`   | `Publication`, the `PublicationRecipient` roll frozen at a record date with each entitlement, the `PublicationRead` audit, and the `PublicationEvent` chain of a resolution's ballots and close and of a distribution's payment records                               |
| `offerings`      | `Offering`, `Subscription`, their review and payment lifecycles, allotment, and the eligibility-gated investor directory at `/api/v1/directory/`                                                                                                                      |
| `whitelist`      | `WhitelistEntry`, the per-company `WhitelistApproval` mirror, `WhitelistChange` commands and the sync from each company's registry                                                                                                                                    |
| `wallets`        | `Wallet`, `Holding`, `Transaction`, balance sync and transfer confirmation                                                                                                                                                                                            |
| `assets`         | `Asset`, `AssetChainDeployment`, `AssetSnapshot`, `ExchangeRate`, price sync, asset identity                                                                                                                                                                          |
| `portfolios`     | `Portfolio`, its CRUD routes and the operator add-wallet and remove-wallet actions                                                                                                                                                                                    |
| `blockchain`     | `BlockchainTransaction` and transaction monitoring; the durable outgoing-signing foundation (`SigningAccount`, `OutgoingOperation`, `SignedAttempt`) and its immutable history inventory (`OutgoingHistoryCapture`, `OutgoingHistoryEvidence`, `OutgoingCutoverHold`) |
| `compliance`     | Monitoring rules, alerts, procedure templates, risk assessments                                                                                                                                                                                                       |
| `documents`      | Uploaded documents and their extraction records                                                                                                                                                                                                                       |
| `integrations`   | Chain client, KYC providers, Alchemy, CoinGecko, Blockstream, ABR company registry, LLM document extraction, SendGrid, Expo push, Transak                                                                                                                             |
| `feature_flags`  | `FeatureFlag` and the trading middleware                                                                                                                                                                                                                              |
| `shared`         | Base model, country lookup, the health-check middleware, the cross-tenant route matrix                                                                                                                                                                                |

The [outgoing-signing guide](outgoing-signing.md) owns admission, locking, history
and activation constraints. Converted writers use the foundation; signer admission
remains closed until the separate cutover requirements are met.

## Backend layers

Most apps are laid out as `models/ querysets/ serializers/ services/ views/
tasks/ admin/`, taking only the layers they need: `operators/` is flat modules,
`integrations/` only `admin.py` (the rest is one subpackage per provider), and
`blockchain/`, `compliance/`, `feature_flags/` and `shared/` are partial. Prefer
fewer layers and fewer lines: delete before abstracting, and add a layer only
when a second caller needs the same logic.

`offerings/` is the reference app.
Where a rule and a file disagree, the rule wins and the file is the backlog.

| Layer          | Owns                                                                                                                                                                                                                       | Never contains                                                                                        | Reference                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `models/`      | Fields, `TextChoices`, constraints, `__str__`, properties over own fields, single-row transitions (guard, set fields, `save(update_fields=...)`, at most about ten lines, raising the app's `APIException` on a bad state) | Queries on other models, multi-step workflows, external I/O                                           | `offerings/models/offering.py`           |
| `querysets/`   | Every reusable query: product selectors, status filters, `select_related` bundles, annotations, aggregates; wired with `objects = XQuerySet.as_manager()`                                                                  | Saves, side effects, calls into services                                                              | `offerings/querysets/offering.py`        |
| `services/`    | Orchestration across models, external I/O (chain, KYC, email), `shared.db.atomic` and `select_for_update`; the one place a multi-model workflow lives. Plain module-level `verb_noun` functions, named after the noun      | HTTP objects, serializers, `Response`                                                                 | `offerings/services/subscription.py`     |
| `serializers/` | JSON shape and input validation; writable FKs constrained in `get_fields()` by policies and product selectors                                                                                                              | Business rules, locking, queries beyond FK scoping                                                    | `offerings/serializers/subscription.py`  |
| `views/`       | Permissions, `scoped_model` plus product filtering in `narrow()`, serializer choice, one service call, `Response`                                                                                                          | Raw `.objects.filter`, try/except that re-wraps an `APIException`, log lines that restate the request | `offerings/views/subscription.py`        |
| `tasks/`       | `@app.task` / `@app.periodic`: load the row by uuid, call one service, return a dict                                                                                                                                       | Orchestration, state machines                                                                         | `users/tasks/retention.py`               |
| `admin/`       | Registration, list/search/filter, operator actions that call the same model transition or service the API calls                                                                                                            | A second implementation of a workflow, HTML badge builders                                            | `users/admin/investor_classification.py` |

One exception to plain-function services: the chain clients under
`integrations/` stay classes because they hold a connection. A class whose
methods are all `staticmethod` is a module spelled awkwardly: do not add one.

### When not to add a layer

- A service method with one caller that only forwards to the ORM: put the query
  in `querysets/` and call it from the view.
- A queryset method with one call site: inline the filter.
- A base class or mixin for one subclass; an exception class for one raise that
  DRF already covers; a manager for a queryset.
- A task that is never deferred; a periodic task for a one-off backfill (use a
  management command or the shell).
- A model, column or endpoint that records data nothing reads.

## Admin row actions

Register row mutations with `admin_action_path` / `admin_action_re_path` from
[admin_actions.py](../../backend/shared/utils/admin_actions.py). The helper checks
model change permission, resolves the row through the admin's queryset, checks
object change permission, and passes the instance to the view. A callable `rows`
can widen related fetching without discarding an empty queryset. Row routes
capture `uuid`. A page over no single row, such as the register outputs due,
uses `admin_page_path`, which checks model change permission and resolves no
row. File reads use `admin_file_path` and view permission instead.

These named-staff actions follow admin's 403 permission behavior. Mint actions
check change permission on the parent; `MintRequestAdmin` deliberately provides
no add permission. `is_staff` alone is not enough. The layer gate refuses bare
admin-view registration outside its helper allowance, and
[route-derived tests](../../backend/shared/tests/test_admin_row_actions.py) exercise
every registered action.

Fields must preserve the API's edit boundaries. On Company, ACN/ABN/type lock after
DRAFT; name and officeholder declaration fields are editable only in DRAFT or
INFO_REQUIRED. Owner is read-only, and generic company admin creation/deletion is
closed. Registration uses its bounded service; any reassignment needs an explicit
workflow and reason.
[Admin/API comparison tests](../../backend/companies/tests/test_admin_matches_the_api.py)
measure serializer/form differences; the officeholder fields are separately bounded
by the update service. There is no complete comparison across every admin/model pair.

Next: [tenancy](tenancy.md), [engineering standards](../development/standards.md),
and [gates](../development/gates.md).
