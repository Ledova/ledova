import Layout from '@components/Layout';
import { AppRoutes } from './routes/AppRoutes';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';

export default function App() {
  return (
    <Layout>
      <MemberRecordsProvider>
        <AppRoutes />
      </MemberRecordsProvider>
    </Layout>
  );
}
