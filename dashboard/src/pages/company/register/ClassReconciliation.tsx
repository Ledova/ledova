import { Field, TextArea } from '@components/Field';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  FIELD_LIMITS,
  ACKNOWLEDGEABLE_DISCREPANCIES,
  ATTRIBUTION_DISCREPANCIES,
  REGISTER_RECONCILIATION_COPY,
  appointmentForAcknowledgement,
  formatDateTime,
  hasCurrentRegisterReadAuthority,
  formatShareCount,
  shortReference,
  useDiscrepancyAcknowledgement,
  type OrderSubmissionOwner,
  type RegisterDiscrepancy,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows, Status, type Tone, LoadError, Loading } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';

import { reconciliationKey, useLatestReconciliation } from './useLatestReconciliation';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';

type Holders = TokenHoldersResponse['holders'];
type Field = keyof typeof REGISTER_RECONCILIATION_COPY.FIELDS;

const COPY = REGISTER_RECONCILIATION_COPY;
const TONES: Record<string, Tone> = { matched: 'done', discrepant: 'waiting', failed: 'closed' };
const FIELDS = Object.keys(COPY.FIELDS) as Field[];
const TITLE = `${COPY.ACKNOWLEDGE} discrepancy`;
const CHANGED = 'The reconciliation or your appointment changed or could not be checked. Cancel and start again.';

function inclusionDetail(value: string) {
  const message = value.match(
    /^(The completed (?:issue|transfer) )([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})( .+)$/i,
  );
  if (!message) return value;
  const [, prefix, source, detail] = message;
  const known =
    detail ===
      ' has no verified final chain inclusion. It requires operator attribution ' +
        'before a register boundary can represent or exclude it.' ||
    /^ was finally included in block \d+, after the captured boundary block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/.test(
      detail,
    ) ||
    /^ is not in the captured boundary's canonical history at block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/.test(
      detail,
    );
  return known ? `${prefix}${shortReference(source)}${detail}` : value;
}

function fieldValue(row: RegisterDiscrepancy, field: Field, holders: Holders) {
  const value = String(row[field]);
  if (field === 'member') return holders.find((holder) => holder.member === value)?.name || shortReference(value);
  if (field === 'source') return shortReference(value);
  if (field === 'detail') return inclusionDetail(value);
  return field === 'chain' || field === 'expected' ? formatShareCount(value) : value;
}

function Discrepancy({ row, holders }: { row: RegisterDiscrepancy; holders: Holders }) {
  const fields = FIELDS.filter((field) => row[field] !== undefined);
  return (
    <>
      <p className="text-sm text-text-primary">{COPY.KINDS[row.kind] ?? row.kind}</p>
      {fields.length > 0 && (
        <Rows>
          {fields.map((field) => (
            <Row key={field} label={COPY.FIELDS[field]}>
              <span className="break-all">{fieldValue(row, field, holders)}</span>
            </Row>
          ))}
        </Rows>
      )}
    </>
  );
}

export function ClassReconciliation({
  owner,
  guard,
  token,
  company,
  holders,
  status,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  holders: Holders;
  status: TokenHoldersResponse['token']['status'];
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const reconciliation = useLatestReconciliation(owner, token, guard);
  const record = reconciliation.isSuccess ? (reconciliation.data ?? undefined) : undefined;
  const acknowledger = appointments.isSuccess ? appointmentForAcknowledgement(appointments.data, company) : undefined;
  const [open, setOpen] = useState<{ record: string; index: number; appointment: string } | null>(null);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const privateReady =
    visible &&
    reconciliation.isSuccess &&
    reconciliation.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const available = useRef(privateReady);
  useLayoutEffect(() => {
    available.current = privateReady;
  }, [privateReady]);
  const check = () => {
    guard();
    if (!available.current) throw new Error('Refresh the current reconciliation and company appointment.');
  };
  const refresh = async (keys: QueryKey[]) => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
  const acknowledgement = useDiscrepancyAcknowledgement(record, {
    appointment: acknowledger?.uuid,
    newKey: () => crypto.randomUUID(),
    guard: check,
    requestConfig: () => ({ ledovaSubmissionGuard: check }),
    onAcknowledged: async () => {
      setOpen(null);
      await refresh([reconciliationKey(owner, token)]);
    },
    onRefused: () => refresh([reconciliationKey(owner, token), ownAppointmentsKey(owner)]),
  });
  const held = acknowledgement.busy || (!!open && attempted && !!acknowledgement.error);
  const heldUuid = open?.record ?? 'reconciliation';
  useEffect(() => {
    onHeldChange?.(token, heldUuid, held);
    return () => onHeldChange?.(token, heldUuid, false);
  }, [onHeldChange, token, heldUuid, held]);
  const row = open && record?.uuid === open.record ? record.discrepancies[open.index] : undefined;
  const current = !!open && !!row?.acknowledgeable && acknowledger?.uuid === open.appointment;
  const ready = privateReady && current && !acknowledgement.busy;
  const checks = useErrorSummary({ reason: !reason.trim() && 'Give the reason for acknowledging.' });
  const offered = (item: RegisterDiscrepancy) =>
    !!acknowledger && item.acknowledgeable && ACKNOWLEDGEABLE_DISCREPANCIES.includes(item.kind);
  const begin = (index: number) => {
    if (open || acknowledgement.busy || !record || !acknowledger) return;
    setReason('');
    setAttempted(false);
    checks.reset();
    setOpen({ record: record.uuid, index, appointment: acknowledger.uuid });
  };
  const close = () => setOpen(null);
  if (
    !visible ||
    (reconciliation.isSuccess &&
      reconciliation.fetchStatus === 'idle' &&
      !record &&
      !['deployed', 'paused'].includes(status) &&
      !open &&
      !held)
  )
    return null;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : (
        appointments.isSuccess && !acknowledger && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {reconciliation.isPending ? (
        <Loading>Loading the reconciliation…</Loading>
      ) : reconciliation.isError ? (
        <LoadError retry={() => reconciliation.refetch()} busy={reconciliation.isFetching}>
          The reconciliation could not be loaded.
        </LoadError>
      ) : !privateReady ? null : !record ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : (
        <>
          <Rows>
            <Row label="Status">
              <Status tone={TONES[record.status] ?? 'waiting'}>{COPY.STATUSES[record.status] ?? record.status}</Status>
            </Row>
            <Row label={COPY.FIELDS.block}>{record.blockNumber ?? 'Not recorded'}</Row>
            <Row label="Register sequence compared">{record.registerSequence ?? 'Not recorded'}</Row>
            <Row label="Reconciled on">{formatDateTime(record.createdAt)}</Row>
          </Rows>
          {record.status === 'failed' && (
            <>
              <p className="text-sm text-text-muted">{COPY.FAILED_NOTE}</p>
              {record.failure && <p className="break-words text-sm text-text-primary">{record.failure}</p>}
            </>
          )}
          {record.discrepancies.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {record.discrepancies.map((item, index) => (
                <li key={index} className="flex flex-col gap-2 py-4">
                  <Discrepancy row={item} holders={holders} />
                  {item.acknowledgement && (
                    <>
                      <Rows>
                        <Row label="Acknowledged by">{item.acknowledgement.acknowledgedByName || 'Not provided'}</Row>
                        <Row label="Acknowledged on">{formatDateTime(item.acknowledgement.acknowledgedAt)}</Row>
                        <Row label={COPY.ACKNOWLEDGE_REASON}>{item.acknowledgement.reason}</Row>
                      </Rows>
                      <p className="text-sm text-text-muted">{COPY.PROVIDED_BY}</p>
                    </>
                  )}
                  {ATTRIBUTION_DISCREPANCIES.includes(item.kind) && (
                    <p className="text-sm text-text-muted">{COPY.ATTRIBUTION_NOTE}</p>
                  )}
                  {offered(item) && (
                    <>
                      <p className="text-sm text-text-muted">{COPY.ACKNOWLEDGEABLE_NOTE}</p>
                      <PageAction
                        label={COPY.ACKNOWLEDGE}
                        context={`discrepancy ${index + 1}`}
                        disabled={acknowledgement.busy}
                        onClick={() => begin(index)}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {open && (
        <Modal
          isOpen={!!open}
          onClose={close}
          title={TITLE}
          showFooter
          confirmLabel={TITLE}
          busy={acknowledgement.busy}
          busyLabel="Recording acknowledgement…"
          confirmDisabled={!ready}
          onConfirm={() => {
            if (!ready || !open || !checks.check()) return;
            setAttempted(true);
            void acknowledgement.acknowledge(open.index, reason.trim());
          }}
          size="lg"
        >
          {privateReady ? (
            <div className="flex flex-col gap-3">
              <ErrorSummary {...checks.summary} />
              {row && <Discrepancy row={row} holders={holders} />}
              <p className="text-sm text-text-muted">{COPY.ACKNOWLEDGEMENT_NOTE}</p>
              <Field {...checks.field('reason')} label={COPY.ACKNOWLEDGE_REASON}>
                <TextArea
                  rows={3}
                  maxLength={FIELD_LIMITS.REASON}
                  value={reason}
                  disabled={acknowledgement.busy}
                  onChange={(event) => {
                    setAttempted(false);
                    setReason(event.target.value);
                  }}
                />
              </Field>
              {attempted && acknowledgement.error && (
                <p role="alert" className="text-sm text-error-light">
                  {acknowledgement.error}
                </p>
              )}
              {!current && (
                <p role="alert" className="text-sm text-error-light">
                  {CHANGED}
                </p>
              )}
            </div>
          ) : (
            <p role="alert" className="text-sm text-error-light">
              {CHANGED}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
