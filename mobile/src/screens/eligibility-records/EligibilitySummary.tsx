import { Text, View } from 'react-native';
import { formatDateTime, formatMoney, type CompanyEligibilitySharedSummary } from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import { CATEGORIES, CERTIFIER_BODIES } from '../investor-eligibility/constants';

export function EligibilitySummary({ summary }: { summary: CompanyEligibilitySharedSummary }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Rows>
        <Row label="Category">
          {CATEGORIES.find((item) => item.category === summary.category)?.label ?? summary.category}
        </Row>
        <Row label="Company">{summary.company}</Row>
        <Row label="Participant account">{summary.userAccount}</Row>
        <Row label="Evidence source">{summary.source}</Row>
        <Row label="Source submitted">{summary.submittedAt ? formatDateTime(summary.submittedAt) : 'Not recorded'}</Row>
        <Row label="Requested expiry">{formatDateTime(summary.requestedExpiresAt)}</Row>
        {summary.certificateIssuedAt !== undefined && (
          <Row label="Certificate date">{summary.certificateIssuedAt ?? 'Not recorded'}</Row>
        )}
        {summary.certifierName !== undefined && <Row label="Accountant">{summary.certifierName}</Row>}
        {summary.certifierBody !== undefined && (
          <Row label="Professional body">
            {CERTIFIER_BODIES.find((item) => item.value === summary.certifierBody)?.label ?? summary.certifierBody}
          </Row>
        )}
        {summary.certifierMembershipNumber !== undefined && (
          <Row label="Membership number">{summary.certifierMembershipNumber}</Row>
        )}
        {summary.associatedCompany !== undefined && (
          <Row label="Associated issuer">{summary.associatedCompany ?? 'Not recorded'}</Row>
        )}
        {summary.offering !== undefined && <Row label="Offering">{summary.offering}</Row>}
        {summary.token !== undefined && <Row label="Share class">{summary.token}</Row>}
        {summary.quantity !== undefined && <Row label="Whole shares">{String(summary.quantity)}</Row>}
        {summary.pricePerShare !== undefined && (
          <Row label="Price per share">
            {summary.priceCurrency ? formatMoney(summary.pricePerShare, summary.priceCurrency) : summary.pricePerShare}
          </Row>
        )}
        {summary.priceCurrency !== undefined && <Row label="Offering currency">{summary.priceCurrency}</Row>}
        {summary.amountAud !== undefined && (
          <Row label="Amount payable (AUD)">{formatMoney(summary.amountAud, 'AUD')}</Row>
        )}
        {summary.offeringTermsDigest !== undefined && (
          <Row label="Offering terms digest">{summary.offeringTermsDigest}</Row>
        )}
      </Rows>
      <Text style={styles.heading}>Declaration shared with the company</Text>
      <Text selectable style={styles.text}>
        {summary.declarationText}
      </Text>
      {summary.offeringTerms !== undefined && (
        <View style={styles.group}>
          <Text style={styles.heading}>Exact offering terms</Text>
          <Text selectable style={styles.text}>
            {JSON.stringify(summary.offeringTerms, null, 2)}
          </Text>
        </View>
      )}
    </View>
  );
}
