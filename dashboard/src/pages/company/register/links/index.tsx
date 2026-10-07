import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_LINK_COPY,
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
import { useWaitingWallets } from '../useRegisterLinks';
import { LinkForm } from './LinkForm';

const COPY = REGISTER_LINK_COPY;
const LEDE =
  "Link the wallets that completed issues and transfers wait for to the company's members. The authority document " +
  'is provided by the company.';

export default function CompanyRegisterLinksPage() {
  const { company = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnLinks
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company}`}
        company={company}
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

function OwnLinks({
  company,
  owner,
  currentOwner,
  back,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.filter((item) => item.companyUuid === company) ?? [];
  const appointment =
    listed.length > 0 && appointments.data
      ? appointmentForRegisterStep(appointments.data, company, 'prepare')
      : undefined;
  const registers = useQuery(registersQuery(owner, appointment ? listed.map(({ uuid }) => uuid) : []));
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
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (listed.length === 0)
    content = <p className="py-3 text-sm text-text-muted">This company is not in a register you can read.</p>;
  else if (!appointment) content = <p className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (!registers.data || !waiting.data)
    content = stale ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (waiting.data.length === 0) content = <p className="py-3 text-sm text-text-muted">{COPY.NOTHING_WAITING}</p>;
  else
    content = (
      <>
        <Section title={listed[0].companyName}>
          <p className="text-sm text-text-muted">{COPY.APPLY_NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && <Unavailable retry={retry} busy={fetching} />}
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
    <Page lede={LEDE} actions={back}>
      {content}
    </Page>
  );
}
