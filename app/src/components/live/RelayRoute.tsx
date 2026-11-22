/**
 * The relayer's EVM window as a route: packets travel from the relayer to Conclave through a
 * lock, because the window is scoped so the relayer can call nothing else.
 */
export function RelayRoute({ live, scoped }: { live: boolean; scoped: boolean }) {
  return (
    <div className="flex w-full items-center gap-3">
      <RouteNode label="Relayer" glyph="R" />
      <div className={`relative h-px flex-1 ${live ? "bg-gradient-to-r from-white/15 via-mint/40 to-white/15" : "bg-white/10"}`}>
        {live && [0, 1, 2].map((i) => <span key={i} className="packet" style={{ animationDelay: `${i * 0.9}s` }} />)}
        <span
          className={`absolute top-1/2 left-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-ink-2 ${
            scoped ? "border-mint/50 text-mint" : "border-white/15 text-fog"
          }`}
          title={scoped ? "Window scoped to Conclave" : "Window not scoped"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d={scoped ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} />
          </svg>
        </span>
      </div>
      <RouteNode label="Conclave" glyph="C" accent />
    </div>
  );
}

function RouteNode({ label, glyph, accent = false }: { label: string; glyph: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        className={`grid h-11 w-11 place-items-center rounded-2xl border text-sm font-semibold ${
          accent ? "border-violet/50 bg-violet/15 text-violet-2" : "border-white/12 bg-white/5 text-white/80"
        }`}
      >
        {glyph}
      </span>
      <span className="text-[0.68rem] text-fog">{label}</span>
    </div>
  );
}
