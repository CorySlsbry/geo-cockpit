import { Modal } from "../../components/Modal";
import { shortDate } from "../../lib/format";

/** The arm / disarm confirmation. `armOk` and the busy flag stay in ClientDetail:
 *  the header button that opens this dialog also resets `armOk`, and the confirm
 *  handler needs the page's loadDetail/setErr. */
export function GoLiveModal({ open, onClose, summary, jobs, armOk, onArmOkChange, armBusy, onConfirm }: {
  open: boolean; onClose: () => void;
  summary: any; jobs: any[];
  armOk: boolean; onArmOkChange: (v: boolean) => void;
  armBusy: boolean; onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={summary.armed ? `Disarm ${summary.name}?` : `Arm ${summary.name}?`}>
      {summary.armed ? (
        <div className="space-y-4 text-sm text-muted">
          <p>This returns <b className="text-ink">{summary.name}</b> to <b className="text-ink">dry-run</b>. Auto-posting and auto-replies stop immediately; nothing goes live.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={armBusy} onClick={onConfirm}>Disarm</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-muted">Arming flips <span className="mono text-ink">dry_run → false</span>. When armed:</p>
          {/* evidence: what the dry-runs actually produced, so the arm decision is one glance */}
          <div className="rounded-xl border border-line bg-surface/50 p-3 text-xs text-muted">
            <div className="label mb-1">Dry-run evidence</div>
            {jobs.length ? (
              <>last audit {shortDate(jobs[0].finished_at || jobs[0].created_at)} — {jobs[0].summary?.targets ?? 0} targets,{" "}
                {jobs[0].summary?.drafts_written ?? 0} drafts written, {jobs[0].summary?.cited ?? 0} cited /{" "}
                {jobs[0].summary?.absent ?? 0} absent · {jobs.length} audit(s) total</>
            ) : (
              <span className="text-warn">no audits yet — run one before arming so you can see what it would post</span>
            )}
          </div>
          <div className="space-y-2">
            <div className="rounded-xl border border-warn/25 bg-warn/5 p-3">
              <div className="label mb-1 !text-warn">Auto-posts to owned channels</div>
              <div className="text-xs text-ink">{(summary.auto || []).join(", ") || "none"}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface/50 p-3">
              <div className="label mb-1">Stays manual (never auto-posted)</div>
              <div className="text-xs text-muted">{(summary.draft || []).join(", ") || "none"} — the community guardrail holds</div>
            </div>
            <div className="text-xs text-muted">DM / email auto-replies: <b className="text-ink">{summary.responder?.enabled ? "ON" : "off"}</b> ({summary.responder?.model || "—"}) · blog cadence: {summary.cadence?.blog_posts ? `${summary.cadence.blog_posts.count}/${summary.cadence.blog_posts.per}` : "—"}</div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={armOk} onChange={(e) => onArmOkChange(e.target.checked)} className="accent-primary" />
            I understand these post to live accounts.
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-danger" disabled={!armOk || armBusy} onClick={onConfirm}>Arm {summary.name}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
