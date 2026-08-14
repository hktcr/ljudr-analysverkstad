import { File } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ENGINE_VERSION, analyzeWav } from "../src/dsp-core.js";

const directory = resolve(process.argv[2] || "validation-fixtures");
const entries = await readdir(directory, { recursive: true, withFileTypes: true });
const files = entries
  .filter(entry => entry.isFile() && /\.wav$/i.test(entry.name))
  .map(entry => resolve(entry.parentPath || entry.path, entry.name));

const exact = name => files.find(path => basename(path).toLowerCase() === name.toLowerCase());
const prefix = value => files.find(path => basename(path).toLowerCase().startsWith(value.toLowerCase()));
const symmetric = (file, metric, expected, tolerance, testCase) => ({
  file, metric, expected, lower: -tolerance, upper: tolerance, testCase,
});

const cases = [
  ...["integratedLufs", "momentaryMaxLufs", "shortTermMaxLufs"].map(metric =>
    symmetric("seq-3341-1-16bit.wav", metric, -23, 0.1, "Tech 3341 case 1")),
  ...["integratedLufs", "momentaryMaxLufs", "shortTermMaxLufs"].map(metric =>
    symmetric("seq-3341-2-16bit.wav", metric, -33, 0.1, "Tech 3341 case 2")),
  ...[-23, -23, -23].map((expected, index) =>
    symmetric(`prefix:seq-3341-${index + 3}-`, "integratedLufs", expected, 0.1, `Tech 3341 case ${index + 3}`)),
  symmetric("seq-3341-7_seq-3342-5-24bit.wav", "integratedLufs", -23, 0.1, "Tech 3341 case 7"),
  symmetric("seq-3341-7_seq-3342-5-24bit.wav", "loudnessRangeLu", 5, 1, "Tech 3342 case 5"),
  symmetric("prefix:seq-3341-2011-8_seq-3342-6-", "integratedLufs", -23, 0.1, "Tech 3341 case 8"),
  symmetric("prefix:seq-3341-2011-8_seq-3342-6-", "loudnessRangeLu", 15, 1, "Tech 3342 case 6"),
  symmetric("seq-3341-9-24bit.wav", "shortTermMaxLufs", -23, 0.1, "Tech 3341 case 9"),
  ...Array.from({ length: 20 }, (_, index) =>
    symmetric(`seq-3341-10-${index + 1}-24bit.wav`, "shortTermMaxLufs", -23, 0.1, `Tech 3341 case 10.${index + 1}`)),
  symmetric("seq-3341-12-24bit.wav", "momentaryMaxLufs", -23, 0.1, "Tech 3341 case 12"),
  ...Array.from({ length: 20 }, (_, index) =>
    symmetric(`prefix:seq-3341-13-${index + 1}-`, "momentaryMaxLufs", -23, 0.1, `Tech 3341 case 13.${index + 1}`)),
  ...[-6, -6, -6, -6, 3, 0, 0, 0, 0].map((expected, index) => ({
    file: `prefix:seq-3341-${index + 15}-`,
    metric: "truePeakEstimateDbtp",
    expected,
    lower: -0.4,
    upper: 0.2,
    testCase: `Tech 3341 case ${index + 15}`,
  })),
  ...[10, 5, 20, 15].map((expected, index) =>
    symmetric(`seq-3342-${index + 1}-16bit.wav`, "loudnessRangeLu", expected, 1, `Tech 3342 case ${index + 1}`)),
];

const analyses = new Map();
const results = [];
for (const item of cases) {
  const path = item.file.startsWith("prefix:") ? prefix(item.file.slice(7)) : exact(item.file);
  if (!path) {
    results.push({ ...item, status: "missing" });
    continue;
  }
  let analysis = analyses.get(path);
  if (!analysis) {
    const bytes = await readFile(path);
    const file = new File([bytes], basename(path), { type: "audio/wav" });
    analysis = await analyzeWav(file, { waveformBins: 64 });
    analyses.set(path, analysis);
  }
  const actual = analysis.summary[item.metric];
  const difference = actual - item.expected;
  const passed = difference >= item.lower && difference <= item.upper;
  results.push({
    testCase: item.testCase,
    file: basename(path),
    metric: item.metric,
    expected: item.expected,
    actual,
    difference,
    lower: item.lower,
    upper: item.upper,
    status: passed ? "passed" : "failed",
  });
}

const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({
  engine: "LjudR",
  engineVersion: ENGINE_VERSION,
  standard: "EBU Tech 3341/3342",
  scope: "62 mono/stereo file-based compliance files, 68 metric assertions",
  exclusions: [
    "Tech 3341 case 6: multichannel, outside LjudR mono/stereo scope",
    "Tech 3341 cases 11 and 14: live-meter tests, outside file-based scope",
  ],
  fixtures: Array.from(analyses.entries(), ([path, analysis]) => ({
    file: basename(path),
    bytes: analysis.sourceIdentity?.bytes ?? null,
    sha256: analysis.sourceIdentity?.value ?? null,
  })).sort((left, right) => left.file.localeCompare(right.file)),
  results,
  counts,
}, null, 2));
if (counts.failed || counts.missing) process.exitCode = 1;
