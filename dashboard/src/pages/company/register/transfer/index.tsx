import { PreparationBack, PreparationNotice, PreparationShell } from '@pages/company/register/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/register/shared/useRegisterPreparationOwner';
import { useTransferRegister } from './useTransferRegister';
import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page } from '@components/Page';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@pages/company/shared/useOwnAppointments';
import { useTransferMembers } from '@pages/company/register/shared/useRegisterTransfers';
import { TransferForm } from './TransferForm';

const LEDE =
  'Prepare a non-paid transfer with the company’s director authority and a genuine signed transfer instrument.';

export default function CompanyRegisterTransferPage() {
  const { uuid = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  const back = <PreparationBack onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnTransfer
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
        uuid={uuid}
        owner={owner}
        currentOwner={boundary.get}
        back={back}
      />
    );
  return <PreparationShell lede={LEDE} actions={back} preferences={preferences} />;
}

function OwnTransfer({
  uuid,
  owner,
  currentOwner,
  back,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
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
  const members = useTransferMembers(owner, uuid, guard, !!appointment);
  const busy = classes.isFetching || appointments.isFetching || registers.isFetching || members.isFetching;
  const stale = classes.isError || appointments.isError || registers.isError || members.isError;
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
    void members.refetch();
  };
  let content: ReactNode;
  if (!classes.data || !appointments.data) content = stale ? <Unavailable retry={retry} busy={busy} /> : <Loading />;
  else if (!listed) content = <PreparationNotice />;
  else if (!appointment) content = <PreparationNotice>{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!register || !members.data) content = stale ? <Unavailable retry={retry} busy={busy} /> : <Loading />;
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
          {stale && <Unavailable retry={retry} busy={busy} />}
          <TransferForm
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            token={uuid}
            members={members.data}
            appointment={appointment}
            blocked={stale || busy}
            onRefused={retry}
          />
        </Section>
      </>
    );
  return (
    <Page narrow lede={LEDE} actions={back}>
      {content}
    </Page>
  );
}
