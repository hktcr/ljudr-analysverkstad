import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "_site");

const publicFiles = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon.svg",
  "src/app.js",
  "src/dsp-core.js",
  "src/analysis-worker.js",
  "src/wav.js",
  "src/export-worker.js",
  "src/project.js",
  "src/sha256.js",
  "src/release-meta.js",
  "src/analysis-exchange.js",
  "validation-manifest.json",
];

const forbiddenAudio = /\.(wav|wave|flac|m4a|aac|mp3|aif|aiff|caf|opus|ogg|w64|rf64|bw64|bwf|raw)$/i;
const forbiddenProject = /(?:\.ljudr\.json|[_-]analysrapport\.(?:html|json))$/i;

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const relativePath of publicFiles) {
  const source = resolve(root, relativePath);
  const sourceLinkStat = await lstat(source);
  if (sourceLinkStat.isSymbolicLink()) throw new Error(`Publik källfil får inte vara en symlänk: ${relativePath}`);
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error(`Publik källfil saknas: ${relativePath}`);
  const target = resolve(destination, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

const packageData = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const releaseCommit = process.env.GITHUB_SHA
  || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/i.test(releaseCommit)) throw new Error("Releasecommit är inte ett fullständigt Git-SHA.");
const builtAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : execFileSync("git", ["show", "-s", "--format=%cI", releaseCommit], { cwd: root, encoding: "utf8" }).trim();
const releaseMeta = {
  version: packageData.version,
  commit: releaseCommit,
  builtAt,
  channel: "public-validation-candidate",
  methodVersion: "ljudr-method/1.0-rc.7",
};
await writeFile(
  resolve(destination, "src/release-meta.js"),
  `export const RELEASE = Object.freeze(${JSON.stringify(releaseMeta, null, 2)});\n`,
  "utf8",
);

const hashes = {};
for (const relativePath of publicFiles) {
  const bytes = await readFile(resolve(destination, relativePath));
  hashes[relativePath] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(resolve(destination, "build-manifest.json"), `${JSON.stringify({
  schema: "se.gaia.ljudr.build-manifest/1",
  release: releaseMeta,
  sourceTree: releaseCommit,
  publicFiles: hashes,
}, null, 2)}\n`, "utf8");

const inspect = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(absolutePath);
      continue;
    }
    const relativePath = absolutePath.slice(destination.length + 1);
    if (forbiddenAudio.test(relativePath) || forbiddenProject.test(relativePath)) {
      throw new Error(`Förbjuden fil i webbpaketet: ${relativePath}`);
    }
  }
};

await inspect(destination);
console.log(`Webbpaket skapat med ${publicFiles.length + 1} uttryckligen tillåtna filer.`);
