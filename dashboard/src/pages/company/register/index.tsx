import { useMemo, type ReactNode } from 'react';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  canOpen,
  useOpenRows,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Disclosure, LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { useRole } from '@hooks/useRole';
import { CompanySelection } from '../CompanySelection';
import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from './ClassRegister';
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
  return (
    <Page lede="The stored register records your company's members and their shares; wallet balances do not replace it.">
      {selection}
      <Section title="Share classes">{children}</Section>
      {sections}
      <Section title="Register instructions">
        <p className="text-sm text-text-muted">
          Company appointees run the supported register commands above. Other tokenised register instructions are
          submitted by the company owner. Staff verify and apply them. Certificates, inspection copies, publications and
          the company pack are prepared by staff on written instruction.
        </p>
      </Section>
    </Page>
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
  const rows = useOpenRows();
  const { role } = useRole();
  const classPages = canOpen(role, DESTINATIONS.companyClass.audience);

  return (
    <RegisterPage
      selection={
        classes.isSuccess &&
        companies.length > 1 && (
          <CompanySelection
            read={{ companies, companyUuid: company?.uuid, selectionBlocked: classes.isFetching, selectCompany }}
          />
        )
      }
      sections={
        company &&
        classes.isSuccess &&
        registers.isSuccess && (
          <>
            <RegisterParticulars owner={owner} guard={guard} company={company.uuid} registers={registers.data} />
            <RegisterLinks owner={owner} guard={guard} company={company.uuid} registers={registers.data} />
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
        <ul className="divide-y divide-border">
          {registers.data.map((register) => (
            <li key={register.token.uuid}>
              <Disclosure
                open={rows.isOpen(register.token.uuid)}
                onToggle={() => rows.toggle(register.token.uuid)}
                summary={
                  <span className="flex flex-wrap items-start justify-between gap-3">
                    <span className="min-w-0 flex-1 basis-40 break-words">
                      <span className="block text-sm text-text-muted">{company.name}</span>
                      <span className="block text-base text-text-primary">{register.token.name}</span>
                    </span>
                    <span className="ml-auto text-sm text-text-muted">{register.token.symbol}</span>
                  </span>
                }
              >
                {classPages && (
                  <div className="border-b border-border-subtle">
                    <LinkRow
                      to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                      label={DESTINATIONS.companyClass.title}
                    />
                  </div>
                )}
                <RegisterDownload register={register} />
                <RegisterMembers owner={owner} guard={guard} register={register} company={company.uuid} />
                {ON_CHAIN.includes(register.token.status) && (
                  <ClassOpenings owner={owner} guard={guard} register={register} company={company.uuid} />
                )}
                <ClassImports owner={owner} guard={guard} token={register.token.uuid} company={company.uuid} />
                <ClassGrants owner={owner} guard={guard} register={register} company={company.uuid} />
                <ClassCorrections owner={owner} guard={guard} token={register.token.uuid} company={company.uuid} />
                <ClassReconciliation
                  owner={owner}
                  guard={guard}
                  token={register.token.uuid}
                  company={company.uuid}
                  holders={register.holders}
                />
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
    </RegisterPage>
  );
}
