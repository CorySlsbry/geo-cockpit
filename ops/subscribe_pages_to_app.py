"""Step 4 of the Meta webhook wiring: subscribe each brand's Page/IG account to the app so
webhook events actually fire. The app-level `instagram` webhook (fields comments,messages) is
already configured; this attaches each account to it.

Two connection models are handled:
  - page-linked (AA, TB): api_host graph.facebook.com — subscribe the PAGE via /{page}/subscribed_apps
    (activates the app for the IG account linked to that page) + the IG id directly for good measure.
  - Instagram-Login (Neuron HQ IG): api_host graph.instagram.com — subscribe /{ig}/subscribed_apps.

Prints only ids/handles/status. Never prints token values. Idempotent (safe to re-run).
"""
import json, os, sys, urllib.request, urllib.parse, glob

TOK_ROOT = os.path.expanduser(r"~/.social-tokens")

def _post(host, node, token, fields):
    url = f"{host}/v23.0/{node}/subscribed_apps"
    body = urllib.parse.urlencode({"subscribed_fields": fields, "access_token": token}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, method="POST"), timeout=25) as r:
            return True, r.read().decode()
    except urllib.error.HTTPError as e:
        return False, f"{e.code} {e.read().decode()[:300]}"

def _get(host, node, token):
    url = f"{host}/v23.0/{node}/subscribed_apps?" + urllib.parse.urlencode({"access_token": token})
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read().decode()[:200]}"}

def load(slug, kind):
    p = os.path.join(TOK_ROOT, slug, f"{kind}.json")
    if not os.path.isfile(p):
        return None
    return json.load(open(p))

def main():
    slugs = [os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(TOK_ROOT, "*", "facebook.json"))]
    slugs = sorted(set(slugs + [os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(TOK_ROOT, "*", "instagram.json"))]))
    for slug in slugs:
        print(f"\n===== {slug} =====")
        fb = load(slug, "facebook")
        ig = load(slug, "instagram")

        # 1) Subscribe the Facebook Page. `feed` (page-post comments) is grantable now; this page<->app
        #    link is ALSO what activates IG comment webhooks for the IG account linked to this page.
        #    `messages` (FB Messenger) needs pages_messaging (webhook step 2) -> added there, not here.
        if fb:
            pid, ptok = fb["account_id"], fb["access_token"]
            ok, msg = _post("https://graph.facebook.com", pid, ptok, "feed")
            print(f"  PAGE {pid} ({fb.get('handle')}) subscribe -> {'OK' if ok else 'FAIL'}: {msg}")
            cur = _get("https://graph.facebook.com", pid, ptok)
            print(f"    now subscribed_apps: {[a.get('name') or a.get('id') for a in cur.get('data', [])] if 'data' in cur else cur}")

        # 2) Subscribe the IG account ONLY for the Instagram-Login model (graph.instagram.com).
        #    Page-linked IG (graph.facebook.com) does NOT support a direct /{ig}/subscribed_apps call
        #    (app lacks the capability); its events flow through the Page subscription above.
        if ig:
            host = ig.get("api_host", "https://graph.facebook.com")
            if "graph.instagram.com" in host:
                iid = ig["account_id"]
                ok, msg = _post("https://graph.instagram.com", iid, ig["access_token"], "comments,messages")
                print(f"  IG   {iid} (@{ig.get('handle')}) subscribe via graph.instagram.com -> {'OK' if ok else 'FAIL'}: {msg}")
            else:
                print(f"  IG   {ig['account_id']} (@{ig.get('handle')}) page-linked -> events flow via the Page subscription (no direct call)")

if __name__ == "__main__":
    main()
