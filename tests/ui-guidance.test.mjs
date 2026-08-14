import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("varje fördjupat mätvärde har en klickbar informationsruta", async () => {
  const html = await read("index.html");
  const ids = [
    "deepMomentary", "deepShortTerm", "deepIntegrated", "deepLra", "deepPlr",
    "deepSamplePeak", "deepSamplePeakTime", "deepTruePeak", "deepRms", "deepCrest",
    "deepCorrelation", "deepChannelBalance", "deepMidSide", "deepDcLeft", "deepDcRight",
    "deepOverrange", "deepInvalid",
  ];
  for (const id of ids) {
    const row = html.match(new RegExp(`<div><dt>[\\s\\S]*?<dd id="${id}"`))?.[0] || "";
    assert.match(row, /data-help-topic=/, `${id} saknar informationsknapp`);
  }
});

test("regelbaserad bedömning har typ, användning och förklarad reflektion", async () => {
  const [html, app] = await Promise.all([read("index.html"), read("src/app.js")]);
  assert.match(html, /id="recordingType"/);
  assert.match(html, /id="assessmentPurpose"/);
  assert.match(html, /id="assessmentReflection"/);
  assert.match(app, /const assessmentProfiles =/);
  assert.match(app, /function levelClass\(/);
  assert.match(app, /Regelbaserad vägledning\. Ingen AI/);
  assert.match(app, /settings: \{ monitoring: state\.monitoring, view: state\.view, assessment: state\.assessment \}/);
});

test("bearbetningar och exportval har rekommendationsinformation", async () => {
  const html = await read("index.html");
  const topics = [
    "fades", "gain", "peak-handling", "monitoring", "export-profiles",
    "preservation-export", "distribution-export", "listening-export",
    "export-status", "export-safety",
  ];
  for (const topic of topics) {
    assert.match(html, new RegExp(`data-help-topic="${topic}"`), `${topic} saknas`);
  }
  assert.match(html, /id="exportRecommendationText"/);
});
