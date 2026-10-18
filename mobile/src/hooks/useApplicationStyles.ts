import { useThemedStyles } from '../contexts';

export const useApplicationStyles = () =>
  useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    item: { paddingVertical: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 23, color: theme.colors.text.primary },
    group: { gap: 12 },
  }));
