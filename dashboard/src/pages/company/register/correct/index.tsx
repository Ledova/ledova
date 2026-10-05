import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type RegisterEntry,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { RegisterChanges } from '../RegisterChanges';
import { Loading, Unavailable } from '../RegisterStatus';
import { describeEntry } from '../proposals';
import { READ_TIMING, useRegisterClasses } from '../useCompanyRegister';
import { entriesKey, readClassEntry } from '../useRegisterCorrections';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { CorrectionForm } from './CorrectionForm';

const COPY = REGISTER_CORRECTION_COPY;
const LEDE =
  "Prepare a correction that reverses one entry of a share class's register exactly. The authority document is " +
  'provided by the company.';

function inverseOf(entry: RegisterEntry) {
  return entry.changes.map((change) => ({ ...change, shares: (-BigInt(change.shares)).toString() }));
}

export default function CompanyRegisterCorrectionPage() {
  const { uuid = '', entry = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnCorrection
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}/${entry}`}
        uuid={uuid}
        entry={entry}
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

function OwnCorrection({
  uuid,
  entry,
  owner,
  currentOwner,
  back,
}: {
  uuid: string;
  entry: string;
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
  const corrected = useQuery({
    queryKey: [...entriesKey(owner, uuid), entry],
    enabled: !!appointment,
    queryFn: () => readClassEntry(uuid, entry, guard),
    ...READ_TIMING,
  });
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (corrected.isError) void corrected.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || corrected.isFetching;
  const stale = classes.isError || appointments.isError || corrected.isError;
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (!listed)
    content = <p className="py-3 text-sm text-text-muted">This share class is not in a register you can read.</p>;
  else if (!appointment) content = <p className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (corrected.data === undefined)
    content = corrected.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (corrected.data === null)
    content = <p className="py-3 text-sm text-text-muted">This entry is not in the register of this share class.</p>;
  else if (!corrected.data.correctable)
    content = (
      <p className="py-3 text-sm text-text-muted">
        {corrected.data.correctedBy
          ? COPY.CORRECTED_NOTE
          : 'This entry records no change, so there is nothing to correct.'}
      </p>
    );
  else
    content = (
      <>
        <Section title={listed.name}>
          <p className="text-sm text-text-muted">
            {listed.companyName} · {listed.symbol}
          </p>
          <Rows>
            <Row label={COPY.ORIGINAL_CHANGES}>
              <span className="block">{describeEntry(corrected.data)}</span>
              <RegisterChanges changes={corrected.data.changes} />
            </Row>
            <Row label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={inverseOf(corrected.data)} />
            </Row>
          </Rows>
          <p className="text-sm text-text-muted">{COPY.COMPENSATION_NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && <Unavailable retry={retry} busy={fetching} />}
          <CorrectionForm
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            token={uuid}
            entry={corrected.data}
            appointment={appointment}
            blocked={stale}
            onConflict={() => {
              void corrected.refetch();
              void appointments.refetch();
            }}
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
