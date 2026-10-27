import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice, PreparationShell } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useLinkRegisters } from './useLinkRegisters';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { REGISTER_LINK_COPY, appointmentForRegisterStep, type OrderSubmissionOwner } from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { useRegisterClasses } from '@hooks/useRegisterClasses';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { useWaitingWallets } from '@pages/company/ledger/shared/useRegisterLinks';
import { LinkForm } from './LinkForm';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_LINK_COPY;
const LEDE =
  "Link the wallets that completed issues and transfers wait for to the company's members. The authority document " +
  'is provided by the company.';

export default function CompanyRegisterLinksPage() {
  const { company = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  if (owner && !preferences.isError)
    return (
      <OwnLinks
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company}`}
        company={company}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return <PreparationShell lede={LEDE} preferences={preferences} />;
}

function OwnLinks({
  company,
  owner,
  currentOwner,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.filter((item) => item.companyUuid === company) ?? [];
  const companyMatches = useRecordCompany(listed.length ? company : undefined, guard);
  const appointment =
    companyMatches && listed.length > 0 && appointments.data
      ? appointmentForRegisterStep(appointments.data, company, 'prepare')
      : undefined;
  const registers = useLinkRegisters(owner, appointment, listed, guard);
  const waiting = useWaitingWallets(owner, company, guard, {
    enabled: !!appointment,
    onMissing: () => void appointments.refetch(),
  });
  const reload = () => {
    void waiting.refetch();
    void registers.refetch();
  };
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (registers.isError) void registers.refetch();
    if (waiting.isError) void waiting.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || registers.isFetching || waiting.isFetching;
  const stale = classes.isError || appointments.isError || registers.isError || waiting.isError;
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (listed.length === 0 || !companyMatches)
    content = <p className="py-3 text-sm text-text-muted">This company is not in a register you can read.</p>;
  else if (!appointment)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!registers.data || !waiting.data)
    content = stale ? (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (waiting.data.length === 0) content = <p className="py-3 text-sm text-text-muted">{COPY.NOTHING_WAITING}</p>;
  else
    content = (
      <>
        <Section title={listed[0].companyName}>
          <p className="text-sm text-text-muted">{COPY.APPLY_NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && (
            <LoadError retry={retry} busy={fetching}>
              The register or your appointments could not be loaded.
            </LoadError>
          )}
          <LinkForm
            owner={owner}
            guard={guard}
            company={company}
            wallets={waiting.data}
            registers={registers.data}
            appointment={appointment}
            blocked={stale || fetching}
            onRefused={reload}
            onConflict={() => {
              reload();
              void appointments.refetch();
            }}
            onMissing={() => void appointments.refetch()}
          />
        </Section>
      </>
    );
  return (
    <Page narrow lede={LEDE} back={companyMatches ? registerPlace({ company, task: 'corrections' }) : undefined}>
      {content}
    </Page>
  );
}
