import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("analysworkern har jobId cancel stale-filter och fem deterministiska operationer", async () => {
  const source = await read("src/analysis-worker.js");
  for (const operation of ["analyze", "analyze-region", "waveform-detail", "spectral-diagnostics", "spectrogram"]) assert.match(source, new RegExp(`"${operation}"`));
  assert.match(source, /latestByOperation/);
  assert.match(source, /cancelledJobs/);
  assert.match(source, /\{ type, jobId, operation/);
  assert.match(source, /type === "cancel"/);
  assert.match(source, /type: "cancelled"|post\("cancelled"/);
});

test("exportworkern har samma jobbkontrakt och full OPFS-livscykel", async () => {
  const source = await read("src/export-worker.js");
  for (const operation of ["export", "storage-list", "storage-get", "storage-remove", "storage-clear"]) {
    assert.match(source, new RegExp(`"${operation}"`));
  }
  assert.match(source, /jobId/);
  assert.match(source, /shouldCancel/);
  assert.match(source, /writer\.cleanup\(\)/);
  assert.match(source, /writer\.markComplete\(\)/);
  assert.doesNotMatch(source, /calculatePeakAdjustment/);
});
