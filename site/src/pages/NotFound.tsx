import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PRIMARY_BUTTON } from '../styles';

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" lead="The page you're looking for doesn't exist." />
      <section className="border-t border-border-subtle">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8 lg:py-20">
          <Link to="/" className={PRIMARY_BUTTON}>
            Back to home
          </Link>
        </div>
      </section>
    </>
  );
}
