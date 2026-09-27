import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
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
    throw new Error('The issuer or share class identity is unavailable.');
  return `${PREFIX}${owner.userUuid}.${owner.ownerAccountUuid}.${tokenUuid}.`;
}

function key(record: SavedPause) {
  if (!UUID.test(record.submissionId) || typeof record.paused !== 'boolean')
    throw new Error('The saved pause request is invalid.');
  return `${prefix(record, record.tokenUuid)}${record.submissionId}`;
}

export async function listSavedPauses(owner: OrderSubmissionOwner, tokenUuid: string): Promise<SavedPause[]> {
  const start = prefix(owner, tokenUuid);
  const keys = (await AsyncStorage.getAllKeys()).filter((item) => item.startsWith(start)).sort();
  const records = await Promise.all(
    keys.map(async (item) => {
      const value = await AsyncStorage.getItem(item);
      if (value === null) return null;
      const record: SavedPause = JSON.parse(value);
      if (
        !record ||
        Object.keys(record).sort().join(',') !== 'ownerAccountUuid,paused,submissionId,tokenUuid,userUuid' ||
        key(record) !== item
      )
        throw new Error('Saved pause requests could not be read.');
      return record;
    }),
  );
  return records.filter((record): record is SavedPause => record !== null);
}

export async function retainSavedPause(record: SavedPause): Promise<SavedPause> {
  const name = key(record);
  const value = JSON.stringify(record);
  const existing = await AsyncStorage.getItem(name);
  if (existing !== null && existing !== value) throw new Error('This saved pause request has different terms.');
  await AsyncStorage.setItem(name, value);
  if ((await AsyncStorage.getItem(name)) !== value)
    throw new Error('The pause request could not be saved on this device.');
  return record;
}

export async function savePause(owner: OrderSubmissionOwner, tokenUuid: string, paused: boolean): Promise<SavedPause> {
  await listSavedPauses(owner, tokenUuid);
  const record = Object.freeze({ ...owner, tokenUuid, paused, submissionId: Crypto.randomUUID() });
  if ((await AsyncStorage.getItem(key(record))) !== null) throw new Error('This pause submission already exists.');
  return retainSavedPause(record);
}

export async function removeSavedPause(record: SavedPause): Promise<void> {
  const name = key(record);
  await AsyncStorage.removeItem(name);
  if ((await AsyncStorage.getItem(name)) !== null) throw new Error('The pause reminder could not be cleared.');
}
