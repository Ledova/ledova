import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useThemedStyles, overlayColors } from '../../../contexts';
import { Action } from '../../../components/Ledger';

export function ActivityModal({
  visible,
  title,
  onClose,
  children,
  actions,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const styles = useThemedStyles((theme) => ({
    overlay: {
      flex: 1,
      padding: 20,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: overlayColors.modal,
    },
    backdrop: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
    panel: {
      width: '100%' as const,
      maxWidth: 520,
      maxHeight: '90%' as const,
      flexShrink: 1,
      borderRadius: 10,
      backgroundColor: theme.colors.surface.base,
      borderColor: theme.colors.border.default,
      borderWidth: 1,
    },
    title: { fontFamily: theme.fontFamily.display, fontSize: 28, color: theme.colors.text.primary, padding: 20 },
    body: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
    actions: {
      padding: 16,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.default,
    },
  }));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close dialog" onPress={onClose} />
        <View style={styles.panel} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
          <View style={styles.actions}>
            <Action label="Close" onPress={onClose} />
            {actions}
          </View>
        </View>
      </View>
    </Modal>
  );
}
