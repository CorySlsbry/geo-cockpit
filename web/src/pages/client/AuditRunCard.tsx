import { Card, Section, Spinner } from "../../components/ui";
import { IconPlay, IconBolt } from "../../components/icons";

/** The "Run an audit" form. State stays in ClientDetail because the Audit-history
 *  Re-run button fires the same runAudit with these same values. */
export function AuditRunCard({ maxMeasure, onMaxMeasure, maxDraft, onMaxDraft, draftModel, onDraftModel, noLlm, onNoLlm, running, onRun }: {
  maxMeasure: string; onMaxMeasure: (v: string) => void;
  maxDraft: string; onMaxDraft: (v: string) => void;
  draftModel: string; onDraftModel: (v: string) => void;
  noLlm: boolean; onNoLlm: (v: boolean) => void;
  running: boolean; onRun: () => void;
}) {
  return (
    <Section title="Run an audit" sub="Measure where AI cites you, then draft the assets that win the citation">
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label mb-1 block" htmlFor="audit-max-measure">Max measure <span className="text-dim">(blank = all)</span></label>
            <input id="audit-max-measure" className="input mono" inputMode="numeric" placeholder="all clusters" value={maxMeasure} onChange={(e) => onMaxMeasure(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="audit-max-drafts">Max drafts</label>
            <input id="audit-max-drafts" className="input mono" inputMode="numeric" value={maxDraft} onChange={(e) => onMaxDraft(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="audit-draft-model">Draft model</label>
            <input id="audit-draft-model" className="input mono" value={draftModel} onChange={(e) => onDraftModel(e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={noLlm} onChange={(e) => onNoLlm(e.target.checked)} className="accent-primary" />
              No LLM (measure only)
            </label>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
          <button className="btn-primary" disabled={running} onClick={onRun}>
            {running ? <><Spinner size={15} /> Starting…</> : <><IconPlay size={15} /> Run audit</>}
          </button>
          <span className="flex items-center gap-1.5 text-xs text-dim"><IconBolt size={13} className="text-primary-light" /> drafts via subscription — no per-token cost</span>
        </div>
      </Card>
    </Section>
  );
}
