export function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div
      role={label ? 'status' : undefined}
      aria-label={label}
      className="flex items-center justify-center min-h-screen bg-surface-raised"
    >
      <div className="h-8 w-8 border-4 border-brand-subtle border-t-brand rounded-full animate-spin" />
    </div>
  );
}
