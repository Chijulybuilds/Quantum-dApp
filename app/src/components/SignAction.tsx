import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Address, Hex } from "viem";

import type { RelayResult } from "../lib/api";
import { txUrl } from "../lib/config";
import { canSignWithQorex, parseSignature, qorexInstalled, signWithQorex } from "../lib/qorex";

type Phase = "idle" | "signing" | "relaying" | "done" | "error";

/**
 * Shows the exact message the member signs (what QoreX displays), gets an ML-DSA-87 signature
 * from QoreX (or a pasted one from the Conclave CLI) and hands it to `submit` (the relayer).
 */
export function SignAction({
  message,
  signer,
  label,
  cliCommand,
  submit,
  onDone,
}: {
  message?: string;
  signer?: Address;
  label: string;
  cliCommand: string;
  submit: (signature: Hex) => Promise<RelayResult>;
  onDone?: (r: RelayResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<RelayResult>();
  const [manual, setManual] = useState(false);
  const [pasted, setPasted] = useState("");
  const qorexReady = canSignWithQorex();

  const run = async (getSignature: () => Promise<Hex>) => {
    setError(undefined);
    try {
      setPhase("signing");
      const signature = await getSignature();
      setPhase("relaying");
      const r = await submit(signature);
      setResult(r);
      setPhase("done");
      onDone?.(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-ink p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-fog">
          <span>You sign exactly this · ML-DSA-87</span>
          <span className="hash">qorechain-msg-v1</span>
        </div>
        <pre className="hash max-h-56 overflow-auto text-[0.8rem] leading-6 whitespace-pre-wrap text-white/85">{message ?? "Loading the message from the contract…"}</pre>
      </div>

      <AnimatePresence mode="wait">
        {phase === "done" && result ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-mint/40 bg-mint/10 p-4">
            <p className="font-medium text-mint">✓ Verified on chain by pqcVerify and recorded</p>
            <a className="hash mt-1 block truncate text-xs text-white/70 underline-offset-4 hover:underline" href={txUrl(result.hash)} target="_blank" rel="noreferrer">
              {result.hash}
            </a>
          </motion.div>
        ) : (
          <motion.div key="actions" className="space-y-3">
            <button
              type="button"
              disabled={!message || !signer || phase === "signing" || phase === "relaying" || !qorexReady}
              onClick={() => run(() => signWithQorex(message!, signer!))}
              className="btn btn-violet w-full"
            >
              {phase === "signing" ? "Waiting for QoreX…" : phase === "relaying" ? "Relaying · verifying on chain…" : `${label} · sign in QoreX`}
            </button>
            {!qorexReady && (
              <p className="text-xs text-fog">
                {qorexInstalled() ? "This QoreX build cannot sign messages yet." : "QoreX is not installed in this browser."} Use the Conclave CLI below.
              </p>
            )}
            <button type="button" onClick={() => setManual((v) => !v)} className="text-xs text-fog underline-offset-4 hover:text-white hover:underline">
              {manual ? "Hide" : "Sign with the Conclave CLI instead"}
            </button>
            <AnimatePresence>
              {manual && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-2 overflow-hidden">
                  <pre className="hash overflow-x-auto rounded-xl bg-white/5 p-3 text-[0.72rem] text-white/80">{cliCommand}</pre>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="Paste the signature (0x…, base64 or the JSON line)"
                    rows={3}
                    className="hash w-full rounded-xl border border-white/10 bg-ink p-3 text-xs outline-none focus:border-violet"
                  />
                  <button type="button" className="btn btn-ghost w-full" disabled={!pasted || phase === "relaying"} onClick={() => run(async () => parseSignature(pasted))}>
                    Relay pasted signature
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {error && <p className="rounded-xl border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
