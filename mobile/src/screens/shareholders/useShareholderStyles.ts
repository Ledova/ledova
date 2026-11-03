import { useThemedStyles } from '../../contexts';

export function useShareholderStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      stack: { gap: theme.spacing.md },
      form: { gap: theme.spacing.md },
      hidden: { display: 'none' as const },
      row: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
      line: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.md },
      lines: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
      fill: { flex: 1, minWidth: 0 },
      group: {
        gap: theme.spacing.smd,
        paddingTop: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.subtle,
      },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      text: { ...text, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      small: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
      heading: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 24, color: theme.colors.text.primary },
      name: { fontFamily: theme.fontFamily.regular, fontSize: 16, lineHeight: 24, color: theme.colors.text.primary },
      figure: { ...text, flexShrink: 0, textAlign: 'right' as const, color: theme.colors.text.primary },
      status: {
        ...text,
        flexShrink: 0,
        maxWidth: '45%' as const,
        textAlign: 'right' as const,
        color: theme.colors.text.muted,
      },
    };
  });
}
