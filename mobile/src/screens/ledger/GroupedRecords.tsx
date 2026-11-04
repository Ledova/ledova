import { Fragment, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  RECORD_GROUP_CAP,
  recordGroups,
  type RecordGroupKey,
  type RecordGrouping,
  type RecordRow,
} from '@ledova/shared';
import { MoreToggle } from '../../components/Ledger';
import { useLedgerStyles } from './useLedgerStyles';

export function GroupedRecords({
  grouping,
  rows,
  requested,
  browsing,
}: {
  grouping: RecordGrouping;
  rows: RecordRow<ReactNode>[];
  requested?: { key: string; record: string };
  browsing: boolean;
}) {
  const look = useLedgerStyles();
  const [expanded, setExpanded] = useState<Partial<Record<RecordGroupKey, boolean>>>({});
  const [revealed, setRevealed] = useState('');
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
    <View style={groups.length === 0 && look.hidden}>
      {[
        ...groups.flatMap((group, at) => [
          ...(group.heading
            ? [
                <Text
                  key={group.key}
                  accessibilityRole="header"
                  style={[look.groupTitle, at > 0 && look.groupRule, !browsing && look.hidden]}
                >
                  {group.heading}
                </Text>,
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
                <View key={`${group.key}/more`} style={[look.more, !browsing && look.hidden]}>
                  <MoreToggle
                    open={!!expanded[group.key]}
                    onToggle={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  >
                    {expanded[group.key] ? group.more.hide : group.more.show}
                  </MoreToggle>
                </View>,
              ]
            : []),
        ]),
        ...rows
          .filter((row) => !row.shown)
          .map((row) => <Fragment key={row.uuid}>{row.render({ collapsed: false, ruled: false })}</Fragment>),
      ]}
    </View>
  );
}
