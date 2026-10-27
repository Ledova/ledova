import Layout from '@components/Layout';
import { AppRoutes } from './routes/AppRoutes';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';

export default function App() {
  return (
    <MemberRecordsProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </MemberRecordsProvider>
  );
}
