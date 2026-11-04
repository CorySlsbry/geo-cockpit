import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Spinner, Banner, Dot } from "./ui";
import { IconExternal, IconCheck, IconAlert } from "./icons";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";

const PLAT_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", email: "Email",
  tiktok: "TikTok", gbp: "Google Business", linkedin: "LinkedIn", mailbox: "Mailbox",
};

// A field named "access_token" is sent to the backend as "token"; everything else maps 1:1.
function toBody(fields: Record<string, string>) {
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!v?.trim()) continue;
    body[k === "access_token" ? "token" : k] = v.trim();
  }
  return body;
}

export function ConnectModal({ slug, platform, status, onClose, onSaved }: {
  slug: string; platform: string | null; status?: any; onClose: () => void; onSaved?: () => void;
}) {
  const [plan, setPlan] = useState<any>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<any>(null);

  useEffect(() => {
    if (!platform) return;
    setPlan(null); setErr(null); setSaved(null); setFields({});
    api.connectPlan(slug, platform).then(setPlan).catch((e) => setErr(String(e.message || e)));
  }, [slug, platform]);

  async function save() {
    if (!platform) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.connectSave(slug, platform, toBody(fields));
      setSaved(r);
      onSaved?.();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const cur = platform ? status?.[platform] : null;
  return (
    <Modal open={!!platform} onClose={onClose} title={`Connect ${PLAT_LABEL[platform || ""] || titleCase(platform || "")}`} width="max-w-xl">
      {err && <Banner tone="danger"><IconAlert size={14} /> {err}</Banner>}
      {!platform ? null : !plan && !err ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> loading connect steps…</div>
      ) : plan?.error ? (
        <Banner tone="danger"><IconAlert size={14} /> {plan.error}</Banner>
      ) : plan ? (
        <div className="space-y-4 text-sm">
          {plan.managed ? (
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${plan.connected ? "border-ok/25 bg-ok/5 text-ok" : "border-warn/25 bg-warn/5 text-warn"}`}>
              <Dot tone={plan.connected ? "ok" : "warn"} />
              {plan.connected ? "Connected & managed by the flywheel — no action needed here." : "Not fully connected yet — see the note below."}
            </div>
          ) : cur?.connected ? (
            <div className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok/5 px-3 py-2 text-xs text-ok">
              <Dot tone="ok" /> Already connected{cur.handle ? ` as ${cur.handle}` : ""}. Re-save to update the token.
            </div>
          ) : null}
          {plan.authorize_url && (
            <a href={plan.authorize_url} target="_blank" rel="noreferrer" className="btn-primary w-full">
              <IconExternal size={15} /> Open authorize page in your browser
            </a>
          )}
          {plan.cred_resolved === false && (
            <Banner tone="warn"><IconAlert size={14} /> The app client-id isn't configured, so the authorize link has a placeholder. You can still paste a token you obtain manually.</Banner>
          )}
          {plan.steps?.length > 0 && (
            <div>
              <div className="label mb-1">Steps</div>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
                {plan.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
          {plan.managed ? (
            <div className="flex justify-end border-t border-line pt-3">
              <button className="btn-primary" onClick={onClose}>Got it</button>
            </div>
          ) : (
            <>
              <div className="space-y-2 border-t border-line pt-3">
                <div className="label">Paste the token fields</div>
                {(plan.token_fields || ["access_token"]).map((f: string) => (
                  <div key={f}>
                    <label className="mb-1 block text-[11px] text-dim">
                      {f}{f === "access_token" && <span className="text-danger"> *</span>}
                    </label>
                    <input
                      className="input mono !text-xs"
                      value={fields[f] || ""}
                      onChange={(e) => setFields((s) => ({ ...s, [f]: e.target.value }))}
                      placeholder={f}
                      autoComplete="off" spellCheck={false}
                    />
                  </div>
                ))}
              </div>
              {saved ? (
                <Banner tone={saved.postable ? "primary" : "warn"}>
                  <IconCheck size={14} /> Saved {saved.fields_written?.length || 0} field(s).{" "}
                  {saved.postable ? "Ready to post." : `Not postable yet — still missing: ${(saved.missing_to_post || []).join(", ")}.`}
                </Banner>
              ) : (
                <div className="flex justify-end gap-2 border-t border-line pt-3">
                  <button className="btn-ghost" onClick={onClose}>Close</button>
                  <button className="btn-primary" disabled={busy || !fields["access_token"]?.trim()} onClick={save}>
                    {busy ? <><Spinner size={15} /> Saving…</> : "Save token"}
                  </button>
                </div>
              )}
            </>
          )}
          {plan.notes?.length > 0 && <div className="text-[11px] text-dim">{plan.notes.join(" · ")}</div>}
        </div>
      ) : null}
    </Modal>
  );
}
