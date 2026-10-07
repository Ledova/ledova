import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_GRANT_COPY as COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '../RegisterStatus';
import { registersQuery, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { GrantForm } from './GrantForm';

const LEDE =
  'Prepare a non-paid share grant on an opened register with the company’s terms, authority and any required acceptance.';

export default function CompanyRegisterGrantPage() {
  const { uuid = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnGrant
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
        uuid={uuid}
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
  const classes = useRegisterClasses(owner);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
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
  const busy = classes.isFetching || appointments.isFetching || registers.isFetching;
  const stale = classes.isError || appointments.isError || registers.isError;
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
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
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            token={uuid}
            members={members}
            appointment={appointment}
            blocked={stale || busy}
            onRefused={retry}
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
