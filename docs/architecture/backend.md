# Backend apps and layers

[Architecture](README.md) · [Documentation](../README.md)

Where backend code belongs and how its layers interact.

## Backend apps

One Django app per bounded concern. `backend/ledova_backend/settings/` is a
package of per-concern modules re-exported by `settings/__init__.py`.

| App | Owns |
| --- | --- |
| `operators` | The single `Operator` configuration row, `GET /api/operator/`, and the operator console: `worklist()` and `configuration_health()` rendered by `OperatorAdmin.changelist_view` |
| `authentication` | `CustomUser`, the `AuthViewSet`, JWT sessions, email verification codes |
| `users` | Profiles, accounts, preferences, financial profiles, device tokens, notifications, favourite assets, `InvestorClassification` and the investor-eligibility predicate |
| `companies` | `Company`, its application lifecycle, and company `Document` records |
| `tokens` | `ShareToken`, `ShareIssuanceRequest`, `ShareIssuance`, `CapitalIncreaseRequest`, `MintRequest`, `YieldToken`, and the trading models |
| `offerings` | `Offering`, `Subscription`, their review and payment lifecycles, allotment, and the eligibility-gated investor directory at `/api/v1/directory/` |
| `whitelist` | `WhitelistEntry`, the per-company `WhitelistApproval` mirror, `WhitelistChange` commands and the sync from each company's registry |
| `wallets` | `Wallet`, `Holding`, `HoldingSnapshot`, `Transaction`, balance sync and transfer confirmation |
| `assets` | `Asset`, `AssetChainDeployment`, `AssetSnapshot`, `ExchangeRate`, price sync, asset identity |
| `portfolios` | `Portfolio` and the value series computed on read |
| `blockchain` | `BlockchainTransaction` and transaction monitoring; the durable outgoing-signing foundation (`SigningAccount`, `OutgoingOperation`, `SignedAttempt`) and its immutable history inventory (`OutgoingHistoryCapture`, `OutgoingHistoryEvidence`, `OutgoingCutoverHold`) |
| `compliance` | Monitoring rules, alerts, procedure templates, risk assessments |
| `documents` | Uploaded documents and their extraction records |
| `integrations` | Chain client, KYC providers, Alchemy, CoinGecko, Blockstream, ABR company registry, LLM document extraction, SendGrid, Expo push, Transak |
| `feature_flags` | `FeatureFlag` and the trading middleware |
| `shared` | Base model, country lookup, the health-check middleware, the cross-tenant route matrix |

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

| Layer | Owns | Never contains | Reference |
| --- | --- | --- | --- |
| `models/` | Fields, `TextChoices`, constraints, `__str__`, properties over own fields, single-row transitions (guard, set fields, `save(update_fields=...)`, at most about ten lines, raising the app's `APIException` on a bad state) | Queries on other models, multi-step workflows, external I/O | `offerings/models/offering.py` |
| `querysets/` | Every reusable query: product selectors, status filters, `select_related` bundles, annotations, aggregates; wired with `objects = XQuerySet.as_manager()` | Saves, side effects, calls into services | `offerings/querysets/offering.py` |
| `services/` | Orchestration across models, external I/O (chain, KYC, email), `shared.db.atomic` and `select_for_update`; the one place a multi-model workflow lives. Plain module-level `verb_noun` functions, named after the noun | HTTP objects, serializers, `Response` | `offerings/services/subscription.py` |
| `serializers/` | JSON shape and input validation; writable FKs constrained in `get_fields()` by policies and product selectors | Business rules, locking, queries beyond FK scoping | `offerings/serializers/subscription.py` |
| `views/` | Permissions, `scoped_model` plus product filtering in `narrow()`, serializer choice, one service call, `Response` | Raw `.objects.filter`, try/except that re-wraps an `APIException`, log lines that restate the request | `offerings/views/subscription.py` |
| `tasks/` | `@app.task` / `@app.periodic`: load the row by uuid, call one service, return a dict | Orchestration, state machines | `users/tasks/retention.py` |
| `admin/` | Registration, list/search/filter, operator actions that call the same model transition or service the API calls | A second implementation of a workflow, HTML badge builders | `users/admin/investor_classification.py` |

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
INFO_REQUIRED. Owner is editable only while adding a company, because changing it
moves the tenancy root. Any reassignment needs an explicit workflow and reason.
[Admin/API comparison tests](../../backend/companies/tests/test_admin_matches_the_api.py)
measure serializer/form differences; the officeholder fields are separately bounded
by the update service. There is no complete comparison across every admin/model pair.

Next: [tenancy](tenancy.md), [engineering standards](../development/standards.md),
and [gate internals](../reference/gate-internals.md).
