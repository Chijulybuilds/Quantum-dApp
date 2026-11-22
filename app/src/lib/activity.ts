import type { Activity } from "./api";
import { qor } from "./format";

export type Tone = "violet" | "mint" | "ember" | "sun" | "fog";

/** Static class names per tone, so Tailwind sees every one. */
export const TONE_DOT: Record<Tone, string> = {
  violet: "bg-violet",
  mint: "bg-mint",
  ember: "bg-ember",
  sun: "bg-sun",
  fog: "bg-white/40",
};
export const TONE_TEXT: Record<Tone, string> = {
  violet: "text-violet-2",
  mint: "text-mint",
  ember: "text-ember",
  sun: "text-sun",
  fog: "text-fog",
};

export const activityKey = (a: Activity) => `${a.tx}:${a.type}:${a.actor ?? ""}:${a.proposalId ?? ""}`;

/** A short human label for a Conclave event. */
export function describeActivity(a: Activity): { title: string; detail?: string; tone: Tone } {
  const p = a.proposalId ? `#${a.proposalId}` : undefined;
  switch (a.type) {
    case "ProposalCreated":
      return { title: "New proposal", detail: p, tone: "violet" };
    case "VoteCast":
      return a.detail?.support
        ? { title: "Voted for", detail: p, tone: "mint" }
        : { title: "Voted against", detail: p, tone: "ember" };
    case "ProposalQueued":
      return { title: "Passed · timelock started", detail: p, tone: "sun" };
    case "ProposalExecuted":
      return { title: "Executed", detail: p, tone: "mint" };
    case "ProposalCanceled":
      return { title: "Canceled", detail: p, tone: "fog" };
    case "Deposited":
      return { title: "Deposit", detail: a.detail?.amount ? `${qor(String(a.detail.amount))} QOR` : undefined, tone: "mint" };
    case "TokenPaid":
      return { title: "Token paid", detail: p, tone: "mint" };
    case "Paused":
      return { title: "Guardian paused payouts", tone: "ember" };
    case "Unpaused":
      return { title: "Payouts resumed", tone: "fog" };
    case "MemberAdded":
      return { title: "Member added", tone: "violet" };
    case "MemberRemoved":
      return { title: "Member removed", tone: "ember" };
    case "ThresholdChanged":
      return { title: "Threshold set", tone: "violet" };
    case "GuardianChanged":
      return { title: "Guardian set", tone: "sun" };
    case "EpochAdvanced":
      return { title: "New membership epoch", tone: "fog" };
    default:
      return { title: a.type, tone: "fog" };
  }
}
