import { createSyncPauseSubmissionStore } from '@ledova/shared';
import { browserStorage } from './browserStorage';

export const pauseSubmissionStore = createSyncPauseSubmissionStore(browserStorage, () => crypto.randomUUID());
