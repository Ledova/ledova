import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  formatShareCount,
  REGISTER_IMPORT_COPY,
  registerImportTotals,
  type OwnCompanyAppointment,
  type RegisterImport,
  type RegisterImportDecisionKind,
  type RegisterImportStep,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EXTENSION_BY_MIME_TYPE, shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { ImportDecision } from './ImportDecision';
import { useCompanyStyles } from './styles';

const DECISION_KINDS: RegisterImportDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterImportDecisionKind, string> = {
  approve: REGISTER_IMPORT_COPY.STAGES.approved,
  apply: REGISTER_IMPORT_COPY.STAGES.applied,
  reject: REGISTER_IMPORT_COPY.STAGES.rejected,
};

function ImportCopy({
  uuid,
  copy,
  epoch,
  description,
}: {
  uuid: string;
  copy: 'register' | 'asic';
  epoch: number;
  description: string;
}) {
  const styles = useCompanyStyles();
  const label = copy === 'asic' ? REGISTER_IMPORT_COPY.DOWNLOAD_ASIC : REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER;
  const share = useMutation({
    mutationFn: async () => {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await shareDocumentCopy(
        epoch,
        async () => {
          const response =
            copy === 'asic'
              ? await apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_ASIC_FILE(uuid), {
                  responseType: 'arraybuffer',
                  ledovaSessionEpoch: epoch,
                })
              : await apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE(uuid), {
                  responseType: 'arraybuffer',
                  ledovaSessionEpoch: epoch,
                });
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${copy === 'asic' ? 'asic-extract' : 'register'}-${uuid}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] }),
      );
    },
  });
  return (
    <>
      <Action
        label={label}
        accessibilityLabel={`${label} of the ${description}`}
        disabled={share.isPending}
        onPress={() => share.mutate()}
      />
      {share.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The document could not be opened. Try again.
        </Text>
      )}
    </>
  );
}

export function ImportRecord({
  proposal,
  epoch,
  steps,
  last,
  onSettled,
  onRefused,
}: {
  proposal: RegisterImport;
  epoch: number;
  steps?: Record<RegisterImportStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const totals = registerImportTotals(proposal.members);
  const kinds: RegisterImportDecisionKind[] = proposal.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage;
  const description = `${stage.toLowerCase()} import as at ${formatDate(proposal.asAt)}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · as at {formatDate(proposal.asAt)}
      </Text>
      <Text style={styles.muted}>
        {proposal.providedBy === 'company'
          ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
          : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
      </Text>
      <Rows>
        {proposal.preparedByName !== null && (
          <Row label="Prepared by">{proposal.preparedByName || 'Name not recorded'}</Row>
        )}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        {proposal.decisions.map((decision) => (
          <Row key={decision.uuid} label={DECIDED[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!proposal.rejectionReason && <Row label="Rejection reason">{proposal.rejectionReason}</Row>}
      </Rows>
      {proposal.asicIssuedTotal !== null && proposal.asicMemberCount !== null && (
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(proposal.asicIssuedTotal), proposal.asicMemberCount)}
        </Text>
      )}
      <Text style={styles.text}>
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
      </Text>
      <ImportCopy uuid={proposal.uuid} copy="register" epoch={epoch} description={description} />
      {!!proposal.asicSnapshot && (
        <ImportCopy uuid={proposal.uuid} copy="asic" epoch={epoch} description={description} />
      )}
      {proposal.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {kinds.map((kind) => {
            const appointment = steps[kind];
            return (
              appointment && (
                <ImportDecision
                  key={kind}
                  proposal={proposal}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onRefused}
                />
              )
            );
          })}
        </View>
      )}
    </View>
  );
}
