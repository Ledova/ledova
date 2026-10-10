REQUEST_GUARDS = (
    ("tokens_shareissuancerequest", "tokens_issuance_review_decision"),
    ("tokens_shareissuancerequest", "tokens_company_issue_request_source"),
)

INSTRUCTION_GUARDS = (
    ("tokens_registerinstruction", "tokens_register_instruction_identity"),
    ("tokens_registerinstruction", "tokens_company_issue_source"),
    ("tokens_registerinstruction", "tokens_company_issue_preparation"),
)

ISSUANCE_GUARDS = REQUEST_GUARDS + (
    ("tokens_shareissuanceexecution", "tokens_company_issue_execution"),
    ("tokens_shareissuanceexecution", "tokens_company_issue_execution_effect"),
    ("blockchain_signedattempt", "tokens_company_issue_signature"),
    ("blockchain_signedattempt", "tokens_company_issue_signature_effect"),
)

DEPLOYMENT_GUARDS = (
    ("tokens_sharetoken", "protect_token_deployment_identity"),
    ("blockchain_signedattempt", "tokens_deployment_signature_source"),
    ("blockchain_signedattempt", "tokens_deployment_signature_current"),
)

CAPITAL_GUARDS = (
    ("tokens_capitalincreaserequest", "tokens_company_capital_request"),
    ("tokens_capitalincreaserequest", "tokens_company_capital_request_source"),
    ("tokens_capitalincreaseexecution", "tokens_company_capital_execution"),
    ("tokens_capitalincreaseexecution", "tokens_company_capital_execution_effect"),
    ("blockchain_signedattempt", "tokens_company_capital_signature"),
    ("blockchain_signedattempt", "tokens_company_capital_signature_effect"),
)

PAUSE_GUARDS = (
    ("tokens_pausechange", "tokens_company_pause_execution"),
    ("tokens_pausechange", "tokens_company_pause_execution_effect"),
    ("blockchain_signedattempt", "tokens_company_pause_signature"),
    ("blockchain_signedattempt", "tokens_company_pause_signature_effect"),
)

WALLET_GUARDS = (
    ("whitelist_whitelistchange", "whitelist_company_change_source"),
    ("blockchain_signedattempt", "whitelist_company_signature"),
    ("blockchain_signedattempt", "whitelist_company_signature_effect"),
)
