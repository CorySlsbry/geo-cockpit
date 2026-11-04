"""Finish the Top Builder AI Instagram connection AFTER the TB Instagram account is
linked to the Top Builder AI Facebook Page. Uses the already-stored PAGE token
(no browser/clipboard) to read the page's linked IG business account.
Prints only names/ids — never a token value."""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

SLUG = "top-builder-ai"
fb_path = Path(os.path.expanduser(f"~/.social-tokens/{SLUG}/facebook.json"))
if not fb_path.exists():
    print("ABORT: facebook.json not found — connect the TB Facebook page first."); sys.exit(1)
fb = json.loads(fb_path.read_text())
ptok = fb["access_token"]; pid = fb["account_id"]; api = fb.get("api_host", "https://graph.facebook.com/v23.0")


def gj(url):
    with urllib.request.urlopen(url, timeout=40) as r:
        return json.loads(r.read().decode())


q = gj(f"{api}/{pid}?" + urllib.parse.urlencode(
    {"fields": "name,instagram_business_account{id,username}", "access_token": ptok}))
iga = q.get("instagram_business_account") or {}
if not iga.get("id"):
    print("STILL NOT LINKED: link the TB Instagram to the Top Builder AI page (IG app -> Edit profile -> Page), then re-run.")
    sys.exit(0)

rec = {"access_token": ptok, "account_id": iga["id"], "handle": iga.get("username", ""), "api_host": api}
fb_path.with_name("instagram.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
sys.path.insert(0, r"C:\Users\you\.neuron-vault")
import tokens as vt
vt._store_token("instagram", SLUG, rec)
print(f"OK: instagram connected | @{iga.get('username')} | ig_business_id={iga['id']} | via page {q.get('name')}")
