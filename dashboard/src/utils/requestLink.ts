import { DESTINATIONS, isUuid } from '@ledova/shared';

export const REQUEST_LINK_COMPANY = 'to';

const STORAGE_KEY = 'ledova.eligibility-request-link';

export function eligibilityRequestLink(company: string) {
  const query = new URLSearchParams({ [REQUEST_LINK_COMPANY]: company });
  return `${window.location.origin}${DESTINATIONS.eligibilityRequests.path}?${query}`;
}

export function linkedCompany(search: string) {
  const company = new URLSearchParams(search).get(REQUEST_LINK_COMPANY) ?? '';
  return isUuid(company) ? company.toLowerCase() : '';
}

export function keepRequestLink(pathname: string, search: string) {
  const company = pathname === DESTINATIONS.eligibilityRequests.path ? linkedCompany(search) : '';
  if (!company) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, company);
  } catch {
    return;
  }
}

export function pendingRequestLink() {
  try {
    const company = sessionStorage.getItem(STORAGE_KEY) ?? '';
    if (!isUuid(company)) return '';
    return `${DESTINATIONS.eligibilityRequests.path}?${new URLSearchParams({ [REQUEST_LINK_COMPANY]: company })}`;
  } catch {
    return '';
  }
}

export function dropRequestLink(pathname: string) {
  if (pathname === DESTINATIONS.eligibilityRequests.path) clearRequestLink();
}

export function clearRequestLink() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}
