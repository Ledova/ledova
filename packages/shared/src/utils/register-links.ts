import { formatShareCount } from '../constants/business/publications';
import { REGISTER_LINK_COPY } from '../constants/business/register-links';
import { REGISTER_OPENING_COPY } from '../constants/business/register-openings';
import type {
  RegisterLink,
  RegisterLinkPreparation,
  RegisterLinkRecord,
  RegisterLinkDecisionPreview,
  RegisterDecideRequest,
  RegisterOpeningLink,
  TokenHoldersResponse,
} from '../types';
import { rowsOf } from './register-commands';
import { sameMapping } from './register-openings';

type LinkedMember = Pick<RegisterLink['mappingSummary'][number], 'member' | 'memberExists'>;
type CurrentMember = Pick<
  TokenHoldersResponse['holders'][number],
  'member' | 'name' | 'balance' | 'shareClass' | 'wallets'
>;

export function registerLinkOf(record: RegisterLinkRecord): RegisterLink {
  const { mapping } = record;
  if (!rowsOf<RegisterOpeningLink>(mapping, ['address', 'member']))
    throw new Error(REGISTER_LINK_COPY.MAPPING_UNREADABLE);
  return { ...record, mapping };
}

export function isPreparedRegisterLink(link: RegisterLink, request: RegisterLinkPreparation) {
  return (
    link.uuid === request.operationId &&
    link.company === request.companyId &&
    link.preparingAppointment === request.appointment &&
    link.authorityEvidence === request.authorityEvidence &&
    link.authority === request.authority &&
    link.approvingDirector === (request.approvingDirector ?? '') &&
    link.authorityReference === request.authorityReference &&
    link.reason === request.reason &&
    link.providedBy === 'company' &&
    sameMapping(link.mapping, request.mapping)
  );
}

function toldApart(entries: [string, string][]) {
  const counts = new Map<string, number>();
  for (const [, label] of entries) counts.set(label, (counts.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return entries.map(([member, label]): [string, string] => {
    if (counts.get(label) === 1) return [member, label];
    seen.set(label, (seen.get(label) ?? 0) + 1);
    return [member, `${label} (${seen.get(label)})`];
  });
}

export function registerLinkMemberLabels(mapping: readonly LinkedMember[], holders: readonly CurrentMember[]) {
  const current = new Map<string, CurrentMember>();
  for (const holder of holders) if (!current.has(holder.member)) current.set(holder.member, holder);
  const nameOf = ({ name }: CurrentMember) => name?.trim() || null;
  const sharing = new Map<string, number>();
  for (const name of [...current.values()].map(nameOf))
    if (name) sharing.set(name.toLowerCase(), (sharing.get(name.toLowerCase()) ?? 0) + 1);
  const labelOf = (holder: CurrentMember) => {
    const name = nameOf(holder);
    if (name && sharing.get(name.toLowerCase()) === 1) return name;
    const [wallet] = holder.wallets;
    const detail = wallet
      ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
      : REGISTER_LINK_COPY.HOLDING(formatShareCount(holder.balance), holder.shareClass);
    return `${name ?? REGISTER_LINK_COPY.UNNAMED_MEMBER} · ${detail}`;
  };
  const mapped = (exists: boolean) => [
    ...new Set(
      mapping
        .filter(({ member, memberExists }) => memberExists === exists && !current.has(member))
        .map(({ member }) => member),
    ),
  ];
  return new Map([
    ...toldApart([...current.values()].map((holder): [string, string] => [holder.member, labelOf(holder)])),
    ...toldApart(mapped(true).map((member): [string, string] => [member, REGISTER_LINK_COPY.NOT_ON_REGISTER])),
    ...mapped(false).map((member, index): [string, string] => [
      member,
      REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED(index + 1),
    ]),
  ]);
}

export function isRegisterLinkDecisionReceipt(
  link: RegisterLink,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterLinkDecisionPreview,
) {
  const decision = link.decisions.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (
    link.uuid !== uuid ||
    !decision ||
    decision.kind !== request.kind ||
    decision.appointment !== request.appointment ||
    decision.digest !== request.previewDigest ||
    decision.reason !== (request.reason ?? '') ||
    (preview && !sameMapping(link.mapping, preview.links))
  )
    return false;
  if (request.kind === 'apply') return link.status === 'applied' && link.reviewedAt === decision.decidedAt;
  if (request.kind === 'reject')
    return (
      link.status === 'rejected' && link.reviewedAt === decision.decidedAt && link.rejectionReason === decision.reason
    );
  return ['submitted', 'applied', 'rejected'].includes(link.status);
}
