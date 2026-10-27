import type { Location } from 'react-router-dom';

export const ROOT_PATH = '/';
export const SIGNIN_PATH = '/signin';
export const MEMBER_INVITATION_PATH = '/member-invitation';
export const SIGNUP_PATH = '/signup';
export const NOT_FOUND_PATH = '*';
export const COMPANY_DASHBOARD_PATH = '/company/dashboard';
export const CERTIFICATES_PATH = '/documents/certificates';

export function certificatesLocation(location: Pick<Location, 'search' | 'state'>) {
  const query = new URLSearchParams(location.search);
  if (!query.has('company') && typeof location.state?.registerCompany === 'string')
    query.set('company', location.state.registerCompany);
  if (!query.has('class') && typeof location.state?.registerToken === 'string')
    query.set('class', location.state.registerToken);
  return { pathname: CERTIFICATES_PATH, search: query.size ? `?${query}` : '', hash: '' };
}

export const SIGNUP_PATHS = {
  emailConfirmation: '/signup/email-confirmation',
  accountType: '/signup/account-type',
  preScreening: '/signup/pre-screening',
  userProfile: '/signup/user-profile',
  financialProfile: '/signup/financial-profile',
  companyRegistration: '/signup/company-registration',
  review: '/signup/review',
} as const;

export const SIGNUP_STEPS = [
  SIGNUP_PATHS.emailConfirmation,
  SIGNUP_PATHS.accountType,
  SIGNUP_PATHS.preScreening,
  SIGNUP_PATHS.userProfile,
  SIGNUP_PATHS.financialProfile,
  SIGNUP_PATHS.companyRegistration,
  SIGNUP_PATHS.review,
] as const;

export type SignupStep = (typeof SIGNUP_STEPS)[number];

export const SIGNUP_RESUMES_AT: SignupStep = SIGNUP_PATHS.accountType;

export const SITE_PATHS = {
  about: '/about',
  contact: '/contact',
  termsOfService: '/terms-of-service',
  privacyPolicy: '/privacy-policy',
} as const;
