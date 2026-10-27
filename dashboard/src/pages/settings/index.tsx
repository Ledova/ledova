import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';
import { Page } from '@components/Page';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { useUserProfile } from '@hooks/useUserProfile';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { CompanyRecordedDetails } from './CompanyRecordedDetails';
import { PersonalProfile } from './PersonalProfile';
import { CompanyProfile } from './CompanyProfile';
import { AccountSettings } from './AccountSettings';

export default function SettingsPage() {
  const { hash, search, state } = useLocation();
  if (hash === '#company-recorded-details') return <CompanyRecordedDetails />;
  if (hash !== '#profile')
    return <Navigate to={{ pathname: DESTINATIONS.settings.path, search, hash: '#profile' }} state={state} replace />;
  return <Profile />;
}

function Profile() {
  const navigation = useSettingsNavigation();
  const profile = useUserProfile();
  const context = useCompanyContext();
  const showCompany = context ? !!context.company?.canManage : navigation.canManageCompany;
  const accessError = navigation.isError || context?.directory.hasError;
  const accessLoading = navigation.isLoading || context?.directory.isLoading;
  return (
    <PageTitle.Provider value="Profile">
      <Page>
        {accessError ? (
          <Section title="Company access">
            <LoadError
              retry={() => Promise.all([navigation.retry(), context?.directory.retry()])}
              busy={navigation.isFetching || context?.directory.isRefreshing}
            >
              Your company access could not be loaded.
            </LoadError>
          </Section>
        ) : accessLoading && !showCompany ? (
          <Loading>Loading company access…</Loading>
        ) : null}
        {showCompany && <CompanyProfile />}
        <PersonalProfile profile={profile} />
        <AccountSettings profile={profile} />
      </Page>
    </PageTitle.Provider>
  );
}
