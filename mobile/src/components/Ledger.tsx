import { Children, Fragment, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

const CARET_SIZE = 16;

export function useCardStyles() {
  return useThemedStyles((theme) => ({
    card: {
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.xl,
      backgroundColor: theme.colors.surface.raised,
    },
    title: {
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.xl,
      lineHeight: 28,
      letterSpacing: -0.2,
      color: theme.colors.text.primary,
    },
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

export function Row({
  label,
  mono = false,
  accessibilityLabel,
  children,
}: {
  label: string;
  mono?: boolean;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
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
    mono: { fontFamily: theme.fontFamily.mono },
  }));
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, mono && styles.mono]} accessibilityLabel={accessibilityLabel}>
        {children}
      </Text>
    </View>
  );
}

export function Fact({ label, children }: { label: string; children: string | ReactElement }) {
  const styles = useThemedStyles((theme) => ({
    fact: { gap: theme.spacing.xs, paddingVertical: theme.spacing.smd },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.text.muted },
    value: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
  }));
  const text = typeof children === 'string';
  return (
    <View accessible={text} accessibilityLabel={text ? `${label}: ${children}` : undefined} style={styles.fact}>
      <Text style={styles.label}>{label}</Text>
      {text ? <Text style={styles.value}>{children}</Text> : children}
    </View>
  );
}

export function ShowMore({ show, hide, children }: { show: string; hide: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const styles = useThemedStyles((theme) => ({
    toggle: { alignSelf: 'flex-start' as const },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.brand.light },
    content: { gap: theme.spacing.smd },
    hidden: { display: 'none' as const },
  }));
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={12}
        onPress={() => setOpen((shown) => !shown)}
        style={styles.toggle}
      >
        <Text style={styles.label}>{open ? hide : show}</Text>
      </Pressable>
      <View style={[styles.content, !open && styles.hidden]}>{children}</View>
    </>
  );
}

export type Tone = 'waiting' | 'moving' | 'done' | 'closed';

export function Status({ tone, muted = false, children }: { tone: Tone; muted?: boolean; children: string }) {
  const styles = useThemedStyles((theme) => ({
    status: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.sm },
    mark: { width: 8, height: 8, borderRadius: 4 },
    waiting: { borderWidth: 1, borderColor: theme.colors.text.muted },
    moving: { backgroundColor: theme.colors.brand.mid, opacity: 0.5 },
    done: { backgroundColor: theme.colors.brand.mid },
    closed: { backgroundColor: theme.colors.text.muted },
    label: {
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.text.primary,
    },
    muted: { color: theme.colors.text.muted },
  }));
  return (
    <View style={styles.status}>
      <View style={[styles.mark, styles[tone]]} />
      <Text style={[styles.label, muted && styles.muted]}>{children}</Text>
    </View>
  );
}

export function LinkRow({
  label,
  onPress,
  accessibilityLabel,
  aside,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  aside?: ReactNode;
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
      {aside}
      <CaretRightIcon size={CARET_SIZE} color={theme.colors.text.muted} />
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
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 16,
      paddingVertical: theme.spacing.smd,
    },
    text: { flex: 1, gap: theme.spacing.xs },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
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
  const handlePress = () => {
    if (!disabled) {
      onPress();
    }
  };
  const styles = useThemedStyles((theme) => ({
    button: {
      alignSelf: 'flex-start' as const,
      borderWidth: 1,
      borderColor: primary ? theme.colors.brand.default : theme.colors.border.default,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: primary ? theme.colors.brand.default : theme.colors.utility.transparent,
      opacity: disabled ? 0.5 : 1,
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: 14,
      color: primary ? theme.colors.utility.white : theme.colors.text.primary,
    },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      onAccessibilityTap={handlePress}
      style={styles.button}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function useActionsStyles() {
  return useThemedStyles((theme) => ({
    actions: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'flex-end' as const,
      gap: theme.spacing.sm,
    },
    ruled: { paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle },
  }));
}

export function Actions({ children }: { children: ReactNode }) {
  const styles = useActionsStyles();
  return <View style={styles.actions}>{children}</View>;
}

export function FormActions({ children }: { children: ReactNode }) {
  const styles = useActionsStyles();
  return <View style={[styles.actions, styles.ruled]}>{children}</View>;
}
