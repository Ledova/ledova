import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, type OrderSubmissionOwner } from '@ledova/shared';
import { Outcome, Section, LoadError, Loading, ShowMore } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useCompanyPackAuthority, useCompanyPack } from './useCompanyPack';
import { CompanyPackHistory } from './OutputHistory';
import { companyPacksKey } from './useOutputHistory';

export function CompanyPack({
  owner,
  guard,
  company,
  sourceReady,
  onEditingChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
}) {
  const { appointments, appointment, check } = useCompanyPackAuthority({ owner, guard, company });
  const client = useQueryClient();
  return (
    <Section title="Company pack">
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : appointment ? (
        <>
          <CompanyPackHistory owner={owner} company={company} guard={check} enabled={sourceReady} />
          <PackForm
            key={JSON.stringify([company, appointment.uuid, sourceReady])}
            company={company}
            appointment={appointment.uuid}
            guard={check}
            sourceReady={sourceReady}
            onEditingChange={onEditingChange}
            onPrepared={() => void client.invalidateQueries({ queryKey: companyPacksKey(owner, company) })}
          />
        </>
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
  onEditingChange,
  onPrepared,
}: {
  company: string;
  appointment: string;
  guard: () => void;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
  onPrepared: () => void;
}) {
  const [open, setOpen] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const editingKey = `pack/${company}`;
  useEffect(() => {
    onEditingChange?.(editingKey, open);
    if (open) firstField.current?.focus();
    return () => onEditingChange?.(editingKey, false);
  }, [editingKey, onEditingChange, open]);
  const { instruction, setInstruction, recipient, setRecipient, busy, error, downloaded, problems, download } =
    useCompanyPack({ company, appointment, guard, sourceReady, onDownloaded: onPrepared });
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
    <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">New company pack</h3>
      <p className="text-sm text-text-muted">
        This company ZIP includes residential addresses and private records. Current company administration, a written
        instruction and a named recipient are required; the captured records and generation time are retained.
      </p>
      <ShowMore show="Show included records and limitations" hide="Hide included records and limitations">
        <div className="text-sm text-text-muted">
          <p className="mt-2">
            Packs include non-tokenised registers, employee awards and fully paid external allotments. Unsupported
            records make the whole archive unavailable; use supported inspection copies or unsigned certificates
            instead.
          </p>
        </div>
      </ShowMore>
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
