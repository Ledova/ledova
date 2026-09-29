import { createSyncPauseSubmissionStore } from '@ledova/shared';

export const pauseSubmissionStore = createSyncPauseSubmissionStore(
  {
    getAllKeys: () => Object.keys(localStorage),
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  },
  () => crypto.randomUUID(),
);
