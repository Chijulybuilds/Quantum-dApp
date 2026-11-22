import { LatticeField } from "../LatticeField";

/** Slow aurora light plus the pointer-reactive lattice from the landing page, behind the app. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <LatticeField
        spacing={44}
        className="absolute inset-0 h-full w-full opacity-70 [mask-image:radial-gradient(90%_70%_at_50%_0%,#000_20%,transparent_75%)]"
      />
    </div>
  );
}
