import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const app = await readFile(resolve(root, "src/app.js"), "utf8");
const css = await readFile(resolve(root, "styles.css"), "utf8");

test("toningar är valfria, flexibla och har stora iPad-reglage", () => {
  assert.match(html, /id="fadeInToggle"/);
  assert.match(html, /id="fadeOutToggle"/);
  assert.match(html, /id="fadeInNumber"[^>]+type="number"/);
  assert.match(html, /id="fadeOutNumber"[^>]+type="number"/);
  assert.match(html, /id="fadeInRange"[^>]+type="range"/);
  assert.match(html, /id="fadeOutRange"[^>]+type="range"/);
  assert.doesNotMatch(html, /id="fade(?:In|Out)Toggle"[^>]+checked/);
  assert.match(css, /\.fade-switch\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.preset-row button\s*\{[^}]*min-height:\s*44px/s);
});

test("medhörningen schemalägger samma linjära fadefunktion med AudioParam", () => {
  const scheduler = app.match(/function schedulePreviewEnvelope[\s\S]*?\n}\n\nfunction updateMonitoringGraph/)?.[0] || "";
  assert.match(scheduler, /fadeEnvelopeAt/);
  assert.match(scheduler, /cancelScheduledValues/);
  assert.match(scheduler, /setValueAtTime/);
  assert.match(scheduler, /linearRampToValueAtTime/);
  assert.doesNotMatch(scheduler, /requestAnimationFrame|setInterval/);
  assert.match(app, /fadeInFrames:\s*Math\.round\(state\.trim\.fadeInSeconds \* sampleRate\(\)\)/);
  assert.match(app, /fadeOutFrames:\s*Math\.round\(state\.trim\.fadeOutSeconds \* sampleRate\(\)\)/);
});

test("global toppmarginal är av med minus två dBTP som försiktigt grundvärde", () => {
  assert.match(html, /id="peakHandlingToggle"/);
  assert.doesNotMatch(html, /id="peakHandlingToggle"[^>]+checked/);
  assert.match(html, /id="peakCeilingNumber"[^>]+value="-2\.0"/);
  assert.match(html, /True Peak-värdet är orienterande och är ingen leveransgaranti/);
  assert.match(html, /Detta är inte en limiter/);
  assert.match(html, /kan inte reparera ljud som redan är klippt eller distorderat/);
});

test("toppmarginalens API sparas i appstatus, projekt och exportanrop", () => {
  assert.match(app, /mode:\s*"global-attenuation"/);
  assert.match(app, /ceilingDbtp:\s*-2/);
  assert.match(app, /peakHandling:\s*\{ \.\.\.state\.peakHandling \}/);
  const projectEdit = app.match(/function projectEdit\(\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(projectEdit, /peakHandling:\s*normalizedPeakHandling\(\)/);
  const exportCall = app.match(/exportWorker\.postMessage\([\s\S]*?\n\s*}\);/)?.[0] || "";
  assert.match(exportCall, /peakHandling:\s*normalizedPeakHandling\(\)/);
});

test("importerade markörtider normaliseras numeriskt före DOM-rendering", () => {
  const renderer = app.match(/function renderMarkers\(\)[\s\S]*?\n}\n\nfunction syncTrimUi/)?.[0] || "";
  assert.match(renderer, /finite\(marker\?\.seconds\)/);
  assert.match(renderer, /if \(seconds === null\) return null/);
  assert.match(renderer, /data-marker-jump="\$\{String\(marker\.seconds\)\}"/);
  assert.match(renderer, /escapeHtml\(marker\.text\)/);
});
