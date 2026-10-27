import { useState } from 'react';
import { formatDate } from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { Confirmation } from '@components/Modal';
import { MemberRecordsContent } from '@components/member-records/MemberRecordsContent';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useRunningAction } from '@hooks/useRunningAction';
import { MemberCertificates } from './MemberCertificates';

export function MemberDocuments() {
  const { read, held, token, selectToken } = useMemberWorkspace();
  const record = read.record;
  const selectedClass = record?.classes.find((item) => item.uuid === token) ?? record?.classes[0];
  const [withdrawing, setWithdrawing] = useState<{ uuid: string; createdAt: string } | null>(null);
  const { running, track } = useRunningAction();
  return (
    <PageTitle.Provider value="Your documents">
      <Page lede="Your share history and certificates.">
        <MemberRecordsContent>
          {record && (
            <MemberCertificates
              read={read}
              selectedClass={selectedClass}
              held={held}
              running={running}
              onSelectClass={selectToken}
              onRequest={(uuid) => track(`certificate:${uuid}`, read.requestCertificate(uuid))}
              onWithdraw={(request) => setWithdrawing({ uuid: request.uuid, createdAt: request.createdAt })}
            />
          )}
        </MemberRecordsContent>
      </Page>
      {withdrawing && (
        <Confirmation
          isOpen
          title="Withdraw this certificate request?"
          confirmLabel="Withdraw certificate request"
          confirmDisabled={held}
          busy={read.busy}
          busyLabel="Withdrawing…"
          onClose={() => setWithdrawing(null)}
          onConfirm={() => void read.withdraw(withdrawing.uuid).finally(() => setWithdrawing(null))}
        >
          The company won&apos;t fulfil your request of {formatDate(withdrawing.createdAt)}. You can request a
          certificate for the same entry again.
        </Confirmation>
      )}
    </PageTitle.Provider>
  );
}
