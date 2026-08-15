import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  APP_VERSION,
  MAX_PROJECT_BYTES,
  PROJECT_SCHEMA,
  buildHtmlReport,
  buildJsonReport,
  buildProject,
  fingerprintFile,
  fullHashFile,
  readProjectFile,
  redactReportMetadata,
  sourceMatchesProject,
} from "../src/project.js";
import { sha256Hex } from "../src/sha256.js";

test("SHA-256 klarar NIST-vektorer och blockvis Blob", async () => {
  const encoder = new TextEncoder();
  assert.equal(sha256Hex(encoder.encode("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(encoder.encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const result = await fullHashFile(new Blob(["abc"]), { chunkBytes: 64 });
  assert.equal(result.value, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(result.scope, "full-file-bytes");
  const boundaryData = new Uint8Array(65_537).map((_, index) => index % 251);
  const independent = createHash("sha256").update(boundaryData).digest("hex");
  assert.equal((await fullHashFile(new Blob([boundaryData]), { chunkBytes: 257 })).value, independent);
});

test("projekt använder full filhash och innehåller inga ljudsamplingar", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "fält.wav", { lastModified: 7 });
  const project = await buildProject({
    file,
    analysis: { format: { frameCount: 20 }, summary: { integratedLufs: -21.4 } },
    edit: { startFrame: 10, endFrame: 20, globalGainDb: -1, localGainRegions: [{ id: "peak", startFrame: 11, attackEndFrame: 12, releaseStartFrame: 13, endFrame: 14, gainDb: -3 }], profile: "edited-wav" },
    metadata: { title: "Skymning", latitude: "56.123456" },
    settings: { series: { status: "applied", proposedGainDb: -1 } },
  });
  assert.equal(project.schema, PROJECT_SCHEMA);
  assert.equal(project.app.version, APP_VERSION);
  assert.equal(project.privacy.audioIncluded, false);
  assert.equal(project.source.identity.scope, "full-file-bytes");
  assert.equal(project.source.identity.value.length, 64);
  assert.equal(project.edit.localGainRegions[0].channelMode, "linked");
  assert.equal(project.source.preflightFingerprint.scope, "quick-preflight-only");
  assert.doesNotMatch(JSON.stringify(project), /"samples"/);
  assert.equal(project.metadata.latitude, "56.123456");
  const restored = await readProjectFile(new File([JSON.stringify(project)], "fält.ljudr.json"));
  assert.equal(restored.metadata.title, "Skymning");
  assert.equal(restored.source.identityRequired, false);
  assert.equal(restored.edit.globalGainDb, -1);
  assert.equal(restored.edit.gainDb, -1);
  assert.equal(restored.edit.profile, "edited-wav");
  assert.equal(restored.settings.series.status, "applied");
});

test("schema 1 migreras explicit men kräver säker källvalidering", async () => {
  const fixture = await readFile(new URL("./fixtures/project-v1.json", import.meta.url));
  const restored = await readProjectFile(new File([fixture], "legacy.json"));
  assert.equal(restored.schema, PROJECT_SCHEMA);
  assert.equal(restored.migratedFrom.schema, "se.gaia.ljudr.analysis-project/1");
  assert.equal(restored.migratedFrom.sourceRevalidationRequired, true);
  assert.equal(restored.source.identityRequired, true);
  const match = await sourceMatchesProject(new File([new Uint8Array(4)], "legacy.wav"), restored);
  assert.equal(match.matches, false);
  assert.equal(match.requiresReanalysis, true);
});

test("strikt projektvalidering stoppar storlek, intervall och fel typer", async () => {
  await assert.rejects(
    readProjectFile({ size: MAX_PROJECT_BYTES + 1, text: async () => "{}" }),
    /större än/,
  );
  const file = new File([new Uint8Array([1, 2, 3])], "x.wav");
  const project = await buildProject({ file, edit: { startFrame: 0, endFrame: 3 } });
  project.edit.gainDb = 100;
  await assert.rejects(readProjectFile(new File([JSON.stringify(project)], "bad.json")), /gainDb/);
  project.edit.globalGainDb = -60;
  project.edit.gainDb = -60;
  project.edit.profile = "edited-wav";
  assert.equal((await readProjectFile(new File([JSON.stringify(project)], "safe-float.json"))).edit.globalGainDb, -60);
  project.edit.globalGainDb = -60.1;
  project.edit.gainDb = -60.1;
  await assert.rejects(readProjectFile(new File([JSON.stringify(project)], "too-low.json")), /globalGainDb/);
  project.edit.globalGainDb = 0;
  project.edit.gainDb = 0;
  project.edit.globalGainDb = 1;
  project.edit.gainDb = 1;
  project.edit.profile = "sample-payload-trim";
  await assert.rejects(readProjectFile(new File([JSON.stringify(project)], "bad.json")), /Sample-payload/);
  project.edit.globalGainDb = 0;
  project.edit.gainDb = 0;
  project.markers = "inte en lista";
  await assert.rejects(readProjectFile(new File([JSON.stringify(project)], "bad.json")), /markörer/);
});

test("full källmatchning upptäcker ändring i filens mitt", async () => {
  const original = new Uint8Array(2 * 1024 * 1024 + 1).fill(7);
  const source = new File([original], "a.wav", { lastModified: 1 });
  const project = await buildProject({ file: source });
  assert.equal((await sourceMatchesProject(source, project)).matches, true);
  const changedBytes = original.slice();
  changedBytes[1024 * 1024] = 9;
  const changed = new File([changedBytes], "a.wav", { lastModified: 1 });
  assert.equal((await sourceMatchesProject(changed, project)).matches, false);
  assert.equal((await fingerprintFile(source)).scope, "quick-preflight-only");
});

test("rapporten har tre semantiska sektioner och renderar nästlade objekt", () => {
  const identity = { algorithm: "SHA-256", scope: "full-file-bytes", bytes: 1, value: "a".repeat(64) };
  const input = {
    file: new File(["x"], "rapport.wav"),
    analysis: {
      sourceIdentity: identity,
      format: { channels: 2, sampleRate: 96000 },
      summary: { integratedLufs: -20 },
      observations: [{ title: "<script>alert(1)</script>", detail: { channel: "L" } }],
    },
    edit: { startFrame: 0, endFrame: 1, gainDb: 0 },
    markers: [{ id: "m1", seconds: 0, text: "Topp" }],
    metadata: { title: "Kor & skymning", coordinatePrecision: "hidden", latitude: "56.1", longitude: "12.8" },
    exportReport: {
      calculatedExportSelection: { signalMeasurements: { integratedLufs: -19 } },
      verifiedOutput: { sourceIdentity: { ...identity, value: "b".repeat(64) }, summary: { integratedLufs: -19.01 } },
      output: { samplePayloadHash: { algorithm: "SHA-256", value: "c".repeat(64) } },
    },
  };
  const json = buildJsonReport(input);
  assert.equal(json.sections.sourceFile.label, "Källfil");
  assert.equal(json.sections.calculatedExportSelection.label, "Beräknat exporturval");
  assert.equal(json.sections.verifiedExportFile.label, "Verifierad exportfil");
  assert.equal(json.metadata.latitude, undefined);
  assert.match(json.metadata.coordinateDisclosure, /utelämnade/);
  const html = buildHtmlReport(input);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Kor &amp; skymning/);
  assert.match(html, /Verifierad exportfil/);

  const exportOnly = buildJsonReport({
    ...input,
    analysis: { format: input.analysis.format, summary: input.analysis.summary },
    exportReport: {
      source: { sourceIdentity: identity },
      regionAnalysis: { processed: { summary: { integratedLufs: -18.9 } } },
      verifiedExport: input.exportReport.verifiedOutput,
    },
  });
  assert.equal(exportOnly.sections.sourceFile.fullFileHash.value, identity.value);
  assert.equal(exportOnly.sections.calculatedExportSelection.processed.summary.integratedLufs, -18.9);
  assert.equal(exportOnly.sections.verifiedExportFile.fullFileHash.value, "b".repeat(64));
});

test("koordinatpolicy är dold, avrundad eller exakt genom aktivt val", () => {
  const base = { latitude: "56,123456", longitude: "12.987654" };
  assert.equal(redactReportMetadata({ ...base, coordinatePrecision: "hidden" }).latitude, undefined);
  assert.equal(redactReportMetadata({ ...base, coordinatePrecision: "rounded" }).latitude, "56.123");
  assert.equal(redactReportMetadata({ ...base, coordinatePrecision: "exact" }).latitude, "56.123456");
});
