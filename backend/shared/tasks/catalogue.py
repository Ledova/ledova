SYSTEM_WIDE = {
    "whitelist.tasks.recovery.recover_whitelist_changes": "Recovers admitted whitelist changes through their "
    "original outgoing operations. Uses operator authority, never admits or reopens a command, and never "
    "substitutes current membership for a signed transaction outcome.",
    "tokens.tasks.mint_request.recover_mint_requests": "Recovers durably admitted mint requests across the deployment, "
    "using operator authority and the original signed operation. It never admits a new request "
    "or restarts a reverted attempt.",
    "tokens.tasks.review_request.execute_review_request_task": "Executes approved issuance and capital increases "
    "only enqueued by the staff admin with change permission. The explicit operator context writes the "
    "issuer ledger and recipient holdings; executed_by is the staff audit actor, not a tenant principal. "
    "The owner confirmed this operator classification on 2026-09-13 in #520.",
    "offerings.tasks.subscription.allot_subscription_task": "Executes allotment and retries enqueued only by "
    "staff admin actions with change permission. It explicitly uses the operator role across issuer and "
    "investor writes, retaining executed_by for audit. The owner confirmed this classification on "
    "2026-09-13 in #520; there is no customer execution caller.",
    "assets.sync_all_assets": "Refreshes the global asset catalogue, which belongs to no tenant.",
    "assets.sync_exchange_rates": "Fetches published rates, identical for every tenant.",
    "blockchain.tasks.check_pending_transactions": "Polls recorded hashes of this deployment's pending and "
    "submitted transactions, across all issuers.",
    "blockchain.tasks.cleanup_failed_transactions": "Reports overdue unresolved rows across the deployment "
    "for queued legacy jobs; receipt recovery runs in check_pending_transactions.",
    "compliance.tasks.run_batch_monitoring": "Screens every account against the operator's rules, which is "
    "the operator's question rather than any customer's.",
    "compliance.tasks.screen_transaction": "Applies the operator's monitoring rules to a recorded transaction "
    "and its account history, writing operator-only alerts and screening records. The transaction and job "
    "commit together on the producer's connection; the task explicitly uses the operator role and records "
    "completion with its alert writes so a retried delivery cannot duplicate them.",
    "compliance.tasks.check_periodic_reviews": "Finds which reviews are due across every account.",
    "offerings.tasks.subscription.reconcile_subscriptions": "Matching a bank line means searching every tenant's "
    "subscriptions, because the line does not say whose it is.",
    "offerings.tasks.subscription.expire_unpaid_subscriptions": "Sweeps every offering's unpaid\n"
    "subscriptions on a clock, across all of them.",
    "shared.tasks.orphaned_files.sweep_private_uploads": "Compares the whole object store against the whole "
    "database, so it has to see both in full.",
    "tokens.tasks.deployment.check_pending_token_deployments": "Polls every deployment this operator started.",
    "tokens.tasks.review_request.check_executing_issuance_requests": "Polls every issuance the relayer claimed.",
    "tokens.tasks.review_request.recover_capital_increases": "Recovers only previously admitted operator capital work.",
    "tokens.tasks.former_holders.fold_every_share_class": "Reads the Transfer log of every deployed "
    "share class and writes the cessations it finds. It is the deployment's statutory register rather "
    "than any owner's data, and R24 makes the table operator-written for that reason.",
    "tokens.tasks.former_holders.purge_former_members_past_the_clock": "Deletes former-member records "
    "seven years after the date they ceased, which is the only deletion anyone may perform on that "
    "table - the app role's policy refuses all three write commands.",
    "tokens.tasks.signing_challenge.purge_signing_challenges": "Deletes expired challenges regardless of whose.",
    "tokens.tasks.swap_expiry.expire_unclaimed_matches": "Releases eligible unclaimed expired matches across both "
    "parties, retaining every swap with a transaction claim or uncertain history.",
    "tokens.tasks.swap_reconciler.resolve_executing_swaps": "Asks the chain about every swap left executing, "
    "and a swap has two parties, so neither one's principal would cover it.",
    "users.tasks.retention.purge_classification_evidence": "Applies the retention clock across every account.",
    "documents.tasks.retention.purge_document_evidence": "Purges expired supporting and unattached payslips "
    "across all uploaders on the operator connection, without a requesting user.",
    "wallets.tasks.chain_observations.observe_wallet_chains": "Polls the chain for every submission whose "
    "watch is due, across all accounts. The chain answers about a transaction, not about whose it is.",
    "wallets.tasks.submissions.recover_wallet_submissions": "Retries every submission left pending across all "
    "accounts on a clock; the owner is not present and each retry re-reads its own row.",
    "wallets.tasks.sync.sync_all_wallets": "Fans out over every wallet; the per-wallet task it defers is the "
    "one that acts for somebody.",
    "wallets.tasks.confirmation.check_all_pending_transactions": "Requeues pending transactions and unfinished "
    "balance reconciliation across all accounts.",
    "wallets.tasks.confirmation.cleanup_stale_pending_transactions": "Reports overdue pending rows across all "
    "accounts for queued legacy jobs without changing status or balances.",
    "whitelist.tasks.sync.sync_all_entries": "Reconciles the on-chain whitelist, which is one list for the "
    "whole deployment and is staff-only in the API for the same reason.",
    "whitelist.tasks.sync.reconcile_failed_adds": "Asks the chain about every entry recorded failed with a hash "
    "it sent, which is a question about the deployment's one whitelist rather than about whoever owns any "
    "wallet on it.",
    "procrastinate.builtin_tasks.remove_old_jobs": "Procrastinate's own queue maintenance.",
    "builtin:procrastinate.builtin_tasks.remove_old_jobs": "The same task under its builtin alias.",
}

PRINCIPAL_BEARING = {
    "tokens.tasks.deployment.deploy_share_token_task": "Deploys one issuer's token and writes back to it.",
    "wallets.tasks.confirmation.confirm_pending_transaction": "Confirms one wallet's transaction and moves the "
    "balance it belongs to, on the money path. Converted: its principal is a required argument, the "
    "request that broadcast the transfer passes its user, and the Alchemy webhook and the "
    "check_all_pending_transactions sweep pass None because no user caused those runs. The principal is "
    "captured at enqueue and used at run, and that gap grows with the delay: the second confirmation check "
    "is scheduled 120 seconds out, and a principal who left the account in between resolves no wallet and "
    'the task answers "Wallet not found" - fails closed and quiet, with the sweep finishing the row as '
    "the operator. The design covers it; the sentence exists so the next conversion with a longer delay "
    "knows the gap is proportional to it.",
    "wallets.tasks.sync.sync_wallet": "Reads and writes one wallet's history, holdings and snapshots. "
    "Converted: the principal is required with no default. Verification captures its user; the wallet "
    "admin, Alchemy webhook and hourly sweep explicitly choose None for operator work. Lookup and every "
    "sync write run inside that context. A user who lost account access after enqueue resolves no wallet, "
    "and the operator sweep remains able to finish it. Compliance screening is durably queued on the "
    "producer connection and handled by a separate operator task.",
    "documents.tasks.extract.extract_document": "Reads one uploader's document and writes an "
    "extraction against it. Converted: the principal is a required argument with no default, the "
    "upload passes its uploader and the staff rerun passes None, because a re-extraction is the "
    "operator's action and reaches documents no single customer owns. The whole body runs inside "
    "that context, which is what puts ExtractionService's three retention rechecks - the initial "
    "locked check, the bytes read and the save - on the alias the enqueue chose, around an "
    "external call no transaction can be held across.",
    "users.tasks.notifications.send_push_notification": "Sends to one user's device tokens. Converted: "
    "the required user_id was already the recipient principal, so the enqueue payload is unchanged and "
    "the whole body - lookup, preferences, inbox insert, device read and invalid-device deactivation - "
    "runs inside acting_for that recipient. A None recipient is refused rather than run as the operator, "
    "because acting_for(None) means operator and nothing in the payload would say that was unintended.",
    "users.tasks.notifications.send_transaction_notification": "Sends to one user about one transaction. "
    "Converted the same way, and the transaction lookup moved inside the recipient context, so a "
    "transaction the recipient cannot reach is refused instead of described to them. The gap between "
    "enqueue and run is up to four attempts at sixty seconds: _notify_wallet_users fans out one job per "
    "account member on the operator connection, and a member removed in between resolves no transaction "
    'and answers "Transaction not found" while the remaining members are notified normally.',
}

CONVERTED_IN = {
    "tokens.tasks.deployment.deploy_share_token_task": 545,
    "wallets.tasks.confirmation.confirm_pending_transaction": 327,
    "wallets.tasks.sync.sync_wallet": 544,
    "documents.tasks.extract.extract_document": 525,
    "users.tasks.notifications.send_push_notification": 523,
    "users.tasks.notifications.send_transaction_notification": 523,
}

OPERATOR_BOUNDARIES = {
    "tokens.services.deployment.retry_confirmation": "Reads the original deployment claim for a signed retry form.",
    "tokens.services.deployment._admit": "Freezes one issuer-visible token's deployment intent after locked ownership "
    "and token-identity checks; public lifecycle writes retain the issuer connection.",
    "tokens.services.deployment._process": "Uses the private shared signer journal for one admitted deployment. Its "
    "local signing callback rechecks ownership and commits bytes, hash and token association together before RPC.",
    "tokens.services.deployment_journal.record_outcome": "Records the original operation's receipt and transaction "
    "outcome; public token and asset projection stays on the caller's connection.",
    "tokens.services.deployment_journal.mark_projected": "Records completion of the attributed token projection.",
}


READS_MUST_SURVIVE_THE_POLICIES = {
    "wallets.tasks.sync.sync_wallet": "Retained market read: POLICIES gives tokens_sharetoken an "
    "issuer-owner OR deployed-with-contract market SELECT term. wallets.services.chain._share_balance "
    "uses deployed_at, so a deployed share class remains visible to an investor without issuer ownership. "
    "Removing that term would leave the share holding unsynced. ScopedWalletSyncTest proves this read "
    "reaches another issuer's deployed token and updates the investor's holding under the user principal.",
}

CLASSIFIED = {**SYSTEM_WIDE, **PRINCIPAL_BEARING}
