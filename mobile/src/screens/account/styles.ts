import { useThemedStyles } from '../../contexts';
export function useAccountStyles() {
  return useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: { padding: 20, paddingBottom: 40, gap: 28 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.body },
    muted: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 22, color: theme.colors.text.muted },
    error: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.status.error.text },
    fields: { gap: 14 },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
    input: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderRadius: theme.borderRadius.md,
      borderColor: theme.colors.border.default,
      backgroundColor: theme.colors.surface.raised,
      color: theme.colors.text.primary,
    },
  }));
}
