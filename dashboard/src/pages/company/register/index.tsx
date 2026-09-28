import { CaretRightIcon } from '@phosphor-icons/react';
import { DESTINATIONS } from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { useCompanyRegister } from './useCompanyRegister';
import { ClassRegister } from './ClassRegister';

export default function CompanyRegisterPage() {
  const { data: classes = [], isPending, isError, isFetching, refetch } = useCompanyRegister();

  return (
    <Page>
      <p className="text-sm text-text-muted">
        The stored register records your company&apos;s members and their shares. Wallet balances do not replace it.
      </p>
      <Section title="Share classes">
        {isPending ? (
          <p role="status" className="py-6 text-sm text-text-muted">
            Loading your register…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-text-muted">We couldn&apos;t load the complete register.</p>
            <PageAction label="Try again" onClick={() => void refetch()} disabled={isFetching} />
          </div>
        ) : classes.length === 0 ? (
          <p className="py-6 text-sm text-text-muted">Your company has no share classes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {classes.map(({ companyName, register }) => (
              <li key={register.token.uuid}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 py-4 marker:hidden">
                    <CaretRightIcon aria-hidden="true" className="shrink-0 text-text-muted group-open:rotate-90" />
                    <span className="min-w-0 flex-1 basis-40 break-words">
                      <span className="block text-sm text-text-muted">{companyName}</span>
                      <span className="block text-base text-text-primary">{register.token.name}</span>
                    </span>
                    <span className="ml-auto text-sm text-text-muted">{register.token.symbol}</span>
                  </summary>
                  <div className="border-b border-border-subtle">
                    <LinkRow
                      to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                      label={DESTINATIONS.companyClass.title}
                    />
                  </div>
                  <ClassRegister register={register} />
                </details>
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
