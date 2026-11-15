import { useParams, useSearchParams } from 'react-router-dom';
import { AccountCheck } from '@components/AccountCheck';
import { Page } from '@components/Page';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';
import { NewClassSetup } from './NewClassSetup';
import { ShareClass } from './ShareClass';

export default function ShareClassPage() {
  const { uuid = '' } = useParams();
  return uuid ? <ShareClass key={uuid} uuid={uuid} /> : <CreateClass />;
}

function CreateClass() {
  const [search] = useSearchParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  return (
    <Page back={registerPlace({ company: search.get('company') ?? undefined })}>
      {owner && !preferences.isError ? (
        <NewClassSetup key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
      ) : (
        <AccountCheck />
      )}
    </Page>
  );
}
