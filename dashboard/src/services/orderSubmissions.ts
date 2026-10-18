import { createOrderSubmissionStore } from '@ledova/shared';
import { browserStorage } from './browserStorage';

export const orderSubmissionStore = createOrderSubmissionStore(browserStorage, () => crypto.randomUUID());
