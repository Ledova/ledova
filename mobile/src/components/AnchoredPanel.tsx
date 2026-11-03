import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useThemedStyles } from '../contexts';
import { useDialogInsets } from './modal';

const ANCHOR_GAP = 8;
const EDGE = 16;
const WIDTH = 320;

export type Anchor = { top: number; right: number };

type Measurable = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

export function useAnchor() {
  const window = useWindowDimensions();
  const insets = useDialogInsets();
  return (button: Measurable | null, open: (anchor: Anchor) => void) =>
    button?.measureInWindow((x, y, width, height) =>
      open({
        top: y + height + ANCHOR_GAP + (Platform.OS === 'android' ? insets.top : 0),
        right: Math.max(EDGE, window.width - x - width),
      }),
    );
}

export function AnchoredPanel({
  anchor,
  closeLabel,
  onClose,
  children,
}: {
  anchor: Anchor | null;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const window = useWindowDimensions();
  const styles = useThemedStyles((theme) => ({
    panel: {
      position: 'absolute' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
      shadowColor: theme.colors.utility.black,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.1,
      shadowRadius: 15,
      elevation: 8,
    },
  }));
  return (
    <Modal visible={!!anchor} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        {anchor && (
          <View
            style={[
              styles.panel,
              {
                top: anchor.top,
                right: anchor.right,
                width: Math.min(WIDTH, window.width - 2 * EDGE),
                maxHeight: window.height - anchor.top - EDGE,
              },
            ]}
          >
            {children}
          </View>
        )}
      </View>
    </Modal>
  );
}
