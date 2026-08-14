import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

test("releaseversionen är konsekvent i motorer, projekt och PWA-cache", async () => {
  const packageData = JSON.parse(await read("package.json"));
  const [project, dsp, exporter, serviceWorker, validation, releaseMeta, validationManifest, html, app] = await Promise.all([
    read("src/project.js"),
    read("src/dsp-core.js"),
    read("src/export-worker.js"),
    read("sw.js"),
    read("docs/VALIDATION.md"),
    read("src/release-meta.js"),
    read("validation-manifest.json"),
    read("index.html"),
    read("src/app.js"),
  ]);
  const version = packageData.version;
  for (const source of [project, dsp, exporter, serviceWorker, validation, releaseMeta, validationManifest]) {
    assert.match(source, new RegExp(version.replaceAll(".", "\\.")));
  }
  assert.match(html, /id="appVersion"/);
  assert.match(app, /appVersion\.textContent = `v\$\{RELEASE\.version\}`/);
  assert.match(app, /import \{ RELEASE \} from "\.\/release-meta\.js"/);
});

test("Pages använder separata jobb och actions pinnade till full SHA", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  assert.match(workflow, /test-and-build:/);
  assert.match(workflow, /deploy:/);
  assert.match(workflow, /needs: test-and-build/);
  for (const action of ["checkout", "setup-node", "upload-pages-artifact", "configure-pages", "deploy-pages"]) {
    assert.match(workflow, new RegExp(`actions/${action}@[0-9a-f]{40}`));
  }
  assert.match(workflow, /persist-credentials: false/);
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
    "build-manifest.json",
    "index.html",
    "manifest.webmanifest",
    "src/analysis-worker.js",
    "src/app.js",
    "src/dsp-core.js",
    "src/export-worker.js",
    "src/project.js",
    "src/release-meta.js",
    "src/sha256.js",
    "src/wav.js",
    "styles.css",
    "sw.js",
    "validation-manifest.json",
  ]);
  assert.equal(files.every(path => [...path].every(character => character.charCodeAt(0) < 128)), true);
  assert.equal(files.some(path => /\.(wav|flac|m4a|mp3|ljudr\.json)$/i.test(path)), false);
});

test("buildmanifestet binder varje publik fil till releasecommit och SHA-256", async () => {
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: root, stdio: "pipe" });
  const manifest = JSON.parse(await readFile(resolve(root, "_site/build-manifest.json"), "utf8"));
  const deployedReleaseMeta = await readFile(resolve(root, "_site/src/release-meta.js"), "utf8");
  assert.equal(manifest.schema, "se.gaia.ljudr.build-manifest/1");
  assert.match(manifest.release.commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.release.version, JSON.parse(await read("package.json")).version);
  assert.match(deployedReleaseMeta, new RegExp(manifest.release.commit));
  assert.doesNotMatch(deployedReleaseMeta, /local-working-tree|placeholder/i);
  for (const [path, expected] of Object.entries(manifest.publicFiles)) {
    const bytes = await readFile(resolve(root, "_site", path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  }
});

test("ignore-reglerna skyddar ljud och lokala rapporter oavsett normalt skiftläge", async () => {
  const ignore = await read(".gitignore");
  for (const name of ["FIELD.WAV", "field.flac", "mix.M4A", "session.ljudr.json", "x_analysrapport.html"]) {
    const ignored = execFileSync("git", ["check-ignore", "-q", name], { cwd: root });
    assert.ok(ignored !== null);
  }
  assert.match(ignore, /_site\//);
});

test("PWA-uppdatering väntar på uttryckligt användarval", async () => {
  const [worker, app] = await Promise.all([read("sw.js"), read("src/app.js")]);
  assert.match(worker, /data\?\.type === "SKIP_WAITING"/);
  assert.doesNotMatch(worker.split('self.addEventListener("message"')[0], /self\.skipWaiting\(\)/);
  assert.match(app, /waitingServiceWorker/);
  assert.match(app, /hasUnsafeUpdateState/);
});

test("den fixerade testinventeringen matchar exakt releasekällan", async () => {
  const inventoryBytes = await readFile(resolve(root, "tests/test-inventory.json"));
  const inventory = JSON.parse(inventoryBytes);
  const validation = JSON.parse(await read("validation-manifest.json"));
  const testFiles = (await readdir(resolve(root, "tests"))).filter(name => name.endsWith(".test.mjs")).sort();
  assert.deepEqual(Object.keys(inventory.files).sort(), testFiles);
  let total = 0;
  for (const file of testFiles) {
    const source = await read(`tests/${file}`);
    const names = Array.from(source.matchAll(/\btest\(\s*"([^"]+)"/g), match => match[1]);
    assert.deepEqual(names, inventory.files[file], `${file} skiljer sig från den fixerade inventeringen`);
    total += names.length;
  }
  const exportSource = await read("tests/export.test.mjs");
  assert.match(exportSource, /for \(const bitsPerSample of \[24, 32\]\)/);
  assert.match(exportSource, /test\(`Ren trimning bevarar PCM\$\{bitsPerSample\} exakt`/);
  total += Object.values(inventory.generated || {}).flat().length;
  assert.equal(total, inventory.total);
  assert.equal(validation.automatedTestInventory.tests, total);
  assert.equal(validation.automatedTestInventory.sha256, createHash("sha256").update(inventoryBytes).digest("hex"));
});
