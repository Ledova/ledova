const APP_URL = (import.meta.env.VITE_LEDOVA_URL ?? '').replace(/\/+$/, '');

export const SIGN_UP_URL = `${APP_URL}/signup`;
export const SIGN_IN_URL = `${APP_URL}/signin`;
export const GITHUB_URL = 'https://github.com/Ledova/ledova';
