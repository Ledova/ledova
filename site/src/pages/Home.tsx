import { Link } from 'react-router-dom';
import { SIGN_UP_URL } from '../appLinks';
import { PRIMARY_BUTTON, SECTION_HEADING, TEXT_LINK } from '../styles';

const COMPANY_POINTS = [
  {
    title: 'Register your company',
    body: 'Set up your company, confirm who can act for it, and open its share classes.',
  },
  {
    title: 'Issue and record shares',
    body: 'Allot shares and keep one register, with every change recorded in order.',
  },
  {
    title: 'Run shareholder admin',
    body: 'Send notices and statements, run votes and record dividends against the register.',
  },
  {
    title: 'Take your records with you',
    body: 'Get a pack of your records that anyone can check without Ledova.',
  },
];

const INVESTOR_POINTS = [
  {
    title: 'Discover companies',
    body: 'Browse the companies that have chosen to publish a profile.',
  },
  {
    title: 'Buy and sell shares',
    body: 'List shares for sale or make an offer. Shares and payment change hands in one step.',
  },
  {
    title: 'Keep your own keys',
    body: 'Your shares sit in a wallet you control, and you sign every transfer.',
  },
  {
    title: 'See what you own',
    body: "Your holdings, read against each company's own register.",
  },
];

const STEPS = [
  { title: 'Create an account', body: 'Sign up with your email, then verify who you are.' },
  { title: 'Get approved', body: 'Your wallet is verified, then approved for each company whose shares you hold.' },
  {
    title: 'Buy or sell',
    body: 'List shares for sale, or fund your wallet and make an offer. Shares and payment swap together, or not at all.',
  },
  {
    title: 'On the register',
    body: "Once the company's directors approve it, the transfer is entered in the register and checked against the chain.",
  },
];

const EXAMPLE_REGISTER = [
  { member: 'Holder A', shares: '40,000', since: 'Mar 2024' },
  { member: 'Holder B', shares: '25,000', since: 'Mar 2024' },
  { member: 'Holder C', shares: '20,000', since: 'Jan 2025' },
  { member: 'Holder D', shares: '15,000', since: 'Sep 2026' },
];

function ExampleRegister() {
  return (
    <figure className="flex flex-col gap-5 rounded-2xl border border-rule bg-paper-card p-5 shadow-[0_24px_48px_-32px_rgba(23,25,30,0.25)] sm:p-8">
      <figcaption className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-1">
          <span className="font-display text-[21px] leading-tight text-ink sm:text-[26px]">Example Co Pty Ltd</span>
          <span className="text-[13px] text-ink-muted sm:text-sm">Share register · Ordinary shares</span>
        </span>
        <span className="hidden shrink-0 rounded-full bg-ledger-tint px-3 py-1.5 text-[13px] font-medium text-ledger-hover sm:inline">
          4 members
        </span>
      </figcaption>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-rule text-left text-xs uppercase tracking-[0.08em] text-ink-muted">
            <th className="py-2.5 font-normal">Member</th>
            <th className="py-2.5 text-right font-normal">Shares</th>
            <th className="hidden py-2.5 text-right font-normal sm:table-cell">Held since</th>
          </tr>
        </thead>
        <tbody>
          {EXAMPLE_REGISTER.map((row) => (
            <tr key={row.member} className="border-b border-rule-soft last:border-b-0">
              <td className="py-3">{row.member}</td>
              <td className="py-3 text-right tabular-nums">{row.shares}</td>
              <td className="hidden py-3 text-right text-ink-muted sm:table-cell">{row.since}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex items-center gap-2.5 border-t border-rule pt-4 text-sm text-ink-muted">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
          <circle cx="9" cy="9" r="8" className="stroke-ledger" strokeWidth="1.5" />
          <path
            d="M5.5 9.2l2.3 2.3 4.7-4.9"
            className="stroke-ledger"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Register matches the chain
      </p>
    </figure>
  );
}

function Audience({ id, title, points }: { id: string; title: string; points: { title: string; body: string }[] }) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-col gap-8 md:scroll-mt-28">
      <h2 className={SECTION_HEADING}>{title}</h2>
      <ul className="border-b border-rule">
        {points.map((point) => (
          <li key={point.title} className="flex flex-col gap-1.5 border-t border-rule py-5 lg:py-6">
            <h3 className="text-base font-semibold text-ink lg:text-lg">{point.title}</h3>
            <p className="text-[15px] leading-relaxed text-ink-muted lg:text-base">{point.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-14 md:px-8 lg:grid-cols-2 lg:items-center lg:gap-20 lg:pb-28 lg:pt-24">
        <div className="flex flex-col gap-6 lg:gap-7">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ledger lg:text-[13px]">
            Share registry and marketplace
          </p>
          <h1 className="font-display text-[44px] leading-[1.04] tracking-[-0.02em] text-ink sm:text-6xl lg:text-[76px] lg:leading-[1.02]">
            The share register for private companies.
          </h1>
          <p className="max-w-[520px] text-[17px] leading-relaxed text-ink-muted lg:text-xl">
            Keep your shareholder records in one place, issue shares, and give approved investors a way to buy and sell,
            with every change recorded and checkable.
          </p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
            <a href={SIGN_UP_URL} className={PRIMARY_BUTTON}>
              Register
            </a>
            <Link to="/#how-it-works" className={`${TEXT_LINK} self-center sm:self-auto`}>
              See how it works <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <ExampleRegister />
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto grid max-w-6xl gap-16 px-5 py-20 md:px-8 lg:grid-cols-2 lg:gap-20 lg:py-24">
          <Audience id="companies" title="For companies" points={COMPANY_POINTS} />
          <Audience id="investors" title="For investors" points={INVESTOR_POINTS} />
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-16 border-t border-rule md:scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-24">
          <h2 className={SECTION_HEADING}>How it works</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:mt-12 lg:grid-cols-4 lg:gap-10">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-baseline gap-4 lg:flex-col lg:items-start lg:gap-3">
                <span className="w-10 shrink-0 font-display text-[28px] leading-none text-ledger lg:text-[40px]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-base font-semibold text-ink lg:text-lg">{step.title}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-muted lg:text-base">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 md:px-8 lg:pb-24">
        <div className="flex flex-col gap-7 rounded-2xl bg-paper-deep px-6 py-9 md:px-12 md:py-14 lg:flex-row lg:items-center lg:justify-between lg:px-16 lg:py-[72px]">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.01em] text-ink lg:text-5xl">
              Bring your register to Ledova.
            </h2>
            <p className="text-base text-ink-muted lg:text-lg">Companies and investors start with the same account.</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-7 lg:shrink-0">
            <a href={SIGN_UP_URL} className={PRIMARY_BUTTON}>
              Register
            </a>
            <Link to="/contact" className={`${TEXT_LINK} self-center sm:self-auto`}>
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
