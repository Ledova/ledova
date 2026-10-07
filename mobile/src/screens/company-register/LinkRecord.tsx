import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  HOLDER_TYPE_LABELS,
  REGISTER_LINK_COPY as COPY,
  REGISTER_LINK_DECISIONS,
  registerLinkMemberLabels,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterLink,
  type RegisterLinkDecisionPreview,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

type Holders = TokenHoldersResponse['holders'];
type Status = Pick<RegisterLinkDecisionPreview['links'][number], 'walletProof' | 'holderType' | 'holderName'>;

const DECISION_KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterDecisionKind, string> = {
  approve: COPY.STAGES.approved,
  apply: COPY.STAGES.applied,
  reject: COPY.STAGES.rejected,
};

const walletCount = (count: number) => `${count} ${count === 1 ? 'wallet' : 'wallets'}`;

export function WalletStatus({ wallet, member }: { wallet: Status; member: string | undefined }) {
  const styles = useCompanyStyles();
  return (
    <>
      <Text style={styles.muted}>{wallet.walletProof ? COPY.WALLET_PROOF[wallet.walletProof] : COPY.NO_STATUS}</Text>
      <Rows>
        <Row label={COPY.MEMBER}>{member}</Row>
        {!!wallet.holderType && (
          <Row label={COPY.HOLDER}>{wallet.holderName || HOLDER_TYPE_LABELS[wallet.holderType]}</Row>
        )}
      </Rows>
    </>
  );
}

function LinkPreview({
  kind,
  preview,
  holders,
}: {
  kind: RegisterDecisionKind;
  preview: RegisterLinkDecisionPreview;
  holders: Holders;
}) {
  const styles = useCompanyStyles();
  const labels = registerLinkMemberLabels(preview.links, holders);
  return (
    <>
      {kind === 'apply' && <Text style={styles.text}>{COPY.APPLY_NOTE}</Text>}
      <Text style={styles.heading}>{COPY.WALLETS}</Text>
      {preview.links.map((row) => (
        <View key={row.address} style={styles.group}>
          <Text selectable style={styles.text}>
            {row.address}
          </Text>
          <WalletStatus wallet={row} member={labels.get(row.member)} />
        </View>
      ))}
      <Text style={styles.muted}>{COPY.STATUS_NOTE}</Text>
    </>
  );
}

export function LinkRecord({
  link,
  holders,
  epoch,
  steps,
  last,
  onSettled,
}: {
  link: RegisterLink;
  holders: Holders;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const kinds: RegisterDecisionKind[] = link.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = COPY.STAGES[link.stage] ?? link.stage;
  const wallets = walletCount(link.mappingSummary.length);
  const prepared = formatDateTime(link.createdAt);
  const description = `${stage.toLowerCase()} wallet link for ${wallets}, prepared on ${prepared}`;
  const labels = registerLinkMemberLabels(link.mappingSummary, holders);
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · {wallets}
      </Text>
      <Text style={styles.muted}>{link.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}</Text>
      <Rows>
        {link.preparedByName !== null && <Row label="Prepared by">{link.preparedByName || 'Name not recorded'}</Row>}
        <Row label="Prepared on">{prepared}</Row>
        {link.decisions.map((decision) => (
          <Row key={decision.uuid} label={DECIDED[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {link.decisions.length === 0 && link.reviewedAt && (
          <Row label="Decided on">{formatDateTime(link.reviewedAt)}</Row>
        )}
        {!!link.rejectionReason && <Row label="Rejection reason">{link.rejectionReason}</Row>}
        <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[link.authority]}</Row>
        {!!link.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{link.approvingDirector}</Row>}
        <Row label={COPY.AUTHORITY_REFERENCE}>{link.authorityReference}</Row>
        <Row label={COPY.REASON}>{link.reason}</Row>
      </Rows>
      <Text style={styles.heading}>{COPY.WALLETS}</Text>
      {link.mappingSummary.map((row) => (
        <View key={row.address}>
          <Text style={styles.text}>{labels.get(row.member)}</Text>
          <Text selectable style={styles.muted}>
            {row.address}
          </Text>
        </View>
      ))}
      <RegisterCopy
        label={COPY.DOWNLOAD}
        accessibilityLabel={`${COPY.DOWNLOAD} of the ${description}`}
        filename={`authority-${link.uuid}`}
        epoch={epoch}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_FILE(link.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          })
        }
      />
      {link.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {kinds.map((kind) => {
            const appointment = steps[kind];
            return (
              appointment && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_LINK_DECISIONS}
                  copy={COPY}
                  noun="wallet link"
                  proposal={link}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => <LinkPreview kind={kind} preview={preview} holders={holders} />}
                </RegisterDecision>
              )
            );
          })}
        </View>
      )}
    </View>
  );
}
