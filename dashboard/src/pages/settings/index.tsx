import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner } from '@ledova/shared';
import { useState } from 'react';
import { Page } from '@components/Page';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
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
  const { owner } = useSubmissionOwner();
  const [companyOwner, setCompanyOwner] = useState<typeof owner>(null);
  const admittedOwner = navigation.canManageCompany
    ? owner
    : navigation.isLoading || navigation.isError
      ? companyOwner
      : null;
  if (companyOwner !== admittedOwner) setCompanyOwner(admittedOwner);
  const showCompany =
    !!owner &&
    (navigation.canManageCompany || (companyOwner === owner && (navigation.isLoading || navigation.isError)));
  return (
    <PageTitle.Provider value="Profile">
      <Page>
        {navigation.isError ? (
          <Section title="Company access">
            <LoadError retry={() => void navigation.retry()} busy={navigation.isFetching}>
              Your company access could not be loaded.
            </LoadError>
          </Section>
        ) : navigation.isLoading && !showCompany ? (
          <Loading>Loading company access…</Loading>
        ) : null}
        {showCompany && <CompanyProfile />}
        <PersonalProfile />
        <AccountSettings />
      </Page>
    </PageTitle.Provider>
  );
}
