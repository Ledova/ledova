import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  allotmentOwnershipImpact,
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  REGISTER_ALLOTMENT_COPY as COPY,
  shareCount,
  shortReference,
  type RegisterAllotmentDecisionPreview,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
} from '@ledova/shared';
import { Disclosure, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { AllotmentOwnership } from './AllotmentOwnership';

export function Part({ title, children }: { title: string; children: ReactNode }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Details({ label, children }: { label: string; children: ReactNode }) {
  const styles = useCompanyStyles();
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((value) => !value)}
      accessibilityLabel={label}
      summary={<Text style={styles.muted}>Details and documents</Text>}
    >
      {children}
    </Disclosure>
  );
}

export function AllotmentReview({
  preview,
  documents,
  showOwnership = true,
}: {
  preview: RegisterAllotmentDecisionPreview;
  documents: ReactNode;
  showOwnership?: boolean;
}) {
  const styles = useCompanyStyles();
  const impact = allotmentOwnershipImpact(preview);
  return (
    <>
      <Part title={preview.name}>
        <Text style={styles.muted}>
          {preview.className} ({preview.classCode})
        </Text>
        <Rows>
          <Row label="Shares">{shareCount(preview.shares)}</Row>
          <Row label="Consideration">{formatMoney(preview.consideration, preview.currency)}</Row>
          {impact && <Row label={COPY.UNIT_PRICE}>{impact.unitPrice}</Row>}
        </Rows>
      </Part>
      {showOwnership && (
        <Part title="Ownership impact">
          {impact && (
            <Rows>
              <Row label="Issued shares">
                {formatShareCount(impact.beforeIssuedSupply)} → {formatShareCount(impact.afterIssuedSupply)}
              </Row>
            </Rows>
          )}
          <AllotmentOwnership preview={preview} />
        </Part>
      )}
      <Part title="Agreement and receipt">
        <Rows>
          <Row label="Agreement reference">{preview.agreement.reference}</Row>
          <Row label="Agreement date">{formatDate(preview.agreement.agreedOn, 'Not recorded')}</Row>
          <Row label="Amount received">{formatMoney(preview.contribution.amount, preview.currency)}</Row>
          <Row label="Receipt date">{formatDate(preview.contribution.receivedOn, 'Not recorded')}</Row>
        </Rows>
      </Part>
      <Part title="Company authority">
        <Rows>
          <Row label="Company issue date">{formatDate(preview.companyEventOn, 'Not recorded')}</Row>
          <Row label="Approving director">{preview.approvingDirector}</Row>
          <Row label="Authority reference">{preview.authorityReference}</Row>
          <Row label="Reason">{preview.reason}</Row>
        </Rows>
      </Part>
      <Details label={`Details and documents for the review of ${preview.name}`}>
        <Rows>
          <Row label="Agreement terms">{preview.agreement.terms}</Row>
          <Row label="Residential address">{preview.residentialAddress}</Row>
          <Row label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Row>
          <Row label="Agreement recorded">{formatDateTime(preview.agreement.recordedAt, 'Not recorded')}</Row>
          <Row label="Receipt attested">{formatDateTime(preview.contribution.recordedAt, 'Not recorded')}</Row>
          <Row label="Register sequence">{preview.registerSequence}</Row>
          <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
        </Rows>
        {documents}
      </Details>
    </>
  );
}

export function GrantReview({
  preview,
  proposal,
  classLabel,
  documents,
  showOwnership = true,
  approving = false,
}: {
  preview: RegisterGrantDecisionPreview;
  proposal: Pick<RegisterGrant, 'authorityReference' | 'reason'>;
  classLabel: string;
  documents: ReactNode;
  showOwnership?: boolean;
  approving?: boolean;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      <Part title={preview.name}>
        <Text style={styles.muted}>{classLabel}</Text>
        <Rows>
          <Row label="Shares">{shareCount(preview.shares)}</Row>
          <Row label="Company issue date">{formatDate(preview.companyEventOn, 'Not recorded')}</Row>
        </Rows>
      </Part>
      {showOwnership && (
        <Part title="Ownership impact">
          {approving && <Text style={styles.muted}>Approval alone does not issue shares.</Text>}
          <Rows>
            <Row label="Member holding">
              {shareCount(preview.currentShares)} → {shareCount(preview.afterShares)}
            </Row>
            <Row label="Issued shares">
              {shareCount(preview.issuedSupply)} → {shareCount(preview.afterIssuedSupply)}
            </Row>
          </Rows>
        </Part>
      )}
      <Part title="Agreement">
        <Rows>
          <Row label="Agreement date">{formatDate(preview.termsOn, 'Not recorded')}</Row>
          <Row label="Recipient acceptance">
            {preview.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
          </Row>
          {!!preview.award && (
            <>
              <Row label="Promised">{shareCount(preview.awardPromisedShares ?? '0')}</Row>
              <Row label="Company-recorded vested">{shareCount(preview.awardVestedShares ?? '0')}</Row>
              <Row label="Issued through grants">{shareCount(preview.awardIssuedShares ?? '0')}</Row>
              <Row label="Vested and not yet issued">{shareCount(preview.awardAvailableShares ?? '0')}</Row>
            </>
          )}
        </Rows>
      </Part>
      <Part title="Company authority">
        <Rows>
          <Row label="Approving director">{preview.approvingDirector}</Row>
          <Row label="Authority reference">{proposal.authorityReference}</Row>
          <Row label="Reason">{proposal.reason}</Row>
        </Rows>
      </Part>
      <Details label={`Details and documents for the review of ${preview.name}`}>
        <Rows>
          <Row label="Agreement terms">{preview.terms}</Row>
          <Row label="Residential address">{preview.residentialAddress}</Row>
          <Row label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Row>
          {!!preview.award && <Row label="Employee award">{shortReference(preview.award)}</Row>}
          {!!preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
            <Row label="Ledger date">{formatDate(preview.effectiveOn)}</Row>
          )}
          <Row label="Register sequence">{preview.registerSequence}</Row>
          <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
        </Rows>
        {documents}
      </Details>
    </>
  );
}
