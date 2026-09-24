import { Link } from 'react-router-dom';
import { NewspaperIcon } from '@phosphor-icons/react';
import { DESIGN_TOKENS, PUBLICATION_COPY, usePublicationSummary } from '@ledova/shared';
import { Accordion } from '@components/Accordion';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

export function PublishedCard() {
  const { lines } = usePublicationSummary();

  if (lines.length === 0) return null;

  return (
    <Accordion title={PUBLICATION_COPY.LIST_TITLE} icon={<NewspaperIcon size={ICON_MD} />}>
      <ul className="flex flex-col gap-1 px-2">
        {lines.map((line) => (
          <li key={line} className="text-sm text-text-primary">
            {line}
          </li>
        ))}
      </ul>
      <div className="flex justify-end pt-3 mt-2 border-t border-border-subtle">
        <Link to="/publications" className="text-xs text-brand-mid hover:text-brand-light transition-colors">
          {PUBLICATION_COPY.SUMMARY_OPEN}
        </Link>
      </div>
    </Accordion>
  );
}
