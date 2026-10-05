import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  ACKNOWLEDGEABLE_DISCREPANCIES,
  ATTRIBUTION_DISCREPANCIES,
  REGISTER_RECONCILIATION_COPY,
  appointmentForAcknowledgement,
  formatDateTime,
  formatShareCount,
  useDiscrepancyAcknowledgement,
  type OrderSubmissionOwner,
  type RegisterDiscrepancy,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows, Status, type Tone } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { ownAppointmentsKey } from '../team/appointments';
import { reconciliationKey, useLatestReconciliation } from './useRegisterCorrections';
import { useOwnAppointments } from './useRegisterImports';

type Holders = TokenHoldersResponse['holders'];
type Field = keyof typeof REGISTER_RECONCILIATION_COPY.FIELDS;

const COPY = REGISTER_RECONCILIATION_COPY;
const TONES: Record<string, Tone> = { matched: 'done', discrepant: 'waiting', failed: 'closed' };
const FIELDS = Object.keys(COPY.FIELDS) as Field[];
const TITLE = `${COPY.ACKNOWLEDGE} discrepancy`;
const CHANGED = 'The reconciliation or your appointment changed or could not be checked. Cancel and start again.';

function fieldValue(row: RegisterDiscrepancy, field: Field, holders: Holders) {
  const value = String(row[field]);
  if (field === 'member') return holders.find((holder) => holder.member === value)?.name || value;
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
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  holders: Holders;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const reconciliation = useLatestReconciliation(owner, token, guard);
  const record = reconciliation.isSuccess ? (reconciliation.data ?? undefined) : undefined;
  const acknowledger = appointments.isSuccess ? appointmentForAcknowledgement(appointments.data, company) : undefined;
  const [open, setOpen] = useState<{ record: string; index: number; appointment: string } | null>(null);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const refresh = async (keys: QueryKey[]) => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
  const acknowledgement = useDiscrepancyAcknowledgement(apiClient, record, {
    appointment: acknowledger?.uuid,
    newKey: () => crypto.randomUUID(),
    guard,
    requestConfig: () => ({ ledovaSubmissionGuard: guard }),
    onAcknowledged: async () => {
      setOpen(null);
      await refresh([reconciliationKey(owner, token)]);
    },
    onRefused: () => refresh([reconciliationKey(owner, token), ownAppointmentsKey(owner)]),
  });
  const row = open && record?.uuid === open.record ? record.discrepancies[open.index] : undefined;
  const current = !!open && !!row?.acknowledgeable && acknowledger?.uuid === open.appointment;
  const ready = current && !!reason.trim() && !acknowledgement.busy;
  const offered = (item: RegisterDiscrepancy) =>
    !!acknowledger && item.acknowledgeable && ACKNOWLEDGEABLE_DISCREPANCIES.includes(item.kind);
  const begin = (index: number) => {
    if (open || acknowledgement.busy || !record || !acknowledger) return;
    setReason('');
    setAttempted(false);
    setOpen({ record: record.uuid, index, appointment: acknowledger.uuid });
  };
  const close = () => {
    if (!acknowledgement.busy) setOpen(null);
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {appointments.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>Your appointments could not be loaded. Retry before acknowledging a discrepancy.</p>
          <PageAction
            label="Retry appointments"
            onClick={() => void appointments.refetch()}
            disabled={appointments.isFetching}
          />
        </div>
      ) : (
        appointments.isSuccess && !acknowledger && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {reconciliation.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading the reconciliation…
        </p>
      ) : reconciliation.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the reconciliation for this share class.</p>
          <PageAction
            label="Retry reconciliation"
            onClick={() => void reconciliation.refetch()}
            disabled={reconciliation.isFetching}
          />
        </div>
      ) : !record ? (
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
                        {item.acknowledgement.acknowledgedByName !== null && (
                          <Row label="Acknowledged by">{item.acknowledgement.acknowledgedByName || 'Not provided'}</Row>
                        )}
                        <Row label="Acknowledged on">{formatDateTime(item.acknowledgement.acknowledgedAt)}</Row>
                        <Row label={COPY.ACKNOWLEDGE_REASON}>{item.acknowledgement.reason}</Row>
                      </Rows>
                      <p className="text-sm text-text-muted">
                        {COPY.PROVIDED_BY[item.acknowledgement.providedBy] ?? item.acknowledgement.providedBy}
                      </p>
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
      <Modal
        isOpen={!!open}
        onClose={close}
        title={TITLE}
        showFooter
        confirmLabel={TITLE}
        confirmLoading={acknowledgement.busy}
        confirmDisabled={!ready}
        onConfirm={() => {
          if (!ready || !open) return;
          setAttempted(true);
          void acknowledgement.acknowledge(open.index, reason.trim());
        }}
        size="lg"
      >
        {open && (
          <div className="flex flex-col gap-3">
            {row && <Discrepancy row={row} holders={holders} />}
            <p className="text-sm text-text-muted">{COPY.ACKNOWLEDGEMENT_NOTE}</p>
            <label className="block space-y-1 text-sm text-text-primary">
              {COPY.ACKNOWLEDGE_REASON}
              <textarea
                className={FIELD_CLASS}
                rows={3}
                maxLength={1000}
                value={reason}
                disabled={acknowledgement.busy}
                onChange={(event) => {
                  setAttempted(false);
                  setReason(event.target.value);
                }}
              />
            </label>
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
        )}
      </Modal>
    </div>
  );
}
