import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_EXCHANGE_SCHEMA,
  GUIDANCE_SCHEMA,
  addGuidanceDigest,
  appendAuditEntry,
  buildAnalysisBundle,
  canonicalJson,
  createLocalReceipt,
  digestCanonical,
  exportAnalysisBundle,
  parseGuidanceFile,
  validateAnalysisBundle,
  validateGuidance,
} from "../src/analysis-exchange.js";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const sourceHash = "ab".repeat(32);

function analysis() {
  const points = 120;
  return {
    sourceIdentity: { value: sourceHash },
    region: { startFrame: 0, endFrame: 288000, selectedFrames: 288000, fadeInFrames: 0, fadeOutFrames: 0, globalGainDb: 0 },
    format: { fileName: "hemlig.wav", fileSizeBytes: 1_000_000, container: "RIFF/WAVE", encoding: "IEEE float", channels: 2, sampleRate: 48000, bitsPerSample: 32, validBitsPerSample: 32, frameCount: 288000, durationSeconds: 6 },
    duration: 6,
    summary: {
      integratedLufs: -19.2, loudnessRangeLu: 4.1, momentaryMaxLufs: -15, shortTermMaxLufs: -17,
      samplePeakDbfs: -5, truePeakEstimateDbtp: -4.8, plrEstimateLu: 14.4, rmsDbfs: -23,
      crestFactorDb: 18, channelBalanceDb: 0.2, correlation: 0.8, overrangeSamples: 0, nonFiniteSamples: 0,
      channels: [{ channel: 1, samplePeakDbfs: -5, truePeakEstimateDbtp: -4.8, truePeakTimeSeconds: 2.345, dcOffset: 0.001, rmsDbfs: -23, crestFactorDb: 18, clippedSamples: 0, overrangeSamples: 0, nonFiniteSamples: 0 }],
    },
    timelines: {
      intervalSeconds: 0.1,
      timeSeconds: Array.from({ length: points }, (_, index) => index / 10),
      momentaryLufs: Array.from({ length: points }, (_, index) => -25 + index / 20),
      shortTermLufs: Array.from({ length: points }, (_, index) => index < 30 ? null : -24 + index / 30),
      samplePeakDbfs: Array.from({ length: points }, (_, index) => -12 + index / 20),
      rmsDbfs: Array.from({ length: points }, () => -40),
      correlation: Array.from({ length: points }, () => 0.75),
      channelRmsDbfs: [[-1, -2]], waveform: [1, 2], spectrum: [3],
    },
    waveform: { channels: [{ samples: [0.1], min: [-1], max: [1], rms: [0.2] }] },
    markersSuggested: [
      { id: "tp", label: "True Peak", severity: "critical", objective: true, startSeconds: 2.345, endSeconds: 2.345, channel: 1, timePrecisionSeconds: 1 / 192000 },
      { id: "flat", label: "Möjlig flat-top", severity: "review", heuristic: true, startSeconds: 4.2, endSeconds: 4.8 },
    ],
    analysisSettings: { lowLevelThresholdDbfs: -80 },
    validation: { engineVersion: "1.0.0-rc.3", loudnessModel: "ITU-R BS.1770-5", loudnessStatus: "validated", truePeakMethod: "4x FIR", truePeakValidationStatus: "validated" },
  };
}

test("kanonisk JSON är nyckelordningsoberoende och digest stabil", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(digestCanonical({ b: 2, a: 1 }), digestCanonical({ a: 1, b: 2 }));
});

test("minimal redacted bundle saknar källhash, ljuddata och tidsserie", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis(), profile: "minimal", privacy: "redacted", release: { version: "1.0.0-rc.3" } }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00.000Z" });
  assert.equal(bundle.schema, ANALYSIS_EXCHANGE_SCHEMA);
  assert.equal(bundle.analysis.temporalDiagnostic, null);
  assert.equal(bundle.analysis.format.fileName, null);
  assert.equal(bundle.analysis.markers[0].startSeconds, 2.345);
  assert.equal(bundle.analysis.markers[1].startSeconds, 4);
  const json = canonicalJson(bundle);
  assert.doesNotMatch(json, /sourceIdentity|sourceHash|waveform|samples|spectrum|channelRmsDbfs|hemlig\.wav/);
  assert.deepEqual(validateAnalysisBundle(bundle), { valid: true, errors: [] });
});

test("temporal diagnostic innehåller endast femsekunders programaggregat", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis(), profile: "temporal-diagnostic", privacy: "exact", metadata: { sourceFileName: "hemlig.wav" }, privacySelection: { includeFileName: true } }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  assert.equal(bundle.analysis.temporalDiagnostic.length, 2);
  assert.deepEqual(bundle.analysis.temporalDiagnostic[0].startSeconds, 0);
  assert.deepEqual(bundle.analysis.temporalDiagnostic[0].endSeconds, 5);
  assert.equal(bundle.analysis.format.fileName, "hemlig.wav");
  assert.equal("rmsDbfs" in bundle.analysis.temporalDiagnostic[0], false);
  assert.equal("channel" in bundle.analysis.temporalDiagnostic[0], false);
});

test("digest avslöjar manipulation och förbjudna fält stoppas", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  bundle.analysis.measurements.integratedLufs = -1;
  assert.throws(() => validateAnalysisBundle(bundle), error => error.code === "INVALID_ANALYSIS_BUNDLE" && error.details.some(item => item.includes("analysisDigest")));
  const fresh = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  fresh.analysis.waveform = [1];
  fresh.analysisDigest = digestCanonical(fresh.analysis);
  assert.throws(() => validateAnalysisBundle(fresh), /ogiltigt/i);
});

test("prototyper, icke ändliga tal och överdjupa träd stoppas", () => {
  assert.throws(() => canonicalJson(Object.create({ inherited: true })), error => error.code === "PROTOTYPE");
  assert.throws(() => canonicalJson({ value: Infinity }), error => error.code === "NON_FINITE");
  let deep = { value: 1 };
  for (let index = 0; index < 10; index += 1) deep = { next: deep };
  assert.throws(() => canonicalJson(deep), error => error.code === "MAX_DEPTH");
});

test("lokalt kvitto binder bundle och digest till full SHA utan att exportera den", () => {
  const result = exportAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z", sourceIdentity: { value: sourceHash } });
  assert.equal(result.receipt.sourceSha256, sourceHash);
  assert.doesNotMatch(result.json, new RegExp(sourceHash));
  assert.ok(result.blob.size > 0);
  assert.deepEqual(createLocalReceipt(result.bundle, { sourceIdentity: sourceHash }), result.receipt);
});

function guidance(bundle) {
  return addGuidanceDigest({
    schema: GUIDANCE_SCHEMA,
    bundleId: bundle.bundleId,
    analysisDigest: bundle.analysisDigest,
    createdAt: "2026-08-15T13:00:00Z",
    producer: { system: "gAIa", component: "VEP", version: "1", method: "panel-review", vepPerspectives: ["audio-dsp"], model: null, promptId: null, runId: null, trust: "unsigned" },
    summary: "Varsam kontroll rekommenderas.",
    assumptions: ["Ingen lokal nivåautomation."],
    uncertainties: ["Lyssning krävs."],
    suggestions: [{ id: "gain-1", classification: "heuristic", kind: "global-gain", summary: "Prova låg global gain.", rationale: "Målet ryms preliminärt.", evidenceRefs: ["loudness", "true-peak"], globalGainDb: 0.5, predictedIntegratedLufs: -18.7, predictedTruePeakDbtp: -4.3, confidence: 0.7 }],
  });
}

test("guidance är strikt bunden, läsbar och aldrig auto-apply", async () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  const receipt = createLocalReceipt(bundle, { sourceIdentity: sourceHash });
  const value = guidance(bundle);
  assert.deepEqual(validateGuidance(value, { receipt, currentAnalysisDigest: bundle.analysisDigest }), { valid: true, errors: [] });
  const parsed = await parseGuidanceFile(JSON.stringify(value), { bundleReceipts: [receipt], sourceIdentity: sourceHash, currentAnalysisDigest: bundle.analysisDigest });
  assert.equal(parsed.match, true);
  assert.equal(parsed.status, "bound-current");
  assert.equal(parsed.autoApply, false);
});

test("guidance med okända actions eller fel bindning avvisas", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  const value = guidance(bundle);
  value.suggestions[0].autoApply = true;
  assert.throws(() => validateGuidance(value), /ogiltig/i);
  const clean = guidance(bundle);
  assert.throws(() => validateGuidance(clean, { currentAnalysisDigest: "cd".repeat(32) }), /ogiltig/i);
});

test("metadata kräver separat opt-in och Minimal läcker ingen fri markörtext", () => {
  const input = analysis();
  input.markersSuggested[0].label = "Hemligt personnamn och samtal";
  const hidden = buildAnalysisBundle({ analysis: input, metadata: { sourceFileName: "secret.wav", title: "Hemligt" }, privacySelection: {} }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  assert.doesNotMatch(canonicalJson(hidden), /Hemligt|secret\.wav/);
  const visible = buildAnalysisBundle({ analysis: input, metadata: { sourceFileName: "secret.wav", title: "Titel" }, privacySelection: { includeFileName: true, includeIdentity: true } }, { bundleId: "223e4567-e89b-42d3-a456-426614174000", createdAt: "2026-08-15T12:00:00Z" });
  assert.equal(visible.analysis.metadata.sourceFileName, "secret.wav");
  assert.equal(visible.analysis.metadata.identity.title, "Titel");
  assert.doesNotMatch(visible.analysis.markers[0].summary, /Hemligt/);
});

test("långa tidslinjer får högst 720 deterministiska segment med 5 s multipel", () => {
  const input = analysis();
  input.duration = 7201;
  input.format.durationSeconds = 7201;
  input.region.endFrame = input.region.selectedFrames = 7201 * 48000;
  input.timelines.intervalSeconds = 10;
  input.timelines.timeSeconds = Array.from({ length: 721 }, (_, index) => index * 10);
  for (const key of ["momentaryLufs", "shortTermLufs", "samplePeakDbfs", "rmsDbfs"]) input.timelines[key] = Array.from({ length: 721 }, () => -20);
  input.timelines.correlation = Array.from({ length: 721 }, () => 0.5);
  const bundle = buildAnalysisBundle({ analysis: input, profile: "temporal-diagnostic" }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  assert.ok(bundle.analysis.temporalDiagnostic.length <= 720);
  assert.equal(bundle.analysis.temporalDiagnostic[0].endSeconds % 5, 0);
});

test("guidance kräver känd evidens och audit är hashkedjad före och efter", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  const receipt = createLocalReceipt(bundle, { sourceIdentity: sourceHash });
  const unknown = { ...guidance(bundle), guidanceDigest: undefined };
  delete unknown.guidanceDigest;
  unknown.suggestions = [{ ...unknown.suggestions[0], evidenceRefs: ["unknown"] }];
  assert.throws(() => validateGuidance(addGuidanceDigest(unknown), { receipt }), /ogiltig/i);
  const entries = appendAuditEntry([], { action: "accept", bundleId: bundle.bundleId, analysisDigest: bundle.analysisDigest, suggestionId: "gain-1", before: { globalGainDb: 0 }, after: { globalGainDb: 0.5 } }, { timestamp: "2026-08-15T14:00:00Z" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].before.globalGainDb, 0);
  assert.equal(entries[0].after.globalGainDb, 0.5);
  assert.equal(Object.isFrozen(entries), true);
});

test("guidance blir aldrig bound-current utan både aktuell full hash och digest", async () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  const receipt = createLocalReceipt(bundle, { sourceIdentity: sourceHash });
  const text = JSON.stringify(guidance(bundle));
  const noHash = await parseGuidanceFile(text, { bundleReceipts: [receipt], currentAnalysisDigest: bundle.analysisDigest });
  assert.equal(noHash.match, false);
  assert.equal(noHash.status, "source-unverified-read-only");
  const noDigest = await parseGuidanceFile(text, { bundleReceipts: [receipt], sourceIdentity: sourceHash });
  assert.equal(noDigest.match, false);
  assert.equal(noDigest.status, "analysis-unverified-read-only");
});

test("strict schema avvisar okända och feltypade nested scalarer efter omdigest", () => {
  const bundle = buildAnalysisBundle({ analysis: analysis() }, { bundleId: uuid, createdAt: "2026-08-15T12:00:00Z" });
  bundle.analysis.measurements.integratedLufs = "-19";
  bundle.analysisDigest = digestCanonical({ schema: bundle.schema, bundleId: bundle.bundleId, profile: bundle.profile, privacy: bundle.privacy, createdAt: bundle.createdAt, analysis: bundle.analysis });
  assert.throws(() => validateAnalysisBundle(bundle), error => error.code === "INVALID_ANALYSIS_BUNDLE");
  const second = buildAnalysisBundle({ analysis: analysis() }, { bundleId: "323e4567-e89b-42d3-a456-426614174000", createdAt: "2026-08-15T12:00:00Z" });
  second.analysis.evidence[0].extra = true;
  second.analysisDigest = digestCanonical({ schema: second.schema, bundleId: second.bundleId, profile: second.profile, privacy: second.privacy, createdAt: second.createdAt, analysis: second.analysis });
  assert.throws(() => validateAnalysisBundle(second), error => error.code === "INVALID_ANALYSIS_BUNDLE");
});
