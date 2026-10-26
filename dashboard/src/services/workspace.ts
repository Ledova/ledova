import type { OrderSubmissionOwner } from '@ledova/shared';

export type WorkspaceMode = 'company' | 'my-shares';

const keyFor = (owner: OrderSubmissionOwner) => `ledova.workspace.${owner.userUuid}.${owner.ownerAccountUuid}`;

export function readWorkspace(owner: OrderSubmissionOwner | null): WorkspaceMode | null {
  if (!owner) return null;
  try {
    const value = localStorage.getItem(keyFor(owner));
    return value === 'company' || value === 'my-shares' ? value : null;
  } catch {
    return null;
  }
}

export function rememberWorkspace(owner: OrderSubmissionOwner, mode: WorkspaceMode) {
  try {
    localStorage.setItem(keyFor(owner), mode);
  } catch {
    return;
  }
}
