import { useThemedStyles } from '../../contexts';

export function useLedgerStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    const ruled = { paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle };
    return {
      stack: { gap: theme.spacing.md },
      fields: { gap: theme.spacing.md },
      group: { ...ruled, gap: theme.spacing.smd },
      summary: { gap: theme.spacing.smd },
      terms: { gap: theme.spacing.xs },
      list: { gap: theme.spacing.sm },
      groups: { gap: theme.spacing.lg },
      figures: { flexDirection: 'row' as const, gap: theme.spacing.md },
      figure: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
      figureLabel: {
        fontFamily: theme.fontFamily.regular,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.muted,
      },
      figureValue: {
        fontFamily: theme.fontFamily.medium,
        fontSize: 20,
        lineHeight: 28,
        color: theme.colors.text.primary,
      },
      row: { gap: theme.spacing.sm, paddingVertical: theme.spacing.smd },
      line: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
        gap: 12,
      },
      fill: { flex: 1, minWidth: 0 },
      text: { ...text, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      strong: { fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      small: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
    };
  });
}
