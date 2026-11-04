import { Fragment, useId, useState, type ReactNode } from 'react';
import {
  RECORD_GROUP_CAP,
  recordGroups,
  type RecordGroupKey,
  type RecordGrouping,
  type RecordRow,
} from '@ledova/shared';
import { MoreToggle } from '@components/Ledger';

export function GroupedRecords({
  grouping,
  rows,
  requested,
  heading: Heading = 'h3',
}: {
  grouping: RecordGrouping;
  rows: RecordRow<ReactNode>[];
  requested?: { key: string; record: string };
  heading?: 'h3' | 'h4';
}) {
  const [expanded, setExpanded] = useState<Partial<Record<RecordGroupKey, boolean>>>({});
  const [revealed, setRevealed] = useState('');
  const list = useId();
  const groups = recordGroups(
    grouping,
    rows.filter((row) => row.shown),
  );
  const asked = requested && revealed !== requested.key ? requested : undefined;
  if (asked && groups.some((group) => group.entries.some((row) => row.uuid === asked.record))) setRevealed(asked.key);
  const opening = groups.find(
    (group) =>
      group.more &&
      !expanded[group.key] &&
      group.entries.some((row, index) => index >= RECORD_GROUP_CAP && (row.held || row.uuid === asked?.record)),
  );
  if (opening) setExpanded((current) => ({ ...current, [opening.key]: true }));
  return (
    <ul id={list} hidden={groups.length === 0}>
      {[
        ...groups.flatMap((group, at) => [
          ...(group.heading
            ? [
                <li key={group.key} className={at > 0 ? 'border-t border-border pt-4' : undefined}>
                  <Heading className="text-xs font-semibold text-text-muted">{group.heading}</Heading>
                </li>,
              ]
            : []),
          ...group.entries.map((row, index) => (
            <Fragment key={row.uuid}>
              {row.render({
                collapsed: !!group.more && !expanded[group.key] && index >= RECORD_GROUP_CAP,
                ruled: index > 0,
              })}
            </Fragment>
          )),
          ...(group.more
            ? [
                <li key={`${group.key}/more`} className="pb-4">
                  <MoreToggle
                    open={!!expanded[group.key]}
                    controls={list}
                    onToggle={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  >
                    {expanded[group.key] ? group.more.hide : group.more.show}
                  </MoreToggle>
                </li>,
              ]
            : []),
        ]),
        ...rows
          .filter((row) => !row.shown)
          .map((row) => <Fragment key={row.uuid}>{row.render({ collapsed: false, ruled: false })}</Fragment>),
      ]}
    </ul>
  );
}
