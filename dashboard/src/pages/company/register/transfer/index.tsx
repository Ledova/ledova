import { PreparationNotice, PreparationShell } from '@pages/company/register/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/register/shared/useRegisterPreparationOwner';
import { useTransferRegister } from './useTransferRegister';
import { useMemo, type ReactNode } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
  peopleFrom,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { usePeople } from '@pages/company/register/shared/usePeople';
import { TransferForm } from './TransferForm';
import { registerPlace } from '@pages/company/register/shared/registerPlace';
import { shareholderPath } from '@pages/company/register/shared/shareholders';

const LEDE =
  'Prepare a non-paid transfer with the company’s director authority and a genuine signed transfer instrument.';

export default function CompanyRegisterTransferPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  if (owner && !preferences.isError)
    return (
      <OwnTransfer
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
        uuid={uuid}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return <PreparationShell lede={LEDE} preferences={preferences} />;
}

function OwnTransfer({
  uuid,
  owner,
  currentOwner,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const { state } = useLocation();
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const registers = useTransferRegister(owner, uuid, listed, guard);
  const register = registers.data?.[0];
  const members = usePeople(owner, uuid, guard, !!appointment);
  const busy = classes.isFetching || appointments.isFetching || registers.isFetching || members.isFetching;
  const fromMember = typeof state?.fromMember === 'string' ? state.fromMember : '';
  const fromName = peopleFrom(members.data).find((person) => person.member === fromMember)?.name;
  const back =
    fromMember && listed
      ? {
          to: shareholderPath(fromMember, listed.companyUuid),
          label: `Back to ${fromName || DESTINATIONS.companyShareholder.title}`,
        }
      : registerPlace({ company: listed?.companyUuid, token: uuid, task: 'transfer' });
  const stale = classes.isError || appointments.isError || registers.isError || members.isError;
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
    void members.refetch();
  };
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = stale ? (
      <LoadError retry={retry} busy={busy}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (!listed) content = <PreparationNotice />;
  else if (!appointment) content = <PreparationNotice>{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!register || !members.data)
    content = stale ? (
      <LoadError retry={retry} busy={busy}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (!register.initialized || register.token.status !== 'draft')
    content = (
      <p className="text-sm text-text-muted">
        This transfer requires an opened register for a draft share class without a deployed contract.
      </p>
    );
  else
    content = (
      <>
        <Section title={listed.name}>
          <p className="text-sm text-text-muted">
            {listed.companyName} · {listed.symbol}
          </p>
          <p className="text-sm text-text-muted">{COPY.NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && (
            <LoadError retry={retry} busy={busy}>
              The register or your appointments could not be loaded.
            </LoadError>
          )}
          <TransferForm
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            token={uuid}
            people={peopleFrom(members.data)}
            appointment={appointment}
            blocked={stale || busy}
            onRefused={retry}
            initialFrom={fromMember}
          />
        </Section>
      </>
    );
  return (
    <Page narrow lede={LEDE} back={back}>
      {content}
    </Page>
  );
}
