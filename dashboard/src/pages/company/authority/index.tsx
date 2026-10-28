import { useEffect, useRef, useState } from 'react';
import { generatePath } from 'react-router-dom';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { LinkRow, Outcome, Section, LoadError, Loading, Status } from '@components/Ledger';
import { FormActions, Page, PageAction } from '@components/Page';
import {
  DESTINATIONS,
  formatDate,
  useSubmissionOwner,
  useUserPreferences,
  type CompanyAuthorityRequest,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { AUTHORITY_REQUEST_TONES } from '@pages/company/shared/statusTones';
import { AuthorityRequestForm } from './AuthorityRequestForm';
import { useAuthorityRequests } from './shared/useAuthorityRequests';

function requestStatus(request: CompanyAuthorityRequest) {
  if (request.status === 'withdrawn') return 'Withdrawn';
  if (request.status === 'pending') return 'Pending';
  return request.appointment?.status === 'revoked' ? 'Appointment revoked' : 'Admitted';
}

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
  const { guard, recorded, setRecorded, companies, history, company, lifecycle } = useAuthorityRequests({
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
                <li key={request.uuid}>
                  <LinkRow
                    to={generatePath(DESTINATIONS.companyAuthorityRequest.path, { uuid: request.uuid })}
                    label={request.companyIdentityRaw.name}
                    context={`authority request submitted ${formatDate(request.createdAt)}`}
                    aside={
                      <Status tone={AUTHORITY_REQUEST_TONES.get(request.status) ?? 'closed'}>
                        {requestStatus(request)}
                      </Status>
                    }
                  >
                    <span className="block text-xs text-text-muted">
                      ACN {request.companyIdentityRaw.acn} · submitted {formatDate(request.createdAt)}
                    </span>
                  </LinkRow>
                </li>
              ))}
            </ul>
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
          ) : null}
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
