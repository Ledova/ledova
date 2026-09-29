import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { pauseSubmissionStore } from './pauseSubmissions';
import { items, owner, resetPauseStorage, tokenUuid } from '../testSupport/pauseRequests';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const submissionId = '44444444-4444-4444-8444-444444444444';
const key = `ledova.pause-submissions.v1.${owner.userUuid}.${owner.ownerAccountUuid}.${tokenUuid}.${submissionId}`;

beforeEach(() => {
  resetPauseStorage();
  jest.mocked(Crypto.randomUUID).mockReturnValue(submissionId);
});

it("keeps saved pause requests in the device's AsyncStorage under an expo-crypto request id", async () => {
  const record = await pauseSubmissionStore.save(owner, tokenUuid, false);

  expect(record).toEqual({ ...owner, tokenUuid, submissionId, paused: false });
  expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(key, JSON.stringify(record));
  expect([...items]).toEqual([[key, JSON.stringify(record)]]);
  expect(await pauseSubmissionStore.list(owner, tokenUuid)).toEqual([record]);
  await pauseSubmissionStore.remove(record);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(key);
  expect(items.size).toBe(0);
});

it('answers with a promise that rejects, rather than throwing, when the identity is unavailable', async () => {
  const refused = pauseSubmissionStore.save({ ...owner, userUuid: '' }, tokenUuid, true);

  await expect(refused).rejects.toThrow('The issuer or share class identity is unavailable.');
  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
  expect(items.size).toBe(0);
});
