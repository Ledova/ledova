export type RecordGroupKey = 'decide' | 'done' | 'rejected';

type RecordEntry = { uuid: string; stage: string; companyEventOn: string | null; createdAt: string };

export type RecordRow<Node> = RecordEntry & {
  shown: boolean;
  held: boolean;
  render: (layout: { collapsed: boolean; ruled: boolean }) => Node;
};

export type RecordGrouping = readonly {
  key: RecordGroupKey;
  title: string;
  stages: readonly string[];
  more?: { show: (count: number) => string; hide: string };
}[];

type RecordGroup<Entry extends RecordEntry> = {
  key: RecordGroupKey;
  heading: string;
  entries: Entry[];
  more?: { show: string; hide: string };
};

export const RECORD_GROUP_CAP = 5;

export const ISSUE_GROUPS: RecordGrouping = [
  { key: 'decide', title: 'Needs a decision', stages: ['submitted', 'approved'] },
  {
    key: 'done',
    title: 'Issued',
    stages: ['applied'],
    more: { show: (count) => `Show all ${count} issues`, hide: 'Show fewer issues' },
  },
  {
    key: 'rejected',
    title: 'Rejected',
    stages: ['rejected'],
    more: { show: (count) => `Show all ${count} rejected issues`, hide: 'Show fewer rejected issues' },
  },
];

export const TRANSFER_GROUPS: RecordGrouping = [
  { key: 'decide', title: 'Needs a decision', stages: ['submitted', 'approved'] },
  {
    key: 'done',
    title: 'Transferred',
    stages: ['applied'],
    more: { show: (count) => `Show all ${count} transfers`, hide: 'Show fewer transfers' },
  },
  {
    key: 'rejected',
    title: 'Rejected',
    stages: ['rejected'],
    more: { show: (count) => `Show all ${count} rejected transfers`, hide: 'Show fewer rejected transfers' },
  },
];

export function recordGroup(grouping: RecordGrouping, stage: string): RecordGroupKey {
  return grouping.find(({ stages }) => stages.includes(stage))?.key ?? 'decide';
}

function newestFirst(left: RecordEntry, right: RecordEntry) {
  if (left.companyEventOn !== right.companyEventOn) {
    if (!left.companyEventOn) return 1;
    if (!right.companyEventOn) return -1;
    return left.companyEventOn < right.companyEventOn ? 1 : -1;
  }
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function recordGroups<Entry extends RecordEntry>(
  grouping: RecordGrouping,
  entries: readonly Entry[],
): RecordGroup<Entry>[] {
  const sorted = [...entries].sort(newestFirst);
  return grouping.flatMap(({ key, title, more }) => {
    const rows = sorted.filter((entry) => recordGroup(grouping, entry.stage) === key);
    if (rows.length === 0) return [];
    const capped = !!more && rows.length > RECORD_GROUP_CAP;
    return [
      {
        key,
        heading: `${title} · ${rows.length}`,
        entries: rows,
        ...(capped ? { more: { show: more.show(rows.length), hide: more.hide } } : {}),
      },
    ];
  });
}
