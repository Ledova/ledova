const normalizeBaseUrl = (value: string): string => value.replace(/\/$/, '');

const SITE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_MARKETING_URL || 'http://localhost:5173');

export const PUBLIC_LINKS = {
  termsOfService: `${SITE_URL}/terms-of-service`,
  privacyPolicy: `${SITE_URL}/privacy-policy`,
} as const;
