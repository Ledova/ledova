import { createOrderActionStore } from '@ledova/shared';
import { browserStorage } from './browserStorage';

export const orderActionStore = createOrderActionStore(browserStorage, () => crypto.randomUUID());
