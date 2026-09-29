import type { ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    section: {
      gap: 12,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface.raised,
    },
    title: { fontFamily: theme.fontFamily.display, fontSize: 25, color: theme.colors.text.primary },
  }));
  return (
    <View style={styles.section}>
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

export function Row({ label, children }: { label: string; children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
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
  last = false,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  last?: boolean;
  children?: ReactNode;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    text: { flex: 1, gap: 4 },
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

export function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const styles = useThemedStyles((theme) => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 16 },
    text: { flex: 1, gap: 5 },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.body },
    description: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 22, color: theme.colors.text.muted },
  }));
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {!!description && <Text style={styles.description}>{description}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={checked}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
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
