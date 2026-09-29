import type { OrderSubmissionOwner, OrderSubmissionStorage } from './order-submission-storage';
import { isUuid } from './validation';

export type SavedPause = OrderSubmissionOwner & {
  tokenUuid: string;
  submissionId: string;
  paused: boolean;
};

export interface SyncStorage {
  getAllKeys: () => readonly string[];
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

type Program<T> = Generator<unknown, T, never>;

const PREFIX = 'ledova.pause-submissions.v1.';

function* settled<T>(pending: T | Promise<T>): Generator<T | Promise<T>, T, T> {
  return yield pending;
}

function runSync<T>(program: Program<T>): T {
  let step = program.next();
  while (!step.done) step = program.next(step.value as never);
  return step.value;
}

async function runAsync<T>(program: Program<T>): Promise<T> {
  let step = program.next();
  while (!step.done) step = program.next((await step.value) as never);
  return step.value;
}

function scopePrefix(owner: OrderSubmissionOwner, tokenUuid: string) {
  if (![owner.userUuid, owner.ownerAccountUuid, tokenUuid].every(isUuid))
    throw new Error('The issuer or share class identity is unavailable.');
  return `${PREFIX}${owner.userUuid}.${owner.ownerAccountUuid}.${tokenUuid}.`;
}

function storageKey(record: SavedPause) {
  if (!isUuid(record.submissionId) || typeof record.paused !== 'boolean')
    throw new Error('The saved pause request is invalid.');
  return `${scopePrefix(record, record.tokenUuid)}${record.submissionId}`;
}

function decode(value: string, key: string): SavedPause {
  const record: SavedPause = JSON.parse(value);
  if (
    !record ||
    Object.keys(record).sort().join(',') !== 'ownerAccountUuid,paused,submissionId,tokenUuid,userUuid' ||
    storageKey(record) !== key
  )
    throw new Error('Saved pause requests could not be read.');
  return record;
}

function* list(storage: OrderSubmissionStorage, owner: OrderSubmissionOwner, tokenUuid: string): Program<SavedPause[]> {
  const start = scopePrefix(owner, tokenUuid);
  const keys = (yield* settled(storage.getAllKeys())).filter((key) => key.startsWith(start)).sort();
  const records: SavedPause[] = [];
  for (const key of keys) {
    const value = yield* settled(storage.getItem(key));
    if (value !== null) records.push(decode(value, key));
  }
  return records;
}

function* retain(storage: OrderSubmissionStorage, record: SavedPause): Program<SavedPause> {
  const name = storageKey(record);
  const value = JSON.stringify(record);
  const existing = yield* settled(storage.getItem(name));
  if (existing !== null && existing !== value) throw new Error('This saved pause request has different terms.');
  yield* settled(storage.setItem(name, value));
  if ((yield* settled(storage.getItem(name))) !== value)
    throw new Error('The pause request could not be saved on this device.');
  return record;
}

function* save(
  storage: OrderSubmissionStorage,
  newUuid: () => string,
  owner: OrderSubmissionOwner,
  tokenUuid: string,
  paused: boolean,
): Program<SavedPause> {
  yield* list(storage, owner, tokenUuid);
  const record = Object.freeze({ ...owner, tokenUuid, paused, submissionId: newUuid() });
  if ((yield* settled(storage.getItem(storageKey(record)))) !== null)
    throw new Error('This pause submission already exists.');
  return yield* retain(storage, record);
}

function* remove(storage: OrderSubmissionStorage, record: SavedPause): Program<void> {
  const name = storageKey(record);
  yield* settled(storage.removeItem(name));
  if ((yield* settled(storage.getItem(name))) !== null) throw new Error('The pause reminder could not be cleared.');
}

export function createPauseSubmissionStore(storage: OrderSubmissionStorage, newUuid: () => string) {
  return {
    list: (owner: OrderSubmissionOwner, tokenUuid: string) => runAsync(list(storage, owner, tokenUuid)),
    save: (owner: OrderSubmissionOwner, tokenUuid: string, paused: boolean) =>
      runAsync(save(storage, newUuid, owner, tokenUuid, paused)),
    retain: (record: SavedPause) => runAsync(retain(storage, record)),
    remove: (record: SavedPause) => runAsync(remove(storage, record)),
  };
}

export function createSyncPauseSubmissionStore(storage: SyncStorage, newUuid: () => string) {
  return {
    list: (owner: OrderSubmissionOwner, tokenUuid: string) => runSync(list(storage, owner, tokenUuid)),
    save: (owner: OrderSubmissionOwner, tokenUuid: string, paused: boolean) =>
      runSync(save(storage, newUuid, owner, tokenUuid, paused)),
    retain: (record: SavedPause) => runSync(retain(storage, record)),
    remove: (record: SavedPause) => runSync(remove(storage, record)),
  };
}
