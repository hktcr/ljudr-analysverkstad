import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
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
];

const forbiddenAudio = /\.(wav|wave|flac|m4a|aac|mp3|aif|aiff|caf|opus|ogg|w64|rf64|bw64|bwf|raw)$/i;
const forbiddenProject = /(?:\.ljudr\.json|[_-]analysrapport\.(?:html|json))$/i;

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const relativePath of publicFiles) {
  const source = resolve(root, relativePath);
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) throw new Error(`Publik källfil saknas: ${relativePath}`);
  const target = resolve(destination, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

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
console.log(`Webbpaket skapat med ${publicFiles.length} uttryckligen tillåtna filer.`);
