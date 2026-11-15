import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  useClassDetails as useSharedClassDetails,
  type OrderSubmissionOwner,
  type useShareClass,
} from '@ledova/shared';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

export function useClassDetails(
  data: ReturnType<typeof useShareClass>,
  owner: OrderSubmissionOwner,
  available: boolean,
  onHeldChange: (held: boolean) => void,
) {
  const navigate = useNavigate();
  return useSharedClassDetails(data, owner, available, onHeldChange, {
    release: flushSync,
    onDeleted: (token, confirmed) => {
      const place = registerPlace({ company: token.companyUuid });
      navigate(place.to, {
        state: {
          ...place.state,
          classNotice: confirmed
            ? 'Share class deleted.'
            : 'This share class is no longer available. Deletion was not confirmed.',
        },
      });
    },
  });
}
