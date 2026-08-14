import { normalizePeakHandling } from "./dsp-core.js";

export const PROJECT_SCHEMA = "se.gaia.ljudr.analysis-project/1";
export const REPORT_SCHEMA = "se.gaia.ljudr.analysis-report/1";
export const APP_VERSION = "0.12.0";

const encoder = new TextEncoder();

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export async function fingerprintFile(file, edgeBytes = 1024 * 1024) {
  const headLength = Math.min(file.size, edgeBytes);
  const tailStart = Math.max(headLength, file.size - edgeBytes);
  const [head, tail] = await Promise.all([
    file.slice(0, headLength).arrayBuffer(),
    file.slice(tailStart).arrayBuffer()
  ]);
  const descriptor = encoder.encode(JSON.stringify({
    name: file.name || null,
    size: file.size,
    lastModified: file.lastModified || null,
    headLength,
    tailStart
  }));
  const combined = new Uint8Array(descriptor.byteLength + head.byteLength + tail.byteLength);
  combined.set(descriptor, 0);
  combined.set(new Uint8Array(head), descriptor.byteLength);
  combined.set(new Uint8Array(tail), descriptor.byteLength + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return {
    algorithm: "SHA-256",
    strategy: "descriptor+first+last",
    edgeBytes,
    value: hex(new Uint8Array(digest))
  };
}

export async function buildProject({ file, analysis = null, edit = {}, markers = [], metadata = {}, settings = {} }) {
  return {
    schema: PROJECT_SCHEMA,
    createdAt: new Date().toISOString(),
    app: { name: "LjudR Analysverkstad", version: APP_VERSION },
    source: file ? {
      name: file.name || null,
      size: file.size,
      type: file.type || null,
      lastModified: file.lastModified || null,
      fingerprint: await fingerprintFile(file)
    } : null,
    analysis,
    edit: {
      rangeConvention: "[startFrame,endFrame)",
      startFrame: Number(edit.startFrame) || 0,
      endFrame: Number(edit.endFrame) || analysis?.format?.frameCount || null,
      gainDb: Number(edit.gainDb) || 0,
      fadeInFrames: Number(edit.fadeInFrames) || 0,
      fadeOutFrames: Number(edit.fadeOutFrames) || 0,
      peakHandling: normalizePeakHandling(edit.peakHandling)
    },
    markers: Array.isArray(markers) ? markers : [],
    metadata: { ...metadata },
    settings: { ...settings },
    privacy: {
      audioIncluded: false,
      statement: "Ljudfilen lämnar inte enheten. Projektfilen innehåller inga ljudsamplingar."
    }
  };
}

export async function readProjectFile(file) {
  const project = JSON.parse(await file.text());
  if (project?.schema !== PROJECT_SCHEMA) throw new Error("Filen är inte ett projekt från LjudR Analysverkstad.");
  if (project?.privacy?.audioIncluded !== false) throw new Error("Projektfilens integritetsmarkering är ogiltig.");
  return {
    ...project,
    edit: {
      ...(project.edit || {}),
      peakHandling: normalizePeakHandling(project.edit?.peakHandling)
    }
  };
}

export async function sourceMatchesProject(file, project) {
  if (!project?.source?.fingerprint) return { matches: false, reason: "Projektet saknar källfingeravtryck." };
  if (file.size !== project.source.size) return { matches: false, reason: "Filstorleken skiljer sig från projektets källa." };
  const fingerprint = await fingerprintFile(file, project.source.fingerprint.edgeBytes);
  return fingerprint.value === project.source.fingerprint.value
    ? { matches: true, reason: "Filens fingeravtryck stämmer." }
    : { matches: false, reason: "Filens fingeravtryck stämmer inte." };
}

const cleanObject = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === "number" && !Number.isFinite(item)) return null;
  if (ArrayBuffer.isView(item)) return Array.from(item);
  return item;
}));

export function buildJsonReport({ file, analysis, edit, markers, metadata, exportReport = null }) {
  return cleanObject({
    schema: REPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    app: { name: "LjudR Analysverkstad", version: APP_VERSION },
    standards: {
      loudness: "ITU-R BS.1770-5 och EBU Tech 3341/3342",
      validation: analysis?.validation || "Kontrollera analysens valideringsfält."
    },
    source: {
      name: file?.name || null,
      size: file?.size || null,
      lastModified: file?.lastModified || null
    },
    technical: analysis?.format || null,
    measurements: analysis?.summary || null,
    observations: analysis?.observations || [],
    edit: edit || null,
    markers: markers || [],
    metadata: metadata || {},
    export: exportReport,
    privacy: "Rapporten innehåller mätdata och metadata men inga ljudsamplingar."
  });
}

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatValue = value => {
  if (value == null) return "Saknas";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  return String(value);
};

const rows = object => Object.entries(object || {}).map(([key, value]) =>
  `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(formatValue(value))}</td></tr>`
).join("");

export function buildHtmlReport(input) {
  const report = buildJsonReport(input);
  const observations = (report.observations || []).map(item => {
    const label = typeof item === "string" ? item : item.label || item.message || JSON.stringify(item);
    return `<li>${escapeHtml(label)}</li>`;
  }).join("") || "<li>Inga observationer registrerade.</li>";
  const metadata = Object.fromEntries(Object.entries(report.metadata || {}).filter(([, value]) => value !== "" && value != null));

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analysrapport | ${escapeHtml(report.source.name || "LjudR")}</title>
<style>
body{margin:0;background:#f3f0e8;color:#17211d;font:16px/1.55 system-ui,sans-serif}.page{max-width:900px;margin:auto;padding:48px 28px}h1{font-size:2.4rem;margin:.2rem 0}h2{margin-top:2rem;border-top:1px solid #c9c2b3;padding-top:1rem}.eyebrow{color:#476557;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.notice{background:#dfeadf;border-radius:14px;padding:16px 18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d9d2c5;padding:9px}th{width:38%;color:#4d5b54}code{font-family:ui-monospace,monospace}footer{margin-top:42px;color:#657069;font-size:.9rem}@media print{body{background:white}.page{max-width:none;padding:0}.notice{border:1px solid #aaa}}
</style>
</head>
<body><main class="page">
<p class="eyebrow">LjudR Analysverkstad</p>
<h1>Analysrapport</h1>
<p>${escapeHtml(report.source.name || "Namnlös ljudfil")}</p>
<p class="notice">Rapporten innehåller mätdata och metadata men inga ljudsamplingar.</p>
<h2>Källa</h2><table>${rows(report.source)}</table>
<h2>Tekniska data</h2><table>${rows(report.technical)}</table>
<h2>Mätningar</h2><table>${rows(report.measurements)}</table>
<h2>Observationer</h2><ul>${observations}</ul>
<h2>Redigering</h2><table>${rows(report.edit)}</table>
<h2>Metadata</h2><table>${rows(metadata)}</table>
<h2>Standard och validering</h2><table>${rows(report.standards)}</table>
<footer>Skapad ${escapeHtml(report.createdAt)} med LjudR Analysverkstad ${escapeHtml(APP_VERSION)}.</footer>
</main></body></html>`;
}

export function downloadText(text, fileName, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadProject(project, fileName = "ljudr-projekt.ljudr.json") {
  downloadText(JSON.stringify(cleanObject(project), null, 2), fileName, "application/json");
}

export function downloadReport(reportInput, format = "html", baseName = "ljudr-analysrapport") {
  if (format === "json") {
    downloadText(JSON.stringify(buildJsonReport(reportInput), null, 2), `${baseName}.json`, "application/json");
  } else {
    downloadText(buildHtmlReport(reportInput), `${baseName}.html`, "text/html;charset=utf-8");
  }
}
