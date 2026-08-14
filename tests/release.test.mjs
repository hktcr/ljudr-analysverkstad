import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

test("releaseversionen är konsekvent i motorer, projekt och PWA-cache", async () => {
  const packageData = JSON.parse(await read("package.json"));
  const [project, dsp, exporter, serviceWorker, validation] = await Promise.all([
    read("src/project.js"),
    read("src/dsp-core.js"),
    read("src/export-worker.js"),
    read("sw.js"),
    read("docs/VALIDATION.md"),
  ]);
  const version = packageData.version;
  for (const source of [project, dsp, exporter, serviceWorker, validation]) {
    assert.match(source, new RegExp(version.replaceAll(".", "\\.")));
  }
});

test("Pages använder separata jobb, aktuella actions och ett tillåtet webbpaket", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  assert.match(workflow, /test-and-build:/);
  assert.match(workflow, /deploy:/);
  assert.match(workflow, /needs: test-and-build/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: _site/);
});

test("webbpaketet innehåller exakt den uttryckliga tillåtelselistan", async () => {
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: root, stdio: "pipe" });
  const files = (await readdir(resolve(root, "_site"), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => {
      const parent = entry.parentPath || entry.path;
      return resolve(parent, entry.name).slice(resolve(root, "_site").length + 1);
    })
    .sort();
  assert.deepEqual(files, [
    "assets/icon-192.png",
    "assets/icon-512.png",
    "assets/icon.svg",
    "index.html",
    "manifest.webmanifest",
    "src/analysis-worker.js",
    "src/app.js",
    "src/dsp-core.js",
    "src/export-worker.js",
    "src/project.js",
    "src/wav.js",
    "styles.css",
    "sw.js",
  ]);
  assert.equal(files.every(path => [...path].every(character => character.charCodeAt(0) < 128)), true);
  assert.equal(files.some(path => /\.(wav|flac|m4a|mp3|ljudr\.json)$/i.test(path)), false);
});

test("ignore-reglerna skyddar ljud och lokala rapporter oavsett normalt skiftläge", async () => {
  const ignore = await read(".gitignore");
  for (const name of ["FIELD.WAV", "field.flac", "mix.M4A", "session.ljudr.json", "x_analysrapport.html"]) {
    const ignored = execFileSync("git", ["check-ignore", "-q", name], { cwd: root });
    assert.ok(ignored !== null);
  }
  assert.match(ignore, /_site\//);
});
