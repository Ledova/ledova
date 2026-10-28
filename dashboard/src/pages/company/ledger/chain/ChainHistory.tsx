import { useId, useState, type ReactNode } from 'react';
import { formatDate, formatShareCount, shareCount } from '@ledova/shared';
import { LoadError, Loading, MoreToggle, Section, Status } from '@components/Ledger';
import { LoadMore, type Noun } from '@components/List';
import { requestTone } from '@pages/company/shared/statusTones';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';
import { useChainHistory } from './useChainHistory';

interface Feed {
  rows: unknown[];
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  more: ReturnType<typeof useChainHistory>['issuances']['more'];
}

function History({
  title,
  note,
  feed,
  noun,
  children,
}: {
  title: string;
  note?: string;
  feed: Feed;
  noun: Noun;
  children: ReactNode;
}) {
  if (!feed.isPending && !feed.isError && feed.rows.length === 0) return null;
  return (
    <Section title={title}>
      {note && <p className="text-sm text-text-muted">{note}</p>}
      {feed.isPending ? (
        <Loading>Loading {noun[1]}…</Loading>
      ) : feed.isError ? (
        <LoadError retry={feed.refetch} busy={feed.isFetching}>
          {title} could not be loaded.
        </LoadError>
      ) : (
        <>
          <ul className="divide-y divide-border-subtle">{children}</ul>
          <LoadMore noun={noun} {...feed.more} />
        </>
      )}
    </Section>
  );
}

function ExecutionNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <MoreToggle open={open} controls={id} onToggle={() => setOpen((value) => !value)}>
        {open ? 'Hide execution history' : 'Show execution history'}
      </MoreToggle>
      <p id={id} hidden={!open} className="whitespace-pre-wrap text-text-muted">
        {notes}
      </p>
    </>
  );
}

export function ChainHistory({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const { issuances, capital, requests } = useChainHistory(uuid, data);
  if (!data.isOwner) return null;
  return (
    <>
      <History title="Issuance requests" feed={requests} noun={['issuance request', 'issuance requests']}>
        {requests.rows.map((request) => (
          <li key={request.uuid} className="space-y-2 py-4 text-sm">
            <p className="break-words text-text-primary">
              {formatShareCount(String(request.amount))} {request.tokenSymbol} to {request.recipientAddress}
            </p>
            <p className="text-text-muted">{request.reason || request.issuanceTypeDisplay}</p>
            <p>
              <Status tone={requestTone(request.status)}>{request.statusDisplay}</Status>
            </p>
            <p className="text-xs text-text-muted">{formatDate(request.createdAt)}</p>
            {request.rejectionReason && <p className="text-text-muted">{request.rejectionReason}</p>}
            {request.executionNotes && <ExecutionNotes notes={request.executionNotes} />}
          </li>
        ))}
      </History>
      <History
        title="Authorised share requests"
        note="Requests made before capital increases became company decisions. New increases use Company capital increases."
        feed={capital}
        noun={['authorised share request', 'authorised share requests']}
      >
        {capital.rows.map((request) => (
          <li key={request.uuid} className="space-y-2 py-4 text-sm">
            <p className="break-words text-text-primary">{request.purpose}</p>
            <p className="text-text-muted">
              +{formatShareCount(String(request.additionalShares))} →{' '}
              {shareCount(request.newAuthorizedTotal, 'authorised')}
            </p>
            <p>
              <Status tone={requestTone(request.status)}>{request.statusDisplay}</Status>
            </p>
            <p className="text-xs text-text-muted">{formatDate(request.createdAt)}</p>
          </li>
        ))}
      </History>
      <History title="Issuances" feed={issuances} noun={['issuance', 'issuances']}>
        {issuances.rows.map((issuance) => (
          <li key={issuance.uuid} className="space-y-2 py-4 text-sm">
            <p className="break-words text-text-primary">
              {shareCount(issuance.amount)} to {issuance.recipientAddress}
            </p>
            <p className="text-text-muted">
              {issuance.statusDisplay} · {formatDate(issuance.createdAt)}
            </p>
            {issuance.subscriptionReference && (
              <p className="text-text-muted">Application {issuance.subscriptionReference}</p>
            )}
          </li>
        ))}
      </History>
    </>
  );
}
