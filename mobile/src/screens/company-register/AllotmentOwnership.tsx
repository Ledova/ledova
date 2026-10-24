import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  allotmentOwnershipImpact,
  REGISTER_ALLOTMENT_COPY as COPY,
  shareCount,
  shortReference,
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
        </Text>
        {impact.rows.some((other) => other.member !== row.member && other.name === row.name) && (
          <Text style={styles.muted}>Member reference {shortReference(row.member)}</Text>
        )}
        <Rows>
          <Row label="Before">
            {shareCount(row.beforeShares)} · {row.beforePercentage}
          </Row>
          <Row label="After">
            {shareCount(row.afterShares)} · {row.afterPercentage}
          </Row>
        </Rows>
      </View>
    ));
  return (
    <View style={styles.group}>
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
    </View>
  );
}
