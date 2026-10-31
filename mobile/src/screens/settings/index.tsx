import { Page } from '../../components/Page';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMemberRecordsState, useMemberRefresh } from '../holdings/MemberRecordsProvider';
import { AccountData, AccountSettings } from './AccountSettings';
import { CompanyRecordedDetails } from './CompanyRecordedDetails';
import { PersonalProfile } from './PersonalProfile';

export function SettingsScreen() {
  const profile = useUserProfile();
  const { read } = useMemberRecordsState();
  const refresh = useMemberRefresh(read, 'profile-refresh', () => profile.profile.refetch());
  return (
    <Page testID="profile-scroll" title="Profile" refreshControl={refresh}>
      <PersonalProfile profile={profile} />
      <CompanyRecordedDetails />
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
