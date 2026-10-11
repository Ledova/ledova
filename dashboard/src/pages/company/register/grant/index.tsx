import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { Loading, Unavailable } from '../RegisterStatus';
import { registersQuery, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { GrantForm } from './GrantForm';
import { useRegisterAward } from '../useRegisterAwards';
import { useTransferMembers } from '../useRegisterTransfers';

const LEDE =
  'Prepare a non-paid share grant on an opened register with the company’s terms, authority and any required acceptance.';

export default function CompanyRegisterGrantPage() {
  const { uuid = '' } = useParams();
  const [params] = useSearchParams();
  const awardUuid = params.get('award') || '';
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnGrant
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}/${awardUuid}`}
        uuid={uuid}
        awardUuid={awardUuid}
        owner={owner}
        currentOwner={boundary.get}
        back={back}
      />
    );
  return (
    <Page lede={LEDE} actions={back}>
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
  back,
}: {
  uuid: string;
  awardUuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner);
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
  const registers = useQuery(registersQuery(owner, companyClasses));
  const register = registers.data?.find((item) => item.token.uuid === uuid);
  const holders = registers.data?.flatMap((item) => item.holders) ?? [];
  const linked = new Set(holders.filter((holder) => holder.wallets.length > 0).map((holder) => holder.member));
  const members = [
    ...new Map(
      holders.filter((holder) => !linked.has(holder.member)).map((holder) => [holder.member, holder]),
    ).values(),
  ];
  const busy =
    classes.isFetching ||
    appointments.isFetching ||
    registers.isFetching ||
    (!!awardUuid && (award.isFetching || retainedMembers.isFetching));
  const stale =
    classes.isError ||
    appointments.isError ||
    registers.isError ||
    (!!awardUuid && (award.isError || retainedMembers.isError));
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
    if (awardUuid && readable) {
      void award.refetch();
      void retainedMembers.refetch();
    }
  };
  let content: ReactNode;
  if (!classes.data || !appointments.data) content = stale ? <Unavailable retry={retry} busy={busy} /> : <Loading />;
  else if (!listed)
    content = <p className="text-sm text-text-muted">This share class is not in a register you can read.</p>;
  else if (!appointment) content = <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (!register) content = stale ? <Unavailable retry={retry} busy={busy} /> : <Loading />;
  else if (!register.initialized || register.token.status !== 'draft')
    content = (
      <p className="text-sm text-text-muted">
        This grant requires an opened register for a draft share class without a deployed contract.
      </p>
    );
  else if (awardUuid && (!readable || !award.data || !retainedMembers.data))
    content = stale ? <Unavailable retry={retry} busy={busy} /> : <Loading />;
  else if (
    awardUuid &&
    ((awardMember && (!awardMember.walletless || !awardMember.particularsRetained)) ||
      (!awardMember && (!award.data!.newMember || BigInt(award.data!.issuedShares) > 0n)))
  )
    content = (
      <p className="text-sm text-text-muted">
        This award’s recipient needs current retained walletless particulars before a grant can be prepared.
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
          <GrantForm
            key={appointment.uuid}
            owner={owner}
            guard={awardUuid ? awardGuard : guard}
            company={listed.companyUuid}
            token={uuid}
            members={members}
            appointment={appointment}
            blocked={stale || busy}
            onRefused={retry}
            award={awardUuid ? award.data : undefined}
            awardMember={awardMember}
          />
        </Section>
      </>
    );
  return (
    <Page lede={LEDE} actions={back}>
      {content}
    </Page>
  );
}
