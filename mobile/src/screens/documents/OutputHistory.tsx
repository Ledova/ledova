import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import {
  formatDate,
  formatDateTime,
  useCompanyPacks,
  useInspectionCopies,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { LoadError, Loading, Rows } from '../../components/Ledger';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useDocumentStyles } from './useDocumentStyles';

function prepared(at: string, by: string) {
  return by ? `Prepared ${formatDateTime(at)} by ${by}` : `Prepared ${formatDateTime(at)}`;
}

function History<Row>({
  title,
  noun,
  query,
  render,
}: {
  title: string;
  noun: string;
  query: { data?: Row[]; isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  render: (row: Row) => ReactElement;
}) {
  const look = useDocumentStyles();
  return (
    <View style={look.group}>
      <Text accessibilityRole="header" style={look.heading}>
        {title}
      </Text>
      {query.isPending ? (
        <Loading>{`Loading ${noun}…`}</Loading>
      ) : query.isError ? (
        <LoadError retry={() => query.refetch()} busy={query.isFetching}>
          {`The ${noun} could not be loaded.`}
        </LoadError>
      ) : query.data?.length ? (
        <Rows>{query.data.map(render)}</Rows>
      ) : (
        <Text style={look.muted}>None yet.</Text>
      )}
    </View>
  );
}

export function InspectionCopyHistory({
  owner,
  token,
  guard,
  enabled,
}: {
  owner: OrderSubmissionOwner;
  token: string;
  guard: () => void;
  enabled: boolean;
}) {
  const look = useDocumentStyles();
  const copies = useInspectionCopies(owner, token, guard, enabled, orderSubmissionSession);
  return (
    <History
      title="Prepared copies"
      noun="prepared copies"
      query={copies}
      render={(copy) => (
        <View key={copy.uuid} style={look.row}>
          <Text style={look.title}>For {copy.recipient}</Text>
          <Text style={look.muted}>
            Requested {formatDate(copy.requestedOn)}
            {copy.late ? ' · provided late' : ''} · {prepared(copy.preparedAt, copy.preparedByName)}
          </Text>
          <Text style={look.muted}>Instruction: {copy.instruction}</Text>
        </View>
      )}
    />
  );
}

export function CompanyPackHistory({
  owner,
  company,
  guard,
  enabled,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  guard: () => void;
  enabled: boolean;
}) {
  const look = useDocumentStyles();
  const packs = useCompanyPacks(owner, company, guard, enabled, orderSubmissionSession);
  return (
    <History
      title="Prepared packs"
      noun="prepared packs"
      query={packs}
      render={(pack) => (
        <View key={pack.digest} style={look.row}>
          <Text style={look.title}>For {pack.recipient}</Text>
          <Text style={look.muted}>
            {prepared(pack.preparedAt, pack.preparedByName)} · {pack.classes}{' '}
            {pack.classes === 1 ? 'share class' : 'share classes'}
          </Text>
          <Text style={look.muted}>Instruction: {pack.instruction}</Text>
        </View>
      )}
    />
  );
}
