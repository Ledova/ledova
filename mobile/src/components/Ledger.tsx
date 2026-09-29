import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

export function useCardStyles() {
  return useThemedStyles((theme) => ({
    card: {
      gap: theme.spacing.smd,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface.raised,
    },
    title: { fontFamily: theme.fontFamily.display, fontSize: 25, color: theme.colors.text.primary },
  }));
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useCardStyles();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    lede: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
  }));
  return <Text style={styles.lede}>{children}</Text>;
}

function items(children: ReactNode, prefix = ''): { key: string; node: ReactElement }[] {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    const key = `${prefix}${child.key ?? index}`;
    return child.type === Fragment ? items(child.props.children, `${key}/`) : [{ key, node: child }];
  });
}

export function Rows({ children }: { children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    rule: { height: 1, backgroundColor: theme.colors.border.subtle },
  }));
  return (
    <View>
      {items(children).map(({ key, node }, index) => (
        <Fragment key={key}>
          {index > 0 && <View style={styles.rule} />}
          {node}
        </Fragment>
      ))}
    </View>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: theme.spacing.sm,
      paddingVertical: 10,
    },
    label: { flexShrink: 1, fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    value: {
      flexGrow: 1,
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      color: theme.colors.text.primary,
      textAlign: 'right' as const,
    },
  }));
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{children}</Text>
    </View>
  );
}

export function LinkRow({
  label,
  onPress,
  accessibilityLabel,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    text: { flex: 1, gap: theme.spacing.xs },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {children}
      </View>
      <CaretRightIcon size={16} color={theme.colors.text.muted} />
    </Pressable>
  );
}

export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles((theme) => ({
    button: {
      alignSelf: 'flex-start' as const,
      borderWidth: 1,
      borderColor: primary ? theme.colors.brand.default : theme.colors.border.default,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: primary ? theme.colors.brand.default : theme.colors.surface.transparent,
      opacity: disabled ? 0.5 : 1,
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: 14,
      color: primary ? '#ffffff' : theme.colors.text.primary,
    },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function Choice({
  label,
  selected,
  onPress,
  disabled = false,
  accessibilityRole = 'button',
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  accessibilityRole?: 'button' | 'radio';
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles((theme) => ({
    choice: {
      alignSelf: 'flex-start' as const,
      borderWidth: 1,
      borderColor: selected ? theme.colors.interactive.defaultSubtle : theme.colors.border.default,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      opacity: disabled ? 0.5 : 1,
    },
    label: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      color: selected ? theme.colors.interactive.active : theme.colors.text.primary,
    },
  }));
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        accessibilityRole === 'radio' ? { checked: selected, selected, disabled } : { selected, disabled }
      }
      disabled={disabled}
      onPress={onPress}
      style={styles.choice}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
