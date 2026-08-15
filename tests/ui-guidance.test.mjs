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
  assert.match(html, /id="assessmentActionPlan"/);
  assert.match(html, />Föreslagna nästa steg</);
  assert.match(html, /id="openRecommendationsButton"/);
  assert.match(html, /id="preserveFromAnalysisButton"/);
  assert.match(app, /const assessmentProfiles =/);
  assert.match(app, /function levelClass\(/);
  assert.match(app, /Regelbaserad vägledning\. Ingen AI/);
  assert.match(app, /settings: projectSettings\(\)/);
  assert.match(app, /function projectSettings\(\)/);
  assert.match(app, /requestRegionAnalysis\(\)/);
  assert.match(app, /recommendationWorkbench/);
  assert.doesNotMatch(app.match(/function projectSettings\(\)[\s\S]*?\n\}/)?.[0] || "", /detail:/, "detaljcache får inte sparas i projektet");
});

test("bearbetningar och exportval har rekommendationsinformation", async () => {
  const html = await read("index.html");
  const topics = [
    "fades", "gain", "series-reference", "monitoring", "export-profiles",
    "preservation-export", "distribution-export",
    "export-status", "export-safety",
  ];
  for (const topic of topics) {
    assert.match(html, new RegExp(`data-help-topic="${topic}"`), `${topic} saknas`);
  }
  assert.match(html, /id="exportRecommendationText"/);
  assert.doesNotMatch(html, /Lyssningskopia|Kommer senare/);
  assert.match(html, /Spotify for Creators kan ta emot den verifierade WAV-mastern direkt/);
});
