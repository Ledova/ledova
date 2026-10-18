import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  allotmentOwnershipImpact,
  formatShareCount,
  REGISTER_ALLOTMENT_COPY as COPY,
  type RegisterAllotmentDecisionPreview,
} from '@ledova/shared';
import { Disclosure, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function AllotmentOwnership({ preview }: { preview: RegisterAllotmentDecisionPreview }) {
  const styles = useCompanyStyles();
  const [expanded, setExpanded] = useState(false);
  const impact = allotmentOwnershipImpact(preview);
  if (!impact)
    return (
      <Text accessibilityRole="alert" style={styles.muted}>
        {COPY.OWNERSHIP_UNAVAILABLE}
      </Text>
    );
  const rows = (items: typeof impact.rows) =>
    items.map((row) => (
      <View key={row.member} style={styles.group}>
        <Text style={styles.text}>
          {row.name || 'Name not recorded'}
          {row.recipient && ' · Investor'}
          {impact.rows.some((other) => other.member !== row.member && other.name === row.name) &&
            ` · Record ${row.member.slice(-8)}`}
        </Text>
        <Rows>
          <Row label="Before">
            {formatShareCount(row.beforeShares)} shares · {row.beforePercentage}
          </Row>
          <Row label="After">
            {formatShareCount(row.afterShares)} shares · {row.afterPercentage}
          </Row>
        </Rows>
      </View>
    ));
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.OWNERSHIP_TITLE}
      </Text>
      <Rows>
        <Row label="Share class">
          {preview.className} ({preview.classCode})
        </Row>
        <Row label={COPY.UNIT_PRICE}>{impact.unitPrice}</Row>
        <Row label="Issued shares">
          {formatShareCount(impact.beforeIssuedSupply)} → {formatShareCount(impact.afterIssuedSupply)}
        </Row>
      </Rows>
      {rows(impact.rows.length > 5 ? impact.rows.slice(0, 1) : impact.rows)}
      {impact.rows.length > 5 && (
        <Disclosure
          open={expanded}
          onToggle={() => setExpanded((value) => !value)}
          accessibilityLabel={`Other shareholders (${impact.rows.length - 1})`}
          summary={<Text style={styles.muted}>Other shareholders ({impact.rows.length - 1})</Text>}
        >
          {rows(impact.rows.slice(1))}
        </Disclosure>
      )}
      <Text style={styles.muted}>{COPY.OWNERSHIP_NOTE}</Text>
    </View>
  );
}
