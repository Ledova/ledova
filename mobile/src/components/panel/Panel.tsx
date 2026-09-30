import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '../../contexts';
import { useCardStyles } from '../Ledger';
import { ModalActions } from '../modal';

interface PanelProps {
  title: string;
  actions?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, actions, notice, children }: PanelProps) {
  const card = useCardStyles();
  const styles = useThemedStyles((theme) => ({
    panel: {
      flex: 1,
      gap: theme.spacing.md,
    },
    body: {
      flex: 1,
    },
  }));
  return (
    <View style={[card.card, styles.panel]}>
      <Text accessibilityRole="header" style={card.title}>
        {title}
      </Text>
      <View style={styles.body}>{children}</View>
      {notice}
      {actions ? <ModalActions>{actions}</ModalActions> : null}
    </View>
  );
}
