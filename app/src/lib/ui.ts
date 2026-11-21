const STATE_COLOR: Record<string, string> = {
  Active: "bg-violet/20 text-violet-2",
  Queued: "bg-sun/15 text-sun",
  Ready: "bg-mint/15 text-mint",
  Executed: "bg-white/10 text-white",
  Defeated: "bg-ember/15 text-ember",
  Canceled: "bg-white/5 text-fog",
  Expired: "bg-white/5 text-fog",
  Stale: "bg-white/5 text-fog",
};

export function stateClass(state: string) {
  return STATE_COLOR[state] ?? "bg-white/5 text-fog";
}
