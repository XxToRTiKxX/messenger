export function CrtOverlay({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <div className="absolute inset-0 animate-flicker bg-[radial-gradient(circle_at_center,rgba(0,255,120,0.06)_0%,rgba(0,0,0,0.35)_70%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:100%_3px] opacity-20" />
      <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.55)]" />
    </div>
  );
}
