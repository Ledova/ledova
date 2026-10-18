import { useGrantRegisters } from './useGrantRegisters';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  DESTINATIONS,
  REGISTER_GRANT_COPY as COPY,
  appointmentForRegisterStep,
  hasCurrentRegisterReadAuthority,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { GrantForm } from './GrantForm';
import { useRegisterAward } from '@pages/company/register/shared/useRegisterAwards';
import { useTransferMembers } from '@pages/company/register/shared/useRegisterTransfers';

const LEDE =
  'Prepare a non-paid share grant on an opened register with the company’s terms, authority and any required acceptance.';

export default function CompanyRegisterGrantPage() {
  const { uuid = '' } = useParams();
  const [params] = useSearchParams();
  const awardUuid = params.get('award') || '';
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = (
    <PageAction
      label={awardUuid ? 'Back to Employee awards' : 'Back to Register'}
      onClick={() => navigate(`${DESTINATIONS.companyRegister.path}${awardUuid ? '#awards' : ''}`)}
    />
  );
  if (owner)
    return (
      <OwnGrant
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}/${awardUuid}`}
        uuid={uuid}
        awardUuid={awardUuid}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return (
    <Page narrow lede={LEDE} actions={back}>
      {preferences.isLoading ? (
        <Loading />
      ) : (
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
      )}
    </Page>
  );
}

function OwnGrant({
  uuid,
  awardUuid,
  owner,
  currentOwner,
}: {
  uuid: string;
  awardUuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const navigate = useNavigate();
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [held, setHeld] = useState(false);
  const preferences = useUserPreferences();
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const company = listed?.companyUuid || '';
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
  const awardGuard = useMemo(
    () => () => {
      guard();
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const award = useRegisterAward(owner, company, uuid, awardUuid, awardGuard, readable);
  const retainedMembers = useTransferMembers(owner, uuid, awardGuard, !!awardUuid && readable && !!appointment);
  const awardMember = retainedMembers.data?.find((row) => row.member === award.data?.member) ?? null;
  const companyClasses =
    classes.data?.filter((item) => item.companyUuid === listed?.companyUuid).map((item) => item.uuid) ?? [];
  const registers = useGrantRegisters(owner, companyClasses, guard);
  const register = registers.data?.find((item) => item.token.uuid === uuid);
  const holders = registers.data?.flatMap((item) => item.holders) ?? [];
  const linked = new Set(holders.filter((holder) => holder.wallets.length > 0).map((holder) => holder.member));
  const members = [
    ...new Map(
      holders.filter((holder) => !linked.has(holder.member)).map((holder) => [holder.member, holder]),
    ).values(),
  ];
  const busy =
    preferences.isFetching ||
    classes.isFetching ||
    appointments.isFetching ||
    registers.isFetching ||
    (!!awardUuid && (award.isFetching || retainedMembers.isFetching));
  const stale =
    preferences.isError ||
    classes.isError ||
    appointments.isError ||
    registers.isError ||
    (!!awardUuid && (award.isError || retainedMembers.isError));
  const retry = () => {
    void preferences.refetch();
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
    if (awardUuid && readable) {
      void award.refetch();
      void retainedMembers.refetch();
    }
  };
  const recipientReady =
    !awardUuid ||
    (readable &&
      award.isSuccess &&
      retainedMembers.isSuccess &&
      !(
        (awardMember && (!awardMember.walletless || !awardMember.particularsRetained)) ||
        (!awardMember && (!award.data.newMember || BigInt(award.data.issuedShares) > 0n))
      ));
  const readReady =
    !!listed && readable && !!register && (!awardUuid || (award.isSuccess && retainedMembers.isSuccess));
  const ready =
    readReady &&
    (!!formAppointment ||
      (!!appointment && register.initialized && register.token.status === 'draft' && recipientReady));
  const visible = ready && !stale && !busy;
  if (visible && appointment && (!formAppointment || (!held && formAppointment.uuid !== appointment.uuid)))
    setFormAppointment(appointment);
  let content: ReactNode;
  if (stale) content = <Unavailable retry={retry} busy={busy} />;
  else if (!classes.data || !appointments.data) content = <Loading />;
  else if (!listed)
    content = <p className="text-sm text-text-muted">This share class is not in a register you can read.</p>;
  else if (!appointment) content = <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (!register) content = <Loading />;
  else if (!register.initialized || register.token.status !== 'draft')
    content = (
      <p className="text-sm text-text-muted">
        This grant requires an opened register for a draft share class without a deployed contract.
      </p>
    );
  else if (awardUuid && (!readable || !award.data || !retainedMembers.data)) content = <Loading />;
  else if (!recipientReady)
    content = (
      <p className="text-sm text-text-muted">
        This award’s recipient needs current retained walletless particulars before a grant can be prepared.
      </p>
    );
  else
    content = visible ? (
      <Section title={listed.name}>
        <p className="text-sm text-text-muted">
          {listed.companyName} · {listed.symbol}
        </p>
        <p className="text-sm text-text-muted">
          {awardUuid
            ? 'Prepare the company’s issue of recorded vested shares. The employee does not purchase them; approval and recording the issue are separate steps.'
            : COPY.NOTE}
        </p>
      </Section>
    ) : (
      <Loading />
    );
  return (
    <Page
      narrow
      lede={LEDE}
      actions={
        <PageAction
          label={awardUuid ? 'Back to Employee awards' : 'Back to Register'}
          disabled={held}
          onClick={() => navigate(`${DESTINATIONS.companyRegister.path}${awardUuid ? '#awards' : ''}`)}
        />
      }
    >
      {content}
      {formAppointment && (
        <div hidden={!visible}>
          <Section title={awardUuid ? 'Issue vested shares' : COPY.PREPARE}>
            <GrantForm
              key={formAppointment.uuid}
              owner={owner}
              guard={awardUuid ? awardGuard : guard}
              company={company}
              token={uuid}
              members={members}
              appointment={formAppointment}
              blocked={!ready || stale || busy}
              visible={visible}
              onHeldChange={setHeld}
              canPrepare={
                !!register?.initialized &&
                register.token.status === 'draft' &&
                recipientReady &&
                !!appointmentForRegisterStep(
                  appointments.isSuccess ? appointments.data.filter((item) => item.uuid === formAppointment.uuid) : [],
                  company,
                  'prepare',
                )
              }
              onRefused={retry}
              award={awardUuid ? award.data : undefined}
              awardMember={awardMember}
            />
          </Section>
        </div>
      )}
    </Page>
  );
}
