export function AuthDivider({ className = 'relative my-6' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border"></div>
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-4 bg-surface-base text-text-subtle font-medium">or</span>
      </div>
    </div>
  );
}
