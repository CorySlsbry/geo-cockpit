import { useNavigate } from "react-router-dom";
import { Card, Section, Chip, Skeleton, Empty } from "../../components/ui";
import { IconExternal, IconRefresh } from "../../components/icons";
import { api } from "../../lib/api";
import { shortDate } from "../../lib/format";

export function AuditHistory({ history, running, onRerun }: {
  history: any; running: boolean; onRerun: () => void;
}) {
  const nav = useNavigate();
  const jobs = history?.jobs || [];

  return (
    <Section title="Audit history" sub="Past runs — reports and reviews">
      {!history ? (
        <Skeleton className="h-24" />
      ) : jobs.length === 0 ? (
        <Empty title="No audits yet" sub="Run your first audit above." />
      ) : (
        <div className="space-y-2">
          {jobs.map((j: any) => {
            const sm = j.summary || {};
            const tone = j.status === "done" ? "ok" : j.status === "failed" ? "danger" : "warn";
            return (
              <Card key={j.id} className="card-hover flex flex-wrap items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button className="truncate font-medium text-ink hover:text-primary-light" onClick={() => nav(`/audit/${j.id}`)}>
                      {shortDate(j.finished_at || j.created_at)}
                    </button>
                    <Chip tone={tone as any}>{j.status}</Chip>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {j.error ? <span className="text-danger">{j.error}</span> : (
                      <>{sm.targets ?? 0} targets · {sm.cited ?? 0} cited · {sm.absent ?? 0} absent · {sm.drafts_written ?? 0} drafts</>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {j.has_report && (
                    <a className="btn-ghost !py-1.5 !text-xs" href={api.reportUrl(j.id)} target="_blank" rel="noreferrer">
                      <IconExternal size={13} /> Report
                    </a>
                  )}
                  <button className="btn-ghost !py-1.5 !text-xs" onClick={() => nav(`/audit/${j.id}/review`)}>Review</button>
                  <button className="btn-ghost !py-1.5 !text-xs" disabled={running} onClick={onRerun}>
                    <IconRefresh size={13} /> Re-run
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}
