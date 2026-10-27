import { useEffect, useRef, useState } from 'react';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { Outcome, Section, LoadError, Loading } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import { useSubmissionOwner, useUserPreferences, type OrderSubmissionOwner, failureSentence } from '@ledova/shared';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { AuthorityRequestRecord } from './AuthorityRequestRecord';
import { useAuthorityRequests } from './useAuthorityRequests';

export default function CompanyAuthorityPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner)
    return (
      <Page narrow>
        {preferences.isError ? (
          <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
            Your account could not be loaded.
          </LoadError>
        ) : (
          <p className="text-sm text-text-muted">
            Verify your signed-in account before opening representative authority.
          </p>
        )}
      </Page>
    );
  return (
    <OwnAuthorityRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}`}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

function OwnAuthorityRequests({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const { guard, recorded, setRecorded, companies, history, company, lifecycle, opening } = useAuthorityRequests({
    owner,
    currentOwner,
  });
  const [preparing, setPreparing] = useState(false);
  const form = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preparing) form.current?.focus();
  }, [preparing]);
  const close = () => {
    setPreparing(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <Page lede="Manage your own company appointment and its authorisation declaration.">
      <Outcome>{recorded && `Request recorded. ${recorded.verificationMessage}`}</Outcome>
      <div hidden={preparing}>
        <Section title="Authority requests">
          {history.isLoading ? (
            <Loading>Loading your requests…</Loading>
          ) : history.isError ? (
            <LoadError retry={() => history.refetch()} busy={history.isFetching}>
              Your authority requests could not be loaded.
            </LoadError>
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-text-muted">No authority requests yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {(history.data ?? []).map((request) => (
                <AuthorityRequestRecord
                  key={request.uuid}
                  request={request}
                  blocked={lifecycle.isPending || history.isFetching}
                  opening={opening.isPending}
                  downloading={opening.isPending && opening.variables?.uuid === request.uuid}
                  action={
                    lifecycle.isPending && lifecycle.variables?.request.uuid === request.uuid
                      ? lifecycle.variables.action
                      : undefined
                  }
                  onDownload={() => opening.mutate(request)}
                  onWithdraw={() => lifecycle.mutateAsync({ request, action: 'withdraw' })}
                  onAdmit={() => lifecycle.mutate({ request, action: 'admit' })}
                  onRevoke={() => lifecycle.mutateAsync({ request, action: 'revoke' })}
                />
              ))}
            </ul>
          )}
          {opening.isError && (
            <p role="alert" className="text-sm text-error-light">
              {failureSentence(opening.error, 'Your evidence could not be downloaded.')}
            </p>
          )}
          {lifecycle.isError && (
            <p role="alert" className="text-sm text-error-light">
              {failureSentence(lifecycle.error, 'Your request outcome could not be confirmed. Refresh or retry.')}
            </p>
          )}
        </Section>
      </div>
      <div ref={form} tabIndex={-1} hidden={!preparing} className="focus:outline-none">
        <Section title="New authority request">
          {companies.isLoading ? (
            <Loading>Loading your companies…</Loading>
          ) : companies.isError ? (
            <LoadError retry={() => companies.refetch()} busy={companies.isFetching}>
              Your companies could not be loaded.
            </LoadError>
          ) : !company ? (
            <CompanyContextNotice />
          ) : (
            <p className="text-sm text-text-muted">{company.name}</p>
          )}
          {!recorded && company && (
            <AuthorityRequestForm
              key={company.uuid}
              company={company}
              disabled={companies.isFetching}
              guard={guard}
              onCancel={close}
              onSuccess={(request) => {
                guard();
                setRecorded(request);
                close();
                void history.refetch();
              }}
            />
          )}
          {!company && (
            <FormActions>
              <PageAction label="Cancel" onClick={close} />
            </FormActions>
          )}
        </Section>
      </div>
      {!preparing && (
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={opener}
            label="Request authority"
            primary
            disabled={lifecycle.isPending}
            onClick={() => {
              setRecorded(null);
              setPreparing(true);
            }}
          />
        </div>
      )}
    </Page>
  );
}
