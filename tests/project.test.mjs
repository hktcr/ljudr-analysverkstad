import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHtmlReport,
  buildJsonReport,
  buildProject,
  fingerprintFile,
  readProjectFile,
  sourceMatchesProject
} from "../src/project.js";

test("projektfilen innehåller fingeravtryck men inga ljudsamplingar", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "fält.wav", { lastModified: 7 });
  const project = await buildProject({
    file,
    analysis: { summary: { integratedLufs: -21.4 } },
    edit: { startFrame: 10, endFrame: 20 },
    metadata: { title: "Skymning" }
  });
  assert.equal(project.privacy.audioIncluded, false);
  assert.equal(project.source.fingerprint.algorithm, "SHA-256");
  assert.equal(project.source.fingerprint.value.length, 64);
  assert.doesNotMatch(JSON.stringify(project), /"samples"/);
  const restored = await readProjectFile(new File([JSON.stringify(project)], "fält.ljudr.json"));
  assert.equal(restored.metadata.title, "Skymning");
  assert.deepEqual(restored.edit.peakHandling, {
    enabled: false,
    mode: "global-attenuation",
    ceilingDbtp: -2,
    sourceTruePeakDbtp: null
  });
});

test("projektfilen sparar toppanpassning och äldre projekt får säkra standardvärden", async () => {
  const file = new File([new Uint8Array([8, 9, 10])], "toppar.wav", { lastModified: 8 });
  const project = await buildProject({
    file,
    edit: {
      gainDb: 2,
      peakHandling: {
        enabled: true,
        mode: "global-attenuation",
        ceilingDbtp: -3,
        sourceTruePeakDbtp: -0.7
      }
    }
  });
  const restored = await readProjectFile(new File([JSON.stringify(project)], "toppar.ljudr.json"));
  assert.deepEqual(restored.edit.peakHandling, {
    enabled: true,
    mode: "global-attenuation",
    ceilingDbtp: -3,
    sourceTruePeakDbtp: -0.7
  });

  const legacy = structuredClone(project);
  delete legacy.edit.peakHandling;
  const restoredLegacy = await readProjectFile(new File([JSON.stringify(legacy)], "äldre.ljudr.json"));
  assert.equal(restoredLegacy.edit.peakHandling.enabled, false);
  assert.equal(restoredLegacy.edit.peakHandling.ceilingDbtp, -2);
});

test("källmatchning upptäcker både rätt och ändrad fil", async () => {
  const source = new File([new Uint8Array([1, 2, 3, 4])], "a.wav", { lastModified: 1 });
  const project = await buildProject({ file: source });
  assert.equal((await sourceMatchesProject(source, project)).matches, true);
  const changed = new File([new Uint8Array([1, 2, 3, 9])], "a.wav", { lastModified: 1 });
  assert.equal((await sourceMatchesProject(changed, project)).matches, false);
});

test("rapporten serialiserar typade arrayer och skyddar HTML", () => {
  const input = {
    file: new File(["x"], "rapport.wav"),
    analysis: {
      format: { channels: 2 },
      summary: { integratedLufs: -20 },
      observations: [{ title: "<script>alert(1)</script>" }],
      waveform: { min: new Float32Array([0, 1]) }
    },
    edit: { startFrame: 0, endFrame: 1 },
    markers: [],
    metadata: { title: "Kor & skymning" }
  };
  const json = buildJsonReport(input);
  assert.equal(json.measurements.integratedLufs, -20);
  const html = buildHtmlReport(input);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Kor &amp; skymning/);
});

test("fingeravtryck är deterministiskt", async () => {
  const file = new File([new Uint8Array(4096).fill(42)], "x.wav", { lastModified: 3 });
  assert.deepEqual(await fingerprintFile(file), await fingerprintFile(file));
});
