import { useThemedStyles } from '../../contexts';

export function useMarketStyles() {
  return useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: { padding: 20, paddingBottom: 40, gap: 24 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    text: { fontSize: 16, color: theme.colors.text.primary, lineHeight: 24 },
    muted: { fontSize: 14, color: theme.colors.text.muted, lineHeight: 22 },
    error: { fontSize: 14, color: theme.colors.status.error.icon, lineHeight: 22 },
    fields: { gap: 12 },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
    classRow: { paddingVertical: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: 12,
      fontSize: 16,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.base,
    },
  }));
}
