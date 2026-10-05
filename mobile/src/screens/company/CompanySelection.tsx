import { Text, View } from 'react-native';
import { Choice } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

type CompanyChoices = {
  companies: { uuid: string; name: string }[];
  companyUuid: string | undefined;
  selectionBlocked: boolean;
  selectCompany: (uuid: string) => void;
};

export function CompanySelection({ read }: { read: CompanyChoices }) {
  const styles = useCompanyStyles();
  if (read.companies.length === 0 || (read.companies.length < 2 && read.companyUuid)) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.text}>Choose company</Text>
      <View style={styles.choices}>
        {read.companies.map((company) => (
          <Choice
            key={company.uuid}
            label={company.name}
            accessibilityLabel={`Select company ${company.name}`}
            selected={read.companyUuid === company.uuid}
            disabled={read.selectionBlocked}
            onPress={() => read.selectCompany(company.uuid)}
          />
        ))}
      </View>
    </View>
  );
}
