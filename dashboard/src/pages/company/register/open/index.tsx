import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_OPENING_COPY,
  apiErrorSentence,
  appointmentForRegisterStep,
  failureStatus,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '../RegisterStatus';
import { READ_TIMING, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { openingHoldersKey, readOpeningHolders } from '../useRegisterOpenings';
import { OpeningForm } from './OpeningForm';

const COPY = REGISTER_OPENING_COPY;
const LEDE =
  "Prepare an opening that records a share class's holdings on chain as its register's first entry. The authority " +
  'document is provided by the company.';
const REFUSED = 'This share class cannot be opened from the chain.';

function HoldersFailure({ error, retry, busy }: { error: unknown; retry: () => void; busy: boolean }) {
  if (failureStatus(error) !== 503) return <Unavailable retry={retry} busy={busy} />;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-3">
      <p className="text-sm text-text-muted">{COPY.HOLDERS_UNAVAILABLE}</p>
      <PageAction label="Try again" onClick={retry} disabled={busy} />
    </div>
  );
}

export default function CompanyRegisterOpeningPage() {
  const { uuid = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnOpening
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

function OwnOpening({
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
  const holders = useQuery({
    queryKey: openingHoldersKey(owner, uuid),
    enabled: !!appointment,
    queryFn: async () => {
      try {
        return await readOpeningHolders(uuid, guard);
      } catch (failure) {
        if (failureStatus(failure) === 404) void appointments.refetch();
        throw failure;
      }
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...READ_TIMING,
  });
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (holders.isError) void holders.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || holders.isFetching;
  const stale = classes.isError || appointments.isError || holders.isError;
  const failure = <HoldersFailure error={holders.error} retry={retry} busy={fetching} />;
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (!listed)
    content = <p className="py-3 text-sm text-text-muted">This share class is not in a register you can read.</p>;
  else if (!appointment) content = <p className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (failureStatus(holders.error) === 400)
    content = <p className="py-3 text-sm text-text-muted">{apiErrorSentence(holders.error, REFUSED, REFUSED)}</p>;
  else if (!holders.data) content = holders.isError ? failure : <Loading />;
  else
    content = (
      <>
        <Section title={listed.name}>
          <p className="text-sm text-text-muted">
            {listed.companyName} · {listed.symbol}
          </p>
          <Rows>
            <Row label="Holdings read at">
              {COPY.BOUNDARY_BLOCK(holders.data.block.number, holders.data.block.date)}
            </Row>
          </Rows>
          <p className="text-sm text-text-muted">{COPY.BOUNDARY_NOTE}</p>
          <p className="text-sm text-text-muted">{COPY.HOLDINGS_NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && failure}
          <OpeningForm
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            token={uuid}
            holders={holders.data}
            appointment={appointment}
            blocked={stale || fetching}
            onReload={() => void holders.refetch()}
            onConflict={() => {
              void holders.refetch();
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
