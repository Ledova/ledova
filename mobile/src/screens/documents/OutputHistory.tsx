import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import {
  companyPackFacts,
  inspectionCopyFacts,
  useCompanyPacks,
  useInspectionCopies,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { LoadError, Loading, Rows } from '../../components/Ledger';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useDocumentStyles } from './useDocumentStyles';

function History<Row>({
  title,
  noun,
  empty,
  query,
  render,
}: {
  title: string;
  noun: string;
  empty: string;
  query: { data?: Row[]; isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  render: (row: Row) => ReactElement;
}) {
  const look = useDocumentStyles();
  return query.isPending ? (
    <Loading>{`Loading ${noun}…`}</Loading>
  ) : query.isError ? (
    <LoadError retry={() => query.refetch()} busy={query.isFetching}>
      {`The ${noun} could not be loaded.`}
    </LoadError>
  ) : query.data?.length ? (
    <View accessibilityLabel={title}>
      <Rows>{query.data.map(render)}</Rows>
    </View>
  ) : (
    <Text style={look.muted}>{empty}</Text>
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
      empty="No inspection copies prepared yet."
      query={copies}
      render={(copy) => (
        <View key={copy.uuid} style={look.row}>
          <Text style={look.title}>For {copy.recipient}</Text>
          <Text style={look.small}>{inspectionCopyFacts(copy)}</Text>
          <Text style={look.small}>Instruction: {copy.instruction}</Text>
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
      empty="No company packs prepared yet."
      query={packs}
      render={(pack) => (
        <View key={pack.digest} style={look.row}>
          <Text style={look.title}>For {pack.recipient}</Text>
          <Text style={look.small}>{companyPackFacts(pack)}</Text>
          <Text style={look.small}>Instruction: {pack.instruction}</Text>
        </View>
      )}
    />
  );
}
