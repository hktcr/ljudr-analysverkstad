export const MAX_LOCAL_GAIN_REGIONS = 256;
export const LOCAL_GAIN_POLICY = "minimum-linked-envelope";

const integer = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} måste vara ett heltal mellan ${minimum} och ${maximum}.`);
  }
  return number;
};

const finite = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} måste vara ett ändligt tal mellan ${minimum} och ${maximum}.`);
  }
  return number;
};

export function normalizeLocalGainRegion(value, index = 0, frameCount = Number.MAX_SAFE_INTEGER) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Lokal gainregion ${index + 1} är ogiltig.`);
  const startFrame = integer(value.startFrame, "Startbildruta", 0, frameCount);
  const endFrame = integer(value.endFrame, "Slutbildruta", startFrame + 1, frameCount);
  const attackEndFrame = integer(value.attackEndFrame ?? startFrame, "Slut på infasning", startFrame, endFrame - 1);
  const releaseStartFrame = integer(value.releaseStartFrame ?? endFrame - 1, "Start på utfasning", attackEndFrame, endFrame - 1);
  const gainDb = finite(value.gainDb, "Lokal gain", -60, 0);
  const id = String(value.id || `local-gain-${index + 1}`).trim().slice(0, 160);
  if (!id) throw new Error(`Lokal gainregion ${index + 1} saknar id.`);
  return {
    id,
    startFrame,
    attackEndFrame,
    releaseStartFrame,
    endFrame,
    gainDb,
    channelMode: "linked",
    source: String(value.source || "manual").slice(0, 80),
    targetDbtp: value.targetDbtp == null ? null : finite(value.targetDbtp, "True Peak-mål", -60, 0),
  };
}

export function normalizeLocalGainRegions(values = [], frameCount = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(values)) throw new Error("Lokala gainregioner måste vara en lista.");
  if (values.length > MAX_LOCAL_GAIN_REGIONS) throw new Error(`Högst ${MAX_LOCAL_GAIN_REGIONS} lokala gainregioner stöds.`);
  const normalized = values.map((value, index) => normalizeLocalGainRegion(value, index, frameCount));
  if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error("Lokala gainregioner måste ha unika id.");
  return normalized.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame || left.id.localeCompare(right.id));
}

export function localGainFactorAtFrame(regions, sourceFrame) {
  let factor = 1;
  for (const region of regions || []) {
    if (sourceFrame < region.startFrame || sourceFrame >= region.endFrame) continue;
    const floor = 10 ** (region.gainDb / 20);
    let current = floor;
    if (sourceFrame < region.attackEndFrame) {
      const span = region.attackEndFrame - region.startFrame;
      const progress = span > 0 ? (sourceFrame - region.startFrame) / span : 1;
      current = 1 + (floor - 1) * progress;
    } else if (sourceFrame > region.releaseStartFrame) {
      const span = region.endFrame - 1 - region.releaseStartFrame;
      const progress = span > 0 ? (sourceFrame - region.releaseStartFrame) / span : 1;
      current = floor + (1 - floor) * progress;
    }
    factor = Math.min(factor, current);
  }
  return Math.max(0, Math.min(1, factor));
}

export function localGainBreakpoints(regions = []) {
  return [...new Set(regions.flatMap(region => [
    region.startFrame,
    region.attackEndFrame,
    region.releaseStartFrame,
    Math.max(region.releaseStartFrame, region.endFrame - 1),
    region.endFrame,
  ]))].sort((left, right) => left - right);
}

export function buildLocalPeakRegion({
  id,
  peakFrame,
  eventStartFrame = peakFrame,
  eventEndFrame = peakFrame + 1,
  gainDb,
  sampleRate,
  transitionSeconds = 0.2,
  paddingSeconds = 0.05,
  frameCount = Number.MAX_SAFE_INTEGER,
  source = "peak-assist",
  targetDbtp = -2,
}) {
  const rate = integer(Math.round(sampleRate), "Samplingsfrekvens", 1);
  const transition = Math.max(1, Math.round(finite(transitionSeconds, "Övergångstid", 0.001, 30) * rate));
  const padding = Math.max(0, Math.round(finite(paddingSeconds, "Säkerhetsmarginal", 0, 30) * rate));
  const peak = integer(Math.round(peakFrame), "Toppbildruta", 0, frameCount - 1);
  const eventStart = integer(Math.round(eventStartFrame), "Händelsestart", 0, frameCount - 1);
  const eventEnd = integer(Math.round(eventEndFrame), "Händelseslut", eventStart + 1, frameCount);
  const holdStart = Math.min(peak, Math.max(0, eventStart - padding));
  const holdEnd = Math.max(peak + 1, Math.min(frameCount, eventEnd + padding));
  const startFrame = Math.max(0, holdStart - transition);
  const endFrame = Math.min(frameCount, holdEnd + transition);
  return normalizeLocalGainRegion({
    id,
    startFrame,
    attackEndFrame: holdStart,
    releaseStartFrame: Math.max(holdStart, holdEnd - 1),
    endFrame,
    gainDb,
    channelMode: "linked",
    source,
    targetDbtp,
  }, 0, frameCount);
}

