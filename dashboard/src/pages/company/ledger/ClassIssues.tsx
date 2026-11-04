import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ISSUE_GROUP_CAP,
  issueGroups,
  type IssueGroupKey,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Choices } from '@components/Choices';
import { MoreToggle, Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { useInvestorIssues } from './useInvestorIssues';
import { useNonPaidIssues } from './useNonPaidIssues';
import { useIssueEntryRead } from './useIssueEntryRead';

const KINDS = [
  ['investor', 'Investor issue'],
  ['nonpaid', 'Non-paid issue'],
] as const;

type IssueKind = (typeof KINDS)[number][0];

export interface IssueRequest {
  key: string;
  member?: string;
  award?: string;
  record?: string;
}

export function ClassIssues({
  owner,
  company,
  register,
  guard,
  sourceReady,
  visible,
  onAllotmentHeld,
  onGrantHeld,
  request,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  visible: boolean;
  onAllotmentHeld: (token: string, held: boolean) => void;
  onGrantHeld: (token: string, held: boolean) => void;
  request?: IssueRequest;
}) {
  const [preparing, setPreparing] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<HTMLDivElement | null>(null);
  const reviewChanged = useCallback((uuid: string, open: boolean) => {
    setReviewing((current) => (open ? uuid : current === uuid ? null : current));
  }, []);
  const [returnToAction, setReturnToAction] = useState(false);
  const prepareAction = useRef<HTMLButtonElement>(null);
  const preparation = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [award, setAward] = useState<string | undefined>();
  const [member, setMember] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const [expanded, setExpanded] = useState<Partial<Record<IssueGroupKey, boolean>>>({});
  const [revealed, setRevealed] = useState('');
  const list = useId();
  const close = (recorded = false) => {
    setPreparing(false);
    setReturnToAction(!recorded);
    setKind('');
    setAward(undefined);
    setMember(undefined);
  };
  useEffect(() => {
    if (visible && preparing) preparation.current?.focus();
  }, [visible, preparing]);
  const investor = useInvestorIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    visible,
    onHeldChange: onAllotmentHeld,
    issueMember: member,
    open: preparing && kind === 'investor',
    kept: preparing,
    onClosed: close,
    reviewTarget,
    onReviewChange: reviewChanged,
  });
  const nonPaid = useNonPaidIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    visible,
    onHeldChange: onGrantHeld,
    award,
    focusRecord: request?.record ? { key: request.key, uuid: request.record } : undefined,
    open: preparing && kind === 'nonpaid',
    kept: preparing,
    onClosed: close,
    reviewTarget,
    onReviewChange: reviewChanged,
  });
  useIssueEntryRead({
    owner,
    company,
    token: register.token.uuid,
    guard,
    visible,
    sourceReady,
    refreshRecords: () => Promise.allSettled([investor.refreshRecords(), nonPaid.refreshRecords()]),
  });
  const held = investor.held || nonPaid.held;
  const formShown = kind === 'investor' ? investor.formShown : kind === 'nonpaid' && nonPaid.formShown;
  useEffect(() => {
    if (visible && !preparing && returnToAction && sourceReady && prepareAction.current) {
      prepareAction.current.focus();
      setReturnToAction(false);
    }
  }, [visible, preparing, returnToAction, sourceReady, investor.prepare]);
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award || request.member) {
      setPreparing(true);
      setReturnToAction(false);
      setKind(request.award ? 'nonpaid' : 'investor');
      setAward(request.award);
      setMember(request.member);
    }
  }
  const records = [...investor.records, ...nonPaid.records];
  const groups = issueGroups(records.filter((record) => record.shown));
  const requested = request?.record && revealed !== request.key ? request : undefined;
  if (requested && groups.some((group) => group.entries.some((record) => record.uuid === requested.record)))
    setRevealed(requested.key);
  const opening = groups.find(
    (group) =>
      group.more &&
      !expanded[group.key] &&
      group.entries.some(
        (record, index) => index >= ISSUE_GROUP_CAP && (record.held || record.uuid === requested?.record),
      ),
  );
  if (opening) setExpanded((current) => ({ ...current, [opening.key]: true }));
  const status = (
    <>
      {investor.setup}
      {investor.status}
      {nonPaid.status}
    </>
  );
  const browsing = !preparing && !reviewing;
  return (
    <div role="region" aria-label="Share issue workflow" className="space-y-5">
      <div hidden={!browsing}>
        <Section title="Share issues">
          {browsing && status}
          {investor.empty && nonPaid.empty && <p className="text-sm text-text-muted">No share issues recorded yet.</p>}
          <ul id={list} hidden={groups.length === 0}>
            {[
              ...groups.flatMap((group, at) => [
                <li key={group.key} className={at > 0 ? 'border-t border-border pt-4' : undefined}>
                  <h3 className="text-xs font-semibold text-text-muted">{group.heading}</h3>
                </li>,
                ...group.entries.map((record, index) => (
                  <Fragment key={record.uuid}>
                    {record.render({
                      collapsed: !!group.more && !expanded[group.key] && index >= ISSUE_GROUP_CAP,
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
              ...records
                .filter((record) => !record.shown)
                .map((record) => (
                  <Fragment key={record.uuid}>{record.render({ collapsed: false, ruled: false })}</Fragment>
                )),
            ]}
          </ul>
        </Section>
      </div>
      {investor.prepare && browsing && (
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={prepareAction}
            label="Prepare issue"
            primary
            disabled={held || !sourceReady}
            onClick={() => {
              setReturnToAction(false);
              setPreparing(true);
            }}
          />
        </div>
      )}
      <div hidden={!reviewing} className="space-y-5">
        {reviewing && status}
        <div ref={setReviewTarget} />
      </div>
      <div ref={preparation} tabIndex={-1} hidden={!preparing} className="focus:outline-none">
        <Section title="Prepare share issue">
          {preparing && status}
          <Choices legend="What kind of issue?" options={KINDS} value={kind} disabled={held} onChange={setKind} />
          {investor.form}
          {nonPaid.form}
          {!formShown && (
            <FormActions>
              <PageAction label="Cancel" disabled={held} onClick={() => close()} />
            </FormActions>
          )}
        </Section>
      </div>
    </div>
  );
}
