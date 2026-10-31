import { RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';
import { NoticeList } from '../publications';
import { usePublications } from '../publications/usePublications';

export function NoticesScreen() {
  const theme = useAppTheme();
  const notices = usePublications();
  return (
    <Page
      testID="notices-scroll"
      title="Notices"
      refreshControl={
        <RefreshControl
          refreshing={notices.isRefreshing && !notices.isLoading}
          onRefresh={notices.retry}
          tintColor={theme.colors.interactive.active}
        />
      }
    >
      <NoticeList notices={notices} publications={notices.publications} />
    </Page>
  );
}
