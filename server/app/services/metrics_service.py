"""
metrics_service.py — read-only reader over THE BRIDGE's metrics.db for the dashboard graphs.

The Computer project's Bridge already collects per-brand platform stats (Stripe revenue/orders,
YouTube subs/views, GEO citation share, ad spend, uptime) 3x/day into metrics.db. We open it
read-only (mode=ro, same pattern as bridge/server.py) and shape series for the premium dashboard —
no duplicate collection. Layered on top: the cockpit's own audit-run + delivery counts.
"""
from __future__ import annotations

import datetime
import json
import sqlite3
from pathlib import Path

from app.config import CONFIG
from app import engine_bridge as eng
from app.services.jobs import JOBS

BRIDGE_DB = Path(CONFIG["bridge_db"])

# YouTube channel key per brand (TBAI shares the Salisbury channel); Bridge's YT_BRAND map.
YT_BRAND = {"neuron-hq": "neuron-hq", "auto-advisor": "auto-advisor", "top-builder-ai": "salisbury-shared"}


def _available() -> bool:
    return BRIDGE_DB.is_file()


def _q(sql: str, params: tuple = ()) -> list[dict]:
    if not _available():
        return []
    conn = sqlite3.connect(f"file:{BRIDGE_DB}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    except Exception:
        return []
    finally:
        conn.close()


def series(source: str, metric: str, brand: str, days: int = 180) -> list[dict]:
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    rows = _q("SELECT ts, value FROM metrics WHERE source=? AND metric=? AND brand=? AND ts>=? "
              "ORDER BY ts ASC", (source, metric, brand, since))
    return [{"ts": r["ts"], "value": r["value"]} for r in rows]


def latest(source: str, metric: str, brand: str):
    rows = _q("SELECT ts, value FROM metrics WHERE source=? AND metric=? AND brand=? "
              "ORDER BY ts DESC LIMIT 1", (source, metric, brand))
    return rows[0] if rows else None


def _sum_since(source: str, metric: str, days: int) -> float:
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    rows = _q("SELECT ROUND(SUM(value),2) AS v FROM metrics WHERE source=? AND metric=? AND ts>=?",
              (source, metric, since))
    return (rows[0]["v"] or 0) if rows else 0


def _client_metrics(slug: str) -> dict:
    yt = YT_BRAND.get(slug, slug)
    cited = series("geo", "citations_cited", slug, 365)
    total = series("geo", "citations_total", slug, 365)
    share_latest = None
    lc, lt = latest("geo", "citations_cited", slug), latest("geo", "citations_total", slug)
    if lc and lt and lt["value"]:
        share_latest = round(100 * lc["value"] / lt["value"], 1)
    subs_latest = latest("youtube", "subscribers", yt)
    views_latest = latest("youtube", "channel_views", yt)
    rev = series("stripe", "revenue", slug, 120)
    return {
        "slug": slug,
        "revenue": rev,
        "orders": series("stripe", "orders", slug, 120),
        "youtube": {
            "yt_brand": yt,
            "subscribers": series("youtube", "subscribers", yt, 365),
            "views": series("youtube", "channel_views", yt, 365),
            "subs_latest": subs_latest["value"] if subs_latest else None,
            "views_latest": views_latest["value"] if views_latest else None,
        },
        "geo": {
            "cited": cited, "total": total,
            "share_latest": share_latest,
            "assets": series("geo", "assets_published_cum", slug, 365) or series("geo", "assets_total", slug, 365),
        },
        "kpis": {
            "revenue_30d": _client_revenue_30d(slug),
            "citation_share": share_latest,
            "audits_run": len([j for j in JOBS.list_jobs(slug, 200) if j["status"] == "done"]),
        },
    }


def _client_revenue_30d(slug: str) -> float:
    since = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
    rows = _q("SELECT ROUND(SUM(value),2) AS v FROM metrics WHERE source='stripe' AND metric='revenue' "
              "AND brand=? AND ts>=?", (slug, since))
    return (rows[0]["v"] or 0) if rows else 0


def dashboard(visible: list[str] | None = None) -> dict:
    good, _bad = eng.client_profile.load_all()
    slugs = [s for s in good if visible is None or s in visible]

    company = {}
    if visible is None:  # company-wide KPIs only for owner/team
        up = latest("sentinel", "uptime_pct", "company")
        company = {
            "revenue_30d": _sum_since("stripe", "revenue", 30),
            "orders_30d": _sum_since("stripe", "orders", 30),
            "ad_spend_30d": (latest("meta_browser", "spend_30d", "company") or {}).get("value"),
            "uptime": up["value"] if up else None,
            "uptime_series": series("sentinel", "uptime_pct", "company", 60),
            "revenue_series": _company_revenue_series(),
        }

    return {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "bridge_available": _available(),
        "company": company,
        "clients": [{"slug": s, "name": eng.client_profile.brand(good[s]).get("name", s),
                     **_client_metrics(s)} for s in slugs],
    }


_AD_METRICS = ["spend_30d", "impressions_30d", "purchases_30d", "campaign_spend"]


def ads(visible: list[str] | None = None) -> dict:
    """Meta ads TRACKING from the Bridge (source `meta_browser`, refreshed 3x/day): per-brand
    spend / impressions / purchases + derived CPP, CPM, and ROAS (vs Stripe revenue). Read-only.
    Auto-adjust + A/B are surfaced as a management panel that needs the Meta Marketing API."""
    brands = [r["brand"] for r in _q("SELECT DISTINCT brand FROM metrics WHERE source='meta_browser' "
                                      "ORDER BY brand")]
    if visible is not None:
        brands = [b for b in brands if b in visible or b == "company"]
    good, _bad = eng.client_profile.load_all()
    rows = []
    for b in brands:
        m = {k: (latest("meta_browser", k, b) or {}).get("value") for k in _AD_METRICS}
        spend = m.get("spend_30d") or 0.0
        impr = m.get("impressions_30d") or 0.0
        purch = m.get("purchases_30d") or 0.0
        rev = (latest("stripe", "revenue_30d", b) or {}).get("value")
        if rev is None:
            rev = _client_revenue_30d(b) if b in good else None
        rows.append({
            "brand": b,
            "name": eng.client_profile.brand(good[b]).get("name", b) if b in good else b,
            "spend_30d": round(spend, 2),
            "impressions_30d": int(impr),
            "purchases_30d": int(purch),
            "campaign_spend": m.get("campaign_spend"),
            "cpp": round(spend / purch, 2) if purch else None,          # cost per purchase
            "cpm": round(1000 * spend / impr, 2) if impr else None,     # cost per 1k impressions
            "revenue_30d": rev,
            "roas": round(rev / spend, 2) if (rev and spend) else None, # return on ad spend
            "as_of": (latest("meta_browser", "spend_30d", b) or {}).get("ts"),
            "spend_series": series("meta_browser", "spend_30d", b, 90),
        })
    return {
        "available": _available(),
        "brands": rows,
        "totals": {
            "spend_30d": round(sum(r["spend_30d"] or 0 for r in rows), 2),
            "purchases_30d": sum(r["purchases_30d"] or 0 for r in rows),
            "impressions_30d": sum(r["impressions_30d"] or 0 for r in rows),
        },
        "management": {
            "tracking": "live",
            "source": "Bridge meta_browser (3x/day)",
            "auto_adjust": "not_connected",
            "ab_test": "not_connected",
            "note": "Live spend/performance tracking is on. Automatic budget adjustment and A/B "
                    "testing require the Meta Marketing API (ads_management scope) on the ad "
                    "account, plus budget guardrails + human approval for spend changes.",
        },
    }


def _company_revenue_series() -> list[dict]:
    rows = _q("SELECT ts, ROUND(SUM(value),2) AS value FROM metrics WHERE source='stripe' AND "
              "metric='revenue' GROUP BY ts ORDER BY ts ASC")
    return [{"ts": r["ts"], "value": r["value"]} for r in rows]
