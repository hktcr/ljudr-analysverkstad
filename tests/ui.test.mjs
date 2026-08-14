import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const app = await readFile(resolve(root, "src/app.js"), "utf8");
const css = await readFile(resolve(root, "styles.css"), "utf8");
const serviceWorker = await readFile(resolve(root, "sw.js"), "utf8");

test("alla HTML-id är unika och statiska appselektorer finns", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  const selectorIds = [...app.matchAll(/\$\("#([A-Za-z][\w:-]*)"\)/g)].map(match => match[1]);
  const missing = [...new Set(selectorIds)].filter(id => !ids.includes(id));
  assert.deepEqual(missing, []);
});

test("integritetsbudskap och nätspärr finns", () => {
  assert.match(html, /Lokalt läge: ljudfilen lämnar inte enheten/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(?:src|href)="https?:\/\//i);
  assert.doesNotMatch(css, /url\(["']?https?:\/\//i);
});

test("alla knappar har uttrycklig typ", () => {
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  assert.ok(buttons.length > 20);
  assert.deepEqual(buttons.filter(button => !/\stype="button"/.test(button)), []);
});

test("appskalet innehåller inga en dash", () => {
  const forbiddenCharacter = String.fromCodePoint(0x2013);
  assert.equal([html, app, css, serviceWorker].some(text => text.includes(forbiddenCharacter)), false);
});

test("alla service-workerresurser finns i den lokala MASTER", async () => {
  const paths = [...serviceWorker.matchAll(/^\s*"\.\/([^"?]+)"[,]?$/gm)].map(match => match[1]);
  assert.ok(paths.includes("index.html"));
  await Promise.all(paths.filter(path => path).map(path => access(resolve(root, path))));
});
