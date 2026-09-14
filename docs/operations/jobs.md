# Background jobs

[Operations](README.md) · [Documentation](../README.md)

Start a worker and find the periodic tasks that keep the application current. All clock times below are UTC.

Procrastinate runs on PostgreSQL. Start a worker with
`python manage.py procrastinate worker --queues=default,builtin` (the compose
`worker` service and `make worker` in `backend/`).
`ledova_backend/worker_entrypoint.py` is an alternative entrypoint that also
serves a health endpoint on `PORT` (default 8080) for platforms that require
one.

## Schedule

| Schedule | Task |
| --- | --- |
| every minute | `expire_unclaimed_matches` |
| every 5 min | `check_pending_token_deployments`, `check_executing_issuance_requests`, `resolve_executing_swaps`, `reconcile_subscriptions`, `check_pending_transactions`, `check_all_pending_transactions`, `recover_wallet_submissions`, `observe_wallet_chains`, `recover_mint_requests`, `recover_whitelist_changes`, `recover_capital_increases` |
| every 10 min | `sync_all_assets`, `sync_exchange_rates` |
| every 30 min | `sync_all_entries`, `reconcile_failed_adds` |
| hourly, on the hour | `sync_all_wallets`, `run_batch_monitoring` |
| hourly, at :15 | `purge_signing_challenges` |
| every 6 hours, at :20 | `fold_every_share_class` |
| daily 03:00 | `expire_unpaid_subscriptions`, `purge_classification_evidence` |
| daily 03:15 | `purge_document_evidence` |
| daily 03:30 | `sweep_private_uploads` |
| daily 03:40 | `purge_former_members_past_the_clock` |
| daily 04:00 | `check_periodic_reviews` |

For interrupted work, use [recovery and reconciliation](recovery.md).
