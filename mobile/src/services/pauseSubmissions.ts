import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createPauseSubmissionStore } from '@ledova/shared';

export const pauseSubmissionStore = createPauseSubmissionStore(AsyncStorage, () => Crypto.randomUUID());
