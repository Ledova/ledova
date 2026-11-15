import { useEffect, useId, useRef, useState } from 'react';
import { REGISTER_CLASS_TYPES, type CompanyShareToken } from '@ledova/shared';
import { Field, TextInput } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { Failure, Outcome, Row, Rows, Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { Modal, ModalActions } from '@components/Modal';
import type { useClassDetails } from './useClassDetails';

type Details = ReturnType<typeof useClassDetails>;
type ClassDetailsProps = { token: CompanyShareToken; details: Details; available: boolean };

function ClassDetailsEditor({ details, available }: { details: Details; available: boolean }) {
  const name = useRef<HTMLInputElement>(null);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => name.current?.focus(), []);
  const editor = details.editor!;
  const draft = editor.draft;
  const nameError = !draft.name.trim() ? 'Enter the class name.' : undefined;
  const codeError = !/^[A-Z]{1,5}$/.test(draft.symbol) ? 'Enter a class code of 1–5 letters.' : undefined;
  const unchanged =
    draft.name.trim() === editor.target.name &&
    draft.symbol === editor.target.symbol &&
    draft.tokenType === editor.target.tokenType;
  const locked = details.busy || details.pending || !available;
  return (
    <form
      aria-label="Edit class details"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (details.pending) void details.recover();
        else if (!nameError && !codeError && !unchanged) void details.save();
      }}
    >
      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <Field label="Class name" error={attempted ? nameError : undefined}>
          <TextInput
            ref={name}
            value={draft.name}
            maxLength={100}
            onChange={(event) => details.setEditor({ ...editor, draft: { ...draft, name: event.target.value } })}
          />
        </Field>
        <Field label="Class code" error={attempted ? codeError : undefined}>
          <TextInput
            value={draft.symbol}
            maxLength={5}
            onChange={(event) =>
              details.setEditor({ ...editor, draft: { ...draft, symbol: event.target.value.toUpperCase() } })
            }
          />
        </Field>
        <SelectField
          label="Class type"
          options={REGISTER_CLASS_TYPES.map(([value, label]) => ({ value, label }))}
          value={draft.tokenType}
          onChange={(value) =>
            details.setEditor({ ...editor, draft: { ...draft, tokenType: value as typeof draft.tokenType } })
          }
        />
      </fieldset>
      <Failure>{details.error}</Failure>
      <FormActions>
        <PageAction label="Cancel" onClick={details.close} disabled={details.busy || details.pending} />
        <PageAction
          type="submit"
          primary
          label={details.pending ? (details.retry ? 'Retry original save' : 'Check original save') : 'Save'}
          busy={details.busy}
          disabled={!available || (!details.pending && unchanged)}
          busyLabel={details.pending ? 'Checking…' : 'Saving…'}
        />
      </FormActions>
    </form>
  );
}

export function ClassDetails(props: ClassDetailsProps) {
  return (
    <Section title="Class details">
      <ClassDetailsContent {...props} />
    </Section>
  );
}

export function ClassDetailsContent({ token, details, available }: ClassDetailsProps) {
  const edit = useRef<HTMLButtonElement>(null);
  const deletionReasonId = useId();
  const wasEditing = useRef(false);
  useEffect(() => {
    if (details.editor) wasEditing.current = true;
    else if (wasEditing.current && available) {
      edit.current?.focus();
      wasEditing.current = false;
    }
  }, [details.editor, available]);
  const target = details.deleting;
  const currentDelete = available && target?.updatedAt === token.updatedAt && token.canDelete;
  return (
    <>
      {details.editor ? (
        <ClassDetailsEditor details={details} available={available} />
      ) : (
        <div className="space-y-4">
          <Rows>
            <Row label="Class name" inline>
              {token.name}
            </Row>
            <Row label="Class code" inline>
              {token.symbol}
            </Row>
            <Row label="Class type" inline>
              {token.tokenTypeDisplay}
            </Row>
          </Rows>
          {token.deletionBlockedReason && (
            <p id={deletionReasonId} className="text-sm text-text-muted">
              {token.deletionBlockedReason}
            </p>
          )}
          {(token.canDelete || token.deletionBlockedReason || token.canEditDetails) && (
            <FormActions>
              {(token.canDelete || token.deletionBlockedReason) && (
                <PageAction
                  label="Delete"
                  context="share class"
                  destructive
                  describedBy={token.deletionBlockedReason ? deletionReasonId : undefined}
                  disabled={!available || details.held || !token.canDelete}
                  onClick={() => details.open('delete')}
                />
              )}
              {token.canEditDetails && (
                <PageAction
                  ref={edit}
                  label="Edit"
                  context="Class details"
                  disabled={!available || details.held}
                  onClick={() => details.open('edit')}
                />
              )}
            </FormActions>
          )}
          <Outcome>{details.outcome}</Outcome>
          {!target && <Failure>{details.error}</Failure>}
        </div>
      )}
      <Modal
        isOpen={!!target && available}
        onClose={details.close}
        title={`Delete ${target?.name ?? 'share class'}?`}
        size="sm"
      >
        <p className="text-sm text-text-primary">
          Delete {target?.name} ({target?.symbol}) from active share classes? Abandoned setup drafts and audit history
          are kept.
        </p>
        <Failure>{details.error}</Failure>
        <ModalActions>
          <PageAction label="Cancel" disabled={details.busy || details.pending} onClick={details.close} />
          <PageAction
            label={
              details.pending ? (details.retry ? 'Retry original deletion' : 'Check original deletion') : 'Delete class'
            }
            destructive
            disabled={!available || (!details.pending && !currentDelete)}
            busy={details.busy}
            busyLabel={details.pending ? 'Checking…' : 'Deleting…'}
            onClick={() => void (details.pending ? details.recover() : details.remove())}
          />
        </ModalActions>
      </Modal>
    </>
  );
}
