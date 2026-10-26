import { useState, type ReactNode } from 'react';
import { CompanyPicker } from '@components/CompanyPicker';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { useMemberWorkspace } from './useMemberWorkspace';

export function MemberRecordsContent({ children, actions = true }: { children: ReactNode; actions?: boolean }) {
  const { read, select } = useMemberWorkspace();
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
      {!read.readFailed && read.error && (
        <p role="alert" className="text-sm text-error-light">
          {read.error}
        </p>
      )}
      {actions && read.retry && (
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
          {read.records.length > 1 && (
            <div className="max-w-md">
              <CompanyPicker
                companies={read.records.map((record) => ({ uuid: record.uuid, name: record.company.name }))}
                value={read.record?.uuid ?? ''}
                disabled={read.busy || read.refreshing || !!read.retry}
                onChange={select}
              />
            </div>
          )}
          {read.record && !read.readFailed && (
            <>
              <h2 className="break-words font-display text-xl text-text-primary">{read.record.company.name}</h2>
              {children}
            </>
          )}
          {!read.readFailed && !read.record && read.records.length === 1 && (
            <Loading>Loading your company record…</Loading>
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
