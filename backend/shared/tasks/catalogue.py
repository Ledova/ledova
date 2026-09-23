SYSTEM_WIDE = {
    "tokens.tasks.nav.recover_nav_update": "Recovers one durably admitted staff NAV update using its original journal.",
    "tokens.tasks.nav.check_pending_nav_updates": "Recovers admitted staff NAV work without inferring new intent.",
    "tokens.tasks.pause.recover_pause_change": "Recovers one durably authorized issuer or staff pause command "
    "through its original outgoing operation. Public issuer projection re-enters the admitted principal's scope.",
    "tokens.tasks.pause.check_pending_pause_changes": "Recovers admitted pause commands across issuers; it cannot "
    "admit new intent, reopen terminal submissions or substitute current state for a signed outcome.",
    "tokens.tasks.deployment.recover_swap_approval": "Recovers one deployment's durably admitted swap approval "
    "on the operator connection, retaining its original target and signed transaction.",
    "tokens.tasks.deployment.check_pending_swap_approvals": "Recovers admitted swap approvals across issuers "
    "without reopening terminal outcomes or adopting historical deployments.",
    "whitelist.tasks.refresh.refresh_whitelist_approvals": "Sweeps every company approval on the deployment, "
    "comparing the expiry the recorded classifications call for with the one the registry holds. It belongs to "
    "no tenant: it reads staff approvals and staff-reviewed classifications and submits under the staff member "
    "whose review decided the outcome, listing for staff any row no actor can be attributed to.",
    "whitelist.tasks.refresh.refresh_whitelist_targets": "Refreshes the named company approvals after the staff "
    "or holder action that changed them, under operator authority and attributed to that actor. The actor is an "
    "audit actor rather than a tenant principal: a holder can only reach it by removing their own wallet, and "
    "the entry point refuses any addition they did not already hold a staff approval for.",
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
    "tokens.tasks.register_reconciliation.reconcile_every_register": "Compares every opened share class's "
    "stored register with a fresh canonical chain snapshot and records the result. It is the deployment's "
    "statutory register rather than any owner's data; it writes only reconciliation records.",
    "shareholders.tasks.publications.purge_publications_past_the_clock": "Deletes publications, their frozen "
    "rolls and their read records seven years after the publication, on the same clock and the same settings "
    "constant the register's own outputs use. It belongs to no tenant: it sweeps every company's publications "
    "on the operator connection, and it is the only deletion anyone may perform on those tables, because the "
    "app role's policy refuses all three write commands on both of them and has no grant on the read records "
    "at all.",
    "shareholders.tasks.publications.tell_the_members": "Announces one publication to every member of the frozen "
    "roll who has an account, by deferring one ordinary notification each. It belongs to no tenant: it reads a "
    "whole company's roll on the operator connection, which no member and no issuer may do, and the members it "
    "writes to are the company's rather than its own. It carries no holding and no document: the notice names "
    "the publication, and the member's own route re-resolves and audits the read before anything is served.",
    "tokens.tasks.former_holders.purge_former_members_past_the_clock": "Deletes former-member records "
    "seven years after the date they ceased, imported former members seven years after their date ceased, "
    "member particulars seven years after the member last held shares, and register export records seven "
    "years after the export. These are the only deletions anyone may perform on those tables - the app "
    "role's policy refuses all three write commands on the former-member and particulars tables, and the "
    "app role has no grant on export records at all.",
    "tokens.tasks.signing_challenge.purge_signing_challenges": "Deletes expired challenges regardless of whose.",
    "tokens.tasks.swap_expiry.expire_unclaimed_matches": "Releases eligible unclaimed expired matches across both "
    "parties, retaining every swap with a transaction claim or uncertain history.",
    "tokens.tasks.swap_reconciler.recover_swap_execution": "Recovers one explicitly admitted swap execution "
    "using its original participant and common signed journal. The exact job commits with admission.",
    "tokens.tasks.swap_reconciler.resolve_executing_swaps": "Recovers admitted swap execution across private "
    "counterparties without inventing an actor, restarting a claim or releasing signed financial holds.",
    "tokens.tasks.approval_submissions.recover_swap_approval_submissions": "Replays the exact recorded bytes of "
    "every pending participant-signed approval across both parties and records the receipt it finds; it signs "
    "nothing, allocates no nonce and reads the private journal on the operator connection.",
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
    "whitelist.tasks.sync.sync_all_entries": "Mirrors each company's on-chain whitelist registry into the "
    "staff-only approval rows. It reads chain state for every company and acts for no principal.",
    "procrastinate.builtin_tasks.remove_old_jobs": "Procrastinate's own queue maintenance.",
    "builtin:procrastinate.builtin_tasks.remove_old_jobs": "The same task under its builtin alias.",
}

PRINCIPAL_BEARING = {
    "tokens.tasks.deployment.deploy_share_token_task": "Deploys one issuer's token and writes back to it.",
    "wallets.tasks.confirmation.confirm_pending_transaction": "Confirms one wallet's transaction and moves the "
    "balance it belongs to, on the money path. Local journal evidence is collected and persisted in a "
    "bounded operator observation step after the scoped wallet lookup; finality consumption, holding "
    "repair and notification enqueue return to the captured principal. Imported history uses its "
    "separate receipt writer and has no financial authority. Converted: its principal is a required argument, the "
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
    "tokens.services.deployment_journal.mark_projected": "Commits the attributed token projection marker with "
    "one immutable swap approval disposition and its exact recovery job.",
}


READS_MUST_SURVIVE_THE_POLICIES = {
    "wallets.tasks.sync.sync_wallet": "Retained market read: POLICIES gives tokens_sharetoken an "
    "issuer-owner OR deployed-with-contract market SELECT term. wallets.services.chain._share_balance "
    "uses deployed_at, so a deployed share class remains visible to an investor without issuer ownership. "
    "Removing that term would leave the share holding unsynced. ScopedWalletSyncTest proves this read "
    "reaches another issuer's deployed token and updates the investor's holding under the user principal.",
}

CLASSIFIED = {**SYSTEM_WIDE, **PRINCIPAL_BEARING}
