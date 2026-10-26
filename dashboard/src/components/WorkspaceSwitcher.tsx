import { useWorkspace } from '@hooks/useWorkspace';
import type { WorkspaceMode } from '@services/workspace';
import { SelectField, type SelectOption } from './SelectField';

export function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  const options: SelectOption[] = [
    ...(workspace.canCompany || workspace.mode === 'company'
      ? [
          {
            value: 'company',
            label: 'Company',
            disabled: !workspace.canCompany || workspace.pending || workspace.unavailable,
          },
        ]
      : []),
    { value: 'my-shares', label: 'My shares' },
  ];
  return (
    <div className="shrink-0 px-3 pb-2">
      <SelectField
        label="Workspace"
        value={workspace.mode}
        options={options}
        disabled={!workspace.canSwitchShares}
        onChange={(value) => {
          if (workspace.change(value as WorkspaceMode)) onNavigate?.();
        }}
      />
    </div>
  );
}
