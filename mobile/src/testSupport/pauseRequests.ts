import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedPause } from '../services/pauseSubmissions';

export const tokenUuid = '11111111-1111-4111-8111-111111111111';
export const owner = {
  userUuid: '22222222-2222-4222-8222-222222222222',
  ownerAccountUuid: '33333333-3333-4333-8333-333333333333',
};
export const items = new Map<string, string>();

export function resetPauseStorage() {
  items.clear();
  jest.mocked(AsyncStorage.getAllKeys).mockImplementation(async () => [...items.keys()]);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => items.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    items.set(key, value);
  });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    items.delete(key);
  });
}

export function pauseResponse(record: SavedPause, completed = false, status = 'deployed') {
  return {
    status: completed ? 200 : 202,
    data: {
      message: completed
        ? 'The original pause transaction was confirmed. The class may have changed since then.'
        : 'Pause request retained. Its outcome is pending; this does not establish the current class state.',
      token: { uuid: record.tokenUuid, status },
      submission: {
        uuid: record.submissionId,
        paused: record.paused,
        status: completed ? 'confirmed' : 'pending',
        completedAt: completed ? '2026-09-15T00:00:00Z' : null,
      },
    },
  };
}
