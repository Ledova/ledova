import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';

export function ErrorSummary({
  attempt,
  problems,
  claim,
}: {
  attempt: number;
  problems: { id: string; message: string }[];
  claim?: (attempt: number) => boolean;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({ summary: { gap: theme.spacing.xs } }));
  const summary = useRef<View>(null);
  useEffect(() => {
    if (attempt === 0 || (claim && !claim(attempt))) return;
    if (summary.current) AccessibilityInfo.sendAccessibilityEvent(summary.current, 'focus');
  }, [attempt, claim]);
  if (problems.length === 0) return null;
  return (
    <View ref={summary} accessible accessibilityRole="alert" style={look.summary}>
      <Text style={styles.error}>Before continuing:</Text>
      {problems.map(({ id, message }) => (
        <Text key={id} style={styles.error}>{`• ${message}`}</Text>
      ))}
    </View>
  );
}
