import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("static app has core accessibility landmarks and labels", async () => {
  const html = await fs.readFile("web/index.html", "utf8");
  assert.match(html, /<main class="shell"/);
  assert.match(html, /<aside class="setup" aria-label="Trip setup"/);
  assert.match(html, /<nav class="tabs" aria-label="Wanderlore sections"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="polite"/);
});

test("static app preserves security and accessible focus styles", async () => {
  const [css, js] = await Promise.all([
    fs.readFile("web/app.css", "utf8"),
    fs.readFile("web/app.js", "utf8")
  ]);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(js, /escapeHtml/);
  assert.doesNotMatch(js, /innerHTML\s*=\s*[^;]*\$\{[^}]*error\.stack/);
});
