import { MEMBER_INVITATION_PATH } from './paths';

const STORAGE_KEY = 'ledova.member-invitation';
const valid = (value: string | null) => !!value && /^[A-Za-z0-9_-]{43}$/.test(value);

export function pendingMemberInvitation() {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return valid(value) ? value! : '';
  } catch {
    return '';
  }
}

export function captureMemberInvitation() {
  const fragment = window.location.hash.slice(1);
  if (fragment) {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      if (valid(fragment)) sessionStorage.setItem(STORAGE_KEY, fragment);
    } catch {
      return '';
    }
  }
  return pendingMemberInvitation();
}

export function clearMemberInvitation() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function invitationDestination(fallback: string) {
  return pendingMemberInvitation() ? MEMBER_INVITATION_PATH : fallback;
}
