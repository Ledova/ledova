import { useThemedStyles } from '../../contexts';

export const useCompanyStyles = () =>
  useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: { padding: 20, paddingBottom: 48, gap: 28 },
    group: { gap: 12 },
    entry: { gap: 8, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    title: { fontFamily: theme.fontFamily.display, fontSize: 34, color: theme.colors.text.primary },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    muted: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    error: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.error.default },
    input: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.raised,
      borderColor: theme.colors.border.default,
      borderWidth: 1,
      borderRadius: 6,
      padding: 12,
    },
  }));
