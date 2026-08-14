import { File } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { analyzeWav } from "../src/dsp-core.js";

const directory = resolve(process.argv[2] || "validation-fixtures");
const entries = await readdir(directory, { recursive: true, withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile() && /\.wav$/i.test(entry.name))
  .map(entry => resolve(entry.parentPath || entry.path, entry.name));

const find = prefix => files.find(path => basename(path).toLowerCase().startsWith(prefix.toLowerCase()));
const cases = [
  ...[-23, -33, -23, -23, -23].map((expected, index) => ({
    prefix: `seq-3341-${index + 1}-`, metric: "integratedLufs", expected, lower: -0.1, upper: 0.1,
  })),
  ...[-6, -6, -6, -6, 3, 0, 0, 0, 0].map((expected, index) => ({
    prefix: `seq-3341-${index + 15}-`, metric: "truePeakEstimateDbtp", expected, lower: -0.4, upper: 0.2,
  })),
  ...[10, 5, 20, 15].map((expected, index) => ({
    prefix: `seq-3342-${index + 1}-`, metric: "loudnessRangeLu", expected, lower: -1, upper: 1,
  })),
];

const results = [];
for (const item of cases) {
  const path = find(item.prefix);
  if (!path) {
    results.push({ ...item, status: "missing" });
    continue;
  }
  const bytes = await readFile(path);
  const file = new File([bytes], basename(path), { type: "audio/wav" });
  const analysis = await analyzeWav(file, { waveformBins: 64 });
  const actual = analysis.summary[item.metric];
  const difference = actual - item.expected;
  const passed = difference >= item.lower && difference <= item.upper;
  results.push({ ...item, file: basename(path), actual, difference, status: passed ? "passed" : "failed" });
}

const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({ engine: "LjudR", results, counts }, null, 2));
if (counts.failed || counts.missing) process.exitCode = 1;
