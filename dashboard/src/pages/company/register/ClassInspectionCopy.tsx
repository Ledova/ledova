import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, type TokenHoldersResponse } from '@ledova/shared';
import { Outcome, Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { useClassInspectionCopy } from './useClassInspectionCopy';

export function ClassInspectionCopy({
  register,
  guard,
  sourceReady,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
}) {
  return (
    <InspectionForm
      key={JSON.stringify([register, sourceReady])}
      register={register}
      guard={guard}
      sourceReady={sourceReady}
    />
  );
}

function InspectionForm({
  register,
  guard,
  sourceReady,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
}) {
  const { today, draft, setDraft, target, setTarget, busy, error, downloaded, valid, blocked, preview, download } =
    useClassInspectionCopy({ register, guard, sourceReady });
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">Inspection copy</h3>
      <p className="text-sm text-text-muted">
        Prepare an inspection CSV under your current company appointment. It includes residential addresses. The
        company&apos;s request and output provenance are retained.
      </p>
      <fieldset disabled={blocked || !!target} className="grid gap-4 sm:grid-cols-2">
        <Field label="Written instruction reference">
          <TextInput
            maxLength={FIELD_LIMITS.REFERENCE}
            value={draft.instruction}
            onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
          />
        </Field>
        <Field label="Recipient">
          <TextInput
            maxLength={FIELD_LIMITS.NAME}
            value={draft.recipient}
            onChange={(event) => setDraft({ ...draft, recipient: event.target.value })}
          />
        </Field>
        <Field label="Date of request (Sydney)">
          <TextInput
            type="date"
            max={today}
            value={draft.requestedOn}
            onChange={(event) => setDraft({ ...draft, requestedOn: event.target.value })}
          />
        </Field>
      </fieldset>
      {!target ? (
        <PageAction
          primary
          label="Preview inspection copy"
          busy={busy === 'preview'}
          busyLabel="Preparing preview…"
          disabled={blocked || !valid}
          onClick={() => void preview()}
        />
      ) : (
        <>
          <Rows>
            <Row label="Share class">{register.token.name}</Row>
            <Row label="Register sequence">{target.preview.registerSequence}</Row>
            <Row label="Instruction">{target.request.instruction}</Row>
            <Row label="Recipient">{target.request.recipient}</Row>
            <Row label="Request date">{target.request.requestedOn}</Row>
          </Rows>
          <div className="flex flex-wrap gap-2">
            <PageAction
              primary
              label="Confirm and download inspection copy"
              busy={busy === 'download'}
              busyLabel="Downloading inspection copy…"
              disabled={blocked}
              onClick={() => void download()}
            />
            <PageAction
              label="Refresh inspection preview"
              busy={busy === 'preview'}
              busyLabel="Refreshing…"
              disabled={blocked}
              onClick={() => void preview()}
            />
            <PageAction label="Edit request" disabled={blocked} onClick={() => setTarget(null)} />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {downloaded && <Outcome>The inspection copy was downloaded.</Outcome>}
    </div>
  );
}
