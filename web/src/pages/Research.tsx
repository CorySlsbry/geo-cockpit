import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Chip } from "../components/ui";

/** Research — read-only window into the neuron-research pair:
 *  the Market Research System + the AI Marketing Engine one-page reports.
 *  Runs happen via the repo CLIs; this pane only views. */

const TABS = [
  { key: "marketing", label: "Marketing Engine" },
  { key: "research", label: "Market Research" },
] as const;

export default function Research() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("marketing");
  const [sum, setSum] = useState<any>(null);

  useEffect(() => {
    fetch("/api/research/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSum)
      .catch(() => setSum(null));
  }, []);

  const built = sum?.reports?.[tab]?.built;
  const store = sum?.store || {};

  return (
    <Page title="Research" crumb="Market Research System + AI Marketing Engine — read-only reports">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition " +
              (tab === t.key
                ? "bg-[#7C5CFF]/20 border-[#7C5CFF] text-white"
                : "border-white/10 text-white/60 hover:text-white")
            }
          >
            {t.label}
          </button>
        ))}
        {built && <Chip tone="ok">built {String(built).replace("T", " ")}</Chip>}
        {store.findings_by_status && (
          <Chip tone="dim">
            findings: {Object.entries(store.findings_by_status).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </Chip>
        )}
        {typeof store.leads === "number" && <Chip tone="dim">leads {store.leads}</Chip>}
      </div>
      <div className="rounded-xl overflow-hidden border border-white/10 bg-white">
        <iframe
          key={tab}
          src={`/api/research/report/${tab}`}
          title={tab}
          className="w-full"
          style={{ height: "calc(100vh - 220px)", border: "0", background: "#fff" }}
        />
      </div>
    </Page>
  );
}
