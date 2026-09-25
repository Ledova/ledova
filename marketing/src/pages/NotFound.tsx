import { Link } from 'react-router-dom';
import { PRIMARY_BUTTON } from '../styles';

export function NotFound() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 px-5 pb-24 pt-14 md:px-8 lg:pt-24">
      <p className="font-display text-6xl text-ledger">404</p>
      <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl">
        Page not found
      </h1>
      <p className="text-[17px] text-ink-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/" className={`${PRIMARY_BUTTON} mt-3`}>
        Back to home
      </Link>
    </section>
  );
}
