import { formatDateTime, formatShortDate } from './date';

function prepared(at: string, by: string) {
  return by ? `${formatDateTime(at)} by ${by}` : formatDateTime(at);
}

export function inspectionCopyFacts(copy: {
  requestedOn: string;
  late: boolean;
  preparedAt: string;
  preparedByName: string;
}) {
  return `Requested ${formatShortDate(copy.requestedOn)}${copy.late ? ' · provided late' : ''} · prepared ${prepared(copy.preparedAt, copy.preparedByName)}`;
}

export function companyPackFacts(pack: { preparedAt: string; preparedByName: string; classes: number }) {
  return `Prepared ${prepared(pack.preparedAt, pack.preparedByName)} · ${pack.classes} ${pack.classes === 1 ? 'share class' : 'share classes'}`;
}
