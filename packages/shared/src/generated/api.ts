export interface ApiPaths {
  '/api/assets/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_assets_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/assets/exchange-rates/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_assets_exchange_rates_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/verify/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_auth_verify_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/change-password/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_change_password_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/device-tokens/register/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_device_tokens_register_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/device-tokens/unregister/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_device_tokens_unregister_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/email-verification/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_email_verification_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/feature-flags/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_feature_flags_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/fiat-purchases/transak-widget-url/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_fiat_purchases_transak_widget_url_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/financial-profiles/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_financial_profiles_list'];
    put?: never;
    post: ApiOperations['api_financial_profiles_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/financial-profiles/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: ApiOperations['api_financial_profiles_partial_update'];
    trace?: never;
  };
  '/api/investor-classifications/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_investor_classifications_list'];
    put?: never;
    post: ApiOperations['api_investor_classifications_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/investor-classifications/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: ApiOperations['api_investor_classifications_destroy'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/investor-classifications/eligibility/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_investor_classifications_eligibility_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/notifications/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_notifications_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/notifications/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: ApiOperations['api_notifications_partial_update'];
    trace?: never;
  };
  '/api/notifications/mark-all-read/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_notifications_mark_all_read_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/notifications/unread-count/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_notifications_unread_count_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/operator/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_operator_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/portfolios/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_portfolios_list'];
    put?: never;
    post: ApiOperations['api_portfolios_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/portfolios/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_portfolios_retrieve'];
    put: ApiOperations['api_portfolios_update'];
    post?: never;
    delete: ApiOperations['api_portfolios_destroy'];
    options?: never;
    head?: never;
    patch: ApiOperations['api_portfolios_partial_update'];
    trace?: never;
  };
  '/api/portfolios/{uuid}/add-wallet/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_portfolios_add_wallet_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/portfolios/{uuid}/remove-wallet/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_portfolios_remove_wallet_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/resend-verification/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_resend_verification_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/signin/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_signin_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/signout-all/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_signout_all_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/signout/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_signout_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/signup/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_signup_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/token/refresh/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_token_refresh_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/transactions/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_transactions_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/user-accounts/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_user_accounts_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/user-accounts/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: ApiOperations['api_user_accounts_partial_update'];
    trace?: never;
  };
  '/api/user-preferences/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_user_preferences_list'];
    put?: never;
    post: ApiOperations['api_user_preferences_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/user-profiles/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_user_profiles_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/user-profiles/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: ApiOperations['api_user_profiles_partial_update'];
    trace?: never;
  };
  '/api/user-profiles/delete-account/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_user_profiles_delete_account_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/user-profiles/export-data/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_user_profiles_export_data_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/users/identity-verification/status/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_users_identity_verification_status_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/users/identity-verification/token/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_users_identity_verification_token_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_companies_list'];
    put?: never;
    post: ApiOperations['api_v1_companies_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/documents/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_documents_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/documents/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: ApiOperations['api_v1_companies_documents_destroy'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/documents/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_companies_documents_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/eligibility-requests/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_companies_eligibility_requests_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/eligibility-requests/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_companies_eligibility_requests_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/eligibility-requests/{uuid}/decide/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_eligibility_requests_decide_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/eligibility-requests/{uuid}/decision-preview/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_eligibility_requests_decision_preview_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{company_uuid}/eligibility-requests/{uuid}/revoke/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_eligibility_requests_revoke_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_companies_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: ApiOperations['api_v1_companies_partial_update'];
    trace?: never;
  };
  '/api/v1/companies/{uuid}/activate/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_activate_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/companies/{uuid}/status/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_companies_status_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/appointments/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_appointments_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/appointments/{uuid}/revoke/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_authority_appointments_revoke_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/appointments/team/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_appointments_team_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/invitations/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_invitations_list'];
    put?: never;
    post: ApiOperations['api_v1_company_authority_invitations_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/invitations/accept/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_authority_invitations_accept_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_requests_list'];
    put?: never;
    post: ApiOperations['api_v1_company_authority_requests_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_requests_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/{uuid}/admit/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_authority_requests_admit_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_authority_requests_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/{uuid}/revoke/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_authority_requests_revoke_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-authority/requests/{uuid}/withdraw/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_authority_requests_withdraw_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-eligibility/requests/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_eligibility_requests_list'];
    put?: never;
    post: ApiOperations['api_v1_company_eligibility_requests_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-eligibility/requests/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_company_eligibility_requests_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-eligibility/requests/{uuid}/withdraw/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_eligibility_requests_withdraw_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/company-eligibility/requests/preview/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_company_eligibility_requests_preview_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/directory/tokens/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_directory_tokens_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/directory/tokens/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_directory_tokens_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/directory/tokens/{uuid}/documents/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_directory_tokens_documents_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/directory/tokens/{uuid}/documents/{document_uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_directory_tokens_documents_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/documents/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_documents_list'];
    put?: never;
    post: ApiOperations['api_v1_documents_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/documents/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_documents_retrieve'];
    put?: never;
    post?: never;
    delete: ApiOperations['api_v1_documents_destroy'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/documents/{uuid}/attach/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_documents_attach_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/offerings/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_offerings_list'];
    put?: never;
    post: ApiOperations['api_v1_offerings_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/offerings/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_offerings_retrieve'];
    put?: never;
    post?: never;
    delete: ApiOperations['api_v1_offerings_destroy'];
    options?: never;
    head?: never;
    patch: ApiOperations['api_v1_offerings_partial_update'];
    trace?: never;
  };
  '/api/v1/offerings/{uuid}/documents/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_offerings_documents_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/offerings/{uuid}/submit/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_offerings_submit_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/offerings/{uuid}/subscriptions/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_offerings_subscriptions_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/offerings/{uuid}/withdraw/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_offerings_withdraw_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/publications/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_publications_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/publications/{uuid}/ballot/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_publications_ballot_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/publications/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_publications_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/publications/summary/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_publications_summary_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/subscriptions/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_subscriptions_list'];
    put?: never;
    post: ApiOperations['api_v1_subscriptions_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/subscriptions/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_subscriptions_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/subscriptions/{uuid}/submit/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_subscriptions_submit_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/subscriptions/{uuid}/withdraw/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_subscriptions_withdraw_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/deploy/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_deploy_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/holders/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_holders_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/issuances/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_issuances_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/issue/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_issue_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/pause-submissions/{submission_id}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_pause_submissions_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/pause/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_pause_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/register/entries/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_entries_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/register/export/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_export_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/register/opening-holders/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_opening_holders_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/register/waiting/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_waiting_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/{uuid}/unpause/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_unpause_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/capital-increases/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_capital_increases_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_capital_increases_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/capital-increases/{uuid}/submit/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_capital_increases_submit_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/issuance-requests/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_issuance_requests_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-corrections/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_corrections_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_register_corrections_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-corrections/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_corrections_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-corrections/{uuid}/decide/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_corrections_decide_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-corrections/{uuid}/decision-preview/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_corrections_decision_preview_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-corrections/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_corrections_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-evidence/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_evidence_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_imports_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_register_imports_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_imports_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/{uuid}/asic-file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_imports_asic_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/{uuid}/decide/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_imports_decide_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/{uuid}/decision-preview/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_imports_decision_preview_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-imports/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_imports_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-instructions/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_instructions_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_register_instructions_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-instructions/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_instructions_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-instructions/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_instructions_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-links/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_links_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_register_links_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-links/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_links_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-links/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_links_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-openings/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_openings_list'];
    put?: never;
    post: ApiOperations['api_v1_tokens_register_openings_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-openings/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_openings_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-openings/{uuid}/decide/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_openings_decide_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-openings/{uuid}/decision-preview/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_openings_decision_preview_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-openings/{uuid}/file/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_openings_file_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-reconciliations/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_reconciliations_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-reconciliations/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_reconciliations_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register-reconciliations/{uuid}/acknowledge/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_tokens_register_reconciliations_acknowledge_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/tokens/register/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_tokens_register_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/events/stream/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['trading_events_stream_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/action-context/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_action_context_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/cancel/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_cancel_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/cancel/message/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_cancel_message_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/modify/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_modify_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/modify/message/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_modify_message_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/swap/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_swap_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/swap/approval-broadcast/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_swap_approval_broadcast_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/swap/approval-data/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_swap_approval_data_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/swap/approval-status/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_swap_approval_status_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/{uuid}/swap/sign/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_swap_sign_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/actions/{action_id}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_actions_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/create/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_create_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/create/message/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_trading_orders_create_message_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/orders/submissions/{submission_id}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_orders_submissions_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/swaps/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_swaps_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/tokens/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_tokens_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/tokens/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_tokens_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/tokens/{uuid}/order-book/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_tokens_order_book_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/wallets/balances/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_wallets_balances_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/trading/whitelist/{token}/{address}/status/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_trading_whitelist_status_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_whitelist_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_whitelist_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/add/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_whitelist_add_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/batch-add/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_whitelist_batch_add_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/entry/{address}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_whitelist_entry_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/export/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_v1_whitelist_export_retrieve'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/remove/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_whitelist_remove_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/whitelist/sync/{address}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_v1_whitelist_sync_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_wallets_list'];
    put?: never;
    post: ApiOperations['api_wallets_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: ApiOperations['api_wallets_destroy'];
    options?: never;
    head?: never;
    patch: ApiOperations['api_wallets_partial_update'];
    trace?: never;
  };
  '/api/wallets/{uuid}/broadcast-transfer/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_broadcast_transfer_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/holdings/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: ApiOperations['api_wallets_holdings_list'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/prepare-transfer/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_prepare_transfer_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/request-verification/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_request_verification_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/sync/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_sync_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/{uuid}/verify-signature/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_verify_signature_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/wallets/batch-check-balances/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: ApiOperations['api_wallets_batch_check_balances_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type ApiWebhooks = Record<string, never>;
export interface ApiComponents {
  schemas: {
    _CompanyUserProfile: {
      fullName: string | null;
    };
    _CompanyUserProfileCreateRequest: {
      firstName: string;
      lastName: string;
      phone?: string;
    };
    AccountExportData: {
      account: ApiComponents['schemas']['ExportedAccount'] | null;
      exportedAt: string;
      financialProfile: ApiComponents['schemas']['ExportedFinancialProfile'] | null;
      portfolios: ApiComponents['schemas']['ExportedPortfolio'][];
      profile: ApiComponents['schemas']['ExportedProfile'] | null;
      transactions: ApiComponents['schemas']['ExportedTransaction'][];
      user: ApiComponents['schemas']['ExportedUser'];
      wallets: ApiComponents['schemas']['ExportedWallet'][];
    };
    AccountSummary: {
      accountNumber: string;
      accountType: ApiComponents['schemas']['AccountTypeEnum'];
      activationDate: string | null;
      role: ApiComponents['schemas']['RoleEnum'];
      uuid: string;
    };
    AccountTypeEnum: 'individual';
    ActionEnum: 'add' | 'remove';
    ApprovalDataResponse:
      | ApiComponents['schemas']['SettlementSufficientApproval']
      | ApiComponents['schemas']['SettlementApprovalTransaction'];
    ApprovalRequiredEnum: true;
    ApprovalSufficientEnum: false;
    ApprovalTransaction: {
      chainId: string;
      data: string;
      from: string;
      gas: string;
      gasPrice: string;
      nonce: string;
      to: string;
      value: string;
    };
    Asset: {
      assetType: ApiComponents['schemas']['AssetTypeEnum'];
      assetTypeDisplay: string;
      chain: string | null;
      chainDeployments: ApiComponents['schemas']['AssetChainDeployment'][];
      contractAddress: string | null;
      createdAt: string;
      currentPrice: string | null;
      decimals?: number;
      isActive?: boolean;
      isYieldToken: boolean;
      lastNavUpdate: string | null;
      name: string;
      navPerToken: string | null;
      priceCurrency?: string;
      symbol: string;
      updatedAt: string;
      uuid: string;
      valueSource: ApiComponents['schemas']['ValueSourceEnum'];
    };
    AssetChainDeployment: {
      chain: string;
      contractAddress?: string | null;
      decimals?: number;
      isActive?: boolean;
      uuid: string;
    };
    AssetShareClass: {
      companyName: string;
      name: string;
      symbol: string;
      uuid: string;
    };
    AssetTypeEnum:
      'native_crypto' | 'erc20_token' | 'stablecoin' | 'tokenized_security' | 'tokenized_rwa' | 'synthetic';
    AuthCookieRefreshed: {
      message: string;
    };
    AuthEmailVerified: {
      email: string;
      isEmailVerified: boolean;
      tokens?: ApiComponents['schemas']['AuthTokenPair'][];
      uuid: string | null;
    };
    AuthIdentity: {
      email: string;
      isEmailVerified: boolean;
      uuid: string | null;
    };
    AuthorityCompanyIdentitySnapshot: {
      abn: string;
      acn: string;
      companyType: ApiComponents['schemas']['CompanyTypeEnum'];
      name: string;
    };
    AuthorityPersonIdentitySnapshot: {
      email: string;
      fullName: string;
      profileUuid: string;
      userId: number;
    };
    AuthPasswordChanged: {
      message: string;
    };
    AuthRefreshError: {
      error: string;
    };
    AuthRefreshRequestRequest: {
      refresh?: ((string | null) | 0 | false | unknown[] | Record<string, never>) | null;
    };
    AuthRefreshResponse:
      ApiComponents['schemas']['AuthTokensRefreshed'] | ApiComponents['schemas']['AuthCookieRefreshed'];
    AuthSession: {
      email: string;
      isEmailVerified: boolean;
      tokens?: ApiComponents['schemas']['AuthTokenPair'][];
      uuid: string | null;
    };
    AuthSessionValidity: {
      expiresAt?: string;
      valid: boolean;
    };
    AuthSignedOut: {
      message: string;
    };
    AuthSignedOutEverywhere: {
      message: string;
    };
    AuthSignoutRequestRequest: {
      refresh?: ((string | null) | 0 | false | unknown[] | Record<string, never>) | null;
    };
    AuthTokenPair: {
      accessToken: string;
      refreshToken: string;
    };
    AuthTokensRefreshed: {
      access: string;
      refresh: string;
    };
    AuthVerificationResent: {
      message: string;
    };
    BallotChoiceEnum: 'for' | 'against' | 'abstain';
    BallotRequest: {
      choice: ApiComponents['schemas']['BallotChoiceEnum'];
    };
    BatchBalanceRequestRequest: {
      addresses: string[];
      chain: ApiComponents['schemas']['SupportedWalletChainEnum'];
    };
    BatchBalanceResponse: {
      balances: {
        [key: string]: string | null;
      };
      chain: ApiComponents['schemas']['SupportedWalletChainEnum'];
      errors?: string[];
      userAccount: string;
    };
    BlankEnum: '';
    BroadcastTransferRequest: {
      amount?: string | null;
      signedTransaction: string;
      toAddress?: string | null;
      tokenContract?: string | null;
      transactionFee?: string | null;
    };
    BroadcastTransferResponse: {
      message: string;
      pendingTransaction: ApiComponents['schemas']['PendingTransfer'] | null;
      status: ApiComponents['schemas']['BroadcastTransferResponseStatusEnum'];
      success: boolean;
      txHash: string;
    };
    BroadcastTransferResponseStatusEnum: 'pending' | 'confirmed' | 'failed' | 'reorged' | 'replaced';
    CapitalIncreaseCreateRequestRequest: {
      additionalShares: number;
      boardResolutionReference: string;
      newAuthorizedTotal: number;
      purpose: string;
      shareholderApprovalReference?: string;
      token: string;
    };
    CapitalIncreaseDetail: {
      additionalShares: number;
      boardResolutionReference: string;
      canBeSubmitted: boolean;
      createdAt: string;
      dilutionPercentage: string | null;
      executedAt: string | null;
      executedIssuance: string | null;
      executionNotes: string;
      newAuthorizedTotal: number;
      purpose: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      reviewedByEmail: string | null;
      shareholderApprovalReference: string;
      status: ApiComponents['schemas']['CapitalRequestStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      submittedBy: number | null;
      submittedByEmail: string | null;
      token: string;
      tokenName: string;
      tokenSymbol: string;
      updatedAt: string;
      uuid: string;
    };
    CapitalIncreaseList: {
      additionalShares: number;
      createdAt: string;
      dilutionPercentage: string | null;
      newAuthorizedTotal: number;
      purpose: string;
      status: ApiComponents['schemas']['CapitalRequestStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      submittedBy: number | null;
      submittedByEmail: string | null;
      token: string;
      tokenName: string;
      tokenSymbol: string;
      uuid: string;
    };
    CapitalIncreaseSubmitted: {
      message: string;
      request: ApiComponents['schemas']['CapitalIncreaseDetail'];
    };
    CapitalRequestStatusEnum:
      | 'draft'
      | 'submitted'
      | 'under_review'
      | 'approved'
      | 'rejected'
      | 'executing'
      | 'executed'
      | 'failed'
      | 'superseded';
    CategoryEnum: 'product_value' | 'accountant_certificate' | 'professional_investor' | 'associated_person';
    CertifierBodyEnum: 'ca_anz' | 'cpa_australia' | 'ipa';
    ChangePasswordRequest: {
      currentPassword: string;
      newPassword: string;
      newPasswordConfirm: string;
    };
    CompanyActivated: {
      attempt: ApiComponents['schemas']['CompanyActivationAttempt'];
      company: ApiComponents['schemas']['CompanyDetail'];
      message: string;
    };
    CompanyActivateRequest: {
      acceptDeclaration: boolean;
      appointment: string;
      declarationVersion: string;
      idempotencyKey: string;
      lifecycleRevision: number;
    };
    CompanyActivation: {
      appointment: string;
      declarationText: string;
      declarationVersion: string;
      latestAttempt: ApiComponents['schemas']['CompanyActivationAttempt'] | null;
      lifecycleRevision: number;
    };
    CompanyActivationAttempt: {
      appliedAt: string | null;
      appointment: string;
      completedAt: string | null;
      declarationText: string;
      declarationVersion: string;
      idempotencyKey: string;
      lifecycleRevision: number;
      reason: string;
      startedAt: string;
      status: ApiComponents['schemas']['CompanyActivationAttemptStatusEnum'];
      uuid: string;
    };
    CompanyActivationAttemptStatusEnum: 'pending' | 'passed' | 'failed';
    CompanyAdministrativeAccess: {
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      draftSetup: boolean;
    };
    CompanyAppointment: {
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      createdAt: string;
      declarationText: string | null;
      declarationVersion: string | null;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      expiresAt: string | null;
      isEffective: boolean;
      revokedAt: string | null;
      status: ApiComponents['schemas']['CompanyAppointmentStatusEnum'];
      uuid: string;
    };
    CompanyAppointmentSourceEnum: 'initial' | 'invitation' | 'legacy_owner';
    CompanyAppointmentStatusEnum: 'active' | 'expired' | 'revoked';
    CompanyAuthorityRequest: {
      appointment: ApiComponents['schemas']['CompanyAppointment'] | null;
      company: string;
      companyIdentity: ApiComponents['schemas']['AuthorityCompanyIdentitySnapshot'];
      companyIdentityRaw: ApiComponents['schemas']['AuthorityCompanyIdentitySnapshot'];
      createdAt: string;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      fileSha256: string;
      fileSize: number;
      fileUrl: string;
      idempotencyKey: string;
      mimeType: string;
      originalFilename: string;
      personIdentity: ApiComponents['schemas']['AuthorityPersonIdentitySnapshot'];
      personIdentityRaw: ApiComponents['schemas']['AuthorityPersonIdentitySnapshot'];
      purpose: string;
      requestDigest: string;
      requestedCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      requestedExpiresAt: string | null;
      requesterProfile: string;
      status: ApiComponents['schemas']['CompanyAuthorityStatusEnum'];
      uuid: string;
      verificationMessage: string;
      verificationStatus: ApiComponents['schemas']['CompanyAuthorityVerificationStatusEnum'];
      withdrawnAt: string | null;
    };
    CompanyAuthorityRequestAdmissionRequest: {
      acceptDeclaration: boolean;
      declarationVersion: ApiComponents['schemas']['DeclarationVersionEnum'];
    };
    CompanyAuthorityRequestUploadRequest: {
      company: string;
      delegatableCapabilities?: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      file: Blob;
      idempotencyKey: string;
      requestedCapabilities?: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      requestedExpiresAt?: string | null;
    };
    CompanyAuthorityStatusEnum: 'pending' | 'withdrawn' | 'admitted';
    CompanyAuthorityVerificationStatusEnum: 'unavailable' | 'self_declared';
    CompanyCapabilityEnum: 'admin' | 'prepare' | 'approve' | 'apply' | 'finance' | 'read_register';
    CompanyDetail: {
      abn?: string;
      acn: string;
      activatedAt: string | null;
      activation: ApiComponents['schemas']['CompanyActivation'] | null;
      additionalInfoResponse: string;
      addressLine1?: string;
      addressLine2?: string;
      administrativeAccess: ApiComponents['schemas']['CompanyAdministrativeAccess'];
      approvedAt: string | null;
      canIssueTokens: boolean;
      city?: string;
      companyType?: ApiComponents['schemas']['CompanyTypeEnum'];
      companyTypeDisplay: string;
      country?: string;
      createdAt: string;
      description?: string;
      displayName: string;
      documents: ApiComponents['schemas']['CompanyDocument'][];
      email: string | null;
      foundedYear?: number | null;
      industry?: string;
      infoRequestedAt: string | null;
      infoRequestReason: string;
      isActive: boolean;
      isApproved: boolean;
      isOpenToInvestors?: boolean;
      isOwner: boolean;
      isPendingReview: boolean;
      name: string;
      operatorWallet: string | null;
      phone?: string;
      postcode?: string;
      primaryContact: ApiComponents['schemas']['_CompanyUserProfile'] | null;
      rejectionAt: string | null;
      rejectionReason: string;
      reviewStartedAt: string | null;
      state?: string;
      status: ApiComponents['schemas']['CompanyStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      tradingName?: string;
      updatedAt: string;
      uuid: string;
      withdrawalReason: string;
      withdrawnAt: string | null;
    };
    CompanyDocument: {
      company: string;
      createdAt: string;
      documentType: ApiComponents['schemas']['CompanyDocumentDocumentTypeEnum'];
      documentTypeDisplay: string;
      fileSize?: number;
      fileUrl: string;
      isVerified: boolean;
      mimeType?: string;
      name: string;
      uuid: string;
      verifiedAt: string | null;
    };
    CompanyDocumentDocumentTypeEnum:
      | 'cert_inc'
      | 'asic'
      | 'constitution'
      | 'share_register'
      | 'financials'
      | 'auditor_report'
      | 'director_id'
      | 'beneficial_ownership'
      | 'shareholder'
      | 'business_plan'
      | 'risk_disclosure'
      | 'prospectus'
      | 'legal_opinion'
      | 'tax_return'
      | 'bank_statement'
      | 'other';
    CompanyDocumentRequest: {
      documentType: ApiComponents['schemas']['CompanyDocumentDocumentTypeEnum'];
      externalUrl?: string;
      file?: Blob;
      fileSize?: number;
      mimeType?: string;
      name: string;
    };
    CompanyEligibilityDecision: {
      appointment: string;
      decidedAt: string;
      decidedBy: number;
      digest: string;
      expiresAt: string | null;
      idempotencyKey: string;
      outcome: ApiComponents['schemas']['CompanyEligibilityDecisionOutcomeEnum'];
      reason: string;
      requestDigest: string;
      revocation: ApiComponents['schemas']['CompanyEligibilityRevocation'] | null;
      uuid: string;
    };
    CompanyEligibilityDecisionCreateRequest: {
      appointment: string;
      confirmation: boolean;
      expiresAt?: string | null;
      idempotencyKey: string;
      outcome: ApiComponents['schemas']['CompanyEligibilityDecisionOutcomeEnum'];
      previewDigest: string;
      reason?: string;
    };
    CompanyEligibilityDecisionOutcomeEnum: 'accepted' | 'refused';
    CompanyEligibilityDecisionPreviewRequest: {
      appointment: string;
      expiresAt?: string | null;
      outcome: ApiComponents['schemas']['CompanyEligibilityDecisionOutcomeEnum'];
      reason?: string;
    };
    CompanyEligibilityDecisionPreviewResult: {
      canDecide: boolean;
      previewDigest: string;
      unmetRequirements: string[];
    };
    CompanyEligibilityRequest: {
      category: ApiComponents['schemas']['CategoryEnum'];
      company: string;
      decision: ApiComponents['schemas']['CompanyEligibilityDecision'] | null;
      digest: string;
      evidenceHash: string;
      idempotencyKey: string;
      outcome: ApiComponents['schemas']['CompanyEligibilityRequestOutcomeEnum'];
      requestedExpiresAt: string;
      sharedSummary: ApiComponents['schemas']['CompanyEligibilitySharedSummary'];
      source: string;
      sourceFingerprint: string;
      submittedAt: string;
      submittedBy: number;
      userAccount: string;
      uuid: string;
      version: string;
      withdrawal: ApiComponents['schemas']['CompanyEligibilityRequestWithdrawal'] | null;
    };
    CompanyEligibilityRequestCreateRequest: {
      company?: string | null;
      declarationAccepted: boolean;
      idempotencyKey: string;
      offering?: string | null;
      previewDigest: string;
      quantity?: number | null;
      requestedExpiresAt: string;
      sharingAccepted: boolean;
      source: string;
    };
    CompanyEligibilityRequestOutcomeEnum: 'pending' | 'accepted' | 'refused' | 'withdrawn' | 'revoked' | 'expired';
    CompanyEligibilityRequestPreviewRequest: {
      company?: string | null;
      offering?: string | null;
      quantity?: number | null;
      requestedExpiresAt: string;
      source: string;
    };
    CompanyEligibilityRequestPreviewResult: {
      canSubmit: boolean;
      evidenceHash: string | null;
      previewDigest: string;
      sharedSummary: ApiComponents['schemas']['CompanyEligibilitySharedSummary'];
      sourceFingerprint: string | null;
      unmetRequirements: string[];
      version: string;
    };
    CompanyEligibilityRequestWithdrawal: {
      digest: string;
      idempotencyKey: string;
      uuid: string;
      withdrawnAt: string;
      withdrawnBy: number;
    };
    CompanyEligibilityRequestWithdrawalCreateRequest: {
      idempotencyKey: string;
    };
    CompanyEligibilityRevocation: {
      appointment: string;
      digest: string;
      idempotencyKey: string;
      reason: string;
      revokedAt: string;
      revokedBy: number;
      uuid: string;
    };
    CompanyEligibilityRevocationCreateRequest: {
      appointment: string;
      idempotencyKey: string;
      reason: string;
    };
    CompanyEligibilitySharedSummary: {
      amountAud?: string;
      associatedCompany?: string | null;
      category: ApiComponents['schemas']['CategoryEnum'];
      certificateIssuedAt?: string | null;
      certifierBody?: ApiComponents['schemas']['CertifierBodyEnum'] | ApiComponents['schemas']['BlankEnum'];
      certifierMembershipNumber?: string;
      certifierName?: string;
      company: string;
      declarationText: string;
      offering?: string;
      offeringTerms?: unknown;
      offeringTermsDigest?: string;
      priceCurrency?: string;
      pricePerShare?: string;
      quantity?: number;
      requestedExpiresAt: string;
      source: string;
      submittedAt: string | null;
      token?: string;
      userAccount: string;
    };
    CompanyList: {
      acn: string;
      administrativeAccess: ApiComponents['schemas']['CompanyAdministrativeAccess'];
      city: string;
      companyType: ApiComponents['schemas']['CompanyTypeEnum'];
      companyTypeDisplay: string;
      createdAt: string;
      displayName: string;
      industry: string;
      isActive: boolean;
      isApproved: boolean;
      isOwner: boolean;
      name: string;
      state: string;
      status: ApiComponents['schemas']['CompanyStatusEnum'];
      statusDisplay: string;
      tradingName: string;
      uuid: string;
    };
    CompanyRegistered: {
      company: ApiComponents['schemas']['CompanyDetail'];
      message: string;
    };
    CompanyRegistrationRequest: {
      abn?: string;
      acn: string;
      companyType?: ApiComponents['schemas']['CompanyTypeEnum'];
      name: string;
      primaryContact: ApiComponents['schemas']['_CompanyUserProfileCreateRequest'];
      tradingName?: string;
    };
    CompanyStatusEnum:
      | 'draft'
      | 'submitted'
      | 'review'
      | 'info_required'
      | 'approved'
      | 'active'
      | 'warning'
      | 'suspended'
      | 'delisted'
      | 'rejected'
      | 'withdrawn';
    CompanyStatusUpdated: {
      company: ApiComponents['schemas']['CompanyDetail'];
      message: string;
    };
    CompanyStatusUpdateRequest: {
      attestOfficeholder?: boolean;
      boardResolutionReference?: string;
      declarantName?: string;
      reason?: string;
      status: ApiComponents['schemas']['CompanyStatusUpdateStatusEnum'];
    };
    CompanyStatusUpdateStatusEnum: 'active' | 'warning' | 'suspended' | 'delisted';
    CompanyTeamAppointment: {
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      company: string;
      createdAt: string;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      email: string;
      expiresAt: string | null;
      isEffective: boolean;
      name: string;
      revokedAt: string | null;
      source: ApiComponents['schemas']['CompanyAppointmentSourceEnum'];
      status: ApiComponents['schemas']['CompanyAppointmentStatusEnum'];
      uuid: string;
    };
    CompanyTeamInvitation: {
      acceptanceDeadline: string;
      acceptedAt: string | null;
      appointmentExpiresAt: string | null;
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      company: string;
      companyName: string;
      createdAt: string;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      idempotencyKey: string;
      inviterAppointment: string;
      uuid: string;
    };
    CompanyTeamInvitationAcceptRequest: {
      acceptDeclaration: boolean;
      code: string;
      declarationVersion: ApiComponents['schemas']['DeclarationVersionEnum'];
    };
    CompanyTeamInvitationCreateRequest: {
      acceptanceDeadline?: string | null;
      appointmentExpiresAt?: string | null;
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      company: string;
      delegatableCapabilities?: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      idempotencyKey: string;
      inviterAppointment: string;
    };
    CompanyTeamInvitationIssued: {
      acceptanceDeadline: string;
      acceptedAt: string | null;
      appointmentExpiresAt: string | null;
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      code: string | null;
      company: string;
      companyName: string;
      createdAt: string;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      idempotencyKey: string;
      inviterAppointment: string;
      uuid: string;
    };
    CompanyTypeEnum: 'pty' | 'public' | 'unlisted';
    DeclarationVersionEnum: '2026-10-04';
    DeletedAccountResponse: {
      message: string;
    };
    DeviceToken: {
      createdAt: string;
      deviceType: ApiComponents['schemas']['DeviceTypeEnum'];
      isActive?: boolean;
      lastUsedAt: string;
      pushToken: string;
      uuid: string;
    };
    DeviceTokenNotFound: {
      detail: string;
    };
    DeviceTypeEnum: 'ios' | 'android';
    DirectoryCompany: {
      city: string;
      displayName: string;
      industry: string;
      state: string;
    };
    DirectoryDocument: {
      createdAt: string;
      documentType: ApiComponents['schemas']['CompanyDocumentDocumentTypeEnum'];
      documentTypeDisplay: string;
      fileSize: number;
      fileUrl: string;
      mimeType: string;
      name: string;
      uuid: string;
      validFrom: string | null;
      validUntil: string | null;
    };
    DirectoryOpenOfferingResponse: {
      closesAt: string | null;
      opensAt: string;
      priceCurrency: string;
      pricePerShare: string;
      uuid: string;
    };
    DirectoryTokenList: {
      bestAsk: string | null;
      bestBid: string | null;
      chain: string | null;
      company: ApiComponents['schemas']['DirectoryCompany'];
      companyName: string;
      companyUuid: string;
      contractAddress: string | null;
      createdAt: string;
      decimals: number;
      deployedAt: string | null;
      isDivisible: boolean;
      issuedShares: number;
      isTransferable: boolean;
      lastPrice: string | null;
      name: string;
      openOffering: ApiComponents['schemas']['DirectoryOpenOfferingResponse'] | null;
      status: ApiComponents['schemas']['ShareTokenStatusEnum'];
      statusDisplay: string;
      symbol: string;
      tokenType: ApiComponents['schemas']['TokenTypeEnum'];
      tokenTypeDisplay: string;
      totalSupply: string;
      uuid: string;
    };
    Document: {
      attachedAt: string | null;
      classification: string | null;
      createdAt: string;
      documentType: ApiComponents['schemas']['UserDocumentTypeEnum'];
      latestExtraction: ApiComponents['schemas']['DocumentExtraction'] | null;
      mimeType: string;
      note: string;
      originalFilename: string;
      purgedAt: string | null;
      retentionUntil: string | null;
      updatedAt: string;
      uuid: string;
    };
    DocumentAttachmentRequest: {
      classification: string;
    };
    DocumentExtraction: {
      confidence: number | null;
      createdAt: string;
      durationMs: number | null;
      error: string;
      finishedAt: string | null;
      modelName: string;
      parsedJson: unknown;
      startedAt: string | null;
      status: ApiComponents['schemas']['DocumentExtractionStatusEnum'];
      updatedAt: string;
      uuid: string;
      warnings: unknown;
    };
    DocumentExtractionStatusEnum: 'pending' | 'running' | 'succeeded' | 'failed';
    DocumentUploadRequest: {
      classification?: string | null;
      documentType?: ApiComponents['schemas']['UserDocumentTypeEnum'];
      file: Blob;
      note?: string;
    };
    EmailVerificationRequest: {
      email: string;
      token: string;
    };
    ExchangeRateResponse: {
      baseCurrency: string;
      rate: string;
      targetCurrency: string;
    };
    ExemptionEnum:
      | 's708_8_minimum_amount'
      | 's708_8_net_assets'
      | 's708_8_gross_income'
      | 's708_11_professional'
      | 's761g_wholesale_client';
    ExportedAccount: {
      accountNumber: string;
      accountType: string;
      activationDate: string | null;
      createdAt: string;
      uuid: string;
    };
    ExportedChainObservation: {
      finality: string;
      network: string;
      policy: {
        [key: string]: unknown;
      };
      result: string;
    };
    ExportedFinancialProfile: {
      intendedUse: string | null;
      intendedUseOtherText: string | null;
      occupation: string | null;
      sourceOfFunds: unknown;
      sourceOfFundsOtherText: string | null;
    };
    ExportedPortfolio: {
      createdAt: string;
      isActive: boolean;
      name: string;
      uuid: string;
    };
    ExportedProfile: {
      citizenshipCountry: string | null;
      createdAt: string;
      dateOfBirth: string | null;
      fullName: string | null;
      isIdVerified: boolean;
      phoneCountryCode: string | null;
      phoneNumber: string | null;
      residentialAddress: string | null;
    };
    ExportedTransaction: {
      amount: string;
      asset: string | null;
      blockHash: string | null;
      blockNumber: string | null;
      blockTimestamp: string | null;
      chain: string;
      chainObservation: ApiComponents['schemas']['ExportedChainObservation'] | null;
      createdAt: string;
      fromAddress: string;
      importedFromHistory: boolean;
      nonce: string | null;
      status: string;
      toAddress: string | null;
      transactionFee: string | null;
      txHash: string;
      uuid: string;
    };
    ExportedUser: {
      dateJoined: string;
      email: string;
      isEmailVerified: boolean;
    };
    ExportedWallet: {
      address: string;
      chain: string;
      createdAt: string;
      isVerified: boolean;
      marketValue: string;
      name: string | null;
      nativeBalance: string;
      uuid: string;
    };
    ExtractedApplicantData: {
      address: string | null;
      dateOfBirth: string | null;
      fullName: string | null;
      residenceCountry?: string | null;
    };
    FeatureFlag: {
      description?: string;
      enabled?: boolean;
      minAppVersion?: string;
      name: string;
      platform?: ApiComponents['schemas']['PlatformEnum'];
      uuid: string;
    };
    FiatPurchaseWidget: {
      chain: string;
      cryptoCurrency: string;
      url: string;
      walletAddress: string;
    };
    FiatPurchaseWidgetRequestRequest: {
      cryptoCurrencyCode?: ((string | null) | 0 | false | unknown[] | Record<string, never>) | null;
      defaultFiatAmount?: ((number | null) | string | boolean | unknown[] | Record<string, never>) | null;
      defaultFiatCurrency?: ((string | null) | 0 | false | unknown[] | Record<string, never>) | null;
      fiatAmount?: ((number | null) | string | boolean | unknown[] | Record<string, never>) | null;
      fiatCurrency?: ((string | null) | 0 | false | unknown[] | Record<string, never>) | null;
      redirectUrl?: unknown;
      themeColor?: unknown;
      walletUuid: string;
    };
    FieldEnum: 'quantity' | 'min_quantity' | 'price_per_share';
    FinancialProfile: {
      intendedUse?:
        | (
            | ApiComponents['schemas']['IntendedUseEnum']
            | ApiComponents['schemas']['BlankEnum']
            | ApiComponents['schemas']['NullEnum']
          )
        | null;
      intendedUseOtherText?: string | null;
      occupation?: string | null;
      sourceOfFunds?: unknown;
      sourceOfFundsOtherText?: string | null;
      userProfile: string;
      uuid: string;
    };
    FinancialProfileRequest: {
      intendedUse?:
        | (
            | ApiComponents['schemas']['IntendedUseEnum']
            | ApiComponents['schemas']['BlankEnum']
            | ApiComponents['schemas']['NullEnum']
          )
        | null;
      intendedUseOtherText?: string | null;
      occupation?: string | null;
      sourceOfFunds?: unknown;
      sourceOfFundsOtherText?: string | null;
    };
    FormerMember: {
      ceasedAtBlock: number | null;
      ceasedOn: string;
      identityRecordedAt: string;
      identitySource: ApiComponents['schemas']['IdentitySourceEnum'];
      identitySourceDisplay: string;
      name: string;
      residentialAddress: string;
      sharesAtCessation: string;
      uuid: string;
      walletAddress: string | null;
    };
    HolderTypeEnum: 'member' | 'treasury' | 'ambiguous' | 'unidentified';
    Holding: {
      asset: ApiComponents['schemas']['Asset'];
      assetName: string;
      assetSymbol: string;
      assetUuid: string;
      chain: string;
      createdAt: string;
      lastSyncedAt: string | null;
      marketValue: string | null;
      quantity: string;
      shareClass: ApiComponents['schemas']['AssetShareClass'] | null;
      updatedAt: string;
      uuid: string;
      valueSource: ApiComponents['schemas']['ValueSourceEnum'];
      walletAddress: string;
      walletUuid: string;
    };
    HttpStatusEnum: 400 | 409;
    IdentitySourceEnum:
      'profile' | 'stamped' | 'recorded' | 'particulars' | 'treasury_label' | 'unresolvable' | 'none' | 'unknown';
    IdentityVerificationSession: {
      accessToken: string | null;
      applicantId: string | null;
      formUrl: string | null;
      provider: string;
    };
    IdentityVerificationStatus: {
      applicantId: string | null;
      extractedData: ApiComponents['schemas']['ExtractedApplicantData'] | null;
      isVerified: boolean;
      needsRetry: boolean;
      provider: string;
      rejectionLabels: string[];
      reviewAnswer: string | null;
      reviewResult: string | null;
      status: string | null;
      verifiedAt: string | null;
    };
    IntendedUseEnum: 'long_term_investment' | 'trading_crypto' | 'savings' | 'other';
    InvestorClassification: {
      category: ApiComponents['schemas']['CategoryEnum'];
      categoryDisplay: string;
      certificateIssuedAt?: string | null;
      certifierBody?: ApiComponents['schemas']['CertifierBodyEnum'] | ApiComponents['schemas']['BlankEnum'];
      certifierMembershipNumber?: string;
      certifierName?: string;
      company?: string | null;
      createdAt: string;
      declarationAccepted?: boolean;
      declarationText: string;
      declaredBasis?: string;
      evidenceFileSize: number | null;
      evidenceMimeType: string;
      expiresAt: string | null;
      isExpired: boolean;
      isLive: boolean;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewNotes: string;
      status: ApiComponents['schemas']['InvestorClassificationStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      userAccount: string;
      uuid: string;
    };
    InvestorClassificationRequest: {
      category: ApiComponents['schemas']['CategoryEnum'];
      certificateIssuedAt?: string | null;
      certifierBody?: ApiComponents['schemas']['CertifierBodyEnum'] | ApiComponents['schemas']['BlankEnum'];
      certifierMembershipNumber?: string;
      certifierName?: string;
      company?: string | null;
      declarationAccepted?: boolean;
      declaredBasis?: string;
      evidenceFile: Blob;
    };
    InvestorClassificationStatusEnum: 'submitted' | 'verified' | 'rejected' | 'revoked' | 'withdrawn';
    InvestorEligibility: {
      account: string | null;
      classification: ApiComponents['schemas']['InvestorClassification'] | null;
      isEligible: boolean;
      reasons: string[];
    };
    IssuanceTypeEnum: 'initial' | 'additional' | 'bonus' | 'dividend' | 'transfer';
    IssuerSubscription: {
      allotmentState: string;
      allottedQuantity: number | null;
      amountDue: string;
      amountReceived: string | null;
      createdAt: string;
      investorName: string;
      paymentConfirmedAt: string | null;
      paymentDueAt: string | null;
      pricePerShare: string;
      quantity: number;
      reference: string;
      settlementRailDisplay: string;
      status: ApiComponents['schemas']['SubscriptionStatusEnum'];
      statusDisplay: string;
      uuid: string;
      walletAddress: string;
    };
    KycProviderEnum: 'sumsub' | 'kycaid';
    MarkAllReadResponse: {
      marked: number;
    };
    NameEnum: 'LedovaAtomicSwap';
    NetworkEnum: 'BTC';
    Notification: {
      body: string;
      createdAt: string;
      data: unknown;
      isArchived?: boolean;
      isRead?: boolean;
      notificationType: ApiComponents['schemas']['NotificationTypeEnum'];
      readAt: string | null;
      title: string;
      updatedAt: string;
      uuid: string;
    };
    NotificationRequest: {
      isArchived?: boolean;
      isRead?: boolean;
    };
    NotificationTypeEnum: 'transaction' | 'general' | 'system';
    NullEnum: null;
    OfferingDetail: {
      acceptsBankTransfer: boolean;
      canBeDeleted: boolean;
      canBeEdited: boolean;
      capShares: number;
      closedAt: string | null;
      closeReason: string;
      closesAt: string | null;
      createdAt: string;
      documents: string[];
      exemption: ApiComponents['schemas']['ExemptionEnum'];
      exemptionDisplay: string;
      isOpen: boolean;
      maximumShares: number | null;
      minimumShares: number;
      opensAt: string;
      priceCurrency: ApiComponents['schemas']['PriceCurrencyEnum'];
      pricePerShare: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedByEmail: string | null;
      reviewNotes: string;
      settlementAssets: string[];
      status: ApiComponents['schemas']['OfferingStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      submittedByEmail: string | null;
      summary: string;
      targetShares: number;
      tokenName: string;
      tokenSymbol: string;
      tokenUuid: string;
      updatedAt: string;
      useOfProceeds: string;
      uuid: string;
    };
    OfferingDocumentsRequest: {
      documents: string[];
    };
    OfferingList: {
      canBeDeleted: boolean;
      canBeEdited: boolean;
      capShares: number;
      closeReason: string;
      closesAt: string | null;
      createdAt: string;
      exemption: ApiComponents['schemas']['ExemptionEnum'];
      exemptionDisplay: string;
      isOpen: boolean;
      maximumShares: number | null;
      minimumShares: number;
      opensAt: string;
      priceCurrency: ApiComponents['schemas']['PriceCurrencyEnum'];
      pricePerShare: string;
      rejectionReason: string;
      status: ApiComponents['schemas']['OfferingStatusEnum'];
      statusDisplay: string;
      targetShares: number;
      tokenName: string;
      tokenSymbol: string;
      tokenUuid: string;
      uuid: string;
    };
    OfferingStatusEnum: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'closed' | 'withdrawn';
    OfferingWithdrawRequest: {
      reason?: string;
    };
    OfferingWriteRequest: {
      acceptsBankTransfer?: boolean;
      capShares: number;
      closesAt?: string | null;
      documents?: string[];
      exemption: ApiComponents['schemas']['ExemptionEnum'];
      maximumShares?: number | null;
      minimumShares: number;
      opensAt: string;
      pricePerShare: string;
      settlementAssets?: string[];
      summary?: string;
      targetShares: number;
      token: string;
      useOfProceeds?: string;
    };
    Operator: {
      abn: string;
      contactEmail: string;
      investorKycRequired: boolean;
      issuedStablecoin: ApiComponents['schemas']['SettlementAsset'] | null;
      issuerKycRequired: boolean;
      legalName: string;
      name: string;
      paymentInstructions: ApiComponents['schemas']['OperatorPaymentInstructions'] | null;
      supportedSettlementAssets: ApiComponents['schemas']['SettlementAsset'][];
      website: string;
    };
    OperatorPaymentInstructions: {
      bankAccountName?: string;
      bankAccountNumber?: string;
      bankBsb?: string;
      paymentReferencePrefix?: string;
      receivingWalletAddress?: string;
      receivingWalletChain?: string;
    };
    OrderActionAppliedResult:
      ApiComponents['schemas']['OrderActionCancelResult'] | ApiComponents['schemas']['OrderActionModifyResult'];
    OrderActionCancelResult: {
      fromStatus: ApiComponents['schemas']['TransferOrderStatusEnum'];
      kind: ApiComponents['schemas']['OrderActionCancelResultKindEnum'];
      toStatus: ApiComponents['schemas']['ToStatusEnum'];
    };
    OrderActionCancelResultKindEnum: 'cancel';
    OrderActionChallenge: {
      digest: string;
      domain: ApiComponents['schemas']['SigningDomain'];
      expiresAt: string;
      message: ApiComponents['schemas']['SigningMessage'];
      purpose: ApiComponents['schemas']['OrderActionChallengePurposeEnum'];
      types: ApiComponents['schemas']['SigningTypes'];
    };
    OrderActionChallengePurposeEnum: 'order_cancel' | 'order_modify';
    OrderActionChange: {
      field: ApiComponents['schemas']['FieldEnum'];
      new: string;
      old: string;
    };
    OrderActionContext: {
      currentValues: ApiComponents['schemas']['OrderActionCurrentValues'];
      domain: ApiComponents['schemas']['SigningDomain'];
      orderUuid: string;
      ownerAccountUuid: string;
      protocolVersion: number;
      token: ApiComponents['schemas']['OrderActionToken'];
      tokenUuid: string;
      walletAddress: string;
      walletUuid: string;
    };
    OrderActionCurrentValues: {
      canCancel: boolean;
      canModify: boolean;
      filledQuantity: string;
      minQuantity: string;
      modificationCount: number;
      orderType: ApiComponents['schemas']['TransferOrderTypeEnum'];
      pricePerShare: string;
      quantity: string;
      remainingQuantity: string;
      status: ApiComponents['schemas']['TransferOrderStatusEnum'];
    };
    OrderActionExecuteRequestRequest: {
      actionId: string;
      digest?: string;
      ownerAccountUuid: string;
      signature?: string;
    };
    OrderActionIdentityRequest: {
      actionId: string;
      ownerAccountUuid: string;
    };
    OrderActionIntent: {
      domain: ApiComponents['schemas']['SigningDomain'];
      modifications: ApiComponents['schemas']['OrderActionValues'] | null;
    };
    OrderActionModifyRequestRequest: {
      actionId: string;
      newMinQuantity: string;
      newPricePerShare: string;
      newQuantity: string;
      ownerAccountUuid: string;
    };
    OrderActionModifyResult: {
      changes: ApiComponents['schemas']['OrderActionChange'][];
      kind: ApiComponents['schemas']['OrderActionModifyResultKindEnum'];
      modificationCount: number;
    };
    OrderActionModifyResultKindEnum: 'modify';
    OrderActionRefusal: {
      code: ApiComponents['schemas']['OrderActionRefusalCodeEnum'];
      detail: string;
      httpStatus: ApiComponents['schemas']['HttpStatusEnum'];
    };
    OrderActionRefusalCodeEnum:
      'order_cancellation_failed' | 'order_modification_failed' | 'order_modification_conflict';
    OrderActionReview: {
      currentValues: ApiComponents['schemas']['OrderActionCurrentValues'];
      token: ApiComponents['schemas']['OrderActionToken'];
    };
    OrderActionSubmission: {
      actionId: string;
      challenge: ApiComponents['schemas']['OrderActionChallenge'] | null;
      intent: ApiComponents['schemas']['OrderActionIntent'];
      order: ApiComponents['schemas']['SubmissionOrder'];
      orderUuid: string;
      ownerAccountUuid: string;
      protocolVersion: number;
      purpose: ApiComponents['schemas']['OrderActionSubmissionPurposeEnum'];
      refusal: ApiComponents['schemas']['OrderActionRefusal'] | null;
      result: ApiComponents['schemas']['OrderActionAppliedResult'] | null;
      review: ApiComponents['schemas']['OrderActionReview'];
      status: ApiComponents['schemas']['OrderActionSubmissionStatusEnum'];
      tokenUuid: string;
      walletAddress: string;
      walletUuid: string;
    };
    OrderActionSubmissionPurposeEnum: 'cancel' | 'modify';
    OrderActionSubmissionStatusEnum: 'pending' | 'applied' | 'refused';
    OrderActionToken: {
      contractAddress: string;
      name: string;
      symbol: string;
    };
    OrderActionValues: {
      minQuantity: string;
      pricePerShare: string;
      quantity: string;
    };
    OrderBook: {
      buyOrders: ApiComponents['schemas']['OrderBookEntry'][];
      sellOrders: ApiComponents['schemas']['OrderBookEntry'][];
      token: string;
    };
    OrderBookEntry: {
      orders: number;
      price: string;
      quantity: number;
    };
    OrderCreateChallenge: {
      digest: string;
      domain: ApiComponents['schemas']['SigningDomain'];
      expiresAt: string;
      message: ApiComponents['schemas']['SigningMessage'];
      purpose: ApiComponents['schemas']['OrderCreateChallengePurposeEnum'];
      tokenUuid: string;
      types: ApiComponents['schemas']['SigningTypes'];
      walletAddress: string;
    };
    OrderCreateChallengePurposeEnum: 'order_create';
    OrderSubmission: {
      challenge: ApiComponents['schemas']['OrderCreateChallenge'] | null;
      intent: ApiComponents['schemas']['OrderSubmissionIntent'];
      match: ApiComponents['schemas']['OrderSubmissionMatch'] | null;
      order: ApiComponents['schemas']['SubmissionOrder'] | null;
      ownerAccountUuid: string;
      refusal: ApiComponents['schemas']['OrderSubmissionRefusal'] | null;
      status: ApiComponents['schemas']['OrderSubmissionStatusEnum'];
      submissionId: string;
      walletUuid: string;
    };
    OrderSubmissionIntent: {
      minQuantity: string;
      orderType: ApiComponents['schemas']['OrderSubmissionIntentOrderTypeEnum'];
      pricePerShare: string;
      quantity: string;
      token: string;
      walletAddress: string;
    };
    OrderSubmissionIntentOrderTypeEnum: 'buy' | 'sell';
    OrderSubmissionMatch: {
      counterOrder: string;
      matched: boolean;
      swapOrder: string;
    };
    OrderSubmissionRefusal: {
      code: string;
      detail: string;
    };
    OrderSubmissionStatusEnum: 'pending' | 'created' | 'refused';
    OutcomeEnum: 'pending' | 'confirmed' | 'reverted' | 'superseded';
    OwnCompanyAppointment: {
      capabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      company: string;
      companyName: string;
      createdAt: string;
      declarationText: string | null;
      declarationVersion: string | null;
      delegatableCapabilities: ApiComponents['schemas']['CompanyCapabilityEnum'][];
      expiresAt: string | null;
      isEffective: boolean;
      revokedAt: string | null;
      source: ApiComponents['schemas']['CompanyAppointmentSourceEnum'];
      status: ApiComponents['schemas']['CompanyAppointmentStatusEnum'];
      uuid: string;
    };
    PaginatedAssetList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Asset'][];
    };
    PaginatedCapitalIncreaseListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['CapitalIncreaseList'][];
    };
    PaginatedCompanyAuthorityRequestList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['CompanyAuthorityRequest'][];
    };
    PaginatedCompanyEligibilityRequestList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['CompanyEligibilityRequest'][];
    };
    PaginatedCompanyListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['CompanyList'][];
    };
    PaginatedCompanyTeamInvitationList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['CompanyTeamInvitation'][];
    };
    PaginatedDirectoryTokenListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['DirectoryTokenList'][];
    };
    PaginatedDocumentList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Document'][];
    };
    PaginatedFeatureFlagList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['FeatureFlag'][];
    };
    PaginatedFinancialProfileList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['FinancialProfile'][];
    };
    PaginatedInvestorClassificationList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['InvestorClassification'][];
    };
    PaginatedIssuerSubscriptionList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['IssuerSubscription'][];
    };
    PaginatedNotificationList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Notification'][];
    };
    PaginatedOfferingListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['OfferingList'][];
    };
    PaginatedOwnCompanyAppointmentList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['OwnCompanyAppointment'][];
    };
    PaginatedPortfolioList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Portfolio'][];
    };
    PaginatedPublicationList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Publication'][];
    };
    PaginatedRegisterCorrectionList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterCorrection'][];
    };
    PaginatedRegisterImportList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterImport'][];
    };
    PaginatedRegisterInstructionList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterInstruction'][];
    };
    PaginatedRegisterOpeningList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterOpening'][];
    };
    PaginatedRegisterReconciliationList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterReconciliation'][];
    };
    PaginatedRegisterWalletLinkList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['RegisterWalletLink'][];
    };
    PaginatedShareIssuanceListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['ShareIssuanceList'][];
    };
    PaginatedShareIssuanceRequestList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['ShareIssuanceRequest'][];
    };
    PaginatedShareRegisterEntryList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['ShareRegisterEntry'][];
    };
    PaginatedShareTokenListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['ShareTokenList'][];
    };
    PaginatedSubscriptionListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['SubscriptionList'][];
    };
    PaginatedSwapOrderListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['SwapOrderList'][];
    };
    PaginatedTransactionList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Transaction'][];
    };
    PaginatedTransferOrderListList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['TransferOrderList'][];
    };
    PaginatedUserProfileList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['UserProfile'][];
    };
    PaginatedWalletList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['Wallet'][];
    };
    PaginatedWhitelistEntryList: {
      count: number;
      next?: string | null;
      previous?: string | null;
      results: ApiComponents['schemas']['WhitelistEntry'][];
    };
    PatchedCompanyUpdateRequest: {
      abn?: string;
      acn?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      companyType?: ApiComponents['schemas']['CompanyTypeEnum'];
      description?: string;
      industry?: string;
      isOpenToInvestors?: boolean;
      name?: string;
      operatorWallet?: string | null;
      phone?: string;
      postcode?: string;
      state?: string;
      tradingName?: string;
    };
    PatchedFinancialProfileRequest: {
      intendedUse?:
        | (
            | ApiComponents['schemas']['IntendedUseEnum']
            | ApiComponents['schemas']['BlankEnum']
            | ApiComponents['schemas']['NullEnum']
          )
        | null;
      intendedUseOtherText?: string | null;
      occupation?: string | null;
      sourceOfFunds?: unknown;
      sourceOfFundsOtherText?: string | null;
    };
    PatchedNotificationRequest: {
      isArchived?: boolean;
      isRead?: boolean;
    };
    PatchedOfferingWriteRequest: {
      acceptsBankTransfer?: boolean;
      capShares?: number;
      closesAt?: string | null;
      documents?: string[];
      exemption?: ApiComponents['schemas']['ExemptionEnum'];
      maximumShares?: number | null;
      minimumShares?: number;
      opensAt?: string;
      pricePerShare?: string;
      settlementAssets?: string[];
      summary?: string;
      targetShares?: number;
      token?: string;
      useOfProceeds?: string;
    };
    PatchedPortfolioRequest: {
      isActive?: boolean;
      name?: string;
    };
    PatchedUserAccountRequest: {
      accountType?: ApiComponents['schemas']['AccountTypeEnum'];
      role?: ApiComponents['schemas']['RoleEnum'];
    };
    PatchedUserProfileRequest: {
      citizenshipCountry?: string;
      confirmedAustralianResident?: boolean;
      confirmedIndividualAccount?: boolean;
      confirmedOver18?: boolean;
      dateOfBirth?: string | null;
      fullName?: string | null;
      isSignupCompleted?: boolean;
      phoneCountryCode?: string | null;
      phoneNumber?: string | null;
      residenceCountry?: string;
      residentialAddress?: string | null;
      termsAndConditions?: boolean;
    };
    PatchedWalletRequest: {
      address?: string;
      addressIndex?: number | null;
      chain?: ApiComponents['schemas']['SupportedWalletChainEnum'];
      derivationPath?: string | null;
      masterFingerprint?: string | null;
      name?: string | null;
      parentChainCode?: string | null;
      parentDerivationPath?: string | null;
      parentPublicKey?: string | null;
      signingPreference?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      walletType?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
    };
    PauseSubmission: {
      completedAt: string | null;
      paused: boolean;
      status: ApiComponents['schemas']['PauseSubmissionStatusEnum'];
      uuid: string;
    };
    PauseSubmissionRequestRequest: {
      submissionId: string;
    };
    PauseSubmissionResponse: {
      message: string;
      submission: ApiComponents['schemas']['PauseSubmission'];
      token: ApiComponents['schemas']['ShareTokenDetail'];
    };
    PauseSubmissionStatusEnum: 'pending' | 'executing' | 'observed' | 'confirmed' | 'failed';
    PaymentInstruction: {
      amountDue: string;
      assetSymbol?: string;
      bankAccountName?: string;
      bankAccountNumber?: string;
      bankBsb?: string;
      chain?: string;
      contractAddress?: string;
      currency: string;
      decimals?: number;
      issuedAt: string | null;
      payee: string;
      paymentDueAt: string | null;
      rail: ApiComponents['schemas']['SettlementRailEnum'];
      railDisplay: string;
      receivingWalletAddress?: string;
      reference: string;
      settlementAmount?: string;
    };
    PendingTransfer: {
      holdingQuantity: string;
      status: string;
      transactionId: string;
      txHash: string;
    };
    PlatformEnum: 'all' | 'ios' | 'android' | 'web' | 'mobile';
    Portfolio: {
      createdAt: string;
      isActive?: boolean;
      name: string;
      updatedAt: string;
      userAccount: string;
      uuid: string;
      walletCount: number;
      walletUuids: string[];
    };
    PortfolioRequest: {
      isActive?: boolean;
      name: string;
    };
    PortfolioWalletResponse: {
      message: string;
      portfolio: ApiComponents['schemas']['Portfolio'];
      success: boolean;
    };
    PreparedBitcoinTransfer: {
      amountBtc: string;
      amountSatoshis: number;
      estimatedTxSize: number;
      feeBtc: string;
      feePerByte: string;
      feeSatoshis: number;
      fromAddress: string;
      network: ApiComponents['schemas']['NetworkEnum'];
      toAddress: string;
      totalCostBtc: string;
    };
    PreparedEvmTransaction: {
      chainId: number;
      data?: string;
      gas: number;
      gasPrice: number;
      nonce: number;
      to: string;
      value: string;
    };
    PreparedEvmTransfer: {
      amountEth?: string;
      amountToken?: string;
      fromAddress: string;
      gasCostEth: string;
      gasLimit: number;
      gasPriceGwei: string;
      gasPriceWei: string;
      toAddress: string;
      tokenContract?: string;
      tokenDecimals?: number;
      tokenSymbol?: string;
      totalCostEth?: string;
      transaction: ApiComponents['schemas']['PreparedEvmTransaction'];
    };
    PreparedWalletTransfer:
      ApiComponents['schemas']['PreparedEvmTransfer'] | ApiComponents['schemas']['PreparedBitcoinTransfer'];
    PrepareWalletTransferRequest: {
      amountBtc?: string;
      amountEth?: string;
      amountToken?: string;
      toAddress: string;
      tokenContract?: string;
    };
    PriceCurrencyEnum: 'AUD' | 'USD' | 'EUR' | 'GBP' | 'CAD' | 'JPY' | 'NZD' | 'SGD';
    PrimaryTypeEnum: 'SwapOrder';
    ProtocolVersionEnum: 1;
    Publication: {
      ballotOutstanding: boolean;
      closesAt: string | null;
      companyName: string;
      createdAt: string;
      currency: string | null;
      declaredOn: string | null;
      kind: ApiComponents['schemas']['PublicationKindEnum'];
      myBallot: ApiComponents['schemas']['PublicationBallot'] | null;
      myEntitlement: string | null;
      myPaymentRecord: ApiComponents['schemas']['PublicationPaymentRecord'] | null;
      myRecordedEntitlement: string | null;
      opensAt: string | null;
      paymentDate: string | null;
      question: string | null;
      ratePerShare: string | null;
      recordDate: string;
      resolutionKind: (ApiComponents['schemas']['ResolutionKindEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      result: ApiComponents['schemas']['PublicationResult'] | null;
      shares: string | null;
      title: string;
      tokenName: string;
      tokenSymbol: string;
      uuid: string;
    };
    PublicationBallot: {
      castAt: string;
      choice: ApiComponents['schemas']['BallotChoiceEnum'];
      staffEntered: boolean;
    };
    PublicationCount: {
      members: number;
      shares: string;
    };
    PublicationKindEnum: 'holding_statement' | 'meeting_notice' | 'resolution' | 'distribution';
    PublicationPaymentRecord: {
      recordedAt: string;
      recordedPaidOn: string;
      reference: string;
    };
    PublicationResult: {
      abstain: ApiComponents['schemas']['PublicationCount'];
      against: ApiComponents['schemas']['PublicationCount'];
      carried: boolean;
      eligible: ApiComponents['schemas']['PublicationCount'];
      for: ApiComponents['schemas']['PublicationCount'];
    };
    PublicationSummary: {
      dividendsWithoutRecord: number;
      nextClosesAt: string | null;
      openResolutions: number;
    };
    RegisterAcknowledgement: {
      acknowledgedAt: string;
      acknowledgedByName: string | null;
      appointment: string | null;
      providedBy: string;
      reason: string;
    };
    RegisterAcknowledgeRequest: {
      appointment: string;
      discrepancy: number;
      idempotencyKey: string;
      reason: string;
    };
    RegisterCorrection: {
      appliedEntry: string | null;
      approvingDirector: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityEvidence: string | null;
      authorityReference: string;
      baseHash: string;
      baseSequence: number;
      changes: unknown;
      company: string;
      corrects: string;
      createdAt: string;
      decisions: ApiComponents['schemas']['RegisterCorrectionDecision'][];
      effectiveOn: string;
      evidenceFingerprint: string;
      evidenceSnapshot: unknown;
      preparedByName: string | null;
      preparingAppointment: string | null;
      providedBy: string;
      reason: string;
      register: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      sourceDocument: string | null;
      stage: string;
      status: ApiComponents['schemas']['RegisterCorrectionStatusEnum'];
      submittedBy: number;
      uuid: string;
    };
    RegisterCorrectionAuthorityEnum: 'director_resolution' | 'court_order';
    RegisterCorrectionChange: {
      member: string;
      shares: string;
    };
    RegisterCorrectionCreateRequest: {
      appointment: string;
      approvingDirector?: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityEvidence: string;
      authorityReference: string;
      correctsId: string;
      effectiveOn: string;
      operationId: string;
      reason: string;
    };
    RegisterCorrectionDecideRequest: {
      appointment: string;
      confirmation: boolean;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      previewDigest: string;
      reason?: string;
    };
    RegisterCorrectionDecision: {
      appointment: string;
      decidedAt: string;
      decidedBy: number;
      decidedByName: string;
      digest: string;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason: string;
      uuid: string;
    };
    RegisterCorrectionDecisionPreview: {
      canDecide: boolean;
      changes: ApiComponents['schemas']['RegisterCorrectionChange'][];
      effectiveOn: string;
      originalChanges: ApiComponents['schemas']['RegisterCorrectionChange'][];
      previewDigest: string;
      registerSequence: number;
      unmetRequirements: string[];
    };
    RegisterCorrectionDecisionRequestRequest: {
      appointment: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason?: string;
    };
    RegisterCorrectionStatusEnum: 'submitted' | 'applied' | 'rejected';
    RegisterDecisionKindEnum: 'approve' | 'apply' | 'reject';
    RegisterDeviceTokenRequest: {
      deviceType: ApiComponents['schemas']['DeviceTypeEnum'];
      pushToken: string;
    };
    RegisterDiscrepancy: {
      acknowledgeable: boolean;
      acknowledgement: ApiComponents['schemas']['RegisterAcknowledgement'] | null;
      address?: string;
      block?: number;
      chain?: string;
      detail?: string;
      effect?: string;
      expected?: string;
      kind: string;
      member?: string;
      source?: string;
      transaction?: string;
    };
    RegisterEvidence: {
      appointment: string;
      company: string;
      createdAt: string;
      fileSize: number;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterEvidenceKindEnum'];
      mimeType: string;
      originalFilename: string;
      providedBy: string;
      sha256: string;
      uuid: string;
    };
    RegisterEvidenceKindEnum: 'share_register' | 'asic_extract' | 'authority';
    RegisterEvidenceUploadRequest: {
      appointment: string;
      companyId: string;
      file: Blob;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterEvidenceKindEnum'];
    };
    RegisterImport: {
      approvingDirector: string;
      asAt: string;
      asicDocument: string | null;
      asicEvidence: string | null;
      asicFingerprint: string;
      asicIssuedTotal: string | null;
      asicMemberCount: number | null;
      asicSnapshot: unknown;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityReference: string;
      company: string;
      createdAt: string;
      decisions: ApiComponents['schemas']['RegisterImportDecision'][];
      evidenceFingerprint: string;
      evidenceSnapshot: unknown;
      formerMembers: unknown;
      members: unknown;
      preparedByName: string | null;
      preparingAppointment: string | null;
      providedBy: string;
      reason: string;
      registerEvidence: string | null;
      registerSequence: number | null;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      sourceDocument: string | null;
      stage: string;
      status: ApiComponents['schemas']['RegisterCorrectionStatusEnum'];
      submittedBy: number;
      token: string;
      uuid: string;
    };
    RegisterImportCreateRequest: {
      appointment: string;
      approvingDirector?: string;
      asAt: string;
      asicEvidence: string;
      asicIssuedTotal: string;
      asicMemberCount: number;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityReference: string;
      formerMembers: {
        [key: string]: unknown;
      }[];
      members: {
        [key: string]: unknown;
      }[];
      operationId: string;
      reason: string;
      registerEvidence: string;
      tokenId: string;
    };
    RegisterImportDecideRequest: {
      appointment: string;
      confirmation: boolean;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      previewDigest: string;
      reason?: string;
    };
    RegisterImportDecision: {
      appointment: string;
      decidedAt: string;
      decidedBy: number;
      decidedByName: string;
      digest: string;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason: string;
      uuid: string;
    };
    RegisterImportDecisionPreview: {
      canDecide: boolean;
      comparison: ApiComponents['schemas']['RegisterImportPreviewRow'][];
      importedMemberCount: number;
      importedTotal: string;
      opensRegister: boolean;
      previewDigest: string;
      registerSequence: number;
      statedMemberCount: number | null;
      statedTotal: string | null;
      unmetRequirements: string[];
    };
    RegisterImportDecisionRequestRequest: {
      appointment: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason?: string;
    };
    RegisterImportPreviewRow: {
      enteredOn: string | null;
      imported: string | null;
      importedEnteredOn: string | null;
      liveAddress: string | null;
      liveName: string | null;
      member: string;
      name: string | null;
      stored: string | null;
      wallets: string[];
    };
    RegisterInstruction: {
      approvingDirector: string;
      authorityReference: string;
      company: string;
      createdAt: string;
      evidenceFingerprint: string;
      evidenceSnapshot: unknown;
      items: unknown;
      kind: ApiComponents['schemas']['RegisterInstructionKindEnum'];
      reason: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      sourceDocument: string;
      status: ApiComponents['schemas']['RegisterCorrectionStatusEnum'];
      submittedBy: number;
      token: string;
      uuid: string;
    };
    RegisterInstructionCreateRequest: {
      approvingDirector: string;
      authorityReference: string;
      documentId: string;
      items: {
        [key: string]: string;
      }[];
      kind: ApiComponents['schemas']['RegisterInstructionKindEnum'];
      operationId: string;
      reason: string;
      tokenId: string;
    };
    RegisterInstructionKindEnum: 'issue' | 'transfer';
    RegisterOpening: {
      appliedEntry: string | null;
      approvingDirector: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityEvidence: string | null;
      authorityReference: string;
      boundary: unknown;
      boundarySummary: ApiComponents['schemas']['RegisterOpeningBoundary'] | null;
      company: string;
      createdAt: string;
      decisions: ApiComponents['schemas']['RegisterOpeningDecision'][];
      evidenceFingerprint: string;
      evidenceSnapshot: unknown;
      mapping: unknown;
      preparedByName: string | null;
      preparingAppointment: string | null;
      providedBy: string;
      reason: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      sourceDocument: string | null;
      stage: string;
      status: ApiComponents['schemas']['RegisterCorrectionStatusEnum'];
      submittedBy: number;
      token: string;
      uuid: string;
    };
    RegisterOpeningBlock: {
      date: string;
      hash: string;
      number: number;
    };
    RegisterOpeningBoundary: {
      blockHash: string;
      blockNumber: number;
      date: string;
      holdings: ApiComponents['schemas']['RegisterOpeningHolding'][];
    };
    RegisterOpeningChange: {
      member: string;
      shares: string;
    };
    RegisterOpeningCreateRequest: {
      appointment: string;
      approvingDirector?: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityEvidence: string;
      authorityReference: string;
      mapping: {
        [key: string]: string;
      }[];
      operationId: string;
      reason: string;
      tokenId: string;
    };
    RegisterOpeningDecideRequest: {
      appointment: string;
      confirmation: boolean;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      previewDigest: string;
      reason?: string;
    };
    RegisterOpeningDecision: {
      appointment: string;
      decidedAt: string;
      decidedBy: number;
      decidedByName: string;
      digest: string;
      idempotencyKey: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason: string;
      uuid: string;
    };
    RegisterOpeningDecisionPreview: {
      canDecide: boolean;
      changes: ApiComponents['schemas']['RegisterOpeningChange'][];
      effectiveOn: string | null;
      previewDigest: string;
      unmetRequirements: string[];
    };
    RegisterOpeningDecisionRequestRequest: {
      appointment: string;
      kind: ApiComponents['schemas']['RegisterDecisionKindEnum'];
      reason?: string;
    };
    RegisterOpeningHolder: {
      address: string;
      member: string | null;
      memberName: string | null;
      shares: string;
    };
    RegisterOpeningHolders: {
      block: ApiComponents['schemas']['RegisterOpeningBlock'];
      holdings: ApiComponents['schemas']['RegisterOpeningHolder'][];
    };
    RegisterOpeningHolding: {
      address: string;
      member: string | null;
      shares: string;
    };
    RegisterReconciliation: {
      blockHash: string;
      blockNumber: number | null;
      createdAt: string;
      discrepancies: ApiComponents['schemas']['RegisterDiscrepancy'][];
      failure: string;
      latest: boolean;
      registerSequence: number | null;
      status: ApiComponents['schemas']['RegisterReconciliationStatusEnum'];
      token: string;
      uuid: string;
    };
    RegisterReconciliationStatusEnum: 'matched' | 'discrepant' | 'failed';
    RegisterWalletLink: {
      approvingDirector: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityReference: string;
      company: string;
      createdAt: string;
      evidenceFingerprint: string;
      evidenceSnapshot: unknown;
      mapping: unknown;
      reason: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      sourceDocument: string;
      status: ApiComponents['schemas']['RegisterCorrectionStatusEnum'];
      submittedBy: number;
      uuid: string;
    };
    RegisterWalletLinkCreateRequest: {
      approvingDirector?: string;
      authority: ApiComponents['schemas']['RegisterCorrectionAuthorityEnum'];
      authorityReference: string;
      companyId: string;
      documentId: string;
      mapping: {
        [key: string]: string;
      }[];
      operationId: string;
      reason: string;
    };
    ResendVerificationRequest: {
      email?: string;
    };
    ResolutionKindEnum: 'ordinary' | 'special';
    ReviewResultEnum: 'GREEN' | 'RED' | 'YELLOW';
    RoleEnum: 'investor' | 'company' | 'both';
    SettlementApprovalBroadcastRequest: {
      ownerAccountUuid: string;
      settlementDigest: string;
      signedTransaction: string;
      swapUuid: string;
      walletUuid: string;
    };
    SettlementApprovalOutcome: {
      outcome: ApiComponents['schemas']['OutcomeEnum'];
      txHash: string;
    };
    SettlementApprovalReceipt: {
      blockNumber: number | null;
      gasUsed: number | null;
      orderUuid: string;
      ownerAccountUuid: string;
      settlementDigest: string;
      swapUuid: string;
      txHash: string;
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementApprovalStatus: {
      currentAllowance: string;
      needsApproval: boolean;
      orderUuid: string;
      ownerAccountUuid: string;
      requiredAmount: string;
      settlementDigest: string;
      spender: string;
      swapUuid: string;
      tokenAddress: string;
      tokenSymbol: string;
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementApprovalTransaction: {
      amount: string;
      description: string;
      needsApproval: ApiComponents['schemas']['ApprovalRequiredEnum'];
      orderUuid: string;
      ownerAccountUuid: string;
      settlementDigest: string;
      spender: string;
      swapUuid: string;
      tokenAddress: string;
      tokenSymbol: string;
      transaction: ApiComponents['schemas']['ApprovalTransaction'];
      unlimited: ApiComponents['schemas']['ApprovalRequiredEnum'];
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementApprovalUncertain: {
      code: ApiComponents['schemas']['SettlementApprovalUncertainCodeEnum'];
      detail: string;
      orderUuid: string;
      ownerAccountUuid: string;
      settlementDigest: string;
      swapUuid: string;
      txHash: string;
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementApprovalUncertainCodeEnum: 'swap_approval_unconfirmed';
    SettlementAsset: {
      chainDeployments: ApiComponents['schemas']['AssetChainDeployment'][];
      name: string;
      symbol: string;
      uuid: string;
    };
    SettlementContext: {
      buyer: ApiComponents['schemas']['SettlementParty'];
      digest: string;
      orderHash: string;
      paymentAsset: ApiComponents['schemas']['SettlementPaymentAsset'];
      pricePerShare: string;
      protocolVersion: ApiComponents['schemas']['ProtocolVersionEnum'];
      seller: ApiComponents['schemas']['SettlementParty'];
      shareToken: ApiComponents['schemas']['SettlementShareToken'];
      swapUuid: string;
      typedData: ApiComponents['schemas']['SettlementTypedData'];
    };
    SettlementDomain: {
      chainId: string;
      name: ApiComponents['schemas']['NameEnum'];
      verifyingContract: string;
      version: ApiComponents['schemas']['VersionEnum'];
    };
    SettlementParty: {
      address: string;
      orderUuid: string;
      ownerAccountUuid: string;
      paymentAssetUuid: string | null;
      walletUuid: string;
    };
    SettlementPaymentAsset: {
      deploymentAddress: string;
      deploymentChain: string;
      deploymentDecimals: number;
      deploymentUuid: string;
      name: string;
      pricingDecimals: number;
      symbol: string;
      uuid: string;
    };
    SettlementRailEnum: 'bank_transfer' | 'stablecoin';
    SettlementShareToken: {
      address: string;
      chain: string;
      decimals: number;
      name: string;
      symbol: string;
      uuid: string;
    };
    SettlementSignatureRequest: {
      ownerAccountUuid: string;
      settlementDigest: string;
      signature: string;
      signerAddress: string;
      swapUuid: string;
      walletUuid: string;
    };
    SettlementSufficientApproval: {
      currentAllowance: string;
      message: string;
      needsApproval: ApiComponents['schemas']['ApprovalSufficientEnum'];
      orderUuid: string;
      ownerAccountUuid: string;
      requiredAmount: string;
      settlementDigest: string;
      swapUuid: string;
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementSwapOrder: {
      buyerAddress: string;
      buyerHasSigned: boolean;
      buyOrderUuid: string;
      completedAt: string | null;
      createdAt: string;
      errorMessage: string;
      expiresAt: string;
      isExpired: boolean;
      isReady: boolean;
      nonce: number;
      orderHash: string;
      paymentAmount: number;
      paymentTokenAddress: string;
      paymentTokenSymbol: string;
      sellerAddress: string;
      sellerHasSigned: boolean;
      sellOrderUuid: string;
      settlementContext: ApiComponents['schemas']['SettlementContext'];
      settlementDigest: string;
      settlementProtocolVersion: ApiComponents['schemas']['ProtocolVersionEnum'];
      shareAmount: number;
      shareTokenAddress: string;
      shareTokenName: string;
      shareTokenSymbol: string;
      status: ApiComponents['schemas']['SwapOrderStatusEnum'];
      statusDisplay: string;
      txHash: string;
      updatedAt: string;
      uuid: string;
    };
    SettlementSwapOrderForSigning: {
      admissionRefusal: string | null;
      approvalOutcome?: ApiComponents['schemas']['SettlementApprovalOutcome'] | null;
      canSign: boolean;
      hasSigned: boolean;
      orderUuid: string;
      ownerAccountUuid: string;
      settlementDigest: string;
      swapOrder: ApiComponents['schemas']['SettlementSwapOrder'];
      swapUuid: string;
      typedData: ApiComponents['schemas']['SettlementTypedData'];
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    SettlementTypedData: {
      domain: ApiComponents['schemas']['SettlementDomain'];
      message: ApiComponents['schemas']['SwapMessage'];
      primaryType: ApiComponents['schemas']['PrimaryTypeEnum'];
      types: ApiComponents['schemas']['SwapSigningTypes'];
    };
    ShareIssuanceCreateRequest: {
      amount: number;
      issuanceType?: ApiComponents['schemas']['IssuanceTypeEnum'];
      reason?: string;
      recipient: string;
    };
    ShareIssuanceList: {
      amount: string;
      blockNumber: number | null;
      completedAt: string | null;
      createdAt: string;
      initiatedBy: number | null;
      initiatedByEmail: string | null;
      issuanceType: ApiComponents['schemas']['IssuanceTypeEnum'];
      issuanceTypeDisplay: string;
      processedAt: string | null;
      reason: string;
      recipientAddress: string;
      recipientName: string;
      status: ApiComponents['schemas']['ShareIssuanceListStatusEnum'];
      statusDisplay: string;
      subscriptionReference: string | null;
      token: string;
      tokenSymbol: string;
      txHash: string | null;
      uuid: string;
    };
    ShareIssuanceListStatusEnum: 'pending' | 'processing' | 'completed' | 'failed';
    ShareIssuanceRequest: {
      amount: number;
      createdAt: string;
      dilutionPercentage: string | null;
      executedAt: string | null;
      executedIssuance: string | null;
      executionNotes: string;
      issuanceType: ApiComponents['schemas']['IssuanceTypeEnum'];
      issuanceTypeDisplay: string;
      reason: string;
      recipientAddress: string;
      recipientName: string;
      rejectionReason: string;
      reviewedAt: string | null;
      reviewedBy: number | null;
      reviewedByEmail: string | null;
      status: ApiComponents['schemas']['CapitalRequestStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      submittedBy: number | null;
      submittedByEmail: string | null;
      token: string;
      tokenName: string;
      tokenSymbol: string;
      updatedAt: string;
      uuid: string;
    };
    ShareIssuanceRequested: {
      issuanceRequest: ApiComponents['schemas']['ShareIssuanceRequest'];
      message: string;
      token: ApiComponents['schemas']['ShareTokenDetail'];
    };
    ShareRegister: {
      formerMembers: ApiComponents['schemas']['FormerMember'][];
      formerMembersAsAt: string | null;
      formerMembersBlock: number | null;
      formerMembersStale: boolean;
      holders: ApiComponents['schemas']['ShareRegisterHolder'][];
      initialized: boolean;
      issuedSupply: string | null;
      token: ApiComponents['schemas']['ShareRegisterToken'];
      totalHolders: number;
      waitingEffects: number | null;
    };
    ShareRegisterEntry: {
      changes: ApiComponents['schemas']['ShareRegisterEntryChange'][];
      correctable: boolean;
      correctedBy: string | null;
      corrects: string | null;
      effectiveOn: string;
      kind: ApiComponents['schemas']['ShareRegisterEntryKindEnum'];
      recordedAt: string;
      sequence: number;
      uuid: string;
    };
    ShareRegisterEntryChange: {
      member: string;
      name: string | null;
      shares: string;
    };
    ShareRegisterEntryKindEnum: 'opening' | 'issue' | 'transfer' | 'cessation' | 'correction';
    ShareRegisterHolder: {
      balance: string;
      enteredOn: string;
      holderType: ApiComponents['schemas']['HolderTypeEnum'];
      identitySource: string;
      member: string;
      name: string | null;
      percentage: number;
      shareClass: string;
      source: string;
      wallets: ApiComponents['schemas']['ShareRegisterWallet'][];
    };
    ShareRegisterToken: {
      name: string;
      status: string;
      symbol: string;
      totalSupply: string;
      uuid: string;
    };
    ShareRegisterWaiting: {
      effects: ApiComponents['schemas']['ShareRegisterWaitingEffect'][] | null;
    };
    ShareRegisterWaitingEffect: {
      block: number;
      kind: ApiComponents['schemas']['ShareRegisterWaitingEffectKindEnum'];
      reason: ApiComponents['schemas']['ShareRegisterWaitingReasonEnum'];
      shares: string;
      source: string;
      unlinkedWallets: string[];
      wallets: string[];
    };
    ShareRegisterWaitingEffectKindEnum: 'issue' | 'transfer';
    ShareRegisterWaitingReasonEnum: 'attribution' | 'unlinked' | 'unreviewed' | 'uninstructed' | 'refused' | 'behind';
    ShareRegisterWallet: {
      address: string;
      whitelistStatus: string;
    };
    ShareTokenCreateRequest: {
      company?: string;
      decimals?: number;
      isDivisible?: boolean;
      isTransferable?: boolean;
      name: string;
      symbol: string;
      tokenType?: ApiComponents['schemas']['TokenTypeEnum'];
      totalSupply: string;
    };
    ShareTokenDetail: {
      chain: string | null;
      company: string;
      companyName: string;
      companyUuid: string;
      contractAddress: string | null;
      createdAt: string;
      decimals: number;
      deployedAt: string | null;
      deploymentTxHash: string | null;
      isDivisible: boolean;
      isTransferable: boolean;
      name: string;
      status: ApiComponents['schemas']['ShareTokenStatusEnum'];
      statusDisplay: string;
      symbol: string;
      tokenType: ApiComponents['schemas']['TokenTypeEnum'];
      tokenTypeDisplay: string;
      totalSupply: string;
      updatedAt: string;
      uuid: string;
    };
    ShareTokenList: {
      bestAsk: string | null;
      bestBid: string | null;
      chain: string | null;
      company: string;
      companyName: string;
      companyUuid: string;
      contractAddress: string | null;
      createdAt: string;
      decimals: number;
      deployedAt: string | null;
      isDivisible: boolean;
      isTransferable: boolean;
      lastPrice: string | null;
      name: string;
      status: ApiComponents['schemas']['ShareTokenStatusEnum'];
      statusDisplay: string;
      symbol: string;
      tokenType: ApiComponents['schemas']['TokenTypeEnum'];
      tokenTypeDisplay: string;
      totalSupply: string;
      uuid: string;
    };
    ShareTokenStatusEnum: 'draft' | 'deploying' | 'deployed' | 'paused';
    SignedOrderSubmissionRequest: {
      digest?: string;
      minQuantity?: number | string;
      orderType: ApiComponents['schemas']['TransferOrderTypeEnum'];
      ownerAccountUuid: string;
      pricePerShare: string;
      quantity: number | string;
      signature?: string;
      submissionId: string;
      token: string;
      walletAddress: string;
      walletUuid: string;
    };
    SigningDomain: {
      chainId: number;
      name: string;
      verifyingContract: string;
      version: string;
    };
    SigningMessage: {
      [key: string]: string;
    };
    SigningType: {
      name: string;
      type: string;
    };
    SigningTypes: {
      [key: string]: {
        name: string;
        type: string;
      }[];
    };
    SubmissionOrder: {
      canBeModified: boolean;
      completedAt: string | null;
      createdAt: string;
      errorMessage: string;
      filledQuantity: number;
      lastModifiedAt: string | null;
      matchedOrderUuid: string | null;
      minQuantity: number;
      modificationCount: number;
      orderType: ApiComponents['schemas']['TransferOrderTypeEnum'];
      orderTypeDisplay: string;
      pricePerShare: string;
      quantity: number;
      remainingQuantity: number;
      remainingValue: string;
      status: ApiComponents['schemas']['TransferOrderStatusEnum'];
      statusDisplay: string;
      token: string;
      tokenContractAddress: string;
      tokenName: string;
      tokenSymbol: string;
      totalValue: string;
      txHash: string;
      updatedAt: string;
      uuid: string;
      walletAddress: string;
    };
    SubscriptionCreateRequest: {
      offering: string;
      quantity: number;
      wallet: string;
    };
    SubscriptionDetail: {
      acceptedAt: string | null;
      allottedAt: string | null;
      allottedQuantity: number | null;
      amountDue: string;
      amountOutstanding: string;
      amountReceived: string | null;
      closedAt: string | null;
      companyName: string;
      createdAt: string;
      currency: string;
      offeringUuid: string;
      paymentDueAt: string | null;
      paymentInstruction: ApiComponents['schemas']['PaymentInstruction'] | null;
      paymentInstructionIssuedAt: string | null;
      paymentNotes: string;
      paymentReceivedOn: string | null;
      paymentReferenceSeen: string;
      paymentTxHash: string;
      pricePerShare: string;
      quantity: number;
      reference: string;
      refundAmount: string | null;
      refundedAt: string | null;
      refundReference: string;
      settlementAmount: number | null;
      settlementAssetSymbol: string | null;
      settlementRail: ApiComponents['schemas']['SettlementRailEnum'];
      settlementRailDisplay: string;
      status: ApiComponents['schemas']['SubscriptionStatusEnum'];
      statusDisplay: string;
      submittedAt: string | null;
      tokenName: string;
      tokenSymbol: string;
      updatedAt: string;
      uuid: string;
      walletAddress: string;
    };
    SubscriptionList: {
      allottedQuantity: number | null;
      amountDue: string;
      amountReceived: string | null;
      companyName: string;
      createdAt: string;
      currency: string;
      offeringUuid: string;
      paymentDueAt: string | null;
      pricePerShare: string;
      quantity: number;
      reference: string;
      settlementRail: ApiComponents['schemas']['SettlementRailEnum'];
      settlementRailDisplay: string;
      status: ApiComponents['schemas']['SubscriptionStatusEnum'];
      statusDisplay: string;
      tokenName: string;
      tokenSymbol: string;
      uuid: string;
      walletAddress: string;
    };
    SubscriptionStatusEnum:
      | 'draft'
      | 'submitted'
      | 'accepted'
      | 'awaiting_payment'
      | 'paid'
      | 'allotted'
      | 'rejected'
      | 'withdrawn'
      | 'refunded';
    SubscriptionWithdrawRequest: {
      reason?: string;
    };
    SupportedWalletChainEnum: 'base' | 'bitcoin' | 'ethereum';
    SwapMessage: {
      buyer: string;
      deadline: string;
      nonce: string;
      paymentAmount: string;
      paymentToken: string;
      seller: string;
      shareAmount: string;
      shareToken: string;
    };
    SwapOrderList: {
      buyerAddress: string;
      buyerHasSigned: boolean;
      buyOrderUuid: string;
      createdAt: string;
      expiresAt: string;
      paymentAmount: number;
      paymentTokenSymbol: string;
      sellerAddress: string;
      sellerHasSigned: boolean;
      sellOrderUuid: string;
      settlementProtocolVersion: number;
      shareAmount: number;
      shareTokenName: string | null;
      shareTokenSymbol: string | null;
      status: ApiComponents['schemas']['SwapOrderStatusEnum'];
      statusDisplay: string;
      uuid: string;
      viewerParties: ApiComponents['schemas']['SwapViewerParty'][];
    };
    SwapOrderStatusEnum:
      'created' | 'seller_signed' | 'buyer_signed' | 'ready' | 'executing' | 'completed' | 'failed' | 'expired';
    SwapSigningTypes: {
      EIP712Domain: ApiComponents['schemas']['SigningType'][];
      SwapOrder: ApiComponents['schemas']['SigningType'][];
    };
    SwapViewerParty: {
      ownerAccountUuid: string;
      userRole: ApiComponents['schemas']['UserRoleEnum'];
      walletUuid: string;
    };
    TokenDeploymentStarted: {
      message: string;
      token: ApiComponents['schemas']['ShareTokenDetail'];
    };
    TokenTypeEnum: 'ordinary' | 'preference' | 'redeemable';
    ToStatusEnum: 'cancelled';
    TradingWalletBalances: {
      balances: ApiComponents['schemas']['TradingWalletTokenBalance'][];
      walletAddress: string;
    };
    TradingWalletTokenBalance: {
      balance: string;
      contractAddress: string;
      decimals: number;
      name: string;
      symbol: string;
      token: string;
      type: ApiComponents['schemas']['TypeEnum'];
    };
    Transaction: {
      amount: string;
      asset: string;
      assetName: string;
      assetSymbol: string;
      blockNumber: number | null;
      blockTimestamp: string | null;
      chain: ApiComponents['schemas']['TransactionChainEnum'];
      createdAt: string;
      fromAddress: string;
      marketValue: string | null;
      shareClass: ApiComponents['schemas']['AssetShareClass'] | null;
      status: ApiComponents['schemas']['TransactionStatusEnum'];
      toAddress: string | null;
      transactionFee: string | null;
      transactionFeeEstimated: string | null;
      txHash: string;
      uuid: string;
      wallet: string;
      walletAddress: string;
    };
    TransactionChainEnum:
      'ethereum' | 'bitcoin' | 'polygon' | 'solana' | 'avalanche' | 'arbitrum' | 'optimism' | 'base';
    TransactionStatusEnum: 'pending' | 'confirmed' | 'failed' | 'reorged' | 'replaced';
    TransferOrderCreateRequest: {
      minQuantity?: number | string;
      orderType: ApiComponents['schemas']['TransferOrderTypeEnum'];
      ownerAccountUuid: string;
      pricePerShare: string;
      quantity: number | string;
      submissionId: string;
      token: string;
      walletAddress: string;
      walletUuid: string;
    };
    TransferOrderList: {
      createdAt: string;
      filledQuantity: number;
      minQuantity: number;
      orderType: ApiComponents['schemas']['TransferOrderTypeEnum'];
      orderTypeDisplay: string;
      pricePerShare: string;
      quantity: number;
      remainingQuantity: number;
      status: ApiComponents['schemas']['TransferOrderStatusEnum'];
      statusDisplay: string;
      token: string;
      tokenName: string | null;
      tokenSymbol: string | null;
      totalValue: string;
      uuid: string;
      walletAddress: string;
    };
    TransferOrderStatusEnum:
      'open' | 'partially_filled' | 'held' | 'matched' | 'pending_signature' | 'completed' | 'cancelled';
    TransferOrderTypeEnum: 'buy' | 'sell';
    TypeEnum: 'share_token' | 'stablecoin';
    UnreadCountResponse: {
      unreadCount: number;
    };
    UnregisterDeviceTokenRequest: {
      pushToken: string;
    };
    UserAccount: {
      accountNumber: string;
      accountType?: ApiComponents['schemas']['AccountTypeEnum'];
      activationDate: string | null;
      role?: ApiComponents['schemas']['RoleEnum'];
      uuid: string;
    };
    UserDocumentTypeEnum: 'payslip' | 'bank_statement' | 'tax_return' | 'other';
    UserPreferences: {
      transactionAlerts?: boolean;
      userAccount: ApiComponents['schemas']['AccountSummary'] | null;
      userProfile: string;
      uuid: string;
    };
    UserPreferencesRequest: {
      transactionAlerts?: boolean;
    };
    UserProfile: {
      citizenshipCountry: string | null;
      citizenshipCountryName: string | null;
      confirmedAustralianResident?: boolean;
      confirmedIndividualAccount?: boolean;
      confirmedOver18?: boolean;
      dateJoined: string;
      dateOfBirth?: string | null;
      email: string;
      fullName?: string | null;
      isActive: boolean;
      isIdVerified: boolean;
      isSignupCompleted?: boolean;
      isStaff: boolean;
      kycaidApplicantId: string | null;
      kycProvider: ApiComponents['schemas']['KycProviderEnum'];
      lastLogin: string | null;
      phoneCountryCode?: string | null;
      phoneNumber?: string | null;
      rejectionLabels: string[] | null;
      residenceCountry?: string | null;
      residenceCountryName: string | null;
      residentialAddress?: string | null;
      reviewResult: (ApiComponents['schemas']['ReviewResultEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      sumsubApplicantId: string | null;
      sumsubVerificationStatus:
        (ApiComponents['schemas']['UserVerificationStatusEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      termsAndConditions?: boolean;
      uuid: string;
      verificationStatus:
        (ApiComponents['schemas']['UserVerificationStatusEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      verifiedAt: string | null;
    };
    UserProfileRequest: {
      citizenshipCountry: string;
      confirmedAustralianResident?: boolean;
      confirmedIndividualAccount?: boolean;
      confirmedOver18?: boolean;
      dateOfBirth?: string | null;
      fullName?: string | null;
      isSignupCompleted?: boolean;
      phoneCountryCode?: string | null;
      phoneNumber?: string | null;
      residenceCountry?: string;
      residentialAddress?: string | null;
      termsAndConditions?: boolean;
    };
    UserRoleEnum: 'buyer' | 'seller';
    UserSigninRequest: {
      email: string;
      password: string;
    };
    UserSignupRequest: {
      email: string;
      password: string;
      passwordConfirm: string;
    };
    UserVerificationStatusEnum: 'init' | 'pending' | 'queued' | 'completed' | 'onHold' | 'prechecked';
    ValueSourceEnum: 'market' | 'nav' | 'par' | 'unpriced';
    VersionEnum: '1';
    Wallet: {
      address: string;
      addressIndex?: number | null;
      chain: ApiComponents['schemas']['SupportedWalletChainEnum'];
      createdAt: string;
      derivationPath?: string | null;
      lastSyncedAt: string | null;
      marketValue: string;
      masterFingerprint?: string | null;
      name?: string | null;
      nativeBalance: string;
      nativeMarketValue: string;
      parentChainCode?: string | null;
      parentDerivationPath?: string | null;
      parentPublicKey?: string | null;
      signingPreference?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      updatedAt: string;
      userAccount: string;
      uuid: string;
      verificationChallenge: string | null;
      verificationSignature: string | null;
      verificationStatus: ApiComponents['schemas']['WalletVerificationStatusEnum'];
      verifiedAt: string | null;
      walletType?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
    };
    WalletRequest: {
      address: string;
      addressIndex?: number | null;
      chain: ApiComponents['schemas']['SupportedWalletChainEnum'];
      derivationPath?: string | null;
      masterFingerprint?: string | null;
      name?: string | null;
      parentChainCode?: string | null;
      parentDerivationPath?: string | null;
      parentPublicKey?: string | null;
      signingPreference?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
      walletType?:
        (ApiComponents['schemas']['WalletSigningPreferenceEnum'] | ApiComponents['schemas']['NullEnum']) | null;
    };
    WalletSigningPreferenceEnum: 'hardware' | 'software';
    WalletSyncResponse: {
      success: boolean;
      syncResult: ApiComponents['schemas']['WalletSyncResult'];
      wallet: ApiComponents['schemas']['Wallet'];
    };
    WalletSyncResult: {
      error?: string;
      holdings?: number;
      status: ApiComponents['schemas']['WalletSyncResultStatusEnum'];
      transactions?: number;
    };
    WalletSyncResultStatusEnum: 'success' | 'skipped' | 'error';
    WalletVerificationChallenge: {
      challenge: string;
      message: string;
      walletAddress: string;
    };
    WalletVerificationResult: {
      message: string;
      success: boolean;
      verificationStatus: ApiComponents['schemas']['WalletVerificationResultVerificationStatusEnum'];
      verifiedAt: string;
    };
    WalletVerificationResultVerificationStatusEnum: 'PENDING' | 'VERIFIED';
    WalletVerificationSignatureRequest: {
      signature: string;
    };
    WalletVerificationStatusEnum: 'PENDING' | 'VERIFIED';
    WhitelistAddRequest: {
      company: string;
      expiresAt?: string | null;
      submissionId: string;
      walletAddress: string;
    };
    WhitelistApproval: {
      company: string;
      companyName: string;
      expiresAt: string | null;
      lastSyncedAt: string | null;
      registryAddress: string;
      status: ApiComponents['schemas']['WhitelistApprovalStatusEnum'];
      statusDisplay: string;
      uuid: string;
    };
    WhitelistApprovalStatusEnum: 'pending' | 'active' | 'removed' | 'failed';
    WhitelistBatchAddRequest: {
      entries: ApiComponents['schemas']['WhitelistAddRequest'][];
    };
    WhitelistBatchError: {
      error: string;
      walletAddress: string;
    };
    WhitelistBatchResponse: {
      errors: ApiComponents['schemas']['WhitelistBatchError'][];
      failed: number;
      pending: number;
      results: ApiComponents['schemas']['WhitelistChange'][];
      successful: number;
    };
    WhitelistChange: {
      action: ApiComponents['schemas']['ActionEnum'];
      approval: ApiComponents['schemas']['WhitelistApproval'] | null;
      company: string;
      expiresAt: string | null;
      message: string;
      status?: ApiComponents['schemas']['WhitelistChangeStatusEnum'];
      submissionId: string;
      success: boolean;
      txHash?: string | null;
      walletAddress: string;
    };
    WhitelistChangeStatusEnum: 'pending' | 'executing' | 'confirmed' | 'unchanged' | 'failed';
    WhitelistEntry: {
      approvals: ApiComponents['schemas']['WhitelistApproval'][];
      createdAt: string;
      label: string;
      updatedAt: string;
      uuid: string;
      walletAddress: string;
    };
    WhitelistRemoveRequest: {
      company: string;
      submissionId: string;
      walletAddress: string;
    };
    WhitelistStatus: {
      address: string;
      isWhitelisted: boolean;
      status: ApiComponents['schemas']['WhitelistStatusStatusEnum'];
    };
    WhitelistStatusStatusEnum: 'whitelisted' | 'not_whitelisted' | 'unknown';
    WhitelistSyncResponse: {
      entry: ApiComponents['schemas']['WhitelistEntry'];
      message: string;
      success: boolean;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type ApiDefs = Record<string, never>;
export interface ApiOperations {
  api_assets_list: {
    parameters: {
      query?: {
        asset_type?: string;
        chain?: string;
        is_active?: boolean;
        ordering?: string;
        page?: number;
        search?: string;
        symbol?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedAssetList'];
        };
      };
    };
  };
  api_assets_exchange_rates_retrieve: {
    parameters: {
      query?: {
        currency?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ExchangeRateResponse'];
        };
      };
    };
  };
  api_auth_verify_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthSessionValidity'];
        };
      };
    };
  };
  api_change_password_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['ChangePasswordRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['ChangePasswordRequest'];
        'multipart/form-data': ApiComponents['schemas']['ChangePasswordRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthPasswordChanged'];
        };
      };
    };
  };
  api_device_tokens_register_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterDeviceTokenRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterDeviceTokenRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterDeviceTokenRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DeviceToken'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DeviceToken'];
        };
      };
    };
  };
  api_device_tokens_unregister_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['UnregisterDeviceTokenRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['UnregisterDeviceTokenRequest'];
        'multipart/form-data': ApiComponents['schemas']['UnregisterDeviceTokenRequest'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DeviceTokenNotFound'];
        };
      };
    };
  };
  api_email_verification_create: {
    parameters: {
      query?: never;
      header?: {
        'X-Auth-Transport'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['EmailVerificationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['EmailVerificationRequest'];
        'multipart/form-data': ApiComponents['schemas']['EmailVerificationRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthEmailVerified'];
        };
      };
    };
  };
  api_feature_flags_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedFeatureFlagList'];
        };
      };
    };
  };
  api_fiat_purchases_transak_widget_url_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['FiatPurchaseWidgetRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['FiatPurchaseWidgetRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['FiatPurchaseWidgetRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['FiatPurchaseWidget'];
        };
      };
    };
  };
  api_financial_profiles_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedFinancialProfileList'];
        };
      };
    };
  };
  api_financial_profiles_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['FinancialProfileRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['FinancialProfileRequest'];
        'multipart/form-data': ApiComponents['schemas']['FinancialProfileRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['FinancialProfile'];
        };
      };
    };
  };
  api_financial_profiles_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedFinancialProfileRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedFinancialProfileRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedFinancialProfileRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['FinancialProfile'];
        };
      };
    };
  };
  api_investor_classifications_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedInvestorClassificationList'];
        };
      };
    };
  };
  api_investor_classifications_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['InvestorClassificationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['InvestorClassificationRequest'];
        'multipart/form-data': ApiComponents['schemas']['InvestorClassificationRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['InvestorClassification'];
        };
      };
    };
  };
  api_investor_classifications_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_investor_classifications_eligibility_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['InvestorEligibility'];
        };
      };
    };
  };
  api_notifications_list: {
    parameters: {
      query?: {
        is_archived?: boolean;
        is_read?: boolean;
        notification_type?: string;
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedNotificationList'];
        };
      };
    };
  };
  api_notifications_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedNotificationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedNotificationRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedNotificationRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Notification'];
        };
      };
    };
  };
  api_notifications_mark_all_read_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['NotificationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['NotificationRequest'];
        'multipart/form-data': ApiComponents['schemas']['NotificationRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['MarkAllReadResponse'];
        };
      };
    };
  };
  api_notifications_unread_count_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UnreadCountResponse'];
        };
      };
    };
  };
  api_operator_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Operator'];
        };
      };
    };
  };
  api_portfolios_list: {
    parameters: {
      query?: {
        is_active?: boolean;
        ordering?: string;
        page?: number;
        user_account?: string;
        user_profile?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedPortfolioList'];
        };
      };
    };
  };
  api_portfolios_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PortfolioRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PortfolioRequest'];
        'multipart/form-data': ApiComponents['schemas']['PortfolioRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Portfolio'];
        };
      };
    };
  };
  api_portfolios_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Portfolio'];
        };
      };
    };
  };
  api_portfolios_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PortfolioRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PortfolioRequest'];
        'multipart/form-data': ApiComponents['schemas']['PortfolioRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Portfolio'];
        };
      };
    };
  };
  api_portfolios_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_portfolios_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedPortfolioRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedPortfolioRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedPortfolioRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Portfolio'];
        };
      };
    };
  };
  api_portfolios_add_wallet_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PortfolioRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PortfolioRequest'];
        'multipart/form-data': ApiComponents['schemas']['PortfolioRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PortfolioWalletResponse'];
        };
      };
    };
  };
  api_portfolios_remove_wallet_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PortfolioRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PortfolioRequest'];
        'multipart/form-data': ApiComponents['schemas']['PortfolioRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PortfolioWalletResponse'];
        };
      };
    };
  };
  api_resend_verification_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['ResendVerificationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['ResendVerificationRequest'];
        'multipart/form-data': ApiComponents['schemas']['ResendVerificationRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthVerificationResent'];
        };
      };
    };
  };
  api_signin_create: {
    parameters: {
      query?: never;
      header?: {
        'X-Auth-Transport'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['UserSigninRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['UserSigninRequest'];
        'multipart/form-data': ApiComponents['schemas']['UserSigninRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthSession'];
        };
      };
    };
  };
  api_signout_all_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthSignedOutEverywhere'];
        };
      };
    };
  };
  api_signout_create: {
    parameters: {
      query?: never;
      header?: {
        'X-Auth-Transport'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['AuthSignoutRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['AuthSignoutRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['AuthSignoutRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthSignedOut'];
        };
      };
    };
  };
  api_signup_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['UserSignupRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['UserSignupRequest'];
        'multipart/form-data': ApiComponents['schemas']['UserSignupRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthIdentity'];
        };
      };
    };
  };
  api_token_refresh_create: {
    parameters: {
      query?: never;
      header?: {
        'X-Auth-Transport'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['AuthRefreshRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['AuthRefreshRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['AuthRefreshRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthRefreshResponse'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthRefreshError'];
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AuthRefreshError'];
        };
      };
    };
  };
  api_transactions_list: {
    parameters: {
      query?: {
        address?: string;
        asset?: string;
        chain?: string;
        direction?: string;
        end_date?: string;
        ordering?: string;
        page?: number;
        start_date?: string;
        wallet?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedTransactionList'];
        };
      };
    };
  };
  api_user_accounts_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UserAccount'];
        };
      };
    };
  };
  api_user_accounts_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedUserAccountRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedUserAccountRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedUserAccountRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UserAccount'];
        };
      };
    };
  };
  api_user_preferences_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UserPreferences'];
        };
      };
    };
  };
  api_user_preferences_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['UserPreferencesRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['UserPreferencesRequest'];
        'multipart/form-data': ApiComponents['schemas']['UserPreferencesRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UserPreferences'];
        };
      };
    };
  };
  api_user_profiles_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedUserProfileList'];
        };
      };
    };
  };
  api_user_profiles_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedUserProfileRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedUserProfileRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedUserProfileRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['UserProfile'];
        };
      };
    };
  };
  api_user_profiles_delete_account_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['UserProfileRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['UserProfileRequest'];
        'multipart/form-data': ApiComponents['schemas']['UserProfileRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DeletedAccountResponse'];
        };
      };
    };
  };
  api_user_profiles_export_data_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['AccountExportData'];
        };
      };
    };
  };
  api_users_identity_verification_status_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['IdentityVerificationStatus'];
        };
      };
    };
  };
  api_users_identity_verification_token_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['IdentityVerificationSession'];
        };
      };
    };
  };
  api_v1_companies_list: {
    parameters: {
      query?: {
        acn?: string;
        active_only?: boolean;
        company_type?: string;
        ordering?: string;
        page?: number;
        search?: string;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCompanyListList'];
        };
      };
    };
  };
  api_v1_companies_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyRegistrationRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyRegistrationRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyRegistrationRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyRegistered'];
        };
      };
    };
  };
  api_v1_companies_documents_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyDocumentRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyDocumentRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyDocumentRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyDocument'];
        };
      };
    };
  };
  api_v1_companies_documents_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_v1_companies_documents_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_companies_eligibility_requests_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path: {
        company_uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCompanyEligibilityRequestList'];
        };
      };
    };
  };
  api_v1_companies_eligibility_requests_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_companies_eligibility_requests_decide_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityDecisionCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityDecisionCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityDecisionCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_companies_eligibility_requests_decision_preview_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityDecisionPreviewRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityDecisionPreviewRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityDecisionPreviewRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityDecisionPreviewResult'];
        };
      };
    };
  };
  api_v1_companies_eligibility_requests_revoke_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        company_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityRevocationCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityRevocationCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityRevocationCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_companies_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyDetail'];
        };
      };
    };
  };
  api_v1_companies_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedCompanyUpdateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedCompanyUpdateRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedCompanyUpdateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyDetail'];
        };
      };
    };
  };
  api_v1_companies_activate_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyActivateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyActivateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyActivateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyActivated'];
        };
      };
    };
  };
  api_v1_companies_status_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyStatusUpdateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyStatusUpdateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyStatusUpdateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyStatusUpdated'];
        };
      };
    };
  };
  api_v1_company_authority_appointments_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedOwnCompanyAppointmentList'];
        };
      };
    };
  };
  api_v1_company_authority_appointments_revoke_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OwnCompanyAppointment'];
        };
      };
    };
  };
  api_v1_company_authority_appointments_team_list: {
    parameters: {
      query: {
        company: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyTeamAppointment'][];
        };
      };
    };
  };
  api_v1_company_authority_invitations_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCompanyTeamInvitationList'];
        };
      };
    };
  };
  api_v1_company_authority_invitations_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyTeamInvitationCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyTeamInvitationCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyTeamInvitationCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyTeamInvitationIssued'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyTeamInvitationIssued'];
        };
      };
    };
  };
  api_v1_company_authority_invitations_accept_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyTeamInvitationAcceptRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyTeamInvitationAcceptRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyTeamInvitationAcceptRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OwnCompanyAppointment'];
        };
      };
    };
  };
  api_v1_company_authority_requests_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCompanyAuthorityRequestList'];
        };
      };
    };
  };
  api_v1_company_authority_requests_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyAuthorityRequestUploadRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyAuthorityRequestUploadRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyAuthorityRequestUploadRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
    };
  };
  api_v1_company_authority_requests_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
    };
  };
  api_v1_company_authority_requests_admit_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyAuthorityRequestAdmissionRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyAuthorityRequestAdmissionRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyAuthorityRequestAdmissionRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
    };
  };
  api_v1_company_authority_requests_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_company_authority_requests_revoke_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
    };
  };
  api_v1_company_authority_requests_withdraw_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyAuthorityRequest'];
        };
      };
    };
  };
  api_v1_company_eligibility_requests_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCompanyEligibilityRequestList'];
        };
      };
    };
  };
  api_v1_company_eligibility_requests_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityRequestCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityRequestCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityRequestCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_company_eligibility_requests_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_company_eligibility_requests_withdraw_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityRequestWithdrawalCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityRequestWithdrawalCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityRequestWithdrawalCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequest'];
        };
      };
    };
  };
  api_v1_company_eligibility_requests_preview_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CompanyEligibilityRequestPreviewRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CompanyEligibilityRequestPreviewRequest'];
        'multipart/form-data': ApiComponents['schemas']['CompanyEligibilityRequestPreviewRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CompanyEligibilityRequestPreviewResult'];
        };
      };
    };
  };
  api_v1_directory_tokens_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedDirectoryTokenListList'];
        };
      };
    };
  };
  api_v1_directory_tokens_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DirectoryTokenList'];
        };
      };
    };
  };
  api_v1_directory_tokens_documents_list: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['DirectoryDocument'][];
        };
      };
    };
  };
  api_v1_directory_tokens_documents_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        document_uuid: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_documents_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedDocumentList'];
        };
      };
    };
  };
  api_v1_documents_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['DocumentUploadRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['DocumentUploadRequest'];
        'multipart/form-data': ApiComponents['schemas']['DocumentUploadRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Document'];
        };
      };
    };
  };
  api_v1_documents_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Document'];
        };
      };
    };
  };
  api_v1_documents_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_v1_documents_attach_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['DocumentAttachmentRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['DocumentAttachmentRequest'];
        'multipart/form-data': ApiComponents['schemas']['DocumentAttachmentRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Document'];
        };
      };
    };
  };
  api_v1_offerings_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedOfferingListList'];
        };
      };
    };
  };
  api_v1_offerings_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OfferingWriteRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OfferingWriteRequest'];
        'multipart/form-data': ApiComponents['schemas']['OfferingWriteRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_offerings_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_offerings_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_v1_offerings_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedOfferingWriteRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedOfferingWriteRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedOfferingWriteRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_offerings_documents_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OfferingDocumentsRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OfferingDocumentsRequest'];
        'multipart/form-data': ApiComponents['schemas']['OfferingDocumentsRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_offerings_submit_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_offerings_subscriptions_list: {
    parameters: {
      query?: {
        page?: number;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedIssuerSubscriptionList'];
        };
      };
    };
  };
  api_v1_offerings_withdraw_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['OfferingWithdrawRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OfferingWithdrawRequest'];
        'multipart/form-data': ApiComponents['schemas']['OfferingWithdrawRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OfferingDetail'];
        };
      };
    };
  };
  api_v1_publications_list: {
    parameters: {
      query?: {
        addressed?: 'me';
        issuer?: string;
        kind?: 'distribution' | 'holding_statement' | 'meeting_notice' | 'resolution';
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedPublicationList'];
        };
      };
    };
  };
  api_v1_publications_ballot_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['BallotRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['BallotRequest'];
        'multipart/form-data': ApiComponents['schemas']['BallotRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Publication'];
        };
      };
    };
  };
  api_v1_publications_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_publications_summary_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PublicationSummary'];
        };
      };
    };
  };
  api_v1_subscriptions_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedSubscriptionListList'];
        };
      };
    };
  };
  api_v1_subscriptions_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['SubscriptionCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['SubscriptionCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['SubscriptionCreateRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SubscriptionDetail'];
        };
      };
    };
  };
  api_v1_subscriptions_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SubscriptionDetail'];
        };
      };
    };
  };
  api_v1_subscriptions_submit_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SubscriptionDetail'];
        };
      };
    };
  };
  api_v1_subscriptions_withdraw_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['SubscriptionWithdrawRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['SubscriptionWithdrawRequest'];
        'multipart/form-data': ApiComponents['schemas']['SubscriptionWithdrawRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SubscriptionDetail'];
        };
      };
    };
  };
  api_v1_tokens_list: {
    parameters: {
      query?: {
        company_uuid?: string;
        contract_address?: string;
        ordering?: string;
        page?: number;
        search?: string;
        status?: string;
        token_type?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareTokenListList'];
        };
      };
    };
  };
  api_v1_tokens_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['ShareTokenCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['ShareTokenCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['ShareTokenCreateRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareTokenDetail'];
        };
      };
    };
  };
  api_v1_tokens_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareTokenDetail'];
        };
      };
    };
  };
  api_v1_tokens_deploy_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['TokenDeploymentStarted'];
        };
      };
    };
  };
  api_v1_tokens_holders_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareRegister'];
        };
      };
    };
  };
  api_v1_tokens_issuances_list: {
    parameters: {
      query?: {
        page?: number;
        status?: string;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareIssuanceListList'];
        };
      };
    };
  };
  api_v1_tokens_issue_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['ShareIssuanceCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['ShareIssuanceCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['ShareIssuanceCreateRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareIssuanceRequested'];
        };
      };
    };
  };
  api_v1_tokens_pause_submissions_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        submission_id: string;
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
    };
  };
  api_v1_tokens_pause_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
    };
  };
  api_v1_tokens_register_entries_list: {
    parameters: {
      query?: {
        entry?: string[];
        page?: number;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareRegisterEntryList'];
        };
      };
    };
  };
  api_v1_tokens_register_export_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/csv': string;
        };
      };
    };
  };
  api_v1_tokens_register_opening_holders_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpeningHolders'];
        };
      };
    };
  };
  api_v1_tokens_register_waiting_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareRegisterWaiting'];
        };
      };
    };
  };
  api_v1_tokens_unpause_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['PauseSubmissionRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PauseSubmissionResponse'];
        };
      };
    };
  };
  api_v1_tokens_capital_increases_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        search?: string;
        status?: string;
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedCapitalIncreaseListList'];
        };
      };
    };
  };
  api_v1_tokens_capital_increases_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['CapitalIncreaseCreateRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['CapitalIncreaseCreateRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['CapitalIncreaseCreateRequestRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CapitalIncreaseDetail'];
        };
      };
    };
  };
  api_v1_tokens_capital_increases_submit_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['CapitalIncreaseSubmitted'];
        };
      };
    };
  };
  api_v1_tokens_issuance_requests_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        status?: string;
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareIssuanceRequestList'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        register?: string;
        status?: 'applied' | 'rejected' | 'submitted';
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterCorrectionList'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterCorrectionCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterCorrectionCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterCorrectionCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterCorrection'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterCorrection'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterCorrection'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_decide_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterCorrectionDecideRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterCorrectionDecideRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterCorrectionDecideRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterCorrection'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_decision_preview_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterCorrectionDecisionRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterCorrectionDecisionRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterCorrectionDecisionRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterCorrectionDecisionPreview'];
        };
      };
    };
  };
  api_v1_tokens_register_corrections_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_evidence_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'multipart/form-data': ApiComponents['schemas']['RegisterEvidenceUploadRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterEvidence'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterEvidence'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        status?: 'applied' | 'rejected' | 'submitted';
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterImportList'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterImportCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterImportCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterImportCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterImport'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterImport'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterImport'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_asic_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_imports_decide_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterImportDecideRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterImportDecideRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterImportDecideRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterImport'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_decision_preview_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterImportDecisionRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterImportDecisionRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterImportDecisionRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterImportDecisionPreview'];
        };
      };
    };
  };
  api_v1_tokens_register_imports_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_instructions_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterInstructionList'];
        };
      };
    };
  };
  api_v1_tokens_register_instructions_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterInstructionCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterInstructionCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterInstructionCreateRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterInstruction'];
        };
      };
    };
  };
  api_v1_tokens_register_instructions_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterInstruction'];
        };
      };
    };
  };
  api_v1_tokens_register_instructions_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_links_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterWalletLinkList'];
        };
      };
    };
  };
  api_v1_tokens_register_links_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterWalletLinkCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterWalletLinkCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterWalletLinkCreateRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterWalletLink'];
        };
      };
    };
  };
  api_v1_tokens_register_links_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterWalletLink'];
        };
      };
    };
  };
  api_v1_tokens_register_links_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_openings_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        status?: 'applied' | 'rejected' | 'submitted';
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterOpeningList'];
        };
      };
    };
  };
  api_v1_tokens_register_openings_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterOpeningCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterOpeningCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterOpeningCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpening'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpening'];
        };
      };
    };
  };
  api_v1_tokens_register_openings_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpening'];
        };
      };
    };
  };
  api_v1_tokens_register_openings_decide_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterOpeningDecideRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterOpeningDecideRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterOpeningDecideRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpening'];
        };
      };
    };
  };
  api_v1_tokens_register_openings_decision_preview_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterOpeningDecisionRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterOpeningDecisionRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterOpeningDecisionRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterOpeningDecisionPreview'];
        };
      };
    };
  };
  api_v1_tokens_register_openings_file_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          '*/*': Blob;
        };
      };
    };
  };
  api_v1_tokens_register_reconciliations_list: {
    parameters: {
      query?: {
        company?: string;
        ordering?: string;
        page?: number;
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedRegisterReconciliationList'];
        };
      };
    };
  };
  api_v1_tokens_register_reconciliations_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterReconciliation'];
        };
      };
    };
  };
  api_v1_tokens_register_reconciliations_acknowledge_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['RegisterAcknowledgeRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['RegisterAcknowledgeRequest'];
        'multipart/form-data': ApiComponents['schemas']['RegisterAcknowledgeRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterReconciliation'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['RegisterReconciliation'];
        };
      };
    };
  };
  api_v1_tokens_register_list: {
    parameters: {
      query?: {
        company_uuid?: string;
        contract_address?: string;
        ordering?: string;
        page?: number;
        search?: string;
        status?: string;
        token_type?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareTokenListList'];
        };
      };
    };
  };
  trading_events_stream_retrieve: {
    parameters: {
      query?: {
        token?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/event-stream': string;
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/plain': string;
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/plain': string;
        };
      };
    };
  };
  api_v1_trading_orders_list: {
    parameters: {
      query?: {
        order_type?: string;
        ordering?: string;
        page?: number;
        payment_asset?: string;
        search?: string;
        status?: string;
        token?: string;
        wallet_address?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedTransferOrderListList'];
        };
      };
    };
  };
  api_v1_trading_orders_action_context_retrieve: {
    parameters: {
      query: {
        owner_account_uuid: string;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionContext'];
        };
      };
    };
  };
  api_v1_trading_orders_cancel_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_cancel_message_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OrderActionIdentityRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OrderActionIdentityRequest'];
        'multipart/form-data': ApiComponents['schemas']['OrderActionIdentityRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_modify_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['OrderActionExecuteRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_modify_message_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['OrderActionModifyRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['OrderActionModifyRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['OrderActionModifyRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderActionSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_swap_retrieve: {
    parameters: {
      query: {
        approval_tx_hash?: string;
        owner_account_uuid: string;
        settlement_digest?: string;
        swap_uuid: string;
        wallet_uuid: string;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SettlementSwapOrderForSigning'];
        };
      };
    };
  };
  api_v1_trading_orders_swap_approval_broadcast_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['SettlementApprovalBroadcastRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['SettlementApprovalBroadcastRequest'];
        'multipart/form-data': ApiComponents['schemas']['SettlementApprovalBroadcastRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SettlementApprovalReceipt'];
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SettlementApprovalUncertain'];
        };
      };
    };
  };
  api_v1_trading_orders_swap_approval_data_retrieve: {
    parameters: {
      query: {
        owner_account_uuid: string;
        settlement_digest: string;
        swap_uuid: string;
        wallet_uuid: string;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ApprovalDataResponse'];
        };
      };
    };
  };
  api_v1_trading_orders_swap_approval_status_retrieve: {
    parameters: {
      query: {
        owner_account_uuid: string;
        settlement_digest: string;
        swap_uuid: string;
        wallet_uuid: string;
      };
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SettlementApprovalStatus'];
        };
      };
    };
  };
  api_v1_trading_orders_swap_sign_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['SettlementSignatureRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['SettlementSignatureRequest'];
        'multipart/form-data': ApiComponents['schemas']['SettlementSignatureRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['SettlementSwapOrder'];
        };
      };
    };
  };
  api_v1_trading_orders_actions_retrieve: {
    parameters: {
      query: {
        owner_account_uuid: string;
      };
      header?: never;
      path: {
        action_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderActionSubmission'];
        };
      };
    };
  };
  api_v1_trading_orders_create_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['SignedOrderSubmissionRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['SignedOrderSubmissionRequest'];
        'multipart/form-data': ApiComponents['schemas']['SignedOrderSubmissionRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderSubmission'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | ApiComponents['schemas']['OrderSubmission']
            | {
                [key: string]: unknown;
              };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_create_message_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['TransferOrderCreateRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['TransferOrderCreateRequest'];
        'multipart/form-data': ApiComponents['schemas']['TransferOrderCreateRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_orders_submissions_retrieve: {
    parameters: {
      query: {
        owner_account_uuid: string;
      };
      header?: never;
      path: {
        submission_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderSubmission'];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
    };
  };
  api_v1_trading_swaps_list: {
    parameters: {
      query: {
        ordering?: string;
        page?: number;
        wallet_address: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedSwapOrderListList'];
        };
      };
    };
  };
  api_v1_trading_tokens_list: {
    parameters: {
      query?: {
        ordering?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedShareTokenListList'];
        };
      };
    };
  };
  api_v1_trading_tokens_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['ShareTokenList'];
        };
      };
    };
  };
  api_v1_trading_tokens_order_book_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['OrderBook'];
        };
      };
    };
  };
  api_v1_trading_wallets_balances_retrieve: {
    parameters: {
      query: {
        wallet_address: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['TradingWalletBalances'];
        };
      };
    };
  };
  api_v1_trading_whitelist_status_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        address: string;
        token: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistStatus'];
        };
      };
    };
  };
  api_v1_whitelist_list: {
    parameters: {
      query?: {
        company?: string;
        date_from?: string;
        date_to?: string;
        ordering?: string;
        page?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedWhitelistEntryList'];
        };
      };
    };
  };
  api_v1_whitelist_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistEntry'];
        };
      };
    };
  };
  api_v1_whitelist_add_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['WhitelistAddRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['WhitelistAddRequest'];
        'multipart/form-data': ApiComponents['schemas']['WhitelistAddRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistChange'];
        };
      };
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistChange'];
        };
      };
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistChange'];
        };
      };
    };
  };
  api_v1_whitelist_batch_add_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['WhitelistBatchAddRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['WhitelistBatchAddRequest'];
        'multipart/form-data': ApiComponents['schemas']['WhitelistBatchAddRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistBatchResponse'];
        };
      };
    };
  };
  api_v1_whitelist_entry_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        address: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistEntry'];
        };
      };
    };
  };
  api_v1_whitelist_export_retrieve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/csv': string;
        };
      };
    };
  };
  api_v1_whitelist_remove_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['WhitelistRemoveRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['WhitelistRemoveRequest'];
        'multipart/form-data': ApiComponents['schemas']['WhitelistRemoveRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistChange'];
        };
      };
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistChange'];
        };
      };
    };
  };
  api_v1_whitelist_sync_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        address: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WhitelistSyncResponse'];
        };
      };
    };
  };
  api_wallets_list: {
    parameters: {
      query?: {
        address?: string;
        chain?: string;
        ordering?: string;
        page?: number;
        verification_status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PaginatedWalletList'];
        };
      };
    };
  };
  api_wallets_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['WalletRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['WalletRequest'];
        'multipart/form-data': ApiComponents['schemas']['WalletRequest'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Wallet'];
        };
      };
    };
  };
  api_wallets_destroy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  api_wallets_partial_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': ApiComponents['schemas']['PatchedWalletRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PatchedWalletRequest'];
        'multipart/form-data': ApiComponents['schemas']['PatchedWalletRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Wallet'];
        };
      };
    };
  };
  api_wallets_broadcast_transfer_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['BroadcastTransferRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['BroadcastTransferRequest'];
        'multipart/form-data': ApiComponents['schemas']['BroadcastTransferRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['BroadcastTransferResponse'];
        };
      };
    };
  };
  api_wallets_holdings_list: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['Holding'][];
        };
      };
    };
  };
  api_wallets_prepare_transfer_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['PrepareWalletTransferRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['PrepareWalletTransferRequest'];
        'multipart/form-data': ApiComponents['schemas']['PrepareWalletTransferRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['PreparedWalletTransfer'];
        };
      };
    };
  };
  api_wallets_request_verification_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WalletVerificationChallenge'];
        };
      };
    };
  };
  api_wallets_sync_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WalletSyncResponse'];
        };
      };
    };
  };
  api_wallets_verify_signature_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        uuid: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['WalletVerificationSignatureRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['WalletVerificationSignatureRequest'];
        'multipart/form-data': ApiComponents['schemas']['WalletVerificationSignatureRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['WalletVerificationResult'];
        };
      };
    };
  };
  api_wallets_batch_check_balances_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': ApiComponents['schemas']['BatchBalanceRequestRequest'];
        'application/x-www-form-urlencoded': ApiComponents['schemas']['BatchBalanceRequestRequest'];
        'multipart/form-data': ApiComponents['schemas']['BatchBalanceRequestRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': ApiComponents['schemas']['BatchBalanceResponse'];
        };
      };
    };
  };
}
export type TradingEventType =
  | 'order_cancelled'
  | 'order_created'
  | 'order_held'
  | 'order_listed'
  | 'order_matched'
  | 'order_modified'
  | 'swap_completed'
  | 'swap_expired'
  | 'swap_failed'
  | 'swap_signed';
