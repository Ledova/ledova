import { PageHeader } from '../components/PageHeader';
import { GITHUB_URL } from '../appLinks';
import { INLINE_LINK, PAGE_SECTION } from '../styles';

const CHANNELS = [
  { title: 'Questions about Ledova', label: 'hello@ledova.io', href: 'mailto:hello@ledova.io' },
  { title: 'Bugs and feature requests', label: 'Open an issue on GitHub', href: `${GITHUB_URL}/issues` },
  { title: 'Code of Conduct reports', label: 'conduct@ledova.io', href: 'mailto:conduct@ledova.io' },
];

export function Contact() {
  return (
    <>
      <PageHeader title="Contact" lead="Tell us about your company's register, or ask us anything about Ledova." />

      <section className="border-t border-border-subtle">
        <ul className={PAGE_SECTION}>
          {CHANNELS.map((channel) => (
            <li
              key={channel.title}
              className="flex flex-col gap-1.5 border-b border-border-subtle py-5 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <span className="text-base font-semibold text-text-primary">{channel.title}</span>
              <a href={channel.href} className={`text-base ${INLINE_LINK}`}>
                {channel.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
