const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const range = values => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? { minimum: Math.min(...clean), maximum: Math.max(...clean) } : { minimum: null, maximum: null };
};

const text = (value, maximum = 2_000) => value == null ? "" : String(value).slice(0, maximum);

export const TMH_SERIES_PROFILE = Object.freeze({
  id: "twenty-minutes-here",
  version: "2026-08-15.1",
  targetDurationSeconds: 20 * 60,
  durationToleranceSeconds: 1 / 44_100,
  targetLufs: -19,
  rangeMinLufs: -20,
  rangeMaxLufs: -18,
  truePeakOrientationDbtp: -2,
  continuityPolicy: "Bevara platsens dynamik. Använd endast uttrycklig global gain och valfria kanttoningar.",
  rationale: "Intern estetisk arbetsreferens för lyssningskonsekvens. Inte en Spotify-standard eller ett tekniskt acceptanskrav.",
});

export function selectAnalysisStage({ source, calculated, verified, stage = "calculated-export-selection" } = {}) {
  if (stage === "verified-output" && verified) return { stage, analysis: verified };
  if (stage === "calculated-export-selection" && calculated) return { stage, analysis: calculated };
  return { stage: "source", analysis: source || null };
}

export function buildEditorialContext({ purpose = "distribution", targetDurationSeconds, profile = TMH_SERIES_PROFILE } = {}) {
  return {
    classification: "editorial",
    seriesProfileId: profile.id,
    seriesProfileVersion: profile.version,
    purpose: text(purpose, 80),
    targetDurationSeconds: finite(targetDurationSeconds) ?? profile.targetDurationSeconds,
    durationToleranceSeconds: profile.durationToleranceSeconds,
    loudnessOrientation: {
      targetLufs: profile.targetLufs,
      rangeMinLufs: profile.rangeMinLufs,
      rangeMaxLufs: profile.rangeMaxLufs,
      rationale: profile.rationale,
    },
    truePeakOrientationDbtp: profile.truePeakOrientationDbtp,
    continuityPolicy: profile.continuityPolicy,
    questions: [
      "Finns tekniska fynd som måste provlyssnas?",
      "Är dynamik och platskänsla bevarade?",
      "Finns redaktionella eller integritetsrelaterade granskningspunkter?",
    ],
  };
}

export function buildEditorialCueSheet(markers = [], { selectionStartSeconds = 0, selectionEndSeconds = Infinity } = {}) {
  const allowed = new Set(["descriptive", "user", "note", "privacy", "keep", "remove", "chapter"]);
  return markers
    .filter(marker => marker?.origin === "user" && allowed.has(marker.type || "user"))
    .filter(marker => finite(marker.seconds) !== null && marker.seconds >= selectionStartSeconds && marker.seconds <= selectionEndSeconds)
    .slice(0, 200)
    .map((marker, index) => ({
      id: `cue-${index + 1}`,
      type: allowed.has(marker.type) ? marker.type : "user",
      startSeconds: Math.max(0, marker.seconds - selectionStartSeconds),
      endSeconds: Math.min(selectionEndSeconds - selectionStartSeconds, Math.max(0, (finite(marker.endSeconds) ?? marker.seconds) - selectionStartSeconds)),
      text: text(marker.text, 500),
      reviewStatus: text(marker.reviewStatus || "unreviewed", 80),
      classification: "editorial",
    }));
}

export function publicationStatus({ durationSeconds, verifiedCurrent, criticalUnreviewed = 0, metadata = {}, manual = {}, exceptionNote = "" } = {}) {
  const target = TMH_SERIES_PROFILE.targetDurationSeconds;
  const durationOk = finite(durationSeconds) !== null && Math.abs(durationSeconds - target) <= Math.max(TMH_SERIES_PROFILE.durationToleranceSeconds, 0.001);
  const metadataOk = Boolean(text(metadata.title).trim() && text(metadata.episode).trim() && text(metadata.place).trim());
  const documentedException = Boolean(text(exceptionNote).trim());
  const checks = {
    duration: durationOk || documentedException,
    verifiedWav: Boolean(verifiedCurrent),
    markersReviewed: criticalUnreviewed === 0,
    fullListen: Boolean(manual.fullListen),
    boundaries: Boolean(manual.boundaries),
    stereo: Boolean(manual.stereo),
    mono: Boolean(manual.mono),
    privacy: Boolean(manual.privacy),
    metadata: metadataOk,
    archiveSaved: Boolean(manual.archiveSaved),
  };
  const incomplete = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return {
    status: incomplete.length ? "review-required" : "ready",
    checks,
    incomplete,
    exceptionNote: text(exceptionNote, 1_000),
    softGate: true,
  };
}

export function buildEpisodeHandoff({ metadata = {}, verifiedOutput = {}, sourceIdentity = null, publication = {}, reportId = null } = {}) {
  const summary = verifiedOutput.summary || {};
  const format = verifiedOutput.format || {};
  return {
    schema: "se.gaia.twenty-minutes-here.episode-handoff/1",
    createdAt: new Date().toISOString(),
    episode: {
      number: finite(metadata.episode),
      title: text(metadata.title, 500),
      series: text(metadata.series || "Twenty Minutes Here", 500),
      sessionId: text(metadata.sessionId, 500),
      place: text(metadata.place, 500),
      date: text(metadata.date, 80),
      localTime: text(metadata.localTime, 80),
      tags: text(metadata.tags),
      description: text(metadata.notes),
      spotifyUrl: "",
      artworkReference: text(metadata.relatedImage),
    },
    location: {
      disclosure: text(metadata.coordinatePrecision || "hidden", 40),
      latitude: metadata.coordinatePrecision === "hidden" ? null : finite(metadata.latitude),
      longitude: metadata.coordinatePrecision === "hidden" ? null : finite(metadata.longitude),
    },
    verifiedMaster: {
      sha256: text(verifiedOutput.sourceIdentity?.value || verifiedOutput.fullFileHash?.value || verifiedOutput.fullFileHash || sourceIdentity?.value || sourceIdentity, 128) || null,
      durationSeconds: finite(format.durationSeconds) ?? finite(verifiedOutput.duration),
      integratedLufs: finite(summary.integratedLufs ?? summary.lufsI),
      truePeakDbtp: finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp),
      loudnessRangeLu: finite(summary.loudnessRangeLu),
      plrLu: finite(summary.plrEstimateLu),
      channels: finite(format.channels),
      sampleRate: finite(format.sampleRate),
    },
    publication,
    reportId: text(reportId, 500) || null,
  };
}

export function summarizeSeriesReports(reports = []) {
  const rows = reports.map((report, index) => {
    const verifiedSection = report.sections?.verifiedExportFile || {};
    const verified = verifiedSection.analysis || verifiedSection.verifiedOutput
      || (verifiedSection.format || verifiedSection.summary ? verifiedSection : null)
      || report.verifiedOutput || report.exportReport?.verifiedOutput || {};
    const summary = verified.summary || report.summary || {};
    const format = verified.format || {};
    return {
      id: text(report.metadata?.sessionId || report.source?.name || `rapport-${index + 1}`, 500),
      durationSeconds: finite(format.durationSeconds ?? verified.duration ?? report.metadata?.durationSeconds),
      integratedLufs: finite(summary.integratedLufs ?? summary.lufsI),
      truePeakDbtp: finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp),
      loudnessRangeLu: finite(summary.loudnessRangeLu ?? summary.lra),
      plrLu: finite(summary.plrEstimateLu ?? summary.plrLu),
      channelBalanceDb: finite(summary.channelBalanceDb),
      monoDeltaDb: finite(summary.monoCompatibility?.energyDeltaDb ?? summary.monoEnergyDeltaDb),
    };
  }).filter(row => Object.values(row).some(Number.isFinite));
  const fields = ["durationSeconds", "integratedLufs", "truePeakDbtp", "loudnessRangeLu", "plrLu", "channelBalanceDb", "monoDeltaDb"];
  const statistics = Object.fromEntries(fields.map(field => {
    const values = rows.map(row => row[field]).filter(Number.isFinite);
    return [field, { median: median(values), ...range(values), count: values.length }];
  }));
  return { count: rows.length, rows, statistics, normalizationApplied: false };
}
