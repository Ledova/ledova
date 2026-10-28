import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, ArrowUpRightIcon, ChartPieIcon, NotebookIcon, UsersIcon } from '@phosphor-icons/react';
import { SIGN_UP_URL } from '../appLinks';
import { PRIMARY_BUTTON, SECTION_HEADING, TEXT_LINK } from '../styles';

const PRODUCT_VIEWS = [
  {
    label: 'Ownership',
    image: 'ownership',
    alt: 'Ledova company dashboard with 19,000 issued shares across six share classes, an ownership ring and class list.',
    caption: 'See ownership by share class, then explore the detail.',
  },
  {
    label: 'Ledger',
    image: 'ledger',
    alt: 'Ledova Ledger showing share classes, their issued shares and shareholder counts.',
    caption: 'Keep share classes and current ownership in a clear ledger.',
  },
  {
    label: 'Documents',
    image: 'certificates',
    alt: 'Ledova Certificates page showing fictional shareholder records and available certificate preparation actions.',
    caption: 'Find certificate records and the next available action.',
  },
];

const FEATURES = [
  {
    title: 'Understand ownership',
    body: 'Explore share classes and see how shares are distributed.',
    Icon: ChartPieIcon,
  },
  {
    title: 'Keep changes organised',
    body: 'Record company-approved share issues, transfers and employee awards.',
    Icon: NotebookIcon,
  },
  {
    title: 'Share the right records',
    body: 'Invite shareholders to their holdings, awards and available certificates.',
    Icon: UsersIcon,
  },
];

const STEPS = [
  { title: 'Set up your workspace', body: 'Add your company and the people authorised to manage it.' },
  { title: 'Bring your existing records', body: 'Record share classes, shareholders and their current holdings.' },
  { title: 'Keep everyone informed', body: 'Maintain changes and invite people to their records.' },
];

const QUESTIONS = [
  { question: 'Is Ledova free?', answer: 'The preview is currently free. It is experimental and uses fictional data.' },
  {
    question: 'Does it replace our legal register?',
    answer:
      'Ledova mirrors company-supplied ownership records. Your company remains responsible for its legal register, approvals, historical records, lawful access arrangements and filings.',
  },
  {
    question: 'Can I use real company data?',
    answer:
      'The current experimental preview is for fictional data only. Do not upload real identity documents, securities or personal information.',
  },
  {
    question: 'Do I need a wallet?',
    answer: 'A wallet is unnecessary for the core ownership record-keeping workflows.',
  },
];

function ProductPreview() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? PRODUCT_VIEWS.length - 1
          : event.key === 'ArrowRight'
            ? (selected + 1) % PRODUCT_VIEWS.length
            : event.key === 'ArrowLeft'
              ? (selected + PRODUCT_VIEWS.length - 1) % PRODUCT_VIEWS.length
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    tabs.current?.querySelectorAll('button')[next]?.focus();
  }

  return (
    <figure id="product" className="mt-10 scroll-mt-24 text-left md:scroll-mt-28">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div ref={tabs} role="tablist" aria-label="Explore the product" onKeyDown={navigate} className="flex gap-1">
          {PRODUCT_VIEWS.map((view, index) => (
            <button
              key={view.image}
              id={`product-tab-${view.image}`}
              type="button"
              role="tab"
              aria-selected={selected === index}
              aria-controls={`product-view-${view.image}`}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              className={`min-h-11 rounded-md px-3.5 text-sm transition-colors ${selected === index ? 'bg-brand-tint text-brand-subtle' : 'text-text-muted hover:text-text-primary'}`}
            >
              {view.label}
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-text-muted sm:inline">Purpose Demo · Fictional company</span>
      </div>
      {PRODUCT_VIEWS.map((view, index) => (
        <div
          key={view.image}
          id={`product-view-${view.image}`}
          role="tabpanel"
          aria-labelledby={`product-tab-${view.image}`}
          hidden={selected !== index}
          className="aspect-[1468/875] overflow-hidden rounded-xl border border-border-subtle bg-surface-raised shadow-[0_20px_50px_-18px_rgba(23,25,30,0.12)]"
        >
          <img
            src={`/screenshots/${view.image}.jpg`}
            alt={view.alt}
            width={1969}
            height={1199}
            loading={index === 0 ? 'eager' : 'lazy'}
            className="block h-auto w-[134.1281%] max-w-none"
          />
        </div>
      ))}
      <figcaption className="mt-3 text-center text-xs text-text-muted">{PRODUCT_VIEWS[selected].caption}</figcaption>
    </figure>
  );
}

export function Home() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-12 text-center md:px-8 lg:pt-16">
        <p className="text-xs font-medium uppercase tracking-[0.11em] text-brand-light">Private company equity</p>
        <h1 className="mx-auto mb-5 mt-4 max-w-[820px] text-balance font-display text-[44px] leading-[1.06] tracking-[-0.025em] text-text-primary sm:text-6xl lg:text-[66px]">
          A clearer picture of your company’s ownership.
        </h1>
        <p className="mx-auto max-w-[610px] text-pretty text-base leading-relaxed text-text-muted sm:text-lg">
          Organise share classes, shareholders and employee equity, and give people access to their records.
        </p>
        <div className="mb-3 mt-7 flex flex-wrap items-center justify-center gap-6">
          <a href={SIGN_UP_URL} className={`${PRIMARY_BUTTON} gap-2`}>
            Try the preview <ArrowRightIcon size={18} aria-hidden="true" />
          </a>
          <Link to="/#how-it-works" className={`${TEXT_LINK} inline-flex items-center gap-2`}>
            See how it works <ArrowUpRightIcon size={18} aria-hidden="true" />
          </Link>
        </div>
        <p className="text-xs text-text-muted">Free during preview · Use fictional data</p>
        <ProductPreview />
      </section>

      <section
        aria-label="Core features"
        className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-3 md:gap-10 md:px-8 lg:py-16"
      >
        {FEATURES.map(({ title, body, Icon }) => (
          <article key={title} className="grid grid-cols-[24px_1fr] gap-x-4 md:block">
            <Icon size={24} aria-hidden="true" className="row-span-2 mt-0.5 text-brand-light md:mb-4 md:mt-0" />
            <h2 className="mb-2 text-base font-medium text-text-primary">{title}</h2>
            <p className="text-sm leading-relaxed text-text-muted">{body}</p>
          </article>
        ))}
      </section>

      <section id="how-it-works" className="scroll-mt-16 bg-surface-tertiary py-12 md:scroll-mt-20 lg:py-16">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <h2 className={`${SECTION_HEADING} max-w-[560px] text-balance`}>Start with the records you already have.</h2>
          <p className="mt-4 max-w-[560px] text-text-muted">
            A simple path from company setup to a clearer view of ownership.
          </p>
          <ol className="mt-9 grid gap-7 md:grid-cols-3 md:gap-10">
            {STEPS.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[32px_1fr] gap-x-4 md:block">
                <span className="row-span-2 font-display text-[28px] leading-tight text-brand-light md:mb-3 md:block">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mb-2 text-base font-medium text-text-primary">{step.title}</h3>
                <p className="text-sm leading-relaxed text-text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12 md:px-8 lg:py-16">
        <h2 className={SECTION_HEADING}>One company. Different perspectives.</h2>
        <div className="mt-7 grid gap-7 md:grid-cols-2 md:gap-12">
          <article className="border-t border-border-subtle pt-6">
            <h3 className="mb-3 font-display text-2xl text-text-primary">For companies</h3>
            <p className="text-sm leading-relaxed text-text-muted">
              See the ownership picture and manage the records behind it: shareholders, company-approved changes, awards
              and documents.
            </p>
          </article>
          <article className="border-t border-border-subtle pt-6">
            <h3 className="mb-3 font-display text-2xl text-text-primary">For shareholders and employees</h3>
            <p className="text-sm leading-relaxed text-text-muted">
              See your own shares and awards, obtain available certificates and explore any ownership overview the
              company shares with you. One account can connect to several companies.
            </p>
          </article>
        </div>
      </section>

      <section id="questions" className="scroll-mt-24 border-t border-border-subtle py-12 md:scroll-mt-28 lg:py-14">
        <div className="mx-auto grid max-w-6xl gap-7 px-5 md:grid-cols-[0.8fr_1.2fr] md:gap-14 md:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.11em] text-brand-light">A few useful answers</p>
            <h2 className={`${SECTION_HEADING} mt-3 max-w-[320px] text-balance`}>Simple, with clear boundaries.</h2>
          </div>
          <div>
            {QUESTIONS.map(({ question, answer }) => (
              <details key={question} className="group border-b border-border-subtle py-4 first:pt-0">
                <summary className="flex min-h-6 cursor-pointer list-none items-start justify-between gap-4 text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden">
                  {question}
                  <span aria-hidden="true" className="text-lg leading-none text-text-muted group-open:hidden">
                    +
                  </span>
                  <span aria-hidden="true" className="hidden text-lg leading-none text-text-muted group-open:inline">
                    −
                  </span>
                </summary>
                <p className="pr-6 pt-3 text-sm leading-relaxed text-text-muted">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-14 md:px-8">
        <div className="flex flex-col items-start justify-between gap-7 rounded-xl bg-brand-tint p-7 md:flex-row md:items-center md:px-10 md:py-9">
          <div>
            <h2 className="font-display text-[32px] leading-tight text-text-primary">Get to know your ownership.</h2>
            <p className="mt-2 text-sm text-text-muted">Explore Ledova with a fictional company.</p>
          </div>
          <a href={SIGN_UP_URL} className={`${PRIMARY_BUTTON} shrink-0 gap-2`}>
            Try the preview <ArrowRightIcon size={18} aria-hidden="true" />
          </a>
        </div>
      </section>
    </>
  );
}
