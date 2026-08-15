import { sha256Hex } from "./sha256.js";

export const ANALYSIS_EXCHANGE_SCHEMA = "se.gaia.ljudr.analysis-exchange/2";
export const GUIDANCE_SCHEMA = "se.gaia.ljudr.guidance/1";

export const EXCHANGE_LIMITS = Object.freeze({
  minimalBytes: 1_000_000,
  temporalDiagnosticBytes: 5_000_000,
  guidanceBytes: 1_000_000,
  maxDepth: 8,
  maxMarkers: 500,
  maxSegments: 720,
  maxTextLength: 2_000,
  maxTextBytes: 16_384,
  segmentSeconds: 5,
});

const DETAIL_PROFILES = new Set(["minimal", "temporal-diagnostic"]);
const PRIVACY_PROFILES = new Set(["redacted", "exact"]);
const CLASSIFICATIONS = new Set(["objective", "heuristic", "artistic"]);
const SEVERITIES = new Set(["critical", "review", "information"]);
const SUGGESTION_KINDS = new Set(["review", "global-gain", "question", "note"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FORBIDDEN_CONTENT_KEYS = new Set([
  "samples", "sampledata", "waveform", "spectrum", "spectrogram", "fft",
  "embedding", "embeddings", "fingerprint", "sourceidentity", "sourcehash",
  "fullfilehash", "pcm", "audiobytes", "channelrmsdbfs",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class AnalysisExchangeError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = "AnalysisExchangeError";
    this.code = code;
    this.details = details;
  }
}

const plainObject = value => value !== null && typeof value === "object"
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function assertSafeTree(value, options = {}, path = "$", depth = 0, state = { textBytes: 0, seen: new Set() }) {
  const maxDepth = options.maxDepth ?? EXCHANGE_LIMITS.maxDepth;
  if (depth > maxDepth) throw new AnalysisExchangeError("MAX_DEPTH", `För djup datastruktur vid ${path}.`);
  if (value === null || typeof value === "boolean") return state;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AnalysisExchangeError("NON_FINITE", `Icke ändligt tal vid ${path}.`);
    return state;
  }
  if (typeof value === "string") {
    if (value.length > EXCHANGE_LIMITS.maxTextLength) throw new AnalysisExchangeError("TEXT_TOO_LONG", `För lång text vid ${path}.`);
    state.textBytes += new TextEncoder().encode(value).byteLength;
    if (state.textBytes > (options.textBudget ?? 256_000)) throw new AnalysisExchangeError("TEXT_BUDGET", "Den sammanlagda textmängden är för stor.");
    return state;
  }
  if (typeof value !== "object") throw new AnalysisExchangeError("UNSAFE_TYPE", `Otillåten datatyp vid ${path}.`);
  if (state.seen.has(value)) throw new AnalysisExchangeError("CYCLE", `Cyklisk datastruktur vid ${path}.`);
  state.seen.add(value);
  if (Array.isArray(value)) {
    const maxArrayLength = options.maxArrayLength ?? Math.max(EXCHANGE_LIMITS.maxMarkers, EXCHANGE_LIMITS.maxSegments);
    if (value.length > maxArrayLength) throw new AnalysisExchangeError("ARRAY_TOO_LONG", `För lång lista vid ${path}.`);
    value.forEach((item, index) => assertSafeTree(item, options, `${path}[${index}]`, depth + 1, state));
  } else {
    if (!plainObject(value)) throw new AnalysisExchangeError("PROTOTYPE", `Otillåten prototyp vid ${path}.`);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new AnalysisExchangeError("PROTOTYPE_KEY", `Otillåten nyckel vid ${path}.${key}.`);
      assertSafeTree(value[key], options, `${path}.${key}`, depth + 1, state);
    }
  }
  state.seen.delete(value);
  return state;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function canonicalJson(value) {
  assertSafeTree(value);
  return canonicalValue(value);
}

export function digestCanonical(value) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

function safeNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

const roundTo = (value, decimals) => Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function severityOf(marker) {
  if (marker.severity === "info") return "information";
  return SEVERITIES.has(marker.severity) ? marker.severity : "review";
}

function classificationOf(marker) {
  if (marker.objective === true && marker.heuristic !== true) return "objective";
  if (marker.heuristic === true) return "heuristic";
  return CLASSIFICATIONS.has(marker.classification) ? marker.classification : "heuristic";
}

function markerTime(value, marker, privacy, critical) {
  const numeric = safeNumber(value, safeNumber(marker.timeSeconds, 0));
  return privacy === "exact" || critical ? Math.max(0, numeric) : Math.max(0, Math.round(numeric));
}

function markerKind(marker) {
  const explicit = marker.machineKind || marker.kind;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim().toLowerCase().slice(0, 100);
  const value = `${marker.type || ""} ${marker.label || ""} ${marker.text || ""}`.toLowerCase();
  if (value.includes("true peak")) return "true-peak";
  if (value.includes("sample peak")) return "sample-peak";
  if (value.includes("ogilt") || value.includes("invalid") || value.includes("nan") || value.includes("infinity")) return "invalid-float";
  if (value.includes("overrange")) return "float-overrange";
  if (value.includes("flat")) return "possible-flat-top";
  if (value.includes("tyst") || value.includes("zero")) return "silence";
  if (value.includes("diskont") || value.includes("discontinu")) return "possible-discontinuity";
  if (value.includes("momentary")) return "momentary-maximum";
  if (value.includes("short-term")) return "short-term-maximum";
  return "review-point";
}

function sanitizeMarker(marker, privacy, index, durationSeconds = Infinity) {
  const severity = severityOf(marker);
  const critical = severity === "critical" && classificationOf(marker) === "objective";
  const startSeconds = Math.min(durationSeconds, markerTime(marker.startSeconds, marker, privacy, critical));
  const endSeconds = Math.min(durationSeconds, Math.max(startSeconds, markerTime(marker.endSeconds, marker, privacy, critical)));
  return {
    id: `marker-${index + 1}`,
    type: markerKind(marker),
    classification: classificationOf(marker),
    severity,
    startSeconds,
    endSeconds,
    channel: Number.isInteger(marker.channel) && marker.channel > 0 ? marker.channel : null,
    summary: classificationOf(marker) === "objective" ? "Objektiv teknisk markör" : "Heuristisk granskningspunkt",
    methodId: "ljudr-analysis",
    reviewStatus: String(marker.reviewStatus || "unreviewed").slice(0, 80),
    timePrecisionSeconds: privacy === "exact" && Number.isFinite(marker.timePrecisionSeconds)
      ? marker.timePrecisionSeconds : (critical ? safeNumber(marker.timePrecisionSeconds, null) : 1),
  };
}

function rankMarkers(markers) {
  const severityRank = { critical: 3, review: 2, information: 1 };
  return [...markers].sort((a, b) => severityRank[b.severity] - severityRank[a.severity]
    || (b.endSeconds - b.startSeconds) - (a.endSeconds - a.startSeconds)
    || a.startSeconds - b.startSeconds).slice(0, EXCHANGE_LIMITS.maxMarkers);
}

function buildTemporalDiagnostic(analysis) {
  const timeline = analysis?.timelines || {};
  const step = Number(timeline.intervalSeconds);
  const duration = Number(analysis?.region?.selectedFrames) / Number(analysis?.format?.sampleRate)
    || Number(analysis?.duration) || 0;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(duration) || duration <= 0) return [];
  const segmentSeconds = Math.max(EXCHANGE_LIMITS.segmentSeconds,
    Math.ceil(duration / EXCHANGE_LIMITS.maxSegments / EXCHANGE_LIMITS.segmentSeconds) * EXCHANGE_LIMITS.segmentSeconds);
  const binCount = Math.min(EXCHANGE_LIMITS.maxSegments, Math.ceil(duration / segmentSeconds));
  const valuesFor = (series, start, end) => Array.isArray(series) ? series.slice(start, end).filter(Number.isFinite) : [];
  const output = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const startSeconds = bin * segmentSeconds;
    const endSeconds = Math.min(duration, startSeconds + segmentSeconds);
    const first = Math.max(0, Math.floor(startSeconds / step));
    const last = Math.max(first + 1, Math.min(Math.ceil(endSeconds / step), Array.isArray(timeline.timeSeconds) ? timeline.timeSeconds.length : Infinity));
    const momentary = valuesFor(timeline.momentaryLufs, first, last);
    const shortTerm = valuesFor(timeline.shortTermLufs, first, last);
    const peaks = valuesFor(timeline.samplePeakDbfs, first, last);
    const correlation = valuesFor(timeline.correlation, first, last);
    const rms = valuesFor(timeline.rmsDbfs, first, last);
    const lowThreshold = safeNumber(analysis?.analysisSettings?.lowLevelThresholdDbfs, -80);
    output.push({
      startSeconds: roundTo(startSeconds, 1),
      endSeconds: roundTo(endSeconds, 1),
      momentaryLufs: { p10: roundTo(quantile(momentary, 0.1), 1), median: roundTo(quantile(momentary, 0.5), 1), max: roundTo(momentary.length ? Math.max(...momentary) : null, 1) },
      shortTermLufs: { median: roundTo(quantile(shortTerm, 0.5), 1), max: roundTo(shortTerm.length ? Math.max(...shortTerm) : null, 1) },
      programSamplePeakDbfs: roundTo(peaks.length ? Math.max(...peaks) : null, 1),
      programTruePeakDbtp: null,
      silencePercent: rms.length ? Math.round(100 * rms.filter(value => value <= lowThreshold).length / rms.length) : null,
      stereoCorrelation: correlation.length
        ? { median: roundTo(quantile(correlation, 0.5), 2), min: roundTo(Math.min(...correlation), 2) }
        : null,
    });
  }
  return output;
}

function buildMeasurements(analysis) {
  const summary = analysis?.summary || {};
  const mono = summary.monoCompatibility || {};
  const channelCount = Math.max(0, Math.min(2, Math.trunc(safeNumber(analysis?.format?.channels, 0))));
  return {
    integratedLufs: safeNumber(summary.integratedLufs),
    loudnessRangeLu: safeNumber(summary.loudnessRangeLu),
    momentaryMaxLufs: safeNumber(summary.momentaryMaxLufs),
    shortTermMaxLufs: safeNumber(summary.shortTermMaxLufs),
    samplePeakDbfs: safeNumber(summary.samplePeakDbfs),
    truePeakDbtp: safeNumber(summary.truePeakEstimateDbtp),
    plrLu: safeNumber(summary.plrEstimateLu),
    rmsDbfs: safeNumber(summary.rmsDbfs),
    crestFactorDb: safeNumber(summary.crestFactorDb),
    channelBalanceDb: safeNumber(summary.channelBalanceDb),
    stereoCorrelation: safeNumber(summary.correlation),
    monoCompatibility: summary.monoCompatibility ? {
      energyDeltaDb: safeNumber(mono.energyDeltaDb),
      samplePeakDbfs: safeNumber(mono.samplePeakDbfs),
      negativeCorrelationPercent: safeNumber(mono.negativeCorrelationPercent),
      riskRegions: (mono.negativeCorrelationRegions || []).slice(0, 100).map(region => ({
        startSeconds: safeNumber(region.startSeconds, 0),
        endSeconds: safeNumber(region.endSeconds, 0),
      })),
    } : null,
    overrangeSamples: Math.max(0, Math.trunc(safeNumber(summary.overrangeSamples, 0))),
    nonFiniteSamples: Math.max(0, Math.trunc(safeNumber(summary.nonFiniteSamples, 0))),
    channels: Array.from({ length: channelCount }, (_, index) => {
      const channel = Array.isArray(summary.channels) ? summary.channels[index] || {} : {};
      return {
      channel: index + 1,
      samplePeakDbfs: safeNumber(channel.samplePeakDbfs),
      truePeakDbtp: safeNumber(channel.truePeakEstimateDbtp),
      truePeakTimeSeconds: safeNumber(channel.truePeakTimeSeconds),
      dcOffset: safeNumber(channel.dcOffset),
      rmsDbfs: safeNumber(channel.rmsDbfs),
      crestFactorDb: safeNumber(channel.crestFactorDb),
      clippedSamples: Math.max(0, Math.trunc(safeNumber(channel.clippedSamples, 0))),
      overrangeSamples: Math.max(0, Math.trunc(safeNumber(channel.overrangeSamples, 0))),
      nonFiniteSamples: Math.max(0, Math.trunc(safeNumber(channel.nonFiniteSamples, 0))),
    }; }),
  };
}

function sanitizeMetadata(metadata, privacy, selection = {}) {
  const coordinates = plainObject(metadata.coordinates)
    && Number.isFinite(metadata.coordinates.latitude) && Number.isFinite(metadata.coordinates.longitude)
    && metadata.coordinates.latitude >= -90 && metadata.coordinates.latitude <= 90
    && metadata.coordinates.longitude >= -180 && metadata.coordinates.longitude <= 180
    ? {
        latitude: privacy === "exact" ? metadata.coordinates.latitude : Number(metadata.coordinates.latitude.toFixed(2)),
        longitude: privacy === "exact" ? metadata.coordinates.longitude : Number(metadata.coordinates.longitude.toFixed(2)),
        precision: privacy,
      }
    : Number.isFinite(Number(metadata.latitude)) && Number.isFinite(Number(metadata.longitude))
      && Number(metadata.latitude) >= -90 && Number(metadata.latitude) <= 90
      && Number(metadata.longitude) >= -180 && Number(metadata.longitude) <= 180
      ? {
          latitude: privacy === "exact" ? Number(metadata.latitude) : Number(Number(metadata.latitude).toFixed(2)),
          longitude: privacy === "exact" ? Number(metadata.longitude) : Number(Number(metadata.longitude).toFixed(2)),
          precision: privacy,
        } : null;
  const text = (key, maximum = EXCHANGE_LIMITS.maxTextLength) => metadata[key] == null
    ? null : String(metadata[key]).slice(0, maximum);
  return {
    sourceFileName: selection.includeFileName ? text("sourceFileName", 255) : null,
    identity: selection.includeIdentity ? {
      title: text("title", 500), series: text("series", 500), episode: text("episode", 500),
      sessionId: text("sessionId", 500), project: text("project", 500), date: text("date", 80),
      localTime: text("localTime", 80), lightConditions: text("lightConditions", 500),
    } : null,
    location: selection.includeLocation ? { place: text("place", 500), coordinates } : null,
    notes: selection.includeNotes ? {
      tags: text("tags"), environment: text("environment"), notes: text("notes"), relatedImage: text("relatedImage"),
    } : null,
    creator: selection.includeCreator ? {
      creator: text("creator", 500), equipment: text("equipment"), license: text("license", 500),
    } : null,
  };
}

function buildAnalysisPayload({ analysis, selectedAnalysis = null, signalStage = null, regionAnalysis = null, markers = null, metadata = {}, privacySelection = {}, privacy, profile, release, editorialContext = null, editorialCueSheet = null }) {
  if (!plainObject(analysis)) throw new AnalysisExchangeError("ANALYSIS_REQUIRED", "Ett analysresultat krävs.");
  const selected = selectedAnalysis || regionAnalysis?.processed || analysis;
  const sourceMarkers = markers || selected.markersSuggested || [];
  const format = selected.format || {};
  const region = selected.region || {};
  const selectedFrames = Math.max(0, Math.trunc(safeNumber(region.selectedFrames, format.frameCount || 0)));
  const sampleRate = Math.max(0, Math.trunc(safeNumber(format.sampleRate, 0)));
  const durationSeconds = selectedFrames > 0 && sampleRate > 0
    ? selectedFrames / sampleRate : safeNumber(format.durationSeconds, safeNumber(selected.duration, 0));
  const markerTimeOf = marker => safeNumber(marker.startSeconds, safeNumber(marker.timeSeconds, 0));
  const markerEndOf = marker => safeNumber(marker.endSeconds, markerTimeOf(marker));
  const selectedMarkers = sourceMarkers.filter(marker => markerTimeOf(marker) <= durationSeconds && markerEndOf(marker) >= 0);
  const payload = {
    signalStage: signalStage || (regionAnalysis ? "calculated-export-selection" : "source"),
    region: {
      range: "[startFrame,endFrame)",
      startFrame: Math.max(0, Math.trunc(safeNumber(region.startFrame, 0))),
      endFrame: Math.max(0, Math.trunc(safeNumber(region.endFrame, format.frameCount || 0))),
      selectedFrames,
      fadeInFrames: Math.max(0, Math.trunc(safeNumber(region.fadeInFrames, 0))),
      fadeOutFrames: Math.max(0, Math.trunc(safeNumber(region.fadeOutFrames, 0))),
      globalGainDb: safeNumber(region.globalGainDb, 0),
    },
    format: {
      container: String(format.container || "WAVE").slice(0, 32),
      encoding: String(format.encoding || "unknown").slice(0, 64),
      channels: Math.trunc(safeNumber(format.channels, 0)),
      sampleRate,
      bitsPerSample: Math.trunc(safeNumber(format.bitsPerSample, 0)),
      validBitsPerSample: Math.trunc(safeNumber(format.validBitsPerSample, format.bitsPerSample || 0)),
      durationSeconds,
      fileSizeBytes: Math.max(0, Math.trunc(safeNumber(format.fileSizeBytes, 0))),
      fileName: privacySelection.includeFileName === true ? String(metadata.sourceFileName || format.fileName || "").slice(0, 255) : null,
    },
    metadata: sanitizeMetadata(metadata, privacy, privacySelection),
    measurements: buildMeasurements(selected),
    markers: rankMarkers(selectedMarkers.map((marker, index) => sanitizeMarker(marker, privacy, index, durationSeconds))),
    editorialContext: editorialContext || null,
    editorialCueSheet: Array.isArray(editorialCueSheet) ? editorialCueSheet : null,
    temporalDiagnostic: profile === "temporal-diagnostic" ? buildTemporalDiagnostic(selected) : null,
    provenance: {
      engineVersion: String(selected.validation?.engineVersion || release.engineVersion || "unknown").slice(0, 80),
      releaseVersion: String(release.version || "unknown").slice(0, 80),
      releaseCommit: String(release.commit || "unknown").slice(0, 160),
      loudnessModel: String(selected.validation?.loudnessModel || "unknown").slice(0, 240),
      truePeakMethod: String(selected.validation?.truePeakMethod || "unknown").slice(0, 240),
      validationLevel: String(release.validationLevel || "automated-tests").slice(0, 80),
    },
    evidence: [
      { id: "loudness", classification: "objective", methodId: "itu-r-bs-1770", status: selected.validation?.loudnessStatus ? "validated" : "unverified" },
      { id: "true-peak", classification: "objective", methodId: "ebu-tech-3341", status: selected.validation?.truePeakValidationStatus || "unverified" },
      { id: "markers", classification: "mixed", methodId: "ljudr-analysis", status: "requires-human-review" },
    ],
  };
  return payload;
}

function randomBundleId() {
  if (!globalThis.crypto?.randomUUID) throw new AnalysisExchangeError("NO_SECURE_RANDOM", "Säker UUID-generator saknas.");
  return globalThis.crypto.randomUUID();
}

function normalizeBuildInput(input) {
  if (!plainObject(input)) throw new AnalysisExchangeError("INPUT", "Byggindata måste vara ett objekt.");
  const profile = input.profile || "minimal";
  const privacy = input.privacy || "redacted";
  if (!DETAIL_PROFILES.has(profile)) throw new AnalysisExchangeError("PROFILE", "Okänd analysprofil.");
  if (!PRIVACY_PROFILES.has(privacy)) throw new AnalysisExchangeError("PRIVACY", "Okänd integritetsprofil.");
  return { ...input, profile, privacy, metadata: input.metadata || {}, release: input.release || {} };
}

export function buildAnalysisBundle(input, options = {}) {
  const normalized = normalizeBuildInput(input);
  const bundleId = options.bundleId || input.bundleId || randomBundleId();
  if (!UUID_PATTERN.test(bundleId)) throw new AnalysisExchangeError("BUNDLE_ID", "bundleId måste vara en UUID.");
  const analysisPayload = buildAnalysisPayload(normalized);
  const createdAt = String(options.createdAt || input.createdAt || new Date().toISOString());
  const digestInput = {
    schema: ANALYSIS_EXCHANGE_SCHEMA,
    bundleId,
    profile: normalized.profile,
    privacy: normalized.privacy,
    createdAt,
    analysis: analysisPayload,
  };
  const analysisDigest = digestCanonical(digestInput);
  const bundle = { ...digestInput, analysisDigest };
  validateAnalysisBundle(bundle);
  return bundle;
}

export const previewAnalysisBundle = buildAnalysisBundle;

export function serializeAnalysisBundle(bundle, options = {}) {
  validateAnalysisBundle(bundle);
  return options.pretty === false ? canonicalJson(bundle) : JSON.stringify(bundle, null, 2);
}

export function createLocalReceipt(bundle, { sourceIdentity }) {
  validateAnalysisBundle(bundle);
  const sourceHash = typeof sourceIdentity === "string" ? sourceIdentity : sourceIdentity?.value;
  if (!SHA256_PATTERN.test(sourceHash || "")) throw new AnalysisExchangeError("SOURCE_IDENTITY", "Ett lokalt fullständigt SHA-256 krävs för kvittot.");
  return {
    schema: "se.gaia.ljudr.analysis-receipt/1",
    bundleId: bundle.bundleId,
    analysisDigest: bundle.analysisDigest,
    sourceSha256: sourceHash,
    engineVersion: bundle.analysis.provenance.engineVersion,
    methodId: bundle.analysis.provenance.loudnessModel,
    editDigest: digestCanonical(bundle.analysis.region),
    evidenceIds: bundle.analysis.evidence.map(item => item.id),
    markerIds: bundle.analysis.markers.map(item => item.id),
    createdAt: bundle.createdAt,
  };
}

export function validateLocalReceipt(receipt) {
  assertSafeTree(receipt);
  if (!plainObject(receipt)) throw new AnalysisExchangeError("INVALID_RECEIPT", "Det lokala kvittot är ogiltigt.", ["Kvittot måste vara ett objekt."]);
  const errors = [];
  exactKeys(receipt, new Set(["schema", "bundleId", "analysisDigest", "sourceSha256", "engineVersion", "methodId", "editDigest", "evidenceIds", "markerIds", "createdAt"]), "$", errors);
  if (receipt?.schema !== "se.gaia.ljudr.analysis-receipt/1" || !UUID_PATTERN.test(receipt?.bundleId || "")) errors.push("Ogiltigt lokalt kvitto.");
  for (const key of ["analysisDigest", "sourceSha256", "editDigest"]) if (!SHA256_PATTERN.test(receipt?.[key] || "")) errors.push(`Ogiltigt kvittofält ${key}.`);
  requireStrings(receipt, ["engineVersion", "methodId"], "$", errors);
  for (const key of ["evidenceIds", "markerIds"]) if (!Array.isArray(receipt?.[key]) || receipt[key].some(item => typeof item !== "string")) errors.push(`Ogiltig kvittolista ${key}.`);
  if (!Number.isFinite(Date.parse(receipt?.createdAt))) errors.push("Ogiltig kvittotid.");
  return finishValidation(errors, "INVALID_RECEIPT", "Det lokala kvittot är ogiltigt.");
}

export function exportAnalysisBundle(input, options = {}) {
  const bundle = buildAnalysisBundle(input, options);
  const json = serializeAnalysisBundle(bundle);
  const bytes = new TextEncoder().encode(json).byteLength;
  const fileName = `ljudr-analysis-${bundle.bundleId}.json`;
  const receipt = options.sourceIdentity ? createLocalReceipt(bundle, { sourceIdentity: options.sourceIdentity }) : null;
  return { bundle, receipt, json, bytes, fileName, blob: new Blob([json], { type: "application/json" }) };
}

function exactKeys(value, allowed, path, errors) {
  if (!plainObject(value)) { errors.push(`${path} måste vara ett vanligt objekt.`); return; }
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`Okänt fält ${path}.${key}.`);
}

const nullableFinite = value => value === null || Number.isFinite(value);
const nullableString = value => value === null || typeof value === "string";

function requireStrings(value, keys, path, errors) {
  for (const key of keys) if (typeof value?.[key] !== "string") errors.push(`${path}.${key} måste vara text.`);
}

function requireNullableNumbers(value, keys, path, errors) {
  for (const key of keys) if (!nullableFinite(value?.[key])) errors.push(`${path}.${key} måste vara ändligt eller null.`);
}

function validateNoForbiddenContent(value, path, errors) {
  if (Array.isArray(value)) return value.forEach((item, index) => validateNoForbiddenContent(item, `${path}[${index}]`, errors));
  if (!plainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CONTENT_KEYS.has(key.toLowerCase())) errors.push(`Förbjudet ljud- eller identitetsfält ${path}.${key}.`);
    validateNoForbiddenContent(child, `${path}.${key}`, errors);
  }
}

function finishValidation(errors, code, message) {
  if (errors.length) throw new AnalysisExchangeError(code, message, errors);
  return { valid: true, errors: [] };
}

export function validateAnalysisBundle(bundle) {
  assertSafeTree(bundle);
  if (!plainObject(bundle)) throw new AnalysisExchangeError("INVALID_ANALYSIS_BUNDLE", "Analyspaketet är ogiltigt.", ["Roten måste vara ett objekt."]);
  if (bundle?.analysis?.metadata) assertSafeTree(bundle.analysis.metadata, { textBudget: EXCHANGE_LIMITS.maxTextBytes });
  const errors = [];
  exactKeys(bundle, new Set(["schema", "bundleId", "analysisDigest", "profile", "privacy", "createdAt", "analysis"]), "$", errors);
  if (bundle.schema !== ANALYSIS_EXCHANGE_SCHEMA) errors.push("Fel analysschema.");
  if (!UUID_PATTERN.test(bundle.bundleId || "")) errors.push("Ogiltigt bundleId.");
  if (!SHA256_PATTERN.test(bundle.analysisDigest || "")) errors.push("Ogiltig analysisDigest.");
  if (!DETAIL_PROFILES.has(bundle.profile)) errors.push("Ogiltig analysprofil.");
  if (!PRIVACY_PROFILES.has(bundle.privacy)) errors.push("Ogiltig integritetsprofil.");
  if (!Number.isFinite(Date.parse(bundle.createdAt))) errors.push("Ogiltig createdAt.");
  exactKeys(bundle.analysis, new Set(["signalStage", "region", "format", "metadata", "measurements", "markers", "editorialContext", "editorialCueSheet", "temporalDiagnostic", "provenance", "evidence"]), "$.analysis", errors);
  exactKeys(bundle.analysis?.region, new Set(["range", "startFrame", "endFrame", "selectedFrames", "fadeInFrames", "fadeOutFrames", "globalGainDb"]), "$.analysis.region", errors);
  exactKeys(bundle.analysis?.format, new Set(["container", "encoding", "channels", "sampleRate", "bitsPerSample", "validBitsPerSample", "durationSeconds", "fileSizeBytes", "fileName"]), "$.analysis.format", errors);
  exactKeys(bundle.analysis?.metadata, new Set(["sourceFileName", "identity", "location", "notes", "creator"]), "$.analysis.metadata", errors);
  if (bundle.analysis?.metadata?.identity !== null) exactKeys(bundle.analysis.metadata.identity, new Set(["title", "series", "episode", "sessionId", "project", "date", "localTime", "lightConditions"]), "$.analysis.metadata.identity", errors);
  if (bundle.analysis?.metadata?.location !== null) {
    exactKeys(bundle.analysis.metadata.location, new Set(["place", "coordinates"]), "$.analysis.metadata.location", errors);
    if (bundle.analysis.metadata.location.coordinates !== null) exactKeys(bundle.analysis.metadata.location.coordinates, new Set(["latitude", "longitude", "precision"]), "$.analysis.metadata.location.coordinates", errors);
  }
  if (bundle.analysis?.metadata?.notes !== null) exactKeys(bundle.analysis.metadata.notes, new Set(["tags", "environment", "notes", "relatedImage"]), "$.analysis.metadata.notes", errors);
  if (bundle.analysis?.metadata?.creator !== null) exactKeys(bundle.analysis.metadata.creator, new Set(["creator", "equipment", "license"]), "$.analysis.metadata.creator", errors);
  if (bundle.analysis?.editorialContext !== null) {
    exactKeys(bundle.analysis.editorialContext, new Set(["classification", "seriesProfileId", "seriesProfileVersion", "purpose", "targetDurationSeconds", "durationToleranceSeconds", "loudnessOrientation", "truePeakOrientationDbtp", "continuityPolicy", "questions"]), "$.analysis.editorialContext", errors);
    exactKeys(bundle.analysis.editorialContext?.loudnessOrientation, new Set(["targetLufs", "rangeMinLufs", "rangeMaxLufs", "rationale"]), "$.analysis.editorialContext.loudnessOrientation", errors);
    requireStrings(bundle.analysis.editorialContext, ["classification", "seriesProfileId", "seriesProfileVersion", "purpose", "continuityPolicy"], "$.analysis.editorialContext", errors);
    requireNullableNumbers(bundle.analysis.editorialContext, ["targetDurationSeconds", "durationToleranceSeconds", "truePeakOrientationDbtp"], "$.analysis.editorialContext", errors);
    requireNullableNumbers(bundle.analysis.editorialContext.loudnessOrientation, ["targetLufs", "rangeMinLufs", "rangeMaxLufs"], "$.analysis.editorialContext.loudnessOrientation", errors);
    requireStrings(bundle.analysis.editorialContext.loudnessOrientation, ["rationale"], "$.analysis.editorialContext.loudnessOrientation", errors);
    if (bundle.analysis.editorialContext.classification !== "editorial" || !Array.isArray(bundle.analysis.editorialContext.questions) || bundle.analysis.editorialContext.questions.some(item => typeof item !== "string")) errors.push("Ogiltig redaktionell kontext.");
  }
  if (bundle.analysis?.editorialCueSheet !== null) {
    if (!Array.isArray(bundle.analysis.editorialCueSheet) || bundle.analysis.editorialCueSheet.length > 200) errors.push("Ogiltigt redaktionellt cue sheet.");
    else bundle.analysis.editorialCueSheet.forEach((cue, index) => {
      exactKeys(cue, new Set(["id", "type", "startSeconds", "endSeconds", "text", "reviewStatus", "classification"]), `$.analysis.editorialCueSheet[${index}]`, errors);
      requireStrings(cue, ["id", "type", "text", "reviewStatus", "classification"], `$.analysis.editorialCueSheet[${index}]`, errors);
      if (cue.classification !== "editorial" || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds < cue.startSeconds || cue.endSeconds > bundle.analysis.format.durationSeconds) errors.push(`Ogiltig redaktionell cue ${index}.`);
    });
  }
  exactKeys(bundle.analysis?.measurements, new Set(["integratedLufs", "loudnessRangeLu", "momentaryMaxLufs", "shortTermMaxLufs", "samplePeakDbfs", "truePeakDbtp", "plrLu", "rmsDbfs", "crestFactorDb", "channelBalanceDb", "stereoCorrelation", "monoCompatibility", "overrangeSamples", "nonFiniteSamples", "channels"]), "$.analysis.measurements", errors);
  requireStrings(bundle.analysis, ["signalStage"], "$.analysis", errors);
  if (!["source", "calculated-export-selection", "verified-output"].includes(bundle.analysis?.signalStage)) errors.push("Ogiltigt signalStage.");
  requireStrings(bundle.analysis?.region, ["range"], "$.analysis.region", errors);
  requireStrings(bundle.analysis?.format, ["container", "encoding"], "$.analysis.format", errors);
  if (!nullableString(bundle.analysis?.format?.fileName) || !nullableString(bundle.analysis?.metadata?.sourceFileName)) errors.push("Filnamn måste vara text eller null.");
  for (const [groupName, group] of Object.entries(bundle.analysis?.metadata || {})) {
    if (groupName === "sourceFileName" || group === null) continue;
    for (const [key, value] of Object.entries(group)) {
      if (key !== "coordinates" && !nullableString(value)) errors.push(`Metadata ${groupName}.${key} måste vara text eller null.`);
    }
  }
  const coordinates = bundle.analysis?.metadata?.location?.coordinates;
  if (coordinates !== null && coordinates !== undefined && (!Number.isFinite(coordinates.latitude)
    || coordinates.latitude < -90 || coordinates.latitude > 90 || !Number.isFinite(coordinates.longitude)
    || coordinates.longitude < -180 || coordinates.longitude > 180 || !PRIVACY_PROFILES.has(coordinates.precision))) errors.push("Ogiltiga metadata-koordinater.");
  requireNullableNumbers(bundle.analysis?.measurements, ["integratedLufs", "loudnessRangeLu", "momentaryMaxLufs", "shortTermMaxLufs", "samplePeakDbfs", "truePeakDbtp", "plrLu", "rmsDbfs", "crestFactorDb", "channelBalanceDb", "stereoCorrelation"], "$.analysis.measurements", errors);
  const mono = bundle.analysis?.measurements?.monoCompatibility;
  if (mono !== null) {
    exactKeys(mono, new Set(["energyDeltaDb", "samplePeakDbfs", "negativeCorrelationPercent", "riskRegions"]), "$.analysis.measurements.monoCompatibility", errors);
    requireNullableNumbers(mono, ["energyDeltaDb", "samplePeakDbfs", "negativeCorrelationPercent"], "$.analysis.measurements.monoCompatibility", errors);
    if (!Array.isArray(mono.riskRegions) || mono.riskRegions.length > 100) errors.push("Ogiltiga monoriskregioner.");
    else mono.riskRegions.forEach((region, index) => {
      exactKeys(region, new Set(["startSeconds", "endSeconds"]), `$.analysis.measurements.monoCompatibility.riskRegions[${index}]`, errors);
      if (!Number.isFinite(region.startSeconds) || !Number.isFinite(region.endSeconds) || region.startSeconds < 0 || region.endSeconds < region.startSeconds || region.endSeconds > bundle.analysis.format.durationSeconds) errors.push(`Ogiltig monoriskregion ${index}.`);
    });
  }
  for (const key of ["overrangeSamples", "nonFiniteSamples"]) if (!Number.isSafeInteger(bundle.analysis?.measurements?.[key]) || bundle.analysis.measurements[key] < 0) errors.push(`Ogiltigt mätvärde ${key}.`);
  const region = bundle.analysis?.region;
  if (!Number.isSafeInteger(region?.startFrame) || !Number.isSafeInteger(region?.endFrame)
    || !Number.isSafeInteger(region?.selectedFrames) || region.startFrame < 0
    || region.endFrame < region.startFrame || region.selectedFrames !== region.endFrame - region.startFrame) errors.push("Ogiltigt eller inkonsekvent frameintervall.");
  if (!Number.isSafeInteger(region?.fadeInFrames) || !Number.isSafeInteger(region?.fadeOutFrames)
    || region.fadeInFrames < 0 || region.fadeOutFrames < 0
    || region.fadeInFrames > region.selectedFrames || region.fadeOutFrames > region.selectedFrames) errors.push("Ogiltiga fadeintervall.");
  if (!Number.isFinite(region?.globalGainDb) || region.globalGainDb < -60 || region.globalGainDb > 24) errors.push("Ogiltig global gain.");
  const format = bundle.analysis?.format;
  if (![1, 2].includes(format?.channels) || ![44100, 48000, 88200, 96000, 176400, 192000].includes(format?.sampleRate)) errors.push("Ogiltigt kanalantal eller samplingsfrekvens.");
  if (![16, 24, 32].includes(format?.bitsPerSample) || !Number.isSafeInteger(format?.validBitsPerSample)
    || format.validBitsPerSample < 1 || format.validBitsPerSample > format.bitsPerSample) errors.push("Ogiltigt sampelformat.");
  if (!Number.isFinite(format?.durationSeconds) || format.durationSeconds < 0 || !Number.isSafeInteger(format?.fileSizeBytes) || format.fileSizeBytes < 0) errors.push("Ogiltig duration eller filstorlek.");
  if (!Array.isArray(bundle.analysis?.measurements?.channels) || bundle.analysis.measurements.channels.length !== format?.channels) errors.push("Kanalmätningarna matchar inte formatet.");
  else bundle.analysis.measurements.channels.forEach((channel, index) => {
    exactKeys(channel, new Set(["channel", "samplePeakDbfs", "truePeakDbtp", "truePeakTimeSeconds", "dcOffset", "rmsDbfs", "crestFactorDb", "clippedSamples", "overrangeSamples", "nonFiniteSamples"]), `$.analysis.measurements.channels[${index}]`, errors);
    if (channel.channel !== index + 1) errors.push(`Fel kanalindex i kanalmätning ${index}.`);
    requireNullableNumbers(channel, ["samplePeakDbfs", "truePeakDbtp", "truePeakTimeSeconds", "dcOffset", "rmsDbfs", "crestFactorDb"], `$.analysis.measurements.channels[${index}]`, errors);
    for (const key of ["clippedSamples", "overrangeSamples", "nonFiniteSamples"]) if (!Number.isSafeInteger(channel[key]) || channel[key] < 0) errors.push(`Ogiltigt kanalvärde ${index}.${key}.`);
  });
  validateNoForbiddenContent(bundle.analysis, "$.analysis", errors);
  if (bundle.analysis && digestCanonical({ schema: bundle.schema, bundleId: bundle.bundleId, profile: bundle.profile, privacy: bundle.privacy, createdAt: bundle.createdAt, analysis: bundle.analysis }) !== bundle.analysisDigest) errors.push("analysisDigest matchar inte det bundna analyspaketet.");
  if (!Array.isArray(bundle.analysis?.markers) || bundle.analysis.markers.length > EXCHANGE_LIMITS.maxMarkers) errors.push("Ogiltig markörlista.");
  else bundle.analysis.markers.forEach((marker, index) => {
    exactKeys(marker, new Set(["id", "type", "classification", "severity", "startSeconds", "endSeconds", "channel", "summary", "methodId", "reviewStatus", "timePrecisionSeconds"]), `$.analysis.markers[${index}]`, errors);
    if (!CLASSIFICATIONS.has(marker.classification) || !SEVERITIES.has(marker.severity)) errors.push(`Ogiltig markörklass i markör ${index}.`);
    if (!Number.isFinite(marker.startSeconds) || !Number.isFinite(marker.endSeconds) || marker.startSeconds < 0 || marker.endSeconds < marker.startSeconds || marker.endSeconds > format.durationSeconds) errors.push(`Ogiltigt tidsintervall i markör ${index}.`);
    requireStrings(marker, ["id", "type", "summary", "methodId", "reviewStatus"], `$.analysis.markers[${index}]`, errors);
    if (marker.channel !== null && (!Number.isSafeInteger(marker.channel) || marker.channel < 1 || marker.channel > format.channels)) errors.push(`Ogiltig kanal i markör ${index}.`);
    if (!nullableFinite(marker.timePrecisionSeconds) || (marker.timePrecisionSeconds !== null && marker.timePrecisionSeconds < 0)) errors.push(`Ogiltig tidsprecision i markör ${index}.`);
  });
  if (bundle.profile === "minimal" && bundle.analysis?.temporalDiagnostic !== null) errors.push("Minimal profil får inte innehålla tidsserie.");
  if (bundle.profile === "temporal-diagnostic") {
    if (!Array.isArray(bundle.analysis?.temporalDiagnostic) || bundle.analysis.temporalDiagnostic.length > EXCHANGE_LIMITS.maxSegments) errors.push("Ogiltig temporal diagnostik.");
    else bundle.analysis.temporalDiagnostic.forEach((segment, index) => {
      exactKeys(segment, new Set(["startSeconds", "endSeconds", "momentaryLufs", "shortTermLufs", "programSamplePeakDbfs", "programTruePeakDbtp", "silencePercent", "stereoCorrelation"]), `$.analysis.temporalDiagnostic[${index}]`, errors);
      exactKeys(segment?.momentaryLufs, new Set(["p10", "median", "max"]), `$.analysis.temporalDiagnostic[${index}].momentaryLufs`, errors);
      exactKeys(segment?.shortTermLufs, new Set(["median", "max"]), `$.analysis.temporalDiagnostic[${index}].shortTermLufs`, errors);
      if (segment?.stereoCorrelation !== null) exactKeys(segment?.stereoCorrelation, new Set(["median", "min"]), `$.analysis.temporalDiagnostic[${index}].stereoCorrelation`, errors);
      const firstWidth = bundle.analysis.temporalDiagnostic[0]?.endSeconds - bundle.analysis.temporalDiagnostic[0]?.startSeconds;
      const width = bundle.analysis.temporalDiagnostic.length === 1 ? EXCHANGE_LIMITS.segmentSeconds : firstWidth;
      if (!Number.isFinite(width) || width < EXCHANGE_LIMITS.segmentSeconds || width % EXCHANGE_LIMITS.segmentSeconds !== 0
        || segment.startSeconds !== index * width || segment.endSeconds <= segment.startSeconds
        || segment.endSeconds - segment.startSeconds > width) errors.push(`Ogiltigt aggregerat tidssegment ${index}.`);
      requireNullableNumbers(segment?.momentaryLufs, ["p10", "median", "max"], `$.analysis.temporalDiagnostic[${index}].momentaryLufs`, errors);
      requireNullableNumbers(segment?.shortTermLufs, ["median", "max"], `$.analysis.temporalDiagnostic[${index}].shortTermLufs`, errors);
      requireNullableNumbers(segment, ["programSamplePeakDbfs", "programTruePeakDbtp", "silencePercent"], `$.analysis.temporalDiagnostic[${index}]`, errors);
      if (segment.stereoCorrelation !== null) requireNullableNumbers(segment.stereoCorrelation, ["median", "min"], `$.analysis.temporalDiagnostic[${index}].stereoCorrelation`, errors);
      if (segment.silencePercent !== null && (segment.silencePercent < 0 || segment.silencePercent > 100)) errors.push(`Ogiltig tystnadsandel i segment ${index}.`);
      for (const value of Object.values(segment.stereoCorrelation || {})) if (value !== null && (value < -1 || value > 1)) errors.push(`Ogiltig stereokorrelation i segment ${index}.`);
    });
  }
  exactKeys(bundle.analysis?.provenance, new Set(["engineVersion", "releaseVersion", "releaseCommit", "loudnessModel", "truePeakMethod", "validationLevel"]), "$.analysis.provenance", errors);
  requireStrings(bundle.analysis?.provenance, ["engineVersion", "releaseVersion", "releaseCommit", "loudnessModel", "truePeakMethod", "validationLevel"], "$.analysis.provenance", errors);
  if (!Array.isArray(bundle.analysis?.evidence) || bundle.analysis.evidence.length > 32) errors.push("Ogiltig evidenslista.");
  else bundle.analysis.evidence.forEach((item, index) => {
    exactKeys(item, new Set(["id", "classification", "methodId", "status"]), `$.analysis.evidence[${index}]`, errors);
    if (!new Set(["objective", "heuristic", "artistic", "mixed"]).has(item.classification)) errors.push(`Ogiltig evidensklass ${index}.`);
    requireStrings(item, ["id", "methodId", "status"], `$.analysis.evidence[${index}]`, errors);
  });
  if (Array.isArray(bundle.analysis?.evidence) && new Set(bundle.analysis.evidence.map(item => item.id)).size !== bundle.analysis.evidence.length) errors.push("Evidens-ID måste vara unika.");
  const bytes = new TextEncoder().encode(canonicalJson(bundle)).byteLength;
  const maximum = bundle.profile === "minimal" ? EXCHANGE_LIMITS.minimalBytes : EXCHANGE_LIMITS.temporalDiagnosticBytes;
  if (bytes > maximum) errors.push(`Paketet överskrider ${maximum} byte.`);
  return finishValidation(errors, "INVALID_ANALYSIS_BUNDLE", "Analyspaketet är ogiltigt.");
}

function parseJsonText(text, maximum) {
  if (typeof text !== "string") throw new AnalysisExchangeError("JSON_TYPE", "JSON-underlaget måste vara text.");
  if (new TextEncoder().encode(text).byteLength > maximum) throw new AnalysisExchangeError("FILE_TOO_LARGE", "JSON-filen är för stor.");
  try { return JSON.parse(text); } catch { throw new AnalysisExchangeError("INVALID_JSON", "Filen innehåller inte giltig JSON."); }
}

export async function parseAnalysisBundleFile(fileOrText) {
  const text = typeof fileOrText === "string" ? fileOrText : await fileOrText.text();
  const value = parseJsonText(text, EXCHANGE_LIMITS.temporalDiagnosticBytes);
  validateAnalysisBundle(value);
  return value;
}

function validateSuggestion(item, index, errors, allowedEvidence = null) {
  exactKeys(item, new Set(["id", "classification", "kind", "summary", "rationale", "evidenceRefs", "globalGainDb", "predictedIntegratedLufs", "predictedTruePeakDbtp", "confidence"]), `$.suggestions[${index}]`, errors);
  if (!CLASSIFICATIONS.has(item?.classification)) errors.push(`Ogiltig klassificering i suggestion ${index}.`);
  if (!SUGGESTION_KINDS.has(item?.kind)) errors.push(`Ogiltig kind i suggestion ${index}.`);
  requireStrings(item, ["id", "summary", "rationale"], `$.suggestions[${index}]`, errors);
  if (!Array.isArray(item?.evidenceRefs) || item.evidenceRefs.some(ref => typeof ref !== "string")) errors.push(`Ogiltiga evidenceRefs i suggestion ${index}.`);
  else if (allowedEvidence && item.evidenceRefs.some(ref => !allowedEvidence.has(ref))) errors.push(`Okänd evidensreferens i suggestion ${index}.`);
  if (item?.kind === "global-gain" && (!Number.isFinite(item.globalGainDb) || item.globalGainDb < -60 || item.globalGainDb > 24)) errors.push(`Ogiltig global gain i suggestion ${index}.`);
  if (item?.kind !== "global-gain" && item?.globalGainDb !== null) errors.push(`Endast global-gain får ha globalGainDb i suggestion ${index}.`);
  for (const key of ["predictedIntegratedLufs", "predictedTruePeakDbtp", "confidence"]) if (item?.[key] !== null && !Number.isFinite(item?.[key])) errors.push(`Ogiltigt ${key} i suggestion ${index}.`);
  if (item?.confidence !== null && (item.confidence < 0 || item.confidence > 1)) errors.push(`Confidence utanför 0 till 1 i suggestion ${index}.`);
}

export function validateGuidance(guidance, options = {}) {
  assertSafeTree(guidance, { textBudget: EXCHANGE_LIMITS.maxTextBytes });
  if (!plainObject(guidance)) throw new AnalysisExchangeError("INVALID_GUIDANCE", "Guidance-filen är ogiltig.", ["Roten måste vara ett objekt."]);
  const errors = [];
  if (options.receipt) {
    try { validateLocalReceipt(options.receipt); } catch (error) { errors.push(...(error.details || [error.message])); }
  }
  exactKeys(guidance, new Set(["schema", "bundleId", "analysisDigest", "guidanceDigest", "createdAt", "producer", "summary", "assumptions", "uncertainties", "suggestions"]), "$", errors);
  if (guidance.schema !== GUIDANCE_SCHEMA) errors.push("Fel guidance-schema.");
  if (!UUID_PATTERN.test(guidance.bundleId || "")) errors.push("Ogiltigt bundleId.");
  if (!SHA256_PATTERN.test(guidance.analysisDigest || "")) errors.push("Ogiltig analysisDigest.");
  if (!SHA256_PATTERN.test(guidance.guidanceDigest || "")) errors.push("Ogiltig guidanceDigest.");
  if (!Number.isFinite(Date.parse(guidance.createdAt))) errors.push("Ogiltig createdAt.");
  if (typeof guidance.summary !== "string") errors.push("Guidance summary måste vara text.");
  exactKeys(guidance.producer, new Set(["system", "component", "version", "method", "vepPerspectives", "model", "promptId", "runId", "trust"]), "$.producer", errors);
  if (!["system", "component", "version", "method"].every(key => typeof guidance.producer?.[key] === "string" && guidance.producer[key])) errors.push("Guidance saknar obligatorisk producentproveniens.");
  if (!Array.isArray(guidance.producer?.vepPerspectives) || !guidance.producer.vepPerspectives.length
    || guidance.producer.vepPerspectives.some(item => typeof item !== "string" || !item)) errors.push("Guidance saknar VEP-perspektiv.");
  if (guidance.producer?.trust !== "unsigned") errors.push("Schema 1 kräver uttrycklig trust unsigned.");
  for (const key of ["model", "promptId", "runId"]) if (guidance.producer?.[key] !== null && typeof guidance.producer?.[key] !== "string") errors.push(`Ogiltig producer.${key}.`);
  const allowedEvidence = options.receipt
    ? new Set([...(options.receipt.evidenceIds || []), ...(options.receipt.markerIds || [])])
    : new Set(["loudness", "true-peak", "markers"]);
  if (!Array.isArray(guidance.suggestions) || guidance.suggestions.length > 100) errors.push("Ogiltig suggestion-lista.");
  else guidance.suggestions.forEach((item, index) => validateSuggestion(item, index, errors, allowedEvidence));
  if (!Array.isArray(guidance.assumptions) || guidance.assumptions.length > 100 || guidance.assumptions.some(item => typeof item !== "string")
    || !Array.isArray(guidance.uncertainties) || guidance.uncertainties.length > 100 || guidance.uncertainties.some(item => typeof item !== "string")) errors.push("Antaganden och osäkerheter måste vara textlistor med högst 100 poster.");
  const receipt = options.receipt;
  if (receipt && (receipt.bundleId !== guidance.bundleId || receipt.analysisDigest !== guidance.analysisDigest)) errors.push("Guidance matchar inte det lokala kvittot.");
  if (options.currentAnalysisDigest && options.currentAnalysisDigest !== guidance.analysisDigest) errors.push("Guidance är inaktuell för aktuell analys.");
  if (new TextEncoder().encode(canonicalJson(guidance)).byteLength > EXCHANGE_LIMITS.guidanceBytes) errors.push("Guidance-filen är för stor.");
  validateNoForbiddenContent(guidance, "$", errors);
  if (plainObject(guidance)) {
    const { guidanceDigest, ...digestInput } = guidance;
    if (SHA256_PATTERN.test(guidanceDigest || "") && digestCanonical(digestInput) !== guidanceDigest) errors.push("guidanceDigest matchar inte guidance-innehållet.");
  }
  return finishValidation(errors, "INVALID_GUIDANCE", "Guidance-filen är ogiltig.");
}

export function addGuidanceDigest(guidanceWithoutDigest) {
  assertSafeTree(guidanceWithoutDigest);
  if (Object.hasOwn(guidanceWithoutDigest, "guidanceDigest")) throw new AnalysisExchangeError("GUIDANCE_DIGEST_PRESENT", "Indata får inte redan innehålla guidanceDigest.");
  return { ...guidanceWithoutDigest, guidanceDigest: digestCanonical(guidanceWithoutDigest) };
}

export async function parseGuidanceFile(fileOrText, options = {}) {
  const text = typeof fileOrText === "string" ? fileOrText : await fileOrText.text();
  const guidance = parseJsonText(text, EXCHANGE_LIMITS.guidanceBytes);
  const receipts = options.bundleReceipts || (options.receipt ? [options.receipt] : []);
  const receipt = receipts.find(item => item?.bundleId === guidance.bundleId && item?.analysisDigest === guidance.analysisDigest) || null;
  validateGuidance(guidance, { receipt, currentAnalysisDigest: options.currentAnalysisDigest });
  const sourceHash = typeof options.sourceIdentity === "string" ? options.sourceIdentity : options.sourceIdentity?.value;
  const sourceMatches = Boolean(receipt && SHA256_PATTERN.test(sourceHash || "") && receipt.sourceSha256 === sourceHash);
  const analysisMatches = Boolean(options.currentAnalysisDigest && options.currentAnalysisDigest === guidance.analysisDigest);
  const match = Boolean(receipt && sourceMatches && analysisMatches);
  return {
    guidance,
    receipt,
    match,
    status: match ? "bound-current"
      : !receipt ? "unbound-read-only"
        : !sourceHash ? "source-unverified-read-only"
          : !sourceMatches ? "source-mismatch" : "analysis-unverified-read-only",
    autoApply: false,
  };
}

export const importGuidanceFile = parseGuidanceFile;

const AUDIT_ACTIONS = new Set(["export", "import", "accept", "reject"]);
const EDIT_KEYS = new Set(["globalGainDb", "trimStartFrame", "trimEndFrame", "fadeInFrames", "fadeOutFrames"]);

function validateEditSnapshot(value, path, errors) {
  if (value === null) return;
  exactKeys(value, EDIT_KEYS, path, errors);
  for (const [key, number] of Object.entries(value || {})) {
    if (!Number.isFinite(number)) errors.push(`${path}.${key} måste vara ändligt.`);
    if (key !== "globalGainDb" && (!Number.isSafeInteger(number) || number < 0)) errors.push(`${path}.${key} måste vara ett icke negativt heltal.`);
  }
}

export function validateAuditLog(entries) {
  assertSafeTree(entries, { maxArrayLength: 10_000 });
  const errors = [];
  if (!Array.isArray(entries) || entries.length > 10_000) errors.push("Ogiltig auditlista.");
  let previousDigest = null;
  for (const [index, entry] of (entries || []).entries()) {
    exactKeys(entry, new Set(["sequence", "timestamp", "action", "bundleId", "analysisDigest", "suggestionId", "before", "after", "previousDigest", "entryDigest"]), `$[${index}]`, errors);
    if (entry.sequence !== index + 1 || !AUDIT_ACTIONS.has(entry.action) || !UUID_PATTERN.test(entry.bundleId || "") || !SHA256_PATTERN.test(entry.analysisDigest || "")) errors.push(`Ogiltig auditpost ${index}.`);
    if (entry.previousDigest !== previousDigest) errors.push(`Bruten auditkedja vid ${index}.`);
    validateEditSnapshot(entry.before, `$[${index}].before`, errors);
    validateEditSnapshot(entry.after, `$[${index}].after`, errors);
    const { entryDigest, ...digestInput } = entry;
    if (!SHA256_PATTERN.test(entryDigest || "") || digestCanonical(digestInput) !== entryDigest) errors.push(`Fel auditdigest vid ${index}.`);
    previousDigest = entry.entryDigest;
  }
  return finishValidation(errors, "INVALID_AUDIT", "Auditloggen är ogiltig.");
}

export function appendAuditEntry(entries, event, options = {}) {
  validateAuditLog(entries);
  assertSafeTree(event);
  const errors = [];
  exactKeys(event, new Set(["action", "bundleId", "analysisDigest", "suggestionId", "before", "after"]), "$.event", errors);
  if (!AUDIT_ACTIONS.has(event.action) || !UUID_PATTERN.test(event.bundleId || "") || !SHA256_PATTERN.test(event.analysisDigest || "")) errors.push("Ogiltigt auditevent.");
  validateEditSnapshot(event.before ?? null, "$.event.before", errors);
  validateEditSnapshot(event.after ?? null, "$.event.after", errors);
  finishValidation(errors, "INVALID_AUDIT_EVENT", "Audithändelsen är ogiltig.");
  const base = {
    sequence: entries.length + 1,
    timestamp: String(options.timestamp || new Date().toISOString()),
    action: event.action,
    bundleId: event.bundleId,
    analysisDigest: event.analysisDigest,
    suggestionId: event.suggestionId == null ? null : String(event.suggestionId).slice(0, 160),
    before: event.before == null ? null : Object.freeze({ ...event.before }),
    after: event.after == null ? null : Object.freeze({ ...event.after }),
    previousDigest: entries.at(-1)?.entryDigest || null,
  };
  if (!Number.isFinite(Date.parse(base.timestamp))) throw new AnalysisExchangeError("AUDIT_TIME", "Ogiltig audittid.");
  const entry = Object.freeze({ ...base, entryDigest: digestCanonical(base) });
  return Object.freeze([...entries, entry]);
}
