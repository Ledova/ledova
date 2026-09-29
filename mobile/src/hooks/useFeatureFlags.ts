import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useFeatureFlags as useSharedFeatureFlags } from '@ledova/shared';

export function useFeatureFlags() {
  return useSharedFeatureFlags(
    {
      mobilePlatform: Platform.OS,
      get appVersion() {
        return Constants.expoConfig?.version;
      },
    },
    { refetchOnWindowFocus: false, refetchOnReconnect: true },
  );
}
