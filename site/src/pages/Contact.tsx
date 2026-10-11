import { PageHeader } from '../components/PageHeader';
import { GITHUB_URL } from '../appLinks';

const CHANNELS = [
  { title: 'Questions about Ledova', label: 'hello@ledova.io', href: 'mailto:hello@ledova.io' },
  { title: 'Bugs and feature requests', label: 'Open an issue on GitHub', href: `${GITHUB_URL}/issues` },
  { title: 'Code of Conduct reports', label: 'conduct@ledova.io', href: 'mailto:conduct@ledova.io' },
];

export function Contact() {
  return (
    <>
      <PageHeader title="Contact" lead="Tell us about your company's register, or ask us anything about Ledova." />

      <section className="border-t border-rule">
        <ul className="mx-auto max-w-3xl px-5 py-12 md:px-8 lg:py-16">
          {CHANNELS.map((channel) => (
            <li
              key={channel.title}
              className="flex flex-col gap-1.5 border-b border-rule py-5 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <span className="text-base font-semibold text-ink">{channel.title}</span>
              <a
                href={channel.href}
                className="text-base text-ledger underline decoration-transparent underline-offset-4 transition-colors hover:decoration-ledger"
              >
                {channel.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
