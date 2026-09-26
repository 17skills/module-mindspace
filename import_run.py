import asyncio, json, os
from playwright.async_api import async_playwright
S="/tmp/browser/out/"
async def main():
  m=json.load(open(os.path.expanduser("~/.cache/lovable-auth/session.json")))
  async with async_playwright() as p:
    b=await p.chromium.launch(headless=True); c=await b.new_context(viewport={"width":1280,"height":1800})
    pg=await c.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: (print("DIALOG:", d.message[:200]), asyncio.ensure_future(d.accept())))
    await pg.goto("http://localhost:8080"); await pg.evaluate(f"localStorage.setItem({json.dumps(m['storage_key'])},{json.dumps(json.dumps(m['session']))})")
    await pg.goto("http://localhost:8080/", wait_until="commit"); await pg.wait_for_selector("input[type=file]", state="attached", timeout=80000)
    await pg.set_input_files("input[type=file]", S+"test-bauplan.md")
    await pg.wait_for_url("**/board/**", timeout=60000); print("url", pg.url)
    await pg.wait_for_selector(".react-flow__node-output", timeout=80000); await pg.wait_for_timeout(4000)
    await pg.locator(".react-flow__node-output").screenshot(path=S+"canvas-output.png")
    print("text:", (await pg.locator(".react-flow__node-output").inner_text())[:300]); print(errs[:3])
    await b.close()
asyncio.run(main())
