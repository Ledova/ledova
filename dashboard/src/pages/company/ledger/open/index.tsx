import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice, PreparationShell } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useOpeningHolders } from './useOpeningHolders';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  REGISTER_OPENING_COPY,
  apiErrorSentence,
  appointmentForRegisterStep,
  failureStatus,
  formatDate,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Row, Rows, Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';

import { useRegisterClasses } from '@hooks/useRegisterClasses';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

import { OpeningForm } from './OpeningForm';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_OPENING_COPY;
const LEDE =
  "Prepare an opening that records a share class's holdings on chain as its register's first entry. The authority " +
  'document is provided by the company.';
const REFUSED = 'This share class cannot be opened from the chain.';

function HoldersFailure({ error, retry, busy }: { error: unknown; retry: () => void; busy: boolean }) {
  return (
    <LoadError retry={retry} busy={busy}>
      {failureStatus(error) === 503
        ? COPY.HOLDERS_UNAVAILABLE
        : 'The register or your appointments could not be loaded.'}
    </LoadError>
  );
}

export default function CompanyRegisterOpeningPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  if (owner && !preferences.isError)
    return (
      <OwnOpening
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
        uuid={uuid}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return <PreparationShell lede={LEDE} preferences={preferences} />;
}

function OwnOpening({
  uuid,
  owner,
  currentOwner,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const companyMatches = useRecordCompany(listed?.companyUuid, guard);
  const appointment =
    companyMatches && listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const holders = useOpeningHolders(owner, uuid, guard, appointment, appointments);
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
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (!listed || !companyMatches) content = <PreparationNotice className="py-3 text-sm text-text-muted" />;
  else if (!appointment)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (failureStatus(holders.error) === 400)
    content = <p className="py-3 text-sm text-text-muted">{apiErrorSentence(holders.error, REFUSED, REFUSED)}</p>;
  else if (!holders.data) content = holders.isError ? failure : <Loading>Loading the register…</Loading>;
  else
    content = (
      <>
        <Section title={listed.name}>
          <p className="text-sm text-text-muted">{listed.symbol}</p>
          <Rows>
            <Row label={COPY.HOLDINGS_READ_ON}>{formatDate(holders.data.block.date)}</Row>
          </Rows>
          <p className="text-sm text-text-muted">{COPY.BOUNDARY_NOTE}</p>
          <p className="text-sm text-text-muted">{COPY.HOLDINGS_NOTE}</p>
        </Section>
        <Section title="Open this ledger">
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
    <Page
      narrow
      lede={LEDE}
      back={
        companyMatches ? registerPlace({ company: listed?.companyUuid, token: uuid, task: 'corrections' }) : undefined
      }
    >
      {content}
    </Page>
  );
}
