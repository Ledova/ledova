import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FunnelIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

const ANCHOR_GAP = 8;
const EDGE = 16;
const WIDTH = 320;

export function FilterPopover({
  label = 'Filters',
  active = false,
  children,
}: {
  label?: string;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const theme = useAppTheme();
  const window = useWindowDimensions();
  const button = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const styles = useThemedStyles((theme) => ({
    button: {
      width: 40,
      height: 40,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
    },
    active: { borderColor: theme.colors.brand.mid },
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
    content: { gap: theme.spacing.md, padding: theme.spacing.md },
  }));
  const close = () => setAnchor(null);
  return (
    <>
      <Pressable
        ref={button}
        accessibilityRole="button"
        accessibilityLabel={active ? `${label}, active` : label}
        accessibilityState={{ expanded: !!anchor }}
        hitSlop={2}
        onPress={() =>
          button.current?.measureInWindow((x, y, width, height) =>
            setAnchor({ top: y + height + ANCHOR_GAP, right: Math.max(EDGE, window.width - x - width) }),
          )
        }
        style={[styles.button, active && styles.active]}
      >
        <FunnelIcon size={theme.icon.sizes.md} color={active ? theme.colors.brand.light : theme.colors.text.primary} />
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${label.toLowerCase()}`}
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
        {anchor && (
          <View
            accessibilityViewIsModal
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
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {children(close)}
            </ScrollView>
          </View>
        )}
      </Modal>
    </>
  );
}
