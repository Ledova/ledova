import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type OrderSubmissionOwner,
  formatShareCount,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { Page, PageAction } from '@components/Page';
import { CompanySelection } from '../CompanySelection';
import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassAllotments } from './ClassAllotments';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from './ClassRegister';
import { ClassInspectionCopy } from './ClassInspectionCopy';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { RegisterLinks } from './RegisterLinks';
import { RegisterParticulars } from './RegisterParticulars';
import { Loading, Unavailable } from './RegisterStatus';
import { useCompanyRegister, useRegisterDownload } from './useCompanyRegister';
import { ownerGuard, useOwnAppointments } from './useRegisterImports';

const ON_CHAIN = ['deployed', 'paused'];

function RegisterPage({
  selection,
  sections,
  children,
}: {
  selection?: ReactNode;
  sections?: ReactNode;
  children: ReactNode;
}) {
  const { hash } = useLocation();
  const title = hash === '#awards' ? 'Employee awards' : hash === '#documents' ? 'Documents' : 'Register';
  return (
    <PageTitle.Provider value={title}>
      <Page
        lede={
          hash === '#awards'
            ? 'Record employee entitlements and vesting. Shares are issued through a separate company decision.'
            : hash === '#documents'
              ? 'Prepare permitted register copies, certificates and company packs.'
              : 'Company-recorded ownership and share issue decisions.'
        }
      >
        {selection}
        {children}
        {sections}
      </Page>
    </PageTitle.Provider>
  );
}

function RegisterDownload({ register }: { register: TokenHoldersResponse }) {
  const download = useRegisterDownload(register.token.uuid, register.token.symbol);
  return (
    <div className="flex flex-col items-start gap-2 border-b border-border-subtle py-3">
      <p className="text-sm text-text-muted">{REGISTER_COPY.PRIVACY_NOTE}</p>
      <PageAction
        label={REGISTER_COPY.DOWNLOAD}
        onClick={() => download.mutate()}
        disabled={!register.initialized || download.isPending}
      />
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {REGISTER_COPY.DOWNLOAD_FAILED}
        </p>
      )}
    </div>
  );
}

function RegisterMembers({
  owner,
  guard,
  register,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
}) {
  const appointments = useOwnAppointments(owner, guard);
  const prepare = appointments.isSuccess && !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  return <ClassRegister register={register} prepare={prepare} />;
}

export default function CompanyRegisterPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (owner && !preferences.isError)
    return (
      <OwnRegister key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
    );
  return (
    <RegisterPage>
      {preferences.isLoading ? (
        <Loading />
      ) : (
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
      )}
    </RegisterPage>
  );
}

function OwnRegister({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const { classes, companies, company, selectCompany, registers } = useCompanyRegister(owner);
  const client = useQueryClient();
  useUserPreferences();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const sourceReady =
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    !classes.isFetching &&
    !registers.isFetching;
  const [memberHeld, setMemberHeld] = useState(false);
  const { hash } = useLocation();
  const view = hash === '#awards' ? 'awards' : hash === '#documents' ? 'documents' : 'register';

  return (
    <RegisterPage
      selection={
        classes.isSuccess &&
        companies.length > 1 && (
          <CompanySelection
            read={{
              companies,
              companyUuid: company?.uuid,
              selectionBlocked: classes.isFetching || memberHeld,
              selectCompany,
            }}
          />
        )
      }
      sections={
        company &&
        classes.isSuccess &&
        registers.isSuccess && (
          <>
            <div hidden={view !== 'register'}>
              <details className="space-y-3 border-t border-border pt-4">
                <summary className="cursor-pointer text-base font-medium">Invite and manage member access</summary>
                <CompanyMemberAccess
                  key={`members/${company.uuid}`}
                  owner={owner}
                  guard={guard}
                  company={company.uuid}
                  registers={registers.data}
                  sourceReady={sourceReady}
                  onHeldChange={setMemberHeld}
                />
              </details>
              <details className="space-y-3 border-t border-border pt-4">
                <summary className="cursor-pointer text-base font-medium">Particulars and wallet links</summary>
                <RegisterParticulars owner={owner} guard={guard} company={company.uuid} registers={registers.data} />
                <RegisterLinks owner={owner} guard={guard} company={company.uuid} registers={registers.data} />
              </details>
              <details className="space-y-3 border-t border-border pt-4">
                <summary className="cursor-pointer text-base font-medium">Register guidance</summary>
                <p className="text-sm text-text-muted">
                  Company appointees prepare, approve and record supported changes. The stored register establishes
                  recorded ownership; wallet balances do not replace it. Share class settings retain empty-class
                  deployment and supported tokenised workflows. Importing holdings does not tokenise them. Outputs are
                  company-provided, and certificates are unsigned. Publications retain their existing staff workflow.
                </p>
              </details>
            </div>
            <div hidden={view !== 'documents'}>
              <CompanyPack owner={owner} guard={guard} company={company.uuid} sourceReady={sourceReady} />
            </div>
          </>
        )
      }
    >
      {classes.isPending ? (
        <Loading />
      ) : classes.isError || registers.isError ? (
        <Unavailable
          retry={() => {
            if (classes.isError) void classes.refetch();
            if (registers.isError) void registers.refetch();
          }}
          busy={classes.isFetching || registers.isFetching}
        />
      ) : companies.length === 0 ? (
        <p className="py-3 text-sm text-text-muted">{REGISTER_COPY.NO_REGISTER}</p>
      ) : !company ? (
        <p className="py-3 text-sm text-text-muted">Select a company to show its register.</p>
      ) : registers.isPending ? (
        <Loading />
      ) : (
        <ul className="space-y-6">
          {registers.data.map((register) => (
            <li key={register.token.uuid}>
              <Section title={`${register.token.name} · ${register.token.symbol}`}>
                <p className="text-sm text-text-muted">
                  {company.name} ·{' '}
                  {register.issuedSupply === null
                    ? 'Issued quantity not recorded'
                    : `${formatShareCount(register.issuedSupply)} issued shares`}{' '}
                  · {register.totalHolders} current members
                </p>
                <div hidden={view !== 'register'} className="space-y-5">
                  <RegisterMembers owner={owner} guard={guard} register={register} company={company.uuid} />
                  <ClassAllotments
                    key={`allotments/${company.uuid}/${register.token.uuid}`}
                    owner={owner}
                    guard={guard}
                    register={register}
                    company={company.uuid}
                    sourceReady={!classes.isFetching && !registers.isFetching}
                  />
                  <details className="space-y-3 border-t border-border-subtle pt-4">
                    <summary className="cursor-pointer text-sm font-medium">Other changes and register history</summary>
                    <LinkRow
                      to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                      label={DESTINATIONS.companyClass.title}
                    />
                    {ON_CHAIN.includes(register.token.status) && (
                      <ClassOpenings owner={owner} guard={guard} register={register} company={company.uuid} />
                    )}
                    <ClassImports owner={owner} guard={guard} token={register.token.uuid} company={company.uuid} />
                    <ClassTransfers owner={owner} guard={guard} register={register} company={company.uuid} />
                    <ClassCorrections
                      owner={owner}
                      guard={guard}
                      token={register.token.uuid}
                      company={company.uuid}
                      register={register}
                      sourceReady={sourceReady}
                    />
                    <ClassReconciliation
                      owner={owner}
                      guard={guard}
                      token={register.token.uuid}
                      company={company.uuid}
                      holders={register.holders}
                    />
                  </details>
                </div>
                <div hidden={view !== 'awards'} className="space-y-5">
                  <ClassAwards
                    key={`${company.uuid}/${register.token.uuid}`}
                    owner={owner}
                    guard={guard}
                    register={register}
                    company={company.uuid}
                    sourceReady={!classes.isFetching && !registers.isFetching}
                  />
                  <details className="space-y-3 border-t border-border-subtle pt-4">
                    <summary className="cursor-pointer text-sm font-medium">Non-paid share issues</summary>
                    <ClassGrants owner={owner} guard={guard} register={register} company={company.uuid} />
                  </details>
                </div>
                <div hidden={view !== 'documents'} className="space-y-5">
                  <RegisterDownload register={register} />
                  <ClassInspectionCopy
                    register={register}
                    guard={guard}
                    sourceReady={!classes.isFetching && !registers.isFetching}
                  />
                </div>
              </Section>
            </li>
          ))}
        </ul>
      )}
    </RegisterPage>
  );
}
