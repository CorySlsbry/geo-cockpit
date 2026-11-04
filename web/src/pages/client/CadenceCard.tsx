import { useEffect, useState } from "react";
import { Card, Chip, Spinner } from "../../components/ui";
import { api } from "../../lib/api";

const CADENCE_ROWS: { key: string; label: string; hint: string }[] = [
  { key: "blog_posts", label: "Blog posts", hint: "cited-ready articles on the client's site" },
  { key: "longform_videos", label: "Long-form videos", hint: "YouTube companions" },
  { key: "shorts", label: "Short videos", hint: "vertical cuts to TikTok / IG" },
  { key: "social_posts", label: "Social posts", hint: "each platform post counts as one" },
];

const VIDEO_KINDS = ["longform_videos", "shorts"];
const VOICE_ROLES: { key: "female" | "male" | "bot"; label: string }[] = [
  { key: "female", label: "Female" }, { key: "male", label: "Male" }, { key: "bot", label: "Bot" },
];

export function CadenceCard({ slug, cadence, videoFormat, shortStyle, videoNarration, characterVoices, onSaved, onFormatSaved, onStyleSaved, onNarrationSaved, onVoicesSaved }: {
  slug: string; cadence: any; videoFormat?: any; shortStyle?: any;
  videoNarration?: any; characterVoices?: any;
  onSaved: (c: any) => void; onFormatSaved?: (v: any) => void; onStyleSaved?: (s: any) => void;
  onNarrationSaved?: (n: any) => void; onVoicesSaved?: (v: any) => void;
}) {
  const init = () =>
    Object.fromEntries(CADENCE_ROWS.map((r) => {
      const c = cadence?.[r.key] || {};
      // `enabled` absent means ON — every profile written before the switch existed keeps running.
      return [r.key, { count: typeof c.count === "number" ? c.count : 0, per: c.per || "week",
                       enabled: c.enabled !== false }];
    }));
  const [form, setForm] =
    useState<Record<string, { count: number; per: string; enabled: boolean }>>(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Run-one: which rows this lane can actually fire, plus the chosen source per row.
  const [runnable, setRunnable] = useState<Record<string, any>>({});
  const [source, setSource] = useState<Record<string, string>>(
    Object.fromEntries(CADENCE_ROWS.map((r) => [r.key, "topic"])));
  const [ref, setRef] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<Record<string, string>>({});
  // Narration mode per VIDEO kind: "narrated" (default) or "character". Save-on-change like the
  // output-size dropdown - one stored value, no partner field, so no Save button.
  const [narration, setNarration] = useState<Record<string, string>>(() =>
    Object.fromEntries(VIDEO_KINDS.map((k) => [k, videoNarration?.[k] === "character" ? "character" : "narrated"])));
  const [narrMsg, setNarrMsg] = useState<Record<string, string>>({});
  // The FIXED voice per character role. Same three voices on every video - a character whose
  // voice changes between videos is a different character.
  const [voices, setVoices] = useState<{ female: string; male: string; bot: string }>({
    female: characterVoices?.female || "", male: characterVoices?.male || "", bot: characterVoices?.bot || "",
  });
  const [voiceList, setVoiceList] = useState<{ id: string; name: string }[] | null>(null);
  const [voiceMsg, setVoiceMsg] = useState("");
  const anyCharacter = VIDEO_KINDS.some((k) => narration[k] === "character");

  useEffect(() => {
    // Only fetch the account's voice list once someone actually uses character mode.
    if (!anyCharacter || voiceList !== null) return;
    api.listElevenVoices().then((r: any) => setVoiceList(r.voices || [])).catch(() => setVoiceList([]));
  }, [anyCharacter, voiceList]);

  async function saveNarration(kind: string, mode: string) {
    const prev = narration[kind];
    setNarration({ ...narration, [kind]: mode });
    setNarrMsg({ ...narrMsg, [kind]: "saving" });
    try {
      const r = await api.setNarration(slug, kind, mode);
      onNarrationSaved?.(r.video_narration);
      setNarrMsg({ ...narrMsg, [kind]: "" });
    } catch (e: any) {
      setNarration((n) => ({ ...n, [kind]: prev }));
      setNarrMsg({ ...narrMsg, [kind]: String(e.message || e) });
    }
  }

  async function saveVoices(next: { female: string; male: string; bot: string }) {
    setVoices(next);
    setVoiceMsg("saving");
    try {
      const r = await api.setCharacterVoices(slug, next);
      onVoicesSaved?.(r.character_voices);
      setVoiceMsg("saved");
    } catch (e: any) { setVoiceMsg(String(e.message || e)); }
  }

  useEffect(() => {
    api.runOneStatus(slug).then((r) => setRunnable(r.targets || {})).catch(() => setRunnable({}));
  }, [slug]);

  async function runOne(kind: string) {
    const src = source[kind] || "topic";
    if (src === "blog" && !(ref[kind] || "").trim()) {
      setRunMsg({ ...runMsg, [kind]: "enter a published post slug or URL" });
      return;
    }
    setRunning(kind); setRunMsg({ ...runMsg, [kind]: "" });
    try {
      const r = await api.runOne(slug, kind, src, ref[kind]);
      setRunMsg({ ...runMsg, [kind]: r.started ? "started — 30-60 min" : (r.message || "did not start") });
    } catch (e: any) {
      setRunMsg({ ...runMsg, [kind]: String(e.message || e) });
    } finally { setRunning(null); }
  }
  const dirty = CADENCE_ROWS.some((r) => {
    const c = cadence?.[r.key] || {};
    return form[r.key].count !== c.count || form[r.key].per !== c.per
      || form[r.key].enabled !== (c.enabled !== false);
  });

  // Output size saves on change, with no Save button. It is a single stored value with no
  // partner field to stay consistent with, unlike the count/per pair the Save button exists for.
  const [fmtBusy, setFmtBusy] = useState(false);
  const [fmtMsg, setFmtMsg] = useState("");
  async function saveFormat(name: string) {
    setFmtBusy(true); setFmtMsg("");
    try {
      const r = await api.setVideoFormat(slug, name);
      onFormatSaved?.(r.video_format);
      setFmtMsg("saved");
    } catch (e: any) {
      setFmtMsg(String(e.message || e));
    } finally { setFmtBusy(false); }
  }

  // Reel style, same save-on-change shape. Writes lanes.json (where the short renderer reads),
  // not the client profile — the "Video size" comment below is the cautionary tale.
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleMsg, setStyleMsg] = useState("");
  async function saveStyle(name: string) {
    setStyleBusy(true); setStyleMsg("");
    try {
      const r = await api.setShortStyle(slug, name);
      onStyleSaved?.(r.short_style);
      setStyleMsg("saved");
    } catch (e: any) {
      setStyleMsg(String(e.message || e));
    } finally { setStyleBusy(false); }
  }

  async function save() {
    setBusy(true); setMsg("");
    try {
      const r = await api.setCadence(slug, form);
      onSaved(r.cadence);
      setMsg("saved");
    } catch (e: any) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="label">Publishing cadence</span>
        <Chip tone="dim" title="This IS the schedule: the hourly dispatcher fires a cycle when a publish is due, and the caps stop anything extra. 0 = paused.">how often we publish</Chip>
      </div>
      <div className="grid gap-2">
        {CADENCE_ROWS.map((r) => {
          const live = cadence?.[r.key] || {};
          const f = form[r.key];
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
              {/* ON/OFF for THIS KIND on THIS lane. Three different switches exist and they are
                  easy to confuse: the Clients-page switch turns the whole LANE off, `armed`
                  decides whether a run publishes, and this one stops one content kind while the
                  lane keeps producing the others. Deliberately not "set the count to 0" — that
                  works, but it destroys the number, so turning the kind back on means remembering
                  what the dial said. left-0.5 is load-bearing: without an explicit left the knob
                  resolves to its static position and lands outside the pill. */}
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={`Turn ${r.label} ${f.enabled ? "off" : "on"} for this client`}
                title={f.enabled
                  ? `${r.label} is on. Switch off to stop publishing this kind without losing the dial.`
                  : `${r.label} is OFF — the dispatcher skips it. Its schedule of ${f.count}/${f.per} is preserved.`}
                onClick={() => setForm({ ...form, [r.key]: { ...f, enabled: !f.enabled } })}
                className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors ${
                  f.enabled ? "bg-primary" : "bg-line"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    f.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <div className="min-w-[130px]">
                <div className={`text-xs font-medium ${f.enabled ? "text-ink" : "text-dim line-through"}`}>{r.label}</div>
                <div className="text-[10px] text-dim">{r.hint}</div>
              </div>
              <input
                className="input mono !w-16 text-center" inputMode="numeric"
                aria-label={`${r.label} count`}
                value={String(f.count)}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value || "0", 10) || 0);
                  setForm({ ...form, [r.key]: { ...f, count: n } });
                }}
              />
              <span className="text-xs text-muted">per</span>
              <select
                className="input !w-auto"
                aria-label={`${r.label} period`}
                value={f.per}
                onChange={(e) => setForm({ ...form, [r.key]: { ...f, per: e.target.value } })}
              >
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
              {/* SOURCE — what this asset is built FROM */}
              <select
                className="input !w-auto text-xs"
                aria-label={`${r.label} source`}
                title="Topic = pick the least-covered term automatically. Blog post = build from one you already published."
                value={source[r.key] || "topic"}
                onChange={(e) => setSource({ ...source, [r.key]: e.target.value })}
              >
                <option value="topic">from topic</option>
                <option value="blog">from blog post</option>
              </select>
              {VIDEO_KINDS.includes(r.key) && (
                <>
                  {/* NARRATED vs CHARACTERS (Cory 2026-08-20). Narrated = the narrator VO speaks
                      and on-screen characters stay MUTE (their generated audio is dropped, never
                      ducked - ducked clips babble). Characters = the characters are the only
                      voices, each pinned to its fixed voice below. Enforced at render time. */}
                  <div className="flex items-center rounded-lg border border-line overflow-hidden text-[11px]"
                       role="radiogroup" aria-label={`${r.label} narration mode`}>
                    {["narrated", "character"].map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={narration[r.key] === m}
                        title={m === "narrated"
                          ? "One narrator voice. Characters animate but make no sound."
                          : "No narrator. The characters are the only voices, using the pinned voices below."}
                        onClick={() => narration[r.key] !== m && saveNarration(r.key, m)}
                        className={`px-2 py-1 ${narration[r.key] === m ? "bg-primary text-white" : "text-dim hover:text-ink"}`}>
                        {m === "narrated" ? "narrated" : "characters"}
                      </button>
                    ))}
                  </div>
                  {narrMsg[r.key] && <span className="text-[10px] text-dim">{narrMsg[r.key]}</span>}
                </>
              )}
              {source[r.key] === "blog" && (
                <input
                  className="input !w-40 text-xs"
                  aria-label={`${r.label} source post`}
                  placeholder="post slug or URL"
                  value={ref[r.key] || ""}
                  onChange={(e) => setRef({ ...ref, [r.key]: e.target.value })}
                />
              )}
              {/* RUN — make one now */}
              <button
                className="btn-ghost !px-2.5 !py-1 text-xs"
                /* Gated on the SAVED state, not the form: this button hits the server, and the
                   engine's allowance() now refuses a switched-off kind. Letting it look clickable
                   would just produce a failure with a less useful message than this tooltip. */
                disabled={!runnable[r.key]?.runnable || running === r.key || live.enabled === false}
                title={live.enabled === false
                  ? `${r.label} is switched off for this client — switch it on and save first`
                  : runnable[r.key]?.runnable
                    ? `Run one now via ${runnable[r.key].task} (background, 30-60 min)`
                    : (runnable[r.key]?.reason || "not runnable for this lane")}
                onClick={() => runOne(r.key)}
              >
                {running === r.key ? <Spinner size={11} /> : null} Run
              </button>
              {/* The WORD comes from the saved state, the "(unsaved)" suffix from the delta.
                  Doing it the other way round (reading f.*) made the row lie in one direction:
                  flip a switch ON and the row immediately printed live usage as though the kind
                  were publishing, while the server still had it off and the dispatcher was still
                  skipping it. Typing 0 into a count did the same in reverse — instant "paused"
                  over a server that was still publishing at 3/day.
                  runMsg sits BESIDE the state instead of replacing it: it is never cleared, so as
                  the first branch of a ternary one click of Run blanked that row's status for the
                  rest of the session. */}
              {(() => {
                const savedOn = live.enabled !== false;
                const pending = f.enabled !== savedOn || f.count !== live.count || f.per !== live.per;
                const tag = pending ? " (unsaved)" : "";
                const state = !savedOn
                  ? <span className="text-warn">off{tag}</span>
                  : live.count === 0
                    ? <span className="text-warn">paused{tag}</span>
                    : typeof live.used === "number"
                      ? <>used <b className="text-ink">{live.used}</b> · left <b className="text-ink">{live.remaining}</b> this {live.per}
                          {tag && <span className="text-warn">{tag}</span>}</>
                      : <>—{tag}</>;
                return (
                  <div className="ml-auto flex items-center gap-2 text-[11px] text-muted">
                    {state}
                    {runMsg[r.key] && (
                      <span className={runMsg[r.key].startsWith("started") ? "text-ok" : "text-danger"}>
                        {runMsg[r.key]}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* OUTPUT SIZE — one value that governs long-form and the shorts cut from it.
            Lives in this card because it is a publishing dial, not a brand/style setting. */}
        {videoFormat && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
            <div className="min-w-[130px]">
              <div className="text-xs font-medium text-ink">Video size</div>
              {/* Deliberately says BODY, not "and its shorts". short_engine.py hardcodes
                  1080x1920 and never reads this value, so claiming it governs shorts was false. */}
              <div className="text-[10px] text-dim">the long-form body renders at this</div>
            </div>
            <select
              className="input !w-auto"
              aria-label="Video output size"
              disabled={fmtBusy}
              /* Bound to a "" sentinel when nothing is set, NOT to the resolved name. Binding to
                 the resolved value made the warning below impossible to clear: an un-opted-in lane
                 resolves to "vertical", so "vertical" already showed as selected and choosing it
                 fired no change event. The only escape was to save `wide` and then `vertical`,
                 and a render firing in that window would have come out 1920x1080. */
              value={videoFormat.explicit ? (videoFormat.current || "") : ""}
              onChange={(e) => { if (e.target.value) saveFormat(e.target.value); }}
            >
              {!videoFormat.explicit && (
                <option value="">not set — using {videoFormat.current} (default)</option>
              )}
              {/* A hand-set WxH is a legal value but is not in PRESETS; surface it rather than
                  silently showing the wrong row as selected. */}
              {videoFormat.explicit && videoFormat.current
                && !(videoFormat.presets || []).some((p: any) => p.name === videoFormat.current) && (
                <option value={videoFormat.current}>{videoFormat.current} (custom)</option>
              )}
              {(videoFormat.presets || []).map((p: any) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {p.w}x{p.h} · {p.aspect}
                </option>
              ))}
            </select>
            {fmtBusy && <Spinner size={11} />}
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              {videoFormat.error
                ? <span className="text-danger">{videoFormat.error}</span>
                : !videoFormat.explicit
                  /* Absence is not "unchanged": with no video.format the engine falls back to
                     video_format.DEFAULT, which is vertical, not the 16:9 this lane has been
                     rendering. Say so rather than letting a default look like a decision. */
                  ? <span className="text-warn">not set — falling back to the default</span>
                  : <span className="text-muted">{videoFormat.w}x{videoFormat.h} · {videoFormat.aspect}</span>}
              {fmtMsg && (
                <span role="status" aria-live="polite"
                      className={fmtMsg === "saved" ? "text-ok" : "text-danger"}>{fmtMsg}</span>
              )}
            </div>
          </div>
        )}

        {/* REEL STYLE — which short-form modes rotate. Unlike "Video size" this genuinely
            governs shorts: it rewrites lanes.json mode_rotation, the value short_mode.py reads. */}
        {shortStyle && (shortStyle.presets || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
            <div className="min-w-[130px]">
              <div className="text-xs font-medium text-ink">Reel style</div>
              <div className="text-[10px] text-dim">how this brand's shorts get made</div>
            </div>
            <select
              className="input !w-auto"
              aria-label="Reel style"
              disabled={styleBusy}
              value={shortStyle.current?.name === "custom" ? "" : (shortStyle.current?.name || "")}
              onChange={(e) => { if (e.target.value) saveStyle(e.target.value); }}
            >
              {/* A hand-edited rotation is legal; show it honestly instead of pretending a
                  preset row is selected. Choosing any preset replaces it. */}
              {shortStyle.current?.name === "custom" && (
                <option value="">custom rotation: {(shortStyle.current?.rotation || []).join(" · ")}</option>
              )}
              {(shortStyle.presets || []).map((p: any) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {(p.rotation || []).join(" → ")}
                </option>
              ))}
            </select>
            {styleBusy && <Spinner size={11} />}
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              {shortStyle.error
                ? <span className="text-danger">{shortStyle.error}</span>
                : <span className="text-muted">
                    {(shortStyle.presets || []).find((p: any) => p.name === shortStyle.current?.name)?.blurb
                      || shortStyle.current?.blurb || ""}
                  </span>}
              {styleMsg && (
                <span role="status" aria-live="polite"
                      className={styleMsg === "saved" ? "text-ok" : "text-danger"}>{styleMsg}</span>
              )}
            </div>
          </div>
        )}

        {/* CHARACTER VOICES - visible once any video kind is character-led. Each role is pinned
            to ONE voice and stays pinned across every video: consistency IS the feature
            (Cory 2026-08-20). A cleared role falls back to the narrator blend. */}
        {anyCharacter && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
            <div className="min-w-[130px]">
              <div className="text-xs font-medium text-ink">Character voices</div>
              <div className="text-[10px] text-dim">pinned per role, same on every video</div>
            </div>
            {VOICE_ROLES.map((role) => (
              <label key={role.key} className="flex items-center gap-1.5 text-[11px] text-dim">
                {role.label}
                {voiceList && voiceList.length > 0 ? (
                  <select
                    className="input !w-auto text-xs"
                    aria-label={`${role.label} character voice`}
                    value={voices[role.key]}
                    onChange={(e) => saveVoices({ ...voices, [role.key]: e.target.value })}
                  >
                    <option value="">(narrator)</option>
                    {voiceList.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                ) : (
                  <input
                    className="input mono !w-40 text-xs"
                    aria-label={`${role.label} character voice id`}
                    placeholder="ElevenLabs voice id"
                    value={voices[role.key]}
                    onChange={(e) => setVoices({ ...voices, [role.key]: e.target.value })}
                    onBlur={() => saveVoices(voices)}
                  />
                )}
              </label>
            ))}
            {voiceMsg && (
              <span role="status" aria-live="polite"
                    className={`text-[11px] ${voiceMsg === "saved" ? "text-ok" : voiceMsg === "saving" ? "text-dim" : "text-danger"}`}>
                {voiceMsg}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-dim">Content and social dial separately. The hourly dispatcher runs things when they're due; these dials are the real schedule.</span>
        <div className="flex items-center gap-2">
          {msg && <span role="status" aria-live="polite" className={`text-xs ${msg === "saved" ? "text-ok" : "text-danger"}`}>{msg}</span>}
          <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
            {busy ? <Spinner size={13} /> : null} Save cadence
          </button>
        </div>
      </div>
    </Card>
  );
}
