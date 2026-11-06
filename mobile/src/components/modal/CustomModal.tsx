import { useContext, useEffect, useRef, type Key, type ReactElement, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { overlayColors, useThemedStyles } from '../../contexts';
import { Action, useCardStyles } from '../Ledger';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export function useDialogInsets() {
  return useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? NO_INSETS;
}

export function ModalActions({ children }: { children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'flex-end' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
    },
  }));
  return <View style={styles.row}>{children}</View>;
}

interface CustomModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  dismissLabel?: string;
  refreshControl?: ReactElement<RefreshControlProps>;
  scrollRef?: Ref<ScrollView>;
  actions?: ReactNode;
  contentKey?: Key;
}

export function CustomModal({
  visible,
  title,
  onClose,
  children,
  busy = false,
  dismissLabel = 'Close dialog',
  refreshControl,
  scrollRef,
  actions,
  contentKey,
}: CustomModalProps) {
  const insets = useDialogInsets();
  const card = useCardStyles();
  const styles = useThemedStyles((theme) => ({
    overlay: { flex: 1, backgroundColor: overlayColors.modal },
    keyboard: { flex: 1 },
    position: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingTop: insets.top + theme.spacing.md,
      paddingRight: insets.right + theme.spacing.md,
      paddingBottom: insets.bottom + theme.spacing.md,
      paddingLeft: insets.left + theme.spacing.md,
    },
    card: {
      width: '100%' as const,
      maxWidth: 520,
      maxHeight: '100%' as const,
      gap: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      shadowColor: theme.colors.utility.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    },
    body: { flexGrow: 0, flexShrink: 1 },
    content: { gap: theme.spacing.md },
  }));
  const close = () => {
    if (!busy) onClose();
  };
  const heading = useRef<Text>(null);
  const shown = useRef({ contentKey, visible });
  useEffect(() => {
    const replaced = shown.current.visible && visible && shown.current.contentKey !== contentKey;
    shown.current = { contentKey, visible };
    if (replaced && heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
  }, [contentKey, visible]);
  return (
    <Modal testID={`modal-${title}`} visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View key={contentKey} style={styles.overlay}>
        <Pressable
          testID={`modal-backdrop-${title}`}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          style={StyleSheet.absoluteFill}
          disabled={busy}
          onPress={close}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
          pointerEvents="box-none"
        >
          <View style={styles.position} pointerEvents="box-none">
            <View accessibilityViewIsModal style={[card.card, styles.card]}>
              <Text ref={heading} accessibilityRole="header" style={card.title}>
                {title}
              </Text>
              <ScrollView
                ref={scrollRef}
                style={styles.body}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                refreshControl={refreshControl}
              >
                {children}
              </ScrollView>
              {actions !== undefined && (
                <ModalActions>
                  <Action label="Cancel" disabled={busy} onPress={close} />
                  {actions}
                </ModalActions>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
