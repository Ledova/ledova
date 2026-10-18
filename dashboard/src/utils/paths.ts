export const COMPANY_DASHBOARD_PATH = '/company/dashboard';

export const SIGNUP_STEPS = [
  '/signup/email-confirmation',
  '/signup/account-type',
  '/signup/pre-screening',
  '/signup/identity-verification',
  '/signup/user-profile',
  '/signup/financial-profile',
  '/signup/company-registration',
  '/signup/review',
] as const;

export type SignupStep = (typeof SIGNUP_STEPS)[number];

export const SIGNUP_RESUMES_AT: SignupStep = '/signup/account-type';
