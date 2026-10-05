import { useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  ATTRIBUTION_DISCREPANCIES,
  formatDateTime,
  formatShareCount,
  REGISTER_RECONCILIATION_COPY as COPY,
  useDiscrepancyAcknowledgement,
  type RegisterDiscrepancy,
  type RegisterReconciliation,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from './styles';
import { useRegisterReconciliation } from './useCompanyRegister';

type Field = keyof typeof COPY.FIELDS;

const FIELDS = Object.keys(COPY.FIELDS) as Field[];
const COUNTS: Field[] = ['chain', 'expected'];

function Acknowledge({
  reconciliation,
  index,
  kind,
  appointment,
  epoch,
  name,
  onSettled,
  onRefused,
}: {
  reconciliation: RegisterReconciliation;
  index: number;
  kind: string;
  appointment: string;
  epoch: number;
  name: string;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const [opened, setOpened] = useState<string>();
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const acknowledgement = useDiscrepancyAcknowledgement(apiClient, reconciliation, {
    appointment,
    newKey: () => Crypto.randomUUID(),
    guard: () => assertSessionEpoch(epoch),
    requestConfig: () => ({ ledovaSessionEpoch: epoch }),
    onAcknowledged: () => {
      setOpened(undefined);
      return onSettled();
    },
    onRefused,
  });
  const { busy, error } = acknowledgement;
  const current = opened === appointment;
  const ready = !!reason.trim() && !busy && current;
  return (
    <>
      <Action
        label={COPY.ACKNOWLEDGE}
        accessibilityLabel={`${COPY.ACKNOWLEDGE} discrepancy ${index + 1} of ${name}`}
        disabled={busy}
        onPress={() => {
          setReason('');
          setAttempted(false);
          setOpened(appointment);
        }}
      />
      {opened && (
        <CustomModal
          visible
          title={`${COPY.ACKNOWLEDGE} discrepancy`}
          busy={busy}
          onClose={() => setOpened(undefined)}
          actions={
            <Action
              label={busy ? 'Recording…' : 'Confirm'}
              primary
              disabled={!ready}
              onPress={() => {
                if (!ready) return;
                setAttempted(true);
                void acknowledgement.acknowledge(index, reason.trim());
              }}
            />
          }
        >
          <View style={styles.group}>
            <Text style={styles.text}>{COPY.KINDS[kind] ?? kind}</Text>
            <Text style={styles.muted}>{COPY.ACKNOWLEDGEMENT_NOTE}</Text>
            <Text style={styles.text}>{COPY.ACKNOWLEDGE_REASON}</Text>
            <TextInput
              accessibilityLabel={COPY.ACKNOWLEDGE_REASON}
              style={styles.input}
              value={reason}
              editable={!busy}
              maxLength={1000}
              multiline
              onChangeText={setReason}
            />
            {attempted && error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {!current && (
              <Text accessibilityRole="alert" style={styles.error}>
                Your appointment for this step changed. Cancel and start this acknowledgement again.
              </Text>
            )}
          </View>
        </CustomModal>
      )}
    </>
  );
}

function Discrepancy({
  row,
  index,
  names,
  last,
  children,
}: {
  row: RegisterDiscrepancy;
  index: number;
  names: Map<string, string | null>;
  last: boolean;
  children: ReactNode;
}) {
  const styles = useCompanyStyles();
  const shown = FIELDS.filter((field) => row[field] !== undefined);
  const { acknowledgement } = row;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>Discrepancy {index + 1}</Text>
      <Text style={styles.text}>{COPY.KINDS[row.kind] ?? row.kind}</Text>
      {shown.length > 0 && (
        <Rows>
          {shown.map((field) => (
            <Row key={field} label={COPY.FIELDS[field]}>
              {field === 'member'
                ? names.get(String(row.member)) || String(row.member)
                : COUNTS.includes(field)
                  ? formatShareCount(String(row[field]))
                  : String(row[field])}
            </Row>
          ))}
        </Rows>
      )}
      {acknowledgement ? (
        <>
          <Text style={styles.muted}>{COPY.PROVIDED_BY[acknowledgement.providedBy] ?? acknowledgement.providedBy}</Text>
          <Rows>
            <Row label="Reason">{acknowledgement.reason}</Row>
            {acknowledgement.acknowledgedByName !== null && (
              <Row label="Acknowledged by">{acknowledgement.acknowledgedByName || 'Name not recorded'}</Row>
            )}
            <Row label="Acknowledged on">{formatDateTime(acknowledgement.acknowledgedAt)}</Row>
          </Rows>
        </>
      ) : ATTRIBUTION_DISCREPANCIES.includes(row.kind) ? (
        <Text style={styles.muted}>{COPY.ATTRIBUTION_NOTE}</Text>
      ) : (
        row.acknowledgeable && (
          <>
            <Text style={styles.muted}>{COPY.ACKNOWLEDGEABLE_NOTE}</Text>
            {children}
          </>
        )
      )}
    </View>
  );
}

export function ClassReconciliation({
  epoch,
  register,
  appointment,
  readOnly,
  refreshAppointments,
}: {
  epoch: number;
  register: TokenHoldersResponse;
  appointment?: string;
  readOnly: boolean;
  refreshAppointments: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const name = register.token.name;
  const reconciliation = useRegisterReconciliation(epoch, register.token.uuid);
  const names = new Map(register.holders.map((holder) => [holder.member, holder.name]));
  const settle = () => reconciliation.refetch();
  const refused = () => Promise.all([reconciliation.refetch(), refreshAppointments()]);
  const record = reconciliation.data;
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.TITLE}
      </Text>
      {readOnly && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {reconciliation.isPending ? (
        <Text style={styles.muted}>Loading the reconciliation…</Text>
      ) : reconciliation.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The reconciliation could not be loaded.
          </Text>
          <Action
            label="Retry the reconciliation"
            accessibilityLabel={`Retry the reconciliation for ${name}`}
            disabled={reconciliation.isFetching}
            onPress={() => void reconciliation.refetch()}
          />
        </View>
      ) : !record ? (
        <Text style={styles.muted}>{COPY.EMPTY}</Text>
      ) : (
        <>
          <Rows>
            <Row label="Status">{COPY.STATUSES[record.status]}</Row>
            <Row label="Chain block">{record.blockNumber === null ? 'Not recorded' : String(record.blockNumber)}</Row>
            <Row label="Register sequence compared">
              {record.registerSequence === null ? 'Not recorded' : String(record.registerSequence)}
            </Row>
            <Row label="Reconciled on">{formatDateTime(record.createdAt)}</Row>
          </Rows>
          {record.status === 'failed' && (
            <>
              <Text style={styles.text}>{COPY.FAILED_NOTE}</Text>
              {!!record.failure && <Text style={styles.muted}>{record.failure}</Text>}
            </>
          )}
          {record.discrepancies.map((row, index) => (
            <Discrepancy
              key={`${record.uuid}-${index}`}
              row={row}
              index={index}
              names={names}
              last={index === record.discrepancies.length - 1}
            >
              {appointment && (
                <Acknowledge
                  reconciliation={record}
                  index={index}
                  kind={row.kind}
                  appointment={appointment}
                  epoch={epoch}
                  name={name}
                  onSettled={settle}
                  onRefused={refused}
                />
              )}
            </Discrepancy>
          ))}
        </>
      )}
    </View>
  );
}
