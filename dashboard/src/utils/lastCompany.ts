import type { OrderSubmissionOwner } from '@ledova/shared';

const key = (owner: OrderSubmissionOwner) => `ledova.company.${owner.userUuid}.${owner.ownerAccountUuid}`;

export function lastCompany(owner: OrderSubmissionOwner | null) {
  if (!owner) return null;
  try {
    return localStorage.getItem(key(owner));
  } catch {
    return null;
  }
}

export function rememberCompany(owner: OrderSubmissionOwner, uuid: string) {
  try {
    localStorage.setItem(key(owner), uuid);
  } catch {}
}
