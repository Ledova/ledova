import type { RouteProp } from '@react-navigation/native';
import { Page } from '../../components/Page';
import { useUserProfile } from '../../hooks/useUserProfile';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { useMemberRecordsState, useMemberRefresh } from '../holdings/MemberRecordsProvider';
import { AccountData, AccountSettings } from './AccountSettings';
import { CompanyRecordedDetails } from './CompanyRecordedDetails';
import { PersonalProfile } from './PersonalProfile';

export function SettingsScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Settings'> }) {
  const profile = useUserProfile();
  const { read } = useMemberRecordsState();
  const refresh = useMemberRefresh(read, 'profile-refresh', () => profile.profile.refetch());
  return (
    <Page testID="profile-scroll" title="Profile" refreshControl={refresh}>
      <PersonalProfile profile={profile} />
      <CompanyRecordedDetails opened={route.params?.record} />
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
