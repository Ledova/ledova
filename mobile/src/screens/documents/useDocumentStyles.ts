import { useThemedStyles } from '../../contexts';

export function useDocumentStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    const ruled = {
      paddingTop: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    };
    return {
      group: { ...ruled, gap: theme.spacing.smd },
      form: { ...ruled, gap: theme.spacing.md },
      heading: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      row: { gap: theme.spacing.xs, paddingVertical: theme.spacing.smd },
      record: { gap: 12, paddingVertical: theme.spacing.md },
      divided: { borderTopWidth: 1, borderTopColor: theme.colors.border.subtle },
      change: { gap: theme.spacing.xs },
      line: { flexDirection: 'row' as const, gap: theme.spacing.md },
      name: { ...text, flex: 1, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      shares: { ...text, flexShrink: 0, textAlign: 'right' as const, color: theme.colors.text.primary },
      title: { ...text, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
      hidden: { display: 'none' as const },
    };
  });
}
