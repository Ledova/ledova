import type { OrderSubmissionOwner } from '@ledova/shared';

export type SavedPause = OrderSubmissionOwner & {
  tokenUuid: string;
  submissionId: string;
  paused: boolean;
};

const PREFIX = 'ledova.pause-submissions.v1.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prefix(owner: OrderSubmissionOwner, tokenUuid: string) {
  if (![owner.userUuid, owner.ownerAccountUuid, tokenUuid].every((value) => UUID.test(value)))
    throw new Error('The issuer or token identity is unavailable.');
  return `${PREFIX}${owner.userUuid}.${owner.ownerAccountUuid}.${tokenUuid}.`;
}

function key(record: SavedPause) {
  if (!UUID.test(record.submissionId) || typeof record.paused !== 'boolean')
    throw new Error('The saved pause request is invalid.');
  return `${prefix(record, record.tokenUuid)}${record.submissionId}`;
}

export function listSavedPauses(owner: OrderSubmissionOwner, tokenUuid: string): SavedPause[] {
  const start = prefix(owner, tokenUuid);
  return Object.keys(localStorage)
    .filter((item) => item.startsWith(start))
    .sort()
    .map((item) => {
      const record: SavedPause = JSON.parse(localStorage.getItem(item) ?? 'null');
      if (
        !record ||
        Object.keys(record).sort().join(',') !== 'ownerAccountUuid,paused,submissionId,tokenUuid,userUuid' ||
        key(record) !== item
      )
        throw new Error('Saved pause requests could not be read.');
      return record;
    });
}

export function savePause(owner: OrderSubmissionOwner, tokenUuid: string, paused: boolean): SavedPause {
  listSavedPauses(owner, tokenUuid);
  const record = Object.freeze({ ...owner, tokenUuid, paused, submissionId: crypto.randomUUID() });
  const name = key(record);
  if (localStorage.getItem(name) !== null) throw new Error('This pause submission already exists.');
  return retainSavedPause(record);
}

export function retainSavedPause(record: SavedPause): SavedPause {
  const name = key(record);
  const value = JSON.stringify(record);
  const existing = localStorage.getItem(name);
  if (existing !== null && existing !== value) throw new Error('This saved pause request has different terms.');
  localStorage.setItem(name, value);
  if (localStorage.getItem(name) !== value) throw new Error('The pause request could not be saved on this device.');
  return record;
}

export function removeSavedPause(record: SavedPause) {
  const name = key(record);
  localStorage.removeItem(name);
  if (localStorage.getItem(name) !== null) throw new Error('The pause reminder could not be cleared.');
}
