import { useState } from 'react';
import { RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';
import { useUserProfile } from '../../hooks/useUserProfile';
import { AccountData, AccountSettings } from './AccountSettings';
import { PersonalProfile } from './PersonalProfile';

export function SettingsScreen() {
  const theme = useAppTheme();
  const profile = useUserProfile();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Page
      testID="profile-scroll"
      title="Profile"
      refreshControl={
        <RefreshControl
          testID="profile-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing) return;
            setRefreshing(true);
            void profile.profile.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <PersonalProfile profile={profile} />
    </Page>
  );
}

export function AccountScreen() {
  return (
    <Page testID="account-scroll" title="Account">
      <AccountSettings />
    </Page>
  );
}

export function DataPrivacyScreen() {
  return (
    <Page testID="data-privacy-scroll" title="Data and privacy">
      <AccountData />
    </Page>
  );
}
