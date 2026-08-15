import { normalizePeakHandling } from "./dsp-core.js";
import { hashBlob } from "./sha256.js";
import { RELEASE } from "./release-meta.js";
import { normalizeLocalGainRegions } from "./local-gain.js";

export const PROJECT_SCHEMA = "se.gaia.ljudr.analysis-project/2";
export const REPORT_SCHEMA = "se.gaia.ljudr.analysis-report/2";
export const APP_VERSION = "1.0.0-rc.14";
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;

const LEGACY_SCHEMA = "se.gaia.ljudr.analysis-project/1";
const MAX_MARKERS = 10_000;
const MAX_TEXT = 100_000;
const MAX_FRAME = Number.MAX_SAFE_INTEGER;
const SHA256 = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, maximum = MAX_TEXT) => String(value ?? "").slice(0, maximum);

const cleanObject = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === "number" && !Number.isFinite(item)) return null;
  if (ArrayBuffer.isView(item)) return Array.from(item);
  return item;
}));

const integer = (value, label, minimum = 0, maximum = MAX_FRAME) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${label} är inte ett giltigt heltal.`);
  return number;
};

const finite = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label} ligger utanför tillåtet intervall.`);
  return number;
};

const fullIdentityFrom = value => {
  if (!isRecord(value) || value.algorithm !== "SHA-256" || !SHA256.test(value.value || "")) return null;
  if (!["full-file-bytes", "full-file"].includes(value.scope) && value.strategy !== "full-file-stream") return null;
  return {
    algorithm: "SHA-256",
    scope: "full-file-bytes",
    strategy: "full-file-stream",
    bytes: Number.isSafeInteger(value.bytes) ? value.bytes : null,
    value: value.value.toLowerCase(),
  };
};

const analysisIdentity = analysis => fullIdentityFrom(
  analysis?.sourceIdentity || analysis?.source?.identity || analysis?.validation?.sourceIdentity || analysis?.fullFileHash
);

export async function fingerprintFile(file, edgeBytes = 1024 * 1024) {
  const safeEdgeBytes = Math.max(64 * 1024, Math.min(4 * 1024 * 1024, Number(edgeBytes) || 1024 * 1024));
  const headLength = Math.min(file.size, safeEdgeBytes);
  const tailStart = Math.max(headLength, file.size - safeEdgeBytes);
  const [head, tail] = await Promise.all([
    file.slice(0, headLength).arrayBuffer(),
    file.slice(tailStart).arrayBuffer(),
  ]);
  const descriptor = encoder.encode(JSON.stringify({ size: file.size, headLength, tailStart }));
  const combined = new Uint8Array(descriptor.byteLength + head.byteLength + tail.byteLength);
  combined.set(descriptor, 0);
  combined.set(new Uint8Array(head), descriptor.byteLength);
  combined.set(new Uint8Array(tail), descriptor.byteLength + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return {
    algorithm: "SHA-256",
    scope: "quick-preflight-only",
    strategy: "descriptor+first+last",
    edgeBytes: safeEdgeBytes,
    value: hex(new Uint8Array(digest)),
  };
}

export async function fullHashFile(file, options = {}) {
  return hashBlob(file, options);
}

const normalizeEdit = (edit = {}, frameCount = null) => {
  const startFrame = integer(edit.startFrame ?? 0, "startFrame");
  const endDefault = Number.isSafeInteger(frameCount) ? frameCount : startFrame;
  const endFrame = integer(edit.endFrame ?? endDefault, "endFrame", startFrame);
  if (Number.isSafeInteger(frameCount) && endFrame > frameCount) throw new Error("Redigeringsintervallet ligger utanför källfilen.");
  if (edit.globalGainDb != null && edit.gainDb != null && Number(edit.globalGainDb) !== Number(edit.gainDb)) {
    throw new Error("globalGainDb och gainDb beskriver olika värden.");
  }
  const globalGainDb = finite(edit.globalGainDb ?? edit.gainDb ?? 0, "globalGainDb", -60, 24);
  const fadeInFrames = integer(edit.fadeInFrames ?? 0, "fadeInFrames", 0, endFrame - startFrame);
  const fadeOutFrames = integer(edit.fadeOutFrames ?? 0, "fadeOutFrames", 0, endFrame - startFrame);
  const localGainRegions = normalizeLocalGainRegions(edit.localGainRegions || [], frameCount ?? MAX_FRAME);
  const profile = edit.profile || (globalGainDb !== 0 || fadeInFrames > 0 || fadeOutFrames > 0 || localGainRegions.length > 0
    ? "edited-wav"
    : "sample-payload-trim");
  if (!["sample-payload-trim", "edited-wav"].includes(profile)) throw new Error("Projektets exportprofil är ogiltig.");
  if (profile === "sample-payload-trim" && (globalGainDb !== 0 || fadeInFrames > 0 || fadeOutFrames > 0 || localGainRegions.length > 0)) {
    throw new Error("Sample-payload-identiskt trimutdrag kan inte innehålla gain, lokala gainkurvor eller fades.");
  }
  return {
    rangeConvention: "[startFrame,endFrame)",
    startFrame,
    endFrame,
    globalGainDb,
    gainDb: globalGainDb,
    fadeInFrames,
    fadeOutFrames,
    localGainRegions,
    profile,
    peakHandling: normalizePeakHandling(edit.peakHandling),
  };
};

const normalizeMarkers = markers => {
  if (!Array.isArray(markers)) throw new Error("Projektets markörer måste vara en lista.");
  if (markers.length > MAX_MARKERS) throw new Error(`Projektet innehåller fler än ${MAX_MARKERS} markörer.`);
  return markers.map((marker, index) => {
    if (!isRecord(marker)) throw new Error(`Markör ${index + 1} är ogiltig.`);
    for (const field of ["id", "type", "text", "label", "message"]) {
      if (marker[field] != null && typeof marker[field] !== "string") throw new Error(`Markör ${index + 1} har ogiltigt ${field}.`);
    }
    return {
      ...cleanObject(marker),
      id: cleanText(marker.id || `marker-${index + 1}`, 200),
      seconds: finite(marker.seconds ?? marker.timeSeconds ?? 0, `Markör ${index + 1}`, 0, 10 ** 9),
      type: cleanText(marker.type || "own", 100),
      text: cleanText(marker.text || marker.label || marker.message || "", 10_000),
      suggested: Boolean(marker.suggested),
    };
  });
};

const normalizeMetadata = metadata => {
  if (!isRecord(metadata)) throw new Error("Projektets metadata är ogiltiga.");
  if (Object.keys(metadata).length > 256) throw new Error("Projektets metadata innehåller för många fält.");
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => {
    if (!["string", "number", "boolean"].includes(typeof value) && value != null) throw new Error(`Metadatafältet ${key} har ogiltig typ.`);
    return [cleanText(key, 200), cleanText(value)];
  }));
};

const validateSource = source => {
  if (!isRecord(source)) throw new Error("Projektets källbeskrivning saknas.");
  const size = integer(source.size, "Källfilens storlek", 0);
  const identity = fullIdentityFrom(source.identity || source.fingerprint);
  return {
    name: source.name == null ? null : cleanText(source.name, 1_000),
    size,
    type: source.type == null ? null : cleanText(source.type, 200),
    lastModified: source.lastModified == null ? null : finite(source.lastModified, "Källfilens datum", 0, Number.MAX_SAFE_INTEGER),
    identity,
    fingerprint: identity,
    preflightFingerprint: isRecord(source.preflightFingerprint) ? cleanObject(source.preflightFingerprint) : null,
    identityRequired: !identity,
  };
};

export async function buildProject({ file, analysis = null, edit = {}, markers = [], metadata = {}, settings = {} }) {
  if (!file || typeof file.slice !== "function") throw new TypeError("En källfil krävs för projektet.");
  const suppliedIdentity = analysisIdentity(analysis);
  const identity = suppliedIdentity?.bytes === file.size ? suppliedIdentity : await fullHashFile(file);
  const preflightFingerprint = await fingerprintFile(file);
  return {
    schema: PROJECT_SCHEMA,
    createdAt: new Date().toISOString(),
    app: { name: "LjudR Analysverkstad", version: APP_VERSION },
    release: cleanObject(RELEASE),
    source: {
      name: file.name || null,
      size: file.size,
      type: file.type || null,
      lastModified: file.lastModified || null,
      identity,
      fingerprint: identity,
      preflightFingerprint,
      identityRequired: false,
    },
    analysis: analysis ? cleanObject(analysis) : null,
    edit: normalizeEdit(edit, analysis?.format?.frameCount),
    markers: normalizeMarkers(markers),
    metadata: normalizeMetadata(metadata),
    settings: isRecord(settings) ? cleanObject(settings) : {},
    privacy: {
      audioIncluded: false,
      exactCoordinatesMayBePrivate: true,
      statement: "Projektfilen innehåller inga ljudsamplingar. Privat metadata, inklusive exakta koordinater, kan finnas i projektfilen.",
    },
  };
}

export function migrateProject(project) {
  if (!isRecord(project)) throw new Error("Projektfilens rot måste vara ett objekt.");
  if (project.schema === PROJECT_SCHEMA) return cleanObject(project);
  if (project.schema !== LEGACY_SCHEMA) throw new Error("Projektets schema stöds inte av denna version.");
  const legacyFingerprint = project.source?.fingerprint;
  const identity = fullIdentityFrom(legacyFingerprint);
  return {
    ...cleanObject(project),
    schema: PROJECT_SCHEMA,
    migratedFrom: {
      schema: LEGACY_SCHEMA,
      appVersion: project.app?.version || "0.9.0-0.12.1",
      migratedAt: new Date().toISOString(),
      sourceRevalidationRequired: !identity,
    },
    source: {
      ...(project.source || {}),
      identity,
      fingerprint: identity,
      preflightFingerprint: legacyFingerprint?.strategy === "descriptor+first+last" ? legacyFingerprint : null,
      identityRequired: !identity,
    },
    edit: { ...(project.edit || {}), peakHandling: normalizePeakHandling(project.edit?.peakHandling) },
  };
}

export function validateProject(project) {
  if (project?.schema !== PROJECT_SCHEMA) throw new Error("Filen är inte ett aktuellt projekt från LjudR Analysverkstad.");
  if (project?.privacy?.audioIncluded !== false) throw new Error("Projektfilens integritetsmarkering är ogiltig.");
  const source = validateSource(project.source);
  const edit = normalizeEdit(project.edit, project.analysis?.format?.frameCount);
  if (source.identity?.bytes != null && source.identity.bytes !== source.size) throw new Error("Projektets fulla källhash har fel byteantal.");
  return {
    ...cleanObject(project),
    schema: PROJECT_SCHEMA,
    source,
    edit,
    markers: normalizeMarkers(project.markers || []),
    metadata: normalizeMetadata(project.metadata || {}),
    settings: isRecord(project.settings) ? cleanObject(project.settings) : {},
    privacy: { ...cleanObject(project.privacy), audioIncluded: false },
  };
}

export async function readProjectFile(file) {
  if (!file || typeof file.text !== "function") throw new TypeError("En projektfil krävs.");
  if (file.size > MAX_PROJECT_BYTES) throw new Error(`Projektfilen är större än ${MAX_PROJECT_BYTES / 1048576} MiB.`);
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error("Projektfilen innehåller inte giltig JSON."); }
  return validateProject(migrateProject(parsed));
}

export async function sourceMatchesProject(file, project, options = {}) {
  if (!project?.source) return { matches: false, secure: false, reason: "Projektet saknar källbeskrivning." };
  if (file.size !== project.source.size) return { matches: false, secure: true, reason: "Filstorleken skiljer sig från projektets källa." };
  const expected = fullIdentityFrom(project.source.identity || project.source.fingerprint);
  if (!expected) {
    return {
      matches: false,
      secure: false,
      requiresReanalysis: true,
      reason: "Det äldre projektet saknar full källhash. Analysera filen igen och spara projektet i aktuellt format.",
    };
  }
  const actual = await fullHashFile(file, options);
  return actual.value === expected.value
    ? { matches: true, secure: true, reason: "Filens fulla SHA-256 stämmer.", identity: actual }
    : { matches: false, secure: true, reason: "Filens fulla SHA-256 stämmer inte.", identity: actual };
}

const coordinateNumber = value => {
  if (value === "" || value == null) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
};

export function redactReportMetadata(metadata = {}) {
  const output = normalizeMetadata(metadata);
  const policy = ["hidden", "rounded", "exact"].includes(output.coordinatePrecision) ? output.coordinatePrecision : "hidden";
  const latitude = coordinateNumber(output.latitude);
  const longitude = coordinateNumber(output.longitude);
  delete output.latitude;
  delete output.longitude;
  if (policy === "exact") {
    if (latitude !== null) output.latitude = String(latitude);
    if (longitude !== null) output.longitude = String(longitude);
    output.coordinateDisclosure = "Exakta koordinater, aktivt valda för denna rapport.";
  } else if (policy === "rounded") {
    if (latitude !== null) output.latitude = latitude.toFixed(3);
    if (longitude !== null) output.longitude = longitude.toFixed(3);
    output.coordinateDisclosure = "Koordinater avrundade till tre decimaler, ungefär 110 meter i latitud.";
  } else {
    output.coordinateDisclosure = "Koordinater utelämnade ur rapporten.";
  }
  output.coordinatePrecision = policy;
  return output;
}

const hashFrom = (...values) => values.map(fullIdentityFrom).find(Boolean) || null;

export function buildJsonReport({ file, analysis, edit, markers, metadata, exportReport = null }) {
  const sourceHash = hashFrom(
    analysis?.sourceIdentity,
    analysis?.source?.identity,
    exportReport?.source?.sourceIdentity,
    exportReport?.source?.identity,
    exportReport?.source?.fullFileHash,
  );
  const verified = exportReport?.verifiedOutput
    || exportReport?.verifiedExport
    || exportReport?.verifiedExportFile
    || exportReport?.verified
    || null;
  const samplePayloadHash = verified?.samplePayloadIdentity
    || (verified?.samplePayloadHash ? { algorithm: "SHA-256", scope: "selected-sample-payload-bytes", value: verified.samplePayloadHash } : null)
    || (exportReport?.output?.samplePayloadHash ? { algorithm: "SHA-256", scope: "selected-sample-payload-bytes", value: exportReport.output.samplePayloadHash } : null);
  const outputHash = hashFrom(exportReport?.output?.fullFileHash, verified?.fullFileHash, verified?.sourceIdentity, verified?.identity);
  const calculated = exportReport?.calculatedExportSelection
    || exportReport?.preflight
    || exportReport?.regionAnalysis
    || {
    signalMeasurements: exportReport?.edit ? {
      selectionTruePeakEstimateDbtp: exportReport.edit.selectionTruePeakEstimateDbtp,
      predictedTruePeakDbtp: exportReport.edit.predictedTruePeakDbtp,
    } : null,
  };
  return cleanObject({
    schema: REPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    app: { name: "LjudR Analysverkstad", version: APP_VERSION },
    release: cleanObject(RELEASE),
    method: {
      version: RELEASE.methodVersion,
      loudness: "ITU-R BS.1770-5 och EBU Tech 3341/3342",
      scope: "Filbaserad mono/stereo WAV inom dokumenterad formatmatris",
    },
    engines: {
      analysis: analysis?.validation?.engineVersion ? { version: analysis.validation.engineVersion } : null,
      export: exportReport?.engine || null,
    },
    sections: {
      sourceFile: {
        label: "Källfil",
        file: { name: file?.name || null, size: file?.size ?? null, lastModified: file?.lastModified || null },
        fullFileHash: sourceHash,
        technical: analysis?.format || null,
        signalMeasurements: analysis?.summary || null,
        channels: analysis?.channelResults || analysis?.channels || analysis?.summary?.channels || null,
        observations: analysis?.observations || [],
        validation: analysis?.validation || null,
      },
      calculatedExportSelection: {
        label: "Beräknat exporturval",
        status: "Beräknat före kvantisering och inte en verifiering av utfilen",
        ...cleanObject(calculated || {}),
        edit: cleanObject(exportReport?.edit || edit || {}),
      },
      verifiedExportFile: {
        label: "Verifierad exportfil",
        status: verified ? "Återöppnad och verifierad från faktisk WAV" : "Ingen verifierad exportfil finns i rapportunderlaget",
        ...(verified ? cleanObject(verified) : {}),
        fullFileHash: outputHash,
        samplePayloadHash: samplePayloadHash ? cleanObject(samplePayloadHash) : null,
        output: exportReport?.output || null,
        warnings: exportReport?.warnings || [],
      },
    },
    edit: cleanObject(exportReport?.edit || edit || {}),
    markers: cleanObject(markers || []),
    metadata: redactReportMetadata(metadata || {}),
    validation: { analysis: analysis?.validation || null, export: exportReport?.validation || null },
    privacy: "Rapporten innehåller mätdata och redigerad metadata men inga ljudsamplingar. Kontrollera rapporten innan den delas.",
  });
}

const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const humanize = key => ({
  sourceFile: "Källfil", calculatedExportSelection: "Beräknat exporturval", verifiedExportFile: "Verifierad exportfil",
  fullFileHash: "Full filhash", samplePayloadHash: "Sample-payload-hash", signalMeasurements: "Signalmått",
  createdAt: "Skapad", startFrame: "Startbildruta", endFrame: "Slutbildruta", gainDb: "Global gain, dB",
  fadeInFrames: "Intoning, bildrutor", fadeOutFrames: "Uttoning, bildrutor", peakHandling: "Global toppmarginal",
}[key] || String(key).replace(/([a-zåäö])([A-ZÅÄÖ])/g, "$1 $2"));

const renderValue = value => {
  if (value == null || value === "") return '<span class="missing">Saknas</span>';
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (Array.isArray(value)) return value.length
    ? `<ol>${value.map(item => `<li>${isRecord(item) || Array.isArray(item) ? renderValue(item) : escapeHtml(item)}</li>`).join("")}</ol>`
    : '<span class="missing">Inga</span>';
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length
      ? `<dl>${entries.map(([key, item]) => `<div><dt>${escapeHtml(humanize(key))}</dt><dd>${renderValue(item)}</dd></div>`).join("")}</dl>`
      : '<span class="missing">Saknas</span>';
  }
  return escapeHtml(value);
};

export function buildHtmlReport(input) {
  const report = buildJsonReport(input);
  const sectionHtml = Object.values(report.sections).map(section => `<section><h2>${escapeHtml(section.label)}</h2>${renderValue(section)}</section>`).join("");
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Analysrapport | ${escapeHtml(report.sections.sourceFile.file.name || "LjudR")}</title><style>body{margin:0;background:#f3f0e8;color:#17211d;font:16px/1.55 system-ui,sans-serif}.page{max-width:980px;margin:auto;padding:48px 28px}h1{font-size:2.4rem;margin:.2rem 0}h2{margin-top:2.2rem;border-top:1px solid #c9c2b3;padding-top:1rem}.eyebrow{color:#476557;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.notice{background:#dfeadf;border-radius:14px;padding:16px 18px}dl{margin:.35rem 0}dl>div{display:grid;grid-template-columns:minmax(12rem,32%) 1fr;gap:1rem;border-bottom:1px solid #d9d2c5;padding:8px 0}dt{font-weight:700;color:#4d5b54}dd{margin:0;min-width:0;overflow-wrap:anywhere}dd dl{border-left:3px solid #d7d0c2;padding-left:12px}.missing{color:#6a746e;font-style:italic}footer{margin-top:42px;color:#657069;font-size:.9rem}@media(max-width:600px){.page{padding:28px 18px}dl>div{grid-template-columns:1fr;gap:.2rem}}@media print{body{background:white}.page{max-width:none;padding:0}.notice{border:1px solid #aaa}}</style></head><body><main class="page"><p class="eyebrow">LjudR Analysverkstad</p><h1>Analysrapport</h1><p class="notice">${escapeHtml(report.privacy)}</p>${sectionHtml}<section><h2>Redigeringsbeslut</h2>${renderValue(report.edit)}</section><section><h2>Markörer</h2>${renderValue(report.markers)}</section><section><h2>Metadata och koordinatredaktion</h2>${renderValue(report.metadata)}</section><section><h2>Metod, version och validering</h2>${renderValue({ app: report.app, release: report.release, engines: report.engines, method: report.method, validation: report.validation })}</section><footer>Skapad ${escapeHtml(report.createdAt)} med LjudR Analysverkstad ${escapeHtml(APP_VERSION)}.</footer></main></body></html>`;
}

export function downloadText(text, fileName, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body?.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadProject(project, fileName = "ljudr-projekt.ljudr.json") {
  downloadText(JSON.stringify(cleanObject(project), null, 2), fileName, "application/json");
}

export function downloadReport(reportInput, format = "html", baseName = "ljudr-analysrapport") {
  if (format === "json") downloadText(JSON.stringify(buildJsonReport(reportInput), null, 2), `${baseName}.json`, "application/json");
  else downloadText(buildHtmlReport(reportInput), `${baseName}.html`, "text/html;charset=utf-8");
}
