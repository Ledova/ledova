import type { ReactNode } from 'react';
import {
  DESTINATIONS,
  REGISTER_COPY,
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
import { ClassRegister } from './ClassRegister';
import { useCompanyRegister, useRegisterDownload } from './useCompanyRegister';

function RegisterPage({ selection, children }: { selection?: ReactNode; children: ReactNode }) {
  return (
    <Page lede="The stored register records your company's members and their shares; wallet balances do not replace it.">
      {selection}
      <Section title="Share classes">{children}</Section>
      <Section title="Register instructions">
        <p className="text-sm text-text-muted">
          The company owner submits written register instructions. Staff verify and apply them. Certificates, inspection
          copies, publications and the company pack are prepared by staff on written instruction.
        </p>
      </Section>
    </Page>
  );
}

function Loading() {
  return (
    <p role="status" className="py-3 text-sm text-text-muted">
      Loading your register…
    </p>
  );
}

function Unavailable({ retry, busy }: { retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-3">
      <p className="text-sm text-text-muted">We couldn&apos;t load the complete register.</p>
      <PageAction label="Try again" onClick={retry} disabled={busy} />
    </div>
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

export default function CompanyRegisterPage() {
  const { owner } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (owner && !preferences.isError)
    return <OwnRegister key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} />;
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

function OwnRegister({ owner }: { owner: OrderSubmissionOwner }) {
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
        <p className="py-3 text-sm text-text-muted">
          You have no company register to show. Share classes appear here for companies you own or where your current
          appointment lets you read the register.
        </p>
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
                <ClassRegister register={register} />
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
    </RegisterPage>
  );
}
