"""
onboard_service.py — onboarding with a PREVIEW-before-save step.

preview() recomposes geo_onboard's public pipeline (discover -> infer_with_llm -> assemble_profile
-> ensure_valid) WITHOUT writing, so the cockpit can show the proposed profile for review/edit first.
save() calls geo_onboard.onboard() (which writes the dry_run profile + scaffolds the token dir).
"""
from __future__ import annotations

from app import engine_bridge as eng

go = eng.geo_onboard


def preview(domain: str, name: str = "", slug: str = "", use_llm: bool = True) -> dict:
    disc = go.discover(domain)
    inferred = go.infer_with_llm(disc["text"], disc["host"], disc["signals"]) if use_llm else None
    profile = go.assemble_profile(domain, disc, inferred, name_override=name, slug_override=slug)
    profile, ok, errs = go.ensure_valid(profile)
    exists = (eng.client_profile.CLIENTS_DIR / f"{profile['slug']}.json").exists()
    return {
        "ok": ok, "errors": errs, "profile": profile,
        "slug": profile.get("slug"),
        "inferred": inferred is not None,
        "homepage_ok": disc.get("homepage_ok"),
        "pages_fetched": disc.get("pages_fetched", []),
        "exists": exists,
    }


def save(domain: str, name: str = "", slug: str = "", use_llm: bool = True, overwrite: bool = False) -> dict:
    return go.onboard(domain, name=name, slug=slug, use_llm=use_llm, overwrite=overwrite)
