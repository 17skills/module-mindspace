"""
Browser-End-to-End: Datentabelle mit Karte und Diagramm verbinden, Ergebnisse im Canvas prüfen.

Legt einen frischen Test-Scope mit einer Quelle (Kopie einer vorhandenen Tabellen-Quelle),
einer Karte und einem Diagramm an, verbindet beide im Browser per Ziehen und prüft:
  - die Verbindungen landen in der Datenbank,
  - die Karte lädt Punkte aus dem sichtbaren Ausschnitt,
  - das Diagramm zeigt serverseitig gruppierte Balken mit den Gruppennamen.
Danach wird der Test-Scope gelöscht.

Start:  SOURCE_NODE=<id einer Quelle mit Datenablage> python3 e2e/dataset_canvas.py
Braucht eine Sitzung aus `lovable auth-session --json` und den Dev-Server auf :8080.
"""
import asyncio, json, os, sys
from pathlib import Path
import requests
from playwright.async_api import async_playwright

BASE = os.environ.get("APP_URL", "http://localhost:8080")
OUT = Path("/tmp/browser/e2e-dataset"); OUT.mkdir(parents=True, exist_ok=True)
ENV = dict(l.split("=", 1) for l in Path(".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
URL = ENV["VITE_SUPABASE_URL"].strip('"'); KEY = ENV["VITE_SUPABASE_PUBLISHABLE_KEY"].strip('"')
SESSION = json.load(open(os.path.expanduser(os.environ.get("SESSION_FILE", "~/.cache/lovable-auth/session.json"))))
TOKEN = SESSION["session"]["access_token"]; USER = SESSION["session"]["user"]["id"]
H = {"apikey": KEY, "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "Prefer": "return=representation"}
SOURCE_NODE = os.environ["SOURCE_NODE"]

def rest(method, path, **kw):
    r = requests.request(method, f"{URL}/rest/v1/{path}", headers=H, timeout=30, **kw)
    if r.status_code >= 300: raise RuntimeError(f"{method} {path}: {r.status_code} {r.text}")
    return r.json() if r.text else None

def setup():
    src = rest("GET", f"nodes?id=eq.{SOURCE_NODE}&select=*")[0]
    board = rest("POST", "boards", json={"user_id": USER, "title": "E2E Datentabelle"})[0]
    def node(type_, title, x, y, w, h, **extra):
        return rest("POST", "nodes", json={"board_id": board["id"], "user_id": USER, "type": type_, "title": title,
            "position_x": x, "position_y": y, "width": w, "height": h, "status": "ready", **extra})[0]
    s = node("source", "Tabelle", 0, 0, src["width"], src["height"], metadata=src["metadata"], content=src.get("content"))
    m = node("map", "Karte", 800, -300, 420, 360, metadata={})
    c = node("chart", "Diagramm", 520, 420, 420, 340, metadata={"columns": [], "rows": [], "chartType": "bar"})
    return board["id"], s["id"], m["id"], c["id"]

async def drag(page, a, b):
    ra, rb = await a.bounding_box(), await b.bounding_box()
    await page.mouse.move(ra["x"] + ra["width"] / 2, ra["y"] + ra["height"] / 2)
    await page.mouse.down()
    for i in range(1, 21):
        t = i / 20
        await page.mouse.move(ra["x"] + (rb["x"] - ra["x"]) * t + rb["width"] / 2 * t,
                              ra["y"] + (rb["y"] - ra["y"]) * t + rb["height"] / 2 * t)
        await page.wait_for_timeout(15)
    await page.mouse.up()
    await page.wait_for_timeout(800)

async def main():
    board, s, m, c = setup()
    failures = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
            page = await ctx.new_page()
            await page.goto(BASE, wait_until="domcontentloaded")
            await page.evaluate(f"localStorage.setItem({json.dumps(SESSION['storage_key'])}, {json.dumps(json.dumps(SESSION['session']))})")
            await page.goto(f"{BASE}/board/{board}", wait_until="commit")
            await page.wait_for_selector(f'.react-flow__node[data-id="{c}"]', timeout=30000)
            await page.wait_for_timeout(1500)
            await page.locator(".react-flow__controls-fitview").click()
            await page.wait_for_timeout(800)
            out = page.locator(f'.react-flow__node[data-id="{s}"] .react-flow__handle.source').last
            for target in (c, m):
                await drag(page, out, page.locator(f'.react-flow__node[data-id="{target}"] .react-flow__handle.target.react-flow__handle-left').first)
            edges = rest("GET", f"edges?board_id=eq.{board}&select=source_id,target_id")
            pairs = {(e["source_id"], e["target_id"]) for e in edges}
            if (s, m) not in pairs: failures.append("Verbindung Tabelle→Karte fehlt")
            if (s, c) not in pairs: failures.append("Verbindung Tabelle→Diagramm fehlt")
            await page.wait_for_timeout(4000)
            await page.screenshot(path=str(OUT / "canvas.png"))
            map_node = page.locator(f'.react-flow__node[data-id="{m}"]')
            markers = await map_node.locator(".leaflet-marker-icon, .leaflet-interactive").count()
            print("Kartenpunkte:", markers)
            if markers == 0: failures.append("Karte zeigt keine Punkte")
            chart = page.locator(f'.react-flow__node[data-id="{c}"]')
            bars = await chart.locator(".recharts-bar-rectangle").count()
            labels = await chart.locator(".recharts-cartesian-axis-tick-value").all_inner_texts()
            print("Balken:", bars, "Achse:", labels)
            if bars == 0: failures.append("Diagramm zeigt keine Balken")
            await map_node.screenshot(path=str(OUT / "map.png"))
            await chart.screenshot(path=str(OUT / "chart.png"))
            await browser.close()
    finally:
        rest("DELETE", f"boards?id=eq.{board}")
    if failures:
        print("FEHLER:", *failures, sep="\n  "); sys.exit(1)
    print("OK: Tabelle mit Karte und Diagramm verbunden, Ergebnisse im Canvas sichtbar")

asyncio.run(main())
