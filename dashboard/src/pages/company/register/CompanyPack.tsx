import { FIELD_LIMITS, type OrderSubmissionOwner } from '@ledova/shared';
import { Outcome, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import { useCompanyPackAuthority, useCompanyPack } from './useCompanyPack';

export function CompanyPack({
  owner,
  guard,
  company,
  sourceReady,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  sourceReady: boolean;
}) {
  const { appointments, appointment, check } = useCompanyPackAuthority({ owner, guard, company });
  return (
    <Section title="Company pack">
      <p className="text-sm text-text-muted">
        This company ZIP includes residential addresses and private records. Current company administration, a written
        instruction and a named recipient are required; the captured records and generation time are retained.
      </p>
      <details className="text-sm text-text-muted">
        <summary className="cursor-pointer">Included records and limitations</summary>
        <p className="mt-2">
          Packs include non-tokenised registers, employee awards and fully paid external allotments. Unsupported records
          make the whole archive unavailable; use supported inspection copies or unsigned certificates instead.
        </p>
      </details>
      {appointment ? (
        <PackForm
          key={JSON.stringify([company, appointment.uuid, sourceReady])}
          company={company}
          appointment={appointment.uuid}
          guard={check}
          sourceReady={sourceReady}
        />
      ) : (
        <p className="text-sm text-text-muted">A current administrator appointment for this company is required.</p>
      )}
      <PageAction
        label="Refresh pack appointment"
        disabled={appointments.isFetching || !sourceReady}
        onClick={() => void appointments.refetch()}
      />
    </Section>
  );
}

function PackForm({
  company,
  appointment,
  guard,
  sourceReady,
}: {
  company: string;
  appointment: string;
  guard: () => void;
  sourceReady: boolean;
}) {
  const { instruction, setInstruction, recipient, setRecipient, busy, error, downloaded, valid, download } =
    useCompanyPack({ company, appointment, guard, sourceReady });
  return (
    <div className="flex flex-col gap-3 pt-3">
      <fieldset disabled={busy || !sourceReady} className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-text-primary">
          Pack instruction reference
          <input
            className={FIELD_CLASS}
            maxLength={FIELD_LIMITS.REFERENCE}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <label className="block text-sm text-text-primary">
          Pack recipient
          <input
            className={FIELD_CLASS}
            maxLength={FIELD_LIMITS.NAME}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </label>
      </fieldset>
      <PageAction
        primary
        label="Prepare and download company pack"
        busy={busy}
        busyLabel="Preparing company pack…"
        disabled={!sourceReady || !valid}
        onClick={() => void download()}
      />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {downloaded && <Outcome>The company pack was downloaded.</Outcome>}
    </div>
  );
}
