import { PageHeader } from '../components/PageHeader';
import { GITHUB_URL } from '../appLinks';
import { SECTION_HEADING } from '../styles';

const PRINCIPLES = [
  {
    title: 'The register is the record',
    body: "Each company's register is an ordered, hash-chained history of its issues and transfers. Holdings are worked out from that history.",
  },
  {
    title: 'The chain is the check',
    body: 'Shares are also held as tokens on a public blockchain. Ledova reconciles each register against the chain and flags any difference.',
  },
  {
    title: 'Settlement is one step',
    body: 'A trade swaps shares for payment in a single transaction that either completes in full or not at all.',
  },
  {
    title: 'Your keys stay yours',
    body: 'Ledova never holds your keys. You sign every transfer, with your recovery phrase in the app or a hardware wallet.',
  },
];

export function About() {
  return (
    <>
      <PageHeader
        title="About Ledova"
        lead="Ledova is a share registry for private companies and a marketplace for their shares. Companies keep their register on Ledova, approved investors buy and sell, and every change is recorded."
      />

      <section className="border-t border-rule">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8 lg:py-20">
          <h2 className={SECTION_HEADING}>How it is built</h2>
          <ul className="mt-8 border-b border-rule">
            {PRINCIPLES.map((principle) => (
              <li key={principle.title} className="flex flex-col gap-1.5 border-t border-rule py-5 lg:py-6">
                <h3 className="text-base font-semibold text-ink lg:text-lg">{principle.title}</h3>
                <p className="text-[15px] leading-relaxed text-ink-muted lg:text-base">{principle.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-rule">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-16 md:px-8 lg:py-20">
          <h2 className={SECTION_HEADING}>Source available</h2>
          <p className="text-base leading-relaxed text-ink-muted lg:text-lg">
            Ledova&apos;s source code is published on{' '}
            <a href={GITHUB_URL} className="font-medium text-ink underline decoration-rule-strong underline-offset-4">
              GitHub
            </a>{' '}
            under the{' '}
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE`}
              className="font-medium text-ink underline decoration-rule-strong underline-offset-4"
            >
              Ledova Noncommercial License 1.0
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}
