import { Navigate, useLocation } from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner } from '@ledova/shared';
import { useState } from 'react';
import { Page } from '@components/Page';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { useUserProfile } from '@hooks/useUserProfile';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { CompanyRecordedDetails } from './CompanyRecordedDetails';
import { PersonalProfile } from './PersonalProfile';
import { CompanyProfile } from './CompanyProfile';
import { AccountSettings } from './AccountSettings';

export default function SettingsPage() {
  const { hash, search, state } = useLocation();
  if (hash !== '#profile')
    return <Navigate to={{ pathname: DESTINATIONS.settings.path, search, hash: '#profile' }} state={state} replace />;
  return <Profile />;
}

function Profile() {
  const navigation = useSettingsNavigation();
  const profile = useUserProfile();
  const context = useCompanyContext();
  const { owner } = useSubmissionOwner();
  const allowed = context ? !!context.company?.canManage : navigation.canManageCompany;
  const accessError = navigation.isError || context?.directory.hasError;
  const accessLoading = navigation.isLoading || context?.directory.isLoading || context?.directory.isRefreshing;
  const key = owner ? `${owner.userUuid}/${owner.ownerAccountUuid}/${context?.companyUuid ?? ''}` : null;
  const [admitted, setAdmitted] = useState<string | null>(null);
  if (allowed && admitted !== key) setAdmitted(key);
  if (admitted && (!key || (!allowed && !accessLoading && !accessError))) setAdmitted(null);
  const showCompany = allowed || (!!key && admitted === key && (accessLoading || accessError));
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
        ) : !showCompany && context && !!context.companyUuid && !context.company ? (
          <Section title="Company details">
            <CompanyContextNotice />
          </Section>
        ) : null}
        {showCompany && <CompanyProfile />}
        <PersonalProfile profile={profile} />
        {!!context?.company?.memberUuids.length && <CompanyRecordedDetails />}
        <AccountSettings profile={profile} />
      </Page>
    </PageTitle.Provider>
  );
}
