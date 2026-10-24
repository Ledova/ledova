import { useEffect, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Text, View } from 'react-native';
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
  const summary = useRef<View>(null);
  useEffect(() => {
    if (attempt === 0 || (claim && !claim(attempt))) return;
    const node = findNodeHandle(summary.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [attempt, claim]);
  if (problems.length === 0) return null;
  return (
    <View ref={summary} accessible accessibilityRole="alert" style={styles.group}>
      <Text style={styles.error}>Before continuing:</Text>
      {problems.map(({ id, message }) => (
        <Text key={id} style={styles.error}>
          {`• ${message}`}
        </Text>
      ))}
    </View>
  );
}
