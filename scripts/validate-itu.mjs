import { File } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ENGINE_VERSION, analyzeWav } from "../src/dsp-core.js";

const directory = resolve(process.argv[2] || "validation-fixtures/itu-bs2217");
const entries = await readdir(directory, { recursive: true, withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile() && /\.wav$/i.test(entry.name))
  .map(entry => resolve(entry.parentPath || entry.path, entry.name));

const cases = [
  { name: "1770-2_Comp_RelGateTest.wav", expected: -10 },
  { name: "1770-2_Comp_AbsGateTest.wav", expected: -69.5 },
  { name: "1770-2_Comp_18LKFS_FrequencySweep.wav", expected: -18 },
  ...[23, 24].flatMap(level => [25, 100, 500, 1000, 2000, 10000].map(frequency => ({
    name: `1770-2_Comp_${level}LKFS_${frequency}Hz_2ch.wav`,
    expected: -level,
  }))),
  ...[23, 24].flatMap(level => ["Mono_Voice+Music", "Stereo_VinL+R"].map(kind => ({
    name: `1770-2_Conf_${kind}-${level}LKFS.wav`,
    expected: -level,
  }))),
];

const results = [];
const fixtures = [];
for (const item of cases) {
  const path = files.find(candidate => basename(candidate).toLowerCase() === item.name.toLowerCase());
  if (!path) {
    results.push({ ...item, metric: "integratedLufs", status: "missing" });
    continue;
  }
  const bytes = await readFile(path);
  const file = new File([bytes], basename(path), { type: "audio/wav" });
  const analysis = await analyzeWav(file, { waveformBins: 64 });
  fixtures.push({ file: basename(path), bytes: analysis.sourceIdentity?.bytes ?? null, sha256: analysis.sourceIdentity?.value ?? null });
  const actual = analysis.summary.integratedLufs;
  const difference = actual - item.expected;
  const passed = difference >= -0.1 && difference <= 0.1;
  results.push({
    ...item,
    metric: "integratedLufs",
    actual,
    difference,
    tolerance: 0.1,
    status: passed ? "passed" : "failed",
  });
}

const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
fixtures.sort((left, right) => left.file.localeCompare(right.file));
console.log(JSON.stringify({ engine: "LjudR", engineVersion: ENGINE_VERSION, standard: "ITU-R BS.2217-2", fixtures, results, counts }, null, 2));
if (counts.failed || counts.missing) process.exitCode = 1;
