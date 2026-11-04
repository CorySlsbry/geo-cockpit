"""
jobs.py — the background audit runner (the multi-minute job the cockpit's north star depends on).

geo_audit.run_audit is one blocking, multi-minute call (live provider measurement + subscription
drafting via the claude CLI). We run it in a worker THREAD (the engine is synchronous) and, for real
progress, re-run run_audit's own public stage functions one at a time (mirroring geo_audit.run_audit
lines 536-564), emitting progress between them — with a whole-run_audit fallback if that ever drifts.

State: an in-memory progress map (live SSE) + a SQLite job store (cockpit.db, survives restart). On
boot, any job left 'running'/'queued' is marked failed('interrupted') — honest, never a phantom.
Concurrency is capped (subscription is single-seat).
"""
from __future__ import annotations

import datetime
import json
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from app.config import CONFIG, DATA_DIR, REPORTS_DIR
from app import engine_bridge as eng

DB_PATH = DATA_DIR / "cockpit.db"


def _now() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


class Jobs:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._progress: dict[str, dict] = {}          # job_id -> {status, phase, pct, log:[...]}
        self._init_db()
        self._recover()
        self._pool = ThreadPoolExecutor(max_workers=CONFIG["audit_concurrency"],
                                        thread_name_prefix="audit")
        self._fn_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="job")

    # --- sqlite ---------------------------------------------------------
    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(DB_PATH, timeout=20)
        c.row_factory = sqlite3.Row
        return c

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")  # concurrent worker-write + request-read without "database is locked"
            c.execute("""CREATE TABLE IF NOT EXISTS jobs(
                id TEXT PRIMARY KEY, kind TEXT, slug TEXT, status TEXT, phase TEXT, pct INTEGER,
                params TEXT, result TEXT, report_path TEXT, error TEXT,
                created_at TEXT, started_at TEXT, finished_at TEXT)""")

    def _recover(self) -> None:
        with self._conn() as c:
            c.execute("UPDATE jobs SET status='failed', error='interrupted by restart', "
                      "finished_at=? WHERE status IN ('queued','running')", (_now(),))

    # --- progress (in-memory, thread-safe) ------------------------------
    def _set(self, job_id: str, *, log_line: str | None = None, **fields) -> None:
        with self._lock:
            p = self._progress.setdefault(job_id, {"status": "queued", "phase": "queued", "pct": 0, "log": []})
            p.update(fields)
            if log_line:
                p["log"].append({"ts": _now(), "line": log_line})
                p["log"] = p["log"][-200:]

    def progress(self, job_id: str) -> dict | None:
        with self._lock:
            p = self._progress.get(job_id)
            return json.loads(json.dumps(p)) if p else None

    def _db_update(self, job_id: str, **fields) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._conn() as c:
            c.execute(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))

    # --- public API -----------------------------------------------------
    def running_for(self, slug: str, kinds: tuple[str, ...] | None = None) -> str | None:
        q = "SELECT id FROM jobs WHERE slug=? AND status IN ('queued','running')"
        params: list = [slug]
        if kinds:
            q += f" AND kind IN ({','.join('?' * len(kinds))})"
            params.extend(kinds)
        with self._conn() as c:
            r = c.execute(q + " ORDER BY created_at DESC LIMIT 1", params).fetchone()
        return r["id"] if r else None

    def enqueue_audit(self, slug: str, params: dict) -> str:
        job_id = "job_" + uuid.uuid4().hex[:12]
        with self._conn() as c:
            c.execute("INSERT INTO jobs(id,kind,slug,status,phase,pct,params,created_at) "
                      "VALUES(?,?,?,?,?,?,?,?)",
                      (job_id, "audit", slug, "queued", "queued", 0, json.dumps(params), _now()))
        self._set(job_id, status="queued", phase="queued", pct=0)
        self._pool.submit(self._run_audit, job_id, slug, params)
        return job_id

    def enqueue_fn(self, kind: str, slug: str, fn, params: dict | None = None) -> str:
        """Run any engine call as a tracked background job (same store/SSE as audits).
        ``fn`` receives one argument: a ``progress(phase=?, pct=?, log_line=?)`` callback.
        Its return value (a JSON-able dict) is persisted as the job result. Quick jobs get
        their own single worker so a long audit can't starve them — and one at a time keeps
        the subscription CLI single-seat."""
        job_id = "job_" + uuid.uuid4().hex[:12]
        with self._conn() as c:
            c.execute("INSERT INTO jobs(id,kind,slug,status,phase,pct,params,created_at) "
                      "VALUES(?,?,?,?,?,?,?,?)",
                      (job_id, kind, slug, "queued", "queued", 0, json.dumps(params or {}), _now()))
        self._set(job_id, status="queued", phase="queued", pct=0)
        self._fn_pool.submit(self._run_fn, job_id, fn)
        return job_id

    def _run_fn(self, job_id: str, fn) -> None:
        self._set(job_id, status="running", phase="working", pct=5)
        self._db_update(job_id, status="running", started_at=_now(), phase="working", pct=5)

        def progress(phase: str | None = None, pct: int | None = None, log_line: str | None = None):
            fields = {k: v for k, v in (("phase", phase), ("pct", pct)) if v is not None}
            self._set(job_id, log_line=log_line, **fields)

        try:
            result = fn(progress)
            self._db_update(job_id, status="done", phase="done", pct=100, finished_at=_now(),
                            result=json.dumps(result))
            self._set(job_id, status="done", phase="done", pct=100, log_line="done")
        except Exception as e:  # never leave a job dangling
            self._db_update(job_id, status="failed", phase="failed", finished_at=_now(), error=str(e)[:500])
            self._set(job_id, status="failed", phase="failed", log_line=f"FAILED: {str(e)[:300]}")

    def get(self, job_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not r:
            return None
        row = dict(r)
        prog = self.progress(job_id)
        summary = None
        if row.get("result"):
            try:
                summary = json.loads(row["result"]).get("audit", {}).get("summary")
            except Exception:
                summary = None
        return {
            "id": row["id"], "kind": row["kind"], "slug": row["slug"], "status": row["status"],
            "phase": (prog or {}).get("phase", row["phase"]), "pct": (prog or {}).get("pct", row["pct"]),
            "log": (prog or {}).get("log", []), "error": row["error"],
            "created_at": row["created_at"], "started_at": row["started_at"],
            "finished_at": row["finished_at"], "summary": summary,
            "has_report": bool(row.get("report_path")),
        }

    def list_jobs(self, slug: str | None = None, limit: int = 40) -> list[dict]:
        with self._conn() as c:
            if slug:
                rows = c.execute("SELECT * FROM jobs WHERE slug=? ORDER BY created_at DESC LIMIT ?",
                                 (slug, limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            row = dict(r)
            summary = None
            if row.get("result"):
                try:
                    summary = json.loads(row["result"]).get("audit", {}).get("summary")
                except Exception:
                    pass
            out.append({"id": row["id"], "kind": row["kind"], "slug": row["slug"], "status": row["status"],
                        "created_at": row["created_at"], "finished_at": row["finished_at"],
                        "summary": summary, "has_report": bool(row.get("report_path")), "error": row["error"]})
        return out

    def result(self, job_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not r or not r["result"]:
            return None
        try:
            return json.loads(r["result"])
        except Exception:
            return None

    def report_path(self, job_id: str) -> str | None:
        with self._conn() as c:
            r = c.execute("SELECT report_path FROM jobs WHERE id=?", (job_id,)).fetchone()
        return r["report_path"] if r and r["report_path"] else None

    def save_result(self, job_id: str, result: dict) -> None:
        """Persist an edited audit result (used by the review edit flow)."""
        with self._conn() as c:
            c.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result), job_id))

    # --- the worker -----------------------------------------------------
    def _run_audit(self, job_id: str, slug: str, params: dict) -> None:
        self._set(job_id, status="running", phase="starting", pct=1, log_line=f"audit queued for {slug}")
        self._db_update(job_id, status="running", started_at=_now(), phase="starting", pct=1)
        try:
            good, _bad = eng.client_profile.load_all()
            profile = good.get(slug) or eng.client_profile.load(slug)
            result = self._run_stages(job_id, profile, good, params)
            self._db_update(job_id, status="done", phase="done", pct=100, finished_at=_now(),
                            result=json.dumps(result), report_path=result.get("report_path"))
            self._set(job_id, status="done", phase="done", pct=100, log_line="audit complete")
        except Exception as e:  # never leave a job dangling
            self._db_update(job_id, status="failed", phase="failed", finished_at=_now(), error=str(e)[:500])
            self._set(job_id, status="failed", phase="failed", log_line=f"FAILED: {str(e)[:300]}")

    def _run_stages(self, job_id: str, profile: dict, all_profiles: dict, params: dict) -> dict:
        cp, ga, cfg = eng.client_profile, eng.geo_audit, eng.geo_config
        max_measure = params.get("max_measure")
        max_draft = params.get("max_draft", ga.DEFAULT_MAX_DRAFT)
        draft_model = params.get("draft_model") or ga.DRAFT_MODEL
        no_llm = bool(params.get("no_llm"))
        brand = cp.brand(profile)
        slug = profile.get("slug") or ga._slugify(brand.get("name", "client"))
        today = datetime.date.today().isoformat()

        try:
            # 0. SITE HEALTH — can the AI engines even see the site? (rules out the silent blocker)
            self._set(job_id, phase="site", pct=2, log_line="Checking AI-crawler access, llms.txt, sitemap, JSON-LD...")
            site_row = None
            try:
                site_row = eng.site_geo_check.as_row(profile)
            except Exception:
                pass

            # 1. MEASURE (per-cluster ticks)
            self._set(job_id, phase="measure", pct=3, log_line="Measuring buyer clusters via AI-search engines...")
            clusters = profile.get("buyer_clusters") or []
            name, domain = brand.get("name", ""), brand.get("domain", "")
            scorecard: list[dict] = []
            total = max(1, len(clusters))
            for i, cluster in enumerate(clusters):
                if max_measure is not None and i >= max_measure:
                    scorecard.append({"cluster": cluster, "cited": None, "cited_where": [], "named_where": [],
                                      "competitor_urls": [], "providers": [],
                                      "note": "Not measured this run (cost cap). Re-run without a measure cap."})
                else:
                    self._set(job_id, log_line=f"measure [{i + 1}/{len(clusters)}] {cluster}")
                    scorecard.append(ga.measure_cluster(name, domain, cluster))
                self._set(job_id, pct=3 + int(37 * (i + 1) / total))
            if site_row:
                scorecard.insert(0, site_row)

            # 2/3. DRAFT (subscription)
            self._set(job_id, phase="draft", pct=42, log_line="Drafting on-brand assets (Claude subscription)...")
            targets = ga.draft_targets(profile, scorecard, all_profiles, max_draft, draft_model, no_llm)

            # 4. NEWS
            self._set(job_id, phase="news", pct=70, log_line="Writing the AI-citable news release...")
            news = ga.build_news(profile, all_profiles, draft_model, no_llm)

            # 8. VIDEO plan
            self._set(job_id, phase="video", pct=82, log_line="Planning video coverage for un-cited clusters...")
            video_plan = ga.build_video_plan(profile, scorecard)

            # 7. AUTOPOST plan (dry-gated; nothing posts here)
            self._set(job_id, phase="autopost", pct=86, log_line="Building the auto-post plan (held under dry-run)...")
            autopost_plan = ga.build_autopost_plan(profile, targets, news)

            # assemble audit (mirrors geo_audit.run_audit 542-557)
            n = len(scorecard)
            measured = sum(1 for r in scorecard if r.get("cited") is not None)
            cited = sum(1 for r in scorecard if r.get("cited") is True)
            absent = sum(1 for r in scorecard if r.get("cited") is False)
            audit = {
                "slug": slug, "brand": brand, "date": today,
                "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "dry_run": cp.is_dry_run(profile),
                "capabilities": {k: cfg.capabilities()[k] for k in ("perplexity", "openai", "gemini", "anthropic")},
                "style": ((profile.get("video") or {}).get("style") or {}),
                "summary": {"clusters": n, "measured": measured, "cited": cited, "absent": absent,
                            "unknown": n - measured, "targets": len(targets),
                            "drafts_written": sum(1 for t in targets if t["draft_status"] == "written")},
                "scorecard": [{**r, "label": ga.cited_label(r.get("cited"))} for r in scorecard],
                "targets": targets, "news": news, "video_plan": video_plan, "autopost_plan": autopost_plan,
            }

            # 6. RENDER report
            self._set(job_id, phase="render", pct=92, log_line="Rendering the branded HTML report...")
            out_dir = REPORTS_DIR / slug
            out_dir.mkdir(parents=True, exist_ok=True)
            report_path = out_dir / f"{slug}-{today}.html"
            eng.audit_report.render(audit, report_path)

            # kits
            self._set(job_id, phase="kits", pct=97, log_line="Building the paste-ready posting kits...")
            kits = eng.slack_kit.build_kits(audit)
            return {"audit": audit, "report_path": str(report_path), "slack_kits": kits}

        except Exception as e:  # stage-runner drifted -> whole-run_audit fallback (states-only)
            self._set(job_id, phase="fallback", pct=50,
                      log_line=f"stage-runner error ({str(e)[:120]}); falling back to run_audit whole")
            out_dir = REPORTS_DIR / slug
            return ga.run_audit(profile, all_profiles, out_dir=out_dir, max_measure=max_measure,
                                max_draft=max_draft, draft_model=draft_model, no_llm=no_llm)


JOBS = Jobs()


async def sse_stream(job_id: str):
    """The shared SSE progress generator (used by /api/audits/{id}/events and /api/jobs/{id}/events).
    Emits a data frame on every progress change, then a final done/failed event."""
    import asyncio

    last = None
    idle = 0
    while True:
        prog = JOBS.progress(job_id)
        if prog is None:
            j = JOBS.get(job_id)
            if j is None:
                yield 'event: error\ndata: {"error":"not found"}\n\n'
                return
            prog = {"status": j["status"], "phase": j["phase"], "pct": j["pct"], "log": j.get("log", [])}
        snap = json.dumps(prog)
        if snap != last:
            yield f"data: {snap}\n\n"
            last = snap
        if prog.get("status") in ("done", "failed"):
            yield f"event: {prog['status']}\ndata: {snap}\n\n"
            return
        idle += 1
        if idle % 15 == 0:
            yield ": keepalive\n\n"
        await asyncio.sleep(1)
