const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, '');

export const SITE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_MARKETING_URL || 'http://localhost:5173');
export const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL || '';

export const PUBLIC_LINKS = {
  termsOfService: `${SITE_URL}/terms-of-service`,
  privacyPolicy: `${SITE_URL}/privacy-policy`,
} as const;
