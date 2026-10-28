import { useEffect, useRef, useState } from 'react';
import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, type OrderSubmissionOwner } from '@ledova/shared';
import { Outcome, Section, LoadError, Loading, Disclosure } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
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
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : appointment ? (
        <PackForm
          key={JSON.stringify([company, appointment.uuid, sourceReady])}
          company={company}
          appointment={appointment.uuid}
          guard={check}
          sourceReady={sourceReady}
        />
      ) : appointments.isSuccess && !appointments.isFetching ? (
        <p className="text-sm text-text-muted">A current administrator appointment for this company is required.</p>
      ) : (
        <Loading>Loading your appointments…</Loading>
      )}
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
  const [open, setOpen] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);
  const { instruction, setInstruction, recipient, setRecipient, busy, error, downloaded, problems, download } =
    useCompanyPack({ company, appointment, guard, sourceReady });
  const checks = useErrorSummary(problems);
  if (!open)
    return (
      <FormActions>
        <PageAction
          ref={opener}
          label="Prepare company pack"
          disabled={busy || !sourceReady}
          onClick={() => setOpen(true)}
        />
      </FormActions>
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        This company ZIP includes residential addresses and private records. Current company administration, a written
        instruction and a named recipient are required; the captured records and generation time are retained.
      </p>
      <Disclosure summary="Included records and limitations">
        <div className="text-sm text-text-muted">
          <p className="mt-2">
            Packs include non-tokenised registers, employee awards and fully paid external allotments. Unsupported
            records make the whole archive unavailable; use supported inspection copies or unsigned certificates
            instead.
          </p>
        </div>
      </Disclosure>
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={busy || !sourceReady} className="grid gap-4 sm:grid-cols-2">
        <Field {...checks.field('instruction')} label="Pack instruction reference">
          <TextInput
            ref={firstField}
            maxLength={FIELD_LIMITS.REFERENCE}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </Field>
        <Field {...checks.field('recipient')} label="Pack recipient">
          <TextInput
            maxLength={FIELD_LIMITS.NAME}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </Field>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Outcome>{downloaded && 'The company pack was downloaded.'}</Outcome>
      <FormActions>
        <PageAction
          label="Cancel"
          context="company pack"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        />
        <PageAction
          primary
          label="Prepare and download company pack"
          busy={busy}
          busyLabel="Preparing company pack…"
          disabled={!sourceReady}
          onClick={() => {
            if (checks.check()) void download();
          }}
        />
      </FormActions>
    </div>
  );
}
