import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  allotmentOwnershipImpact,
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  shareCount,
  shortReference,
  type RegisterAllotmentDecisionPreview,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
} from '@ledova/shared';
import { Fact, Rows, Section, ShowMore } from '../../components/Ledger';
import { useThemedStyles } from '../../contexts';
import { useLedgerStyles } from './useLedgerStyles';

function Group({ title, children }: { title: string; children: ReactNode }) {
  const look = useLedgerStyles();
  return (
    <View>
      <Text accessibilityRole="header" style={look.heading}>
        {title}
      </Text>
      <Rows>{children}</Rows>
    </View>
  );
}

function Details({ children }: { children: ReactNode }) {
  return (
    <ShowMore show="Show details and documents" hide="Hide details and documents">
      {children}
    </ShowMore>
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
  const look = useLedgerStyles();
  const impact = allotmentOwnershipImpact(preview);
  return (
    <>
      <Section title={preview.name}>
        <Text style={look.muted}>
          {preview.className} ({preview.classCode})
        </Text>
        <View>
          <Fact label="Shares">{shareCount(preview.shares)}</Fact>
          <Fact label="Consideration">{formatMoney(preview.consideration, preview.currency)}</Fact>
          {impact && <Fact label={COPY.UNIT_PRICE}>{impact.unitPrice}</Fact>}
        </View>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          {impact && (
            <Rows>
              <Fact label="Issued shares">
                {`${formatShareCount(impact.beforeIssuedSupply)} → ${formatShareCount(impact.afterIssuedSupply)}`}
              </Fact>
            </Rows>
          )}
          <AllotmentOwnership preview={preview} />
        </Section>
      )}
      <Section title="Company records">
        <View style={look.groups}>
          <Group title="Agreement and receipt">
            <Fact label="Agreement reference">{preview.agreement.reference}</Fact>
            <Fact label="Agreement date">{formatDate(preview.agreement.agreedOn, 'Not recorded')}</Fact>
            <Fact label="Amount received">{formatMoney(preview.contribution.amount, preview.currency)}</Fact>
            <Fact label="Receipt date">{formatDate(preview.contribution.receivedOn, 'Not recorded')}</Fact>
          </Group>
          <Group title="Company authority">
            <Fact label="Company issue date">{formatDate(preview.companyEventOn, 'Not recorded')}</Fact>
            <Fact label="Approving director">{preview.approvingDirector}</Fact>
            <Fact label="Authority reference">{preview.authorityReference}</Fact>
            <Fact label="Reason">{preview.reason}</Fact>
          </Group>
        </View>
        <Details>
          <Rows>
            <Fact label="Agreement terms">{preview.agreement.terms}</Fact>
            <Fact label="Residential address">{preview.residentialAddress}</Fact>
            <Fact label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Fact>
            <Fact label="Agreement recorded">{formatDateTime(preview.agreement.recordedAt, 'Not recorded')}</Fact>
            <Fact label="Receipt attested">{formatDateTime(preview.contribution.recordedAt, 'Not recorded')}</Fact>
            <Fact label="Authorised supply">{shareCount(preview.authorisedSupply)}</Fact>
          </Rows>
          {documents}
        </Details>
      </Section>
    </>
  );
}

function AllotmentOwnership({ preview }: { preview: RegisterAllotmentDecisionPreview }) {
  const look = useLedgerStyles();
  const table = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    rule: { borderTopWidth: 1, borderTopColor: theme.colors.border.subtle },
    number: { width: 88, alignItems: 'flex-end' as const },
  }));
  const impact = allotmentOwnershipImpact(preview);
  if (!impact)
    return (
      <Text accessibilityRole="alert" style={look.muted}>
        {COPY.OWNERSHIP_UNAVAILABLE}
      </Text>
    );
  const rows = (shown: typeof impact.rows, label: string) => (
    <View accessibilityLabel={label}>
      <View style={table.row}>
        <Text style={[look.muted, look.fill]}>Shareholder</Text>
        <Text style={[look.muted, table.number]}>Before</Text>
        <Text style={[look.muted, table.number]}>After</Text>
      </View>
      {shown.map((row) => (
        <View
          key={row.member}
          accessible
          accessibilityLabel={`${row.name || 'Name not recorded'}${row.recipient ? ' · Investor' : ''}: before ${shareCount(row.beforeShares)}, ${row.beforePercentage}; after ${shareCount(row.afterShares)}, ${row.afterPercentage}`}
          style={[table.row, table.rule]}
        >
          <View style={[look.fill, look.terms]}>
            <Text style={look.title}>
              {row.name || 'Name not recorded'}
              {row.recipient && ' · Investor'}
            </Text>
            {impact.rows.some((other) => other.member !== row.member && other.name === row.name) && (
              <Text style={look.small}>Member reference {shortReference(row.member)}</Text>
            )}
          </View>
          <View style={table.number}>
            <Text style={look.text}>{shareCount(row.beforeShares)}</Text>
            <Text style={look.muted}>{row.beforePercentage}</Text>
          </View>
          <View style={table.number}>
            <Text style={look.text}>{shareCount(row.afterShares)}</Text>
            <Text style={look.muted}>{row.afterPercentage}</Text>
          </View>
        </View>
      ))}
    </View>
  );
  return (
    <View accessibilityLabel={COPY.OWNERSHIP_TITLE} style={look.summary}>
      {rows(impact.rows.length > 5 ? impact.rows.slice(0, 1) : impact.rows, 'Share class ownership forecast')}
      {impact.rows.length > 5 && (
        <ShowMore show={`Show other shareholders (${impact.rows.length - 1})`} hide="Hide other shareholders">
          {rows(impact.rows.slice(1), 'Other shareholder ownership forecast')}
        </ShowMore>
      )}
    </View>
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
  const look = useLedgerStyles();
  return (
    <>
      <Section title={preview.name}>
        <Text style={look.muted}>{classLabel}</Text>
        <View>
          <Fact label="Shares">{shareCount(preview.shares)}</Fact>
          <Fact label="Company issue date">{formatDate(preview.companyEventOn, 'Not recorded')}</Fact>
        </View>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          {approving && <Text style={look.muted}>Approval alone does not issue shares.</Text>}
          <Rows>
            <Fact label="Member holding">
              {`${shareCount(preview.currentShares)} → ${shareCount(preview.afterShares)}`}
            </Fact>
            <Fact label="Issued shares">
              {`${shareCount(preview.issuedSupply)} → ${shareCount(preview.afterIssuedSupply)}`}
            </Fact>
          </Rows>
        </Section>
      )}
      <Section title="Company records">
        <View style={look.groups}>
          <Group title="Agreement">
            <Fact label="Agreement date">{formatDate(preview.termsOn, 'Not recorded')}</Fact>
            <Fact label="Recipient acceptance">
              {preview.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
            </Fact>
            {preview.award && <Fact label="Promised">{shareCount(preview.awardPromisedShares!)}</Fact>}
            {preview.award && <Fact label="Company-recorded vested">{shareCount(preview.awardVestedShares!)}</Fact>}
            {preview.award && <Fact label="Issued through grants">{shareCount(preview.awardIssuedShares!)}</Fact>}
            {preview.award && (
              <Fact label="Vested and not yet issued">{shareCount(preview.awardAvailableShares!)}</Fact>
            )}
          </Group>
          <Group title="Company authority">
            <Fact label="Approving director">{preview.approvingDirector}</Fact>
            <Fact label="Authority reference">{proposal.authorityReference}</Fact>
            <Fact label="Reason">{proposal.reason}</Fact>
          </Group>
        </View>
        <Details>
          <Rows>
            <Fact label="Agreement terms">{preview.terms}</Fact>
            <Fact label="Residential address">{preview.residentialAddress}</Fact>
            <Fact label="Member record">{preview.newMember ? 'New member' : 'Existing member'}</Fact>
            {preview.award && <Fact label="Source">Employee award</Fact>}
            {preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
              <Fact label="Ledger date">{formatDate(preview.effectiveOn)}</Fact>
            )}
            <Fact label="Authorised supply">{shareCount(preview.authorisedSupply)}</Fact>
          </Rows>
          {documents}
        </Details>
      </Section>
    </>
  );
}
