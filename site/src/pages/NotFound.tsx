import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PRIMARY_BUTTON } from '../styles';

export function NotFound() {
  return (
    <PageHeader title="Page not found" lead="The page you're looking for doesn't exist.">
      <Link to="/" className={`${PRIMARY_BUTTON} mt-8`}>
        Back to home
      </Link>
    </PageHeader>
  );
}
