import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { LoadError, Loading, Section, Failure } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { useMemberWorkspace } from './useMemberWorkspace';

export function MemberRecordsContent({ children }: { children: ReactNode }) {
  const { read } = useMemberWorkspace();
  const requested = new URLSearchParams(useLocation().search).get('company');
  const record = read.record && requested && read.record.company.uuid === requested ? read.record : null;
  const associated = !requested || read.records.some(({ company }) => company.uuid === requested);
  const [retrying, setRetrying] = useState(false);
  return (
    <>
      {read.readFailed && (
        <LoadError
          retry={() => {
            setRetrying(true);
            return read.refresh().finally(() => setRetrying(false));
          }}
          busy={retrying || read.busy || read.refreshing}
        >
          Your member records could not be loaded.
        </LoadError>
      )}
      {!read.readFailed && read.error && <Failure>{read.error}</Failure>}
      {read.retry && (
        <PageAction
          label="Retry original member action"
          disabled={read.busy || read.refreshing || read.readFailed || !read.owner}
          onClick={() => void read.recover()}
        />
      )}
      {!read.owner ? (
        <p role="status">Check your signed-in account before opening member records.</p>
      ) : read.loading || retrying || read.refreshing || (read.busy && read.records.length === 0) ? (
        <Loading>Loading member records…</Loading>
      ) : (
        <>
          {!requested && !read.readFailed && read.records.length > 0 && <CompanyContextNotice />}
          {record && !read.readFailed && children}
          {!read.readFailed && !record && associated && requested && <Loading>Loading your company record…</Loading>}
          {!read.readFailed && !associated && (
            <p className="text-sm text-text-muted">Your account has no member record for this company.</p>
          )}
          {!read.error && read.records.length === 0 && (
            <Section title="Get access to your shares">
              <p className="text-sm text-text-muted">
                Open the invitation email from your company to see your shares and employee awards here.
              </p>
            </Section>
          )}
        </>
      )}
    </>
  );
}
