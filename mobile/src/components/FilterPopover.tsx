import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { FunnelIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';
import { AnchoredPanel, useAnchor, type Anchor } from './AnchoredPanel';

export function FilterPopover({
  label = 'Filters',
  closeLabel = `Close ${label.toLowerCase()}`,
  icon,
  active = false,
  children,
}: {
  label?: string;
  closeLabel?: string;
  icon?: ReactNode;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const theme = useAppTheme();
  const anchorOf = useAnchor();
  const button = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const styles = useThemedStyles((theme) => ({
    button: {
      width: 40,
      height: 40,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 20,
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
        onPress={() => anchorOf(button.current, setAnchor)}
        style={styles.button}
      >
        {icon ?? (
          <FunnelIcon
            size={theme.icon.sizes.md}
            color={active ? theme.colors.brand.light : theme.colors.text.primary}
          />
        )}
      </Pressable>
      <AnchoredPanel anchor={anchor} closeLabel={closeLabel} onClose={close}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {children(close)}
        </ScrollView>
      </AnchoredPanel>
    </>
  );
}
