import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

function GrantRows({ grant }: { grant: RegisterGrant | RegisterGrantDecisionPreview }) {
  return (
    <Rows>
      <Row label="Member">
        {grant.name} · {grant.member}
      </Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Row>
      <Row label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{grant.shares}</Row>
      <Row label={COPY.EFFECTIVE_ON}>{grant.effectiveOn}</Row>
      <Row label={COPY.TERMS}>{grant.terms}</Row>
      <Row label="Recipient acceptance">
        {grant.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
      </Row>
    </Rows>
  );
}

export function GrantRecord({
  grant,
  epoch,
  steps,
  last,
  onSettled,
}: {
  grant: RegisterGrant;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const description = `non-paid grant for ${grant.name}, prepared ${formatDateTime(grant.createdAt)}`;
  const documents: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {COPY.STAGES[grant.stage] ?? grant.stage} · {grant.name}
      </Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <GrantRows grant={grant} />
      <Rows>
        <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
        <Row label={COPY.REASON}>{grant.reason}</Row>
        <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
        {grant.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!grant.rejectionReason && <Row label="Rejection reason">{grant.rejectionReason}</Row>}
        {!!grant.registerEntry && <Row label="Register entry">{grant.registerEntry}</Row>}
      </Rows>
      {documents.map((kind) => (
        <RegisterCopy
          key={kind}
          label={`Download ${kind} document`}
          accessibilityLabel={`Download ${kind} document of ${description}`}
          filename={`${kind}-${grant.uuid}`}
          epoch={epoch}
          read={() => {
            const config = { responseType: 'arraybuffer' as const, ledovaSessionEpoch: epoch };
            if (kind === 'authority')
              return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_FILE(grant.uuid), config);
            if (kind === 'terms')
              return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(grant.uuid), config);
            return apiClient.get<ArrayBuffer>(
              COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(grant.uuid),
              config,
            );
          }}
        />
      ))}
      {grant.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {(['approve', 'apply', 'reject'] as RegisterDecisionKind[]).map(
            (kind) =>
              steps[kind] && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_GRANT_DECISIONS}
                  copy={COPY}
                  noun="non-paid grant"
                  proposal={grant}
                  kind={kind}
                  appointment={steps[kind]!.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => (
                    <>
                      <GrantRows grant={preview} />
                      <Rows>
                        <Row label="Register sequence">{preview.registerSequence}</Row>
                        <Row label="Member holding">
                          {preview.currentShares} → {preview.afterShares}
                        </Row>
                        <Row label="Issued supply">
                          {preview.issuedSupply} → {preview.afterIssuedSupply}
                        </Row>
                        <Row label="Authorised supply">{preview.authorisedSupply}</Row>
                      </Rows>
                    </>
                  )}
                </RegisterDecision>
              ),
          )}
        </View>
      )}
    </View>
  );
}
