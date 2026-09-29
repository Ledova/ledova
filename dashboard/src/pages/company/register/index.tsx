import { DESTINATIONS } from '@ledova/shared';
import { Disclosure, LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { useOpenRows } from '@hooks/useOpenRows';
import { useCompanyRegister } from './useCompanyRegister';
import { ClassRegister } from './ClassRegister';

export default function CompanyRegisterPage() {
  const { data: classes = [], isPending, isError, isFetching, refetch } = useCompanyRegister();
  const rows = useOpenRows();

  return (
    <Page lede="The stored register records your company's members and their shares; wallet balances do not replace it.">
      <Section title="Share classes">
        {isPending ? (
          <p role="status" className="py-3 text-sm text-text-muted">
            Loading your register…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-3">
            <p className="text-sm text-text-muted">We couldn&apos;t load the complete register.</p>
            <PageAction label="Try again" onClick={() => void refetch()} disabled={isFetching} />
          </div>
        ) : classes.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">Your company has no share classes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {classes.map(({ companyName, register }) => (
              <li key={register.token.uuid}>
                <Disclosure
                  open={rows.isOpen(register.token.uuid)}
                  onToggle={() => rows.toggle(register.token.uuid)}
                  summary={
                    <span className="flex flex-wrap items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 basis-40 break-words">
                        <span className="block text-sm text-text-muted">{companyName}</span>
                        <span className="block text-base text-text-primary">{register.token.name}</span>
                      </span>
                      <span className="ml-auto text-sm text-text-muted">{register.token.symbol}</span>
                    </span>
                  }
                >
                  <div className="border-b border-border-subtle">
                    <LinkRow
                      to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                      label={DESTINATIONS.companyClass.title}
                    />
                  </div>
                  <ClassRegister register={register} />
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Register instructions">
        <p className="text-sm text-text-muted">
          The company owner submits written register instructions. Staff verify and apply them. Certificates, inspection
          copies, publications and the company pack are prepared by staff on written instruction.
        </p>
      </Section>
    </Page>
  );
}
