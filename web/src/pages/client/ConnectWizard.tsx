import type { Dispatch, SetStateAction } from "react";
import { Modal } from "../../components/Modal";
import { Banner, Spinner } from "../../components/ui";
import { IconAlert, IconCheck, IconExternal } from "../../components/icons";
import { titleCase } from "../../lib/format";

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", email: "Email",
  tiktok: "TikTok", gbp: "Google Business", linkedin: "LinkedIn", mailbox: "Mailbox",
};

/** The connect modal. Plan fetching + token save stay in ClientDetail (openWizard /
 *  saveConnect): the wizard is opened from the Connections grid there, and saving
 *  refreshes the page-level connect status. */
export function ConnectWizard({ wizard, plan, form, setForm, connBusy, connResult, onClose, onSave }: {
  wizard: string | null; plan: any;
  form: Record<string, string>; setForm: Dispatch<SetStateAction<Record<string, string>>>;
  connBusy: boolean; connResult: any;
  onClose: () => void; onSave: () => void;
}) {
  return (
    <Modal open={!!wizard} onClose={onClose} title={`Connect ${PLATFORM_LABEL[wizard || ""] || titleCase(wizard || "")}`} width="max-w-xl">
      {!plan && !connResult?.error && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner /> loading connect plan…</div>
      )}
      {connResult?.error && !plan && <Banner tone="danger"><IconAlert size={14} /> {connResult.error}</Banner>}
      {plan && (
        <div className="space-y-4">
          {plan.managed && (
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${plan.connected ? "border-ok/25 bg-ok/5 text-ok" : "border-warn/25 bg-warn/5 text-warn"}`}>
              <IconCheck size={13} /> {plan.connected ? "Connected & managed by the flywheel — no action needed here." : "Not fully connected yet — see the note below."}
            </div>
          )}
          {/* authorize */}
          {plan.authorize_url && (
            <a href={plan.authorize_url} target="_blank" rel="noreferrer" className="btn-primary w-full">
              <IconExternal size={15} /> Open authorize page ↗
            </a>
          )}
          {plan.cred_resolved === false && (
            <Banner tone="warn"><IconAlert size={14} /> App credentials not resolved — set the client id/secret first.</Banner>
          )}

          {/* steps */}
          {(plan.steps || []).length > 0 && (
            <div>
              <div className="label mb-1.5">Steps</div>
              <ol className="space-y-1.5">
                {plan.steps.map((s: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-muted">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary-light">{i + 1}</span>
                    <span className="whitespace-pre-wrap">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* paste-token form */}
          {(plan.token_fields || []).length > 0 && (
            <div className="rounded-xl border border-line bg-surface/40 p-3">
              <div className="label mb-2">Paste tokens</div>
              <div className="space-y-2">
                {plan.token_fields.map((f: string) => (
                  <div key={f}>
                    <label className="mb-0.5 block text-[11px] text-dim" htmlFor={`tok-${f}`}>{f}</label>
                    <input
                      id={`tok-${f}`}
                      className="input mono text-xs"
                      placeholder={f}
                      value={form[f] || ""}
                      onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              {plan.token_endpoint && <div className="mt-2 text-[10px] text-dim">Token endpoint: <span className="mono break-all">{plan.token_endpoint}</span></div>}
            </div>
          )}

          {/* notes */}
          {(plan.notes || []).map((n: string, i: number) => (
            <p key={i} className="text-[11px] text-dim">{n}</p>
          ))}

          {/* result */}
          {connResult && !connResult.error && (
            <Banner tone={connResult.postable ? "primary" : "warn"}>
              {connResult.postable ? <IconCheck size={14} /> : <IconAlert size={14} />}
              <span>
                Saved {connResult.fields_written?.length ? `(${connResult.fields_written.join(", ")})` : ""}.
                {connResult.postable ? " Ready to post." : ` Still missing: ${(connResult.missing_to_post || []).join(", ") || "—"}`}
              </span>
            </Banner>
          )}
          {connResult?.error && <Banner tone="danger"><IconAlert size={14} /> {connResult.error}</Banner>}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            {plan.managed ? (
              <button className="btn-primary" onClick={onClose}>Got it</button>
            ) : (
              <>
                <button className="btn-ghost" onClick={onClose}>Close</button>
                <button className="btn-primary" disabled={connBusy} onClick={onSave}>
                  {connBusy ? <><Spinner size={15} /> Saving…</> : "Save tokens"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
