import { formatRegisterChanges } from '@ledova/shared';

type Changes = Parameters<typeof formatRegisterChanges>[0];

export function RegisterChanges({ changes, named }: { changes: Changes; named?: Changes }) {
  return (
    <>
      {formatRegisterChanges(changes, named).map((line, index) => (
        <span key={index} className="block break-words">
          {line}
        </span>
      ))}
    </>
  );
}
