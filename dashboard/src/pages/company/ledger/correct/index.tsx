import { PreparationNotice, PreparationShell } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useCorrectionEntry } from './useCorrectionEntry';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  REGISTER_CORRECTION_COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
  type RegisterEntry,
} from '@ledova/shared';
import { Row, Rows, Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';
import { describeEntry } from '@pages/company/shared/proposals';

import { useRegisterClasses } from '@hooks/useRegisterClasses';

import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { CorrectionForm } from './CorrectionForm';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_CORRECTION_COPY;
const LEDE =
  "Prepare a correction that reverses one entry of a share class's register exactly. The authority document is " +
  'provided by the company.';

function inverseOf(entry: RegisterEntry) {
  return entry.changes.map((change) => ({ ...change, shares: (-BigInt(change.shares)).toString() }));
}

export default function CompanyRegisterCorrectionPage() {
  const { uuid = '', entry = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  if (owner && !preferences.isError)
    return (
      <OwnCorrection
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}/${entry}`}
        uuid={uuid}
        entry={entry}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return <PreparationShell lede={LEDE} preferences={preferences} />;
}

function OwnCorrection({
  uuid,
  entry,
  owner,
  currentOwner,
}: {
  uuid: string;
  entry: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const corrected = useCorrectionEntry(owner, uuid, entry, guard, appointment);
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (corrected.isError) void corrected.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || corrected.isFetching;
  const stale = classes.isError || appointments.isError || corrected.isError;
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
  else if (!listed) content = <PreparationNotice className="py-3 text-sm text-text-muted" />;
  else if (!appointment)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (corrected.data === undefined)
    content = corrected.isError ? (
      <LoadError retry={retry} busy={fetching}>
        The register could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
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
          {stale && (
            <LoadError retry={retry} busy={fetching}>
              The register or your appointments could not be loaded.
            </LoadError>
          )}
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
    <Page narrow lede={LEDE} back={registerPlace({ token: uuid, task: 'corrections' })}>
      {content}
    </Page>
  );
}
