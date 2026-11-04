export type IssueGroupKey = 'decide' | 'issued' | 'rejected';

export type IssueEntry = { uuid: string; stage: string; companyEventOn: string | null; createdAt: string };

export type IssueRow<Node> = IssueEntry & {
  shown: boolean;
  held: boolean;
  render: (layout: { collapsed: boolean; ruled: boolean }) => Node;
};

export type IssueGroup<Entry extends IssueEntry> = {
  key: IssueGroupKey;
  heading: string;
  entries: Entry[];
  more?: { show: string; hide: string };
};

export const ISSUE_GROUP_CAP = 5;

const GROUPS: { key: IssueGroupKey; title: string; more?: { show: (count: number) => string; hide: string } }[] = [
  { key: 'decide', title: 'Needs a decision' },
  { key: 'issued', title: 'Issued', more: { show: (count) => `Show all ${count} issues`, hide: 'Show fewer issues' } },
  {
    key: 'rejected',
    title: 'Rejected',
    more: { show: (count) => `Show all ${count} rejected issues`, hide: 'Show fewer' },
  },
];

export function issueGroup(stage: string): IssueGroupKey {
  return stage === 'applied' ? 'issued' : stage === 'rejected' ? 'rejected' : 'decide';
}

function newestFirst(left: IssueEntry, right: IssueEntry) {
  if (left.companyEventOn !== right.companyEventOn) {
    if (!left.companyEventOn) return 1;
    if (!right.companyEventOn) return -1;
    return left.companyEventOn < right.companyEventOn ? 1 : -1;
  }
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function issueGroups<Entry extends IssueEntry>(entries: readonly Entry[]): IssueGroup<Entry>[] {
  const sorted = [...entries].sort(newestFirst);
  return GROUPS.flatMap(({ key, title, more }) => {
    const rows = sorted.filter((entry) => issueGroup(entry.stage) === key);
    if (rows.length === 0) return [];
    const capped = !!more && rows.length > ISSUE_GROUP_CAP;
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
