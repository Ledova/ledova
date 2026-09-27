import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { listSavedPauses, removeSavedPause, retainSavedPause, savePause } from './pauseSubmissions';
import { items, owner, resetPauseStorage, tokenUuid } from '../testSupport/pauseRequests';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const submissionId = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  resetPauseStorage();
  jest.mocked(Crypto.randomUUID).mockReturnValue(submissionId);
});

it('retains exact terms and isolates every user, account and class scope', async () => {
  const record = await savePause(owner, tokenUuid, false);
  expect(record).toEqual({ ...owner, tokenUuid, submissionId, paused: false });
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([record]);
  expect(await listSavedPauses({ ...owner, userUuid: submissionId }, tokenUuid)).toEqual([]);
  expect(await listSavedPauses({ ...owner, ownerAccountUuid: submissionId }, tokenUuid)).toEqual([]);
  expect(await listSavedPauses(owner, submissionId)).toEqual([]);
  await expect(savePause(owner, tokenUuid, true)).rejects.toThrow('already exists');
  await expect(retainSavedPause({ ...record, paused: true })).rejects.toThrow('different terms');
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([record]);
});

it('requires storage read-back and restores the same removed request on retry', async () => {
  jest.mocked(AsyncStorage.setItem).mockResolvedValueOnce();
  await expect(savePause(owner, tokenUuid, true)).rejects.toThrow('could not be saved');
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([]);
  const record = await savePause(owner, tokenUuid, true);
  items.clear();
  expect(await retainSavedPause(record)).toEqual(record);
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([record]);
});

it('fails closed on corrupt or renamed saved terms and verifies removal', async () => {
  const record = await savePause(owner, tokenUuid, true);
  const name = [...items.keys()][0];
  items.set(name, JSON.stringify({ ...record, tokenUuid: submissionId }));
  await expect(listSavedPauses(owner, tokenUuid)).rejects.toThrow('could not be read');
  await expect(savePause(owner, tokenUuid, true)).rejects.toThrow('could not be read');
  items.set(name, JSON.stringify(record));
  jest.mocked(AsyncStorage.removeItem).mockResolvedValueOnce();
  await expect(removeSavedPause(record)).rejects.toThrow('could not be cleared');
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([record]);
  await removeSavedPause(record);
  expect(await listSavedPauses(owner, tokenUuid)).toEqual([]);
});

it.each(['userUuid', 'ownerAccountUuid'] as const)('rejects an unavailable %s before storage', async (field) => {
  await expect(savePause({ ...owner, [field]: '' }, tokenUuid, true)).rejects.toThrow('identity is unavailable');
  expect(items.size).toBe(0);
});
