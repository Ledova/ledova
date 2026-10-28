import { PageHeader } from '../components/PageHeader';
import { GITHUB_URL } from '../appLinks';
import { INLINE_LINK, SECTION_HEADING } from '../styles';

const CAPABILITIES = [
  {
    title: 'Understand ownership',
    body: 'Bring existing share classes, shareholders and holdings together, then explore how issued shares are distributed. Recording existing holdings does not issue new shares.',
  },
  {
    title: 'Keep company changes organised',
    body: 'Keep company-approved share issues and transfers, external investment evidence, employee awards and recorded vesting together. An award is a promised entitlement, separate from issued shares.',
  },
  {
    title: 'Give people access to their records',
    body: 'Invite shareholders and employees to their own holdings, awards and available unsigned certificates, plus any ownership overview the company shares with them. One account can connect to several companies.',
  },
];

export function About() {
  return (
    <>
      <PageHeader
        title="About Ledova"
        lead="A simpler way for private companies and their shareholders to understand ownership and keep records organised."
      />

      <section className="border-t border-border-subtle">
        <div className="mx-auto max-w-3xl px-5 py-16 md:px-8 lg:py-20">
          <h2 className={SECTION_HEADING}>What Ledova helps you do</h2>
          <ul className="mt-8 border-b border-border-subtle">
            {CAPABILITIES.map(({ title, body }) => (
              <li key={title} className="flex flex-col gap-1.5 border-t border-border-subtle py-5 lg:py-6">
                <h3 className="text-base font-semibold text-text-primary lg:text-lg">{title}</h3>
                <p className="text-[15px] leading-relaxed text-text-muted lg:text-base">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-border-subtle">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-16 md:px-8 lg:py-20">
          <h2 className={SECTION_HEADING}>Companies stay in control</h2>
          <p className="text-base leading-relaxed text-text-muted lg:text-lg">
            Ledova mirrors company-supplied ownership records. Companies keep responsibility for their legal register,
            historical records, lawful access arrangements, approvals and filings. Ledova provides the tools; company
            decisions stay with the people authorised to make them.
          </p>
        </div>
      </section>

      <section className="border-t border-border-subtle">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-16 md:px-8 lg:py-20">
          <h2 className={SECTION_HEADING}>Free during preview</h2>
          <p className="text-base leading-relaxed text-text-muted lg:text-lg">
            The current preview is free, experimental and unaudited. Explore it with fictional data only; do not submit
            real funds, securities, identity documents or personal information.
          </p>
          <p className="text-base leading-relaxed text-text-muted lg:text-lg">
            Ledova&apos;s source code is published on{' '}
            <a href={GITHUB_URL} className={INLINE_LINK}>
              GitHub
            </a>{' '}
            under the{' '}
            <a href={`${GITHUB_URL}/blob/main/LICENSE`} className={INLINE_LINK}>
              Ledova Noncommercial License 1.0
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}
