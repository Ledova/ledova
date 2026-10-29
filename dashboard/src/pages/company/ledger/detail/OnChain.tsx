import { formatDate, getBlockExplorerAddressUrl, getBlockExplorerTxUrl, type CompanyShareToken } from '@ledova/shared';
import { LinkRow, Row, Rows, Section, Status } from '@components/Ledger';
import { CopyButton } from '@components/CopyButton';
import { pageTitle } from '@utils/destinations';
import { SHARE_CLASS_STATUS_TONES } from '@pages/company/shared/statusTones';
import { classPath } from '@pages/company/ledger/shared/registerPlace';

export function OnChain({ token }: { token: CompanyShareToken }) {
  const addressUrl =
    token.chain && token.contractAddress ? getBlockExplorerAddressUrl(token.chain, token.contractAddress) : '';
  const txUrl = token.chain && token.deploymentTxHash ? getBlockExplorerTxUrl(token.chain, token.deploymentTxHash) : '';
  return (
    <Section title="On chain">
      <Rows>
        <Row label="State">
          <Status tone={SHARE_CLASS_STATUS_TONES.get(token.status) ?? 'waiting'}>{token.statusDisplay}</Status>
        </Row>
        {token.deployedAt && <Row label="Deployed on">{formatDate(token.deployedAt)}</Row>}
        {token.contractAddress && (
          <Row label="Contract">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 break-all">{token.contractAddress}</span>
              <CopyButton key={token.contractAddress} value={token.contractAddress} label="Copy contract address" />
            </div>
          </Row>
        )}
      </Rows>
      {(addressUrl || txUrl) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {addressUrl && (
            <a href={addressUrl} target="_blank" rel="noopener noreferrer" className="text-brand-light underline">
              View contract
            </a>
          )}
          {txUrl && (
            <a href={txUrl} target="_blank" rel="noopener noreferrer" className="text-brand-light underline">
              View deployment transaction
            </a>
          )}
        </p>
      )}
      <LinkRow
        to={classPath('companyClassChain', token.uuid, token.companyUuid)}
        label={pageTitle('companyClassChain')}
      >
        <span className="block text-xs text-text-muted">Chain grants, capital increases and pausing</span>
      </LinkRow>
    </Section>
  );
}
