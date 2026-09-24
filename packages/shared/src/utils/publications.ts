import { PUBLICATION_COPY } from '../constants';
import type { PublicationSummary } from '../types';
import { formatDateTime } from './date';

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function describePublicationSummary(summary: PublicationSummary): string[] {
  const lines: string[] = [];
  if (summary.publishedSince > 0)
    lines.push(
      counted(summary.publishedSince, PUBLICATION_COPY.SUMMARY_PUBLISHED_ONE, PUBLICATION_COPY.SUMMARY_PUBLISHED_MANY),
    );
  if (summary.openResolutions > 0)
    lines.push(
      `${counted(
        summary.openResolutions,
        PUBLICATION_COPY.SUMMARY_RESOLUTION_ONE,
        PUBLICATION_COPY.SUMMARY_RESOLUTION_MANY,
      )} ${formatDateTime(summary.nextClosesAt)}`,
    );
  if (summary.dividendsWithoutRecord > 0)
    lines.push(
      counted(
        summary.dividendsWithoutRecord,
        PUBLICATION_COPY.SUMMARY_DIVIDEND_ONE,
        PUBLICATION_COPY.SUMMARY_DIVIDEND_MANY,
      ),
    );
  return lines;
}
