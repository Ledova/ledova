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
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      small: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
      hidden: { display: 'none' as const },
      ruled,
      form: { ...ruled, gap: theme.spacing.lg },
      record: { gap: theme.spacing.smd, paddingVertical: theme.spacing.md },
      heading: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 24, color: theme.colors.text.primary },
      name: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 24, color: theme.colors.text.primary },
      pair: { flexDirection: 'row' as const, gap: theme.spacing.md },
      cell: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
      wrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
      review: { gap: 20 },
      disclosure: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: theme.spacing.smd,
        minHeight: 44,
      },
      split: {
        flexDirection: 'row' as const,
        alignItems: 'baseline' as const,
        justifyContent: 'space-between' as const,
        gap: theme.spacing.smd,
      },
      tabular: { fontVariant: ['tabular-nums' as const] },
      groupTitle: {
        fontFamily: theme.fontFamily.semibold,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.muted,
      },
      groupRule: { paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border.default },
      more: { paddingBottom: theme.spacing.md },
    };
  });
}
