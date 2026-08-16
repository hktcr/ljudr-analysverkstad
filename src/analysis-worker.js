import { analyzeRegion, analyzeSpectralDiagnostics, analyzeSpectrogram, analyzeWaveformDetail, analyzeWav } from "./dsp-core.js";

const cancelledJobs = new Set();
const latestByOperation = new Map();

const post = (type, jobId, operation, payload = {}) => self.postMessage({ type, jobId, operation, ...payload });

self.addEventListener("message", async event => {
  const message = event.data || {};
  const jobId = String(message.jobId || "");
  if (message.type === "cancel") {
    if (jobId) cancelledJobs.add(jobId);
    return;
  }
  if (!["analyze", "analyze-region", "waveform-detail", "spectral-diagnostics", "spectrogram"].includes(message.type) || !jobId) return;

  const operation = message.type;
  latestByOperation.set(operation, jobId);
  cancelledJobs.delete(jobId);
  const shouldCancel = () => cancelledJobs.has(jobId) || latestByOperation.get(operation) !== jobId;
  const progress = details => {
    if (!shouldCancel()) post("progress", jobId, operation, details);
  };

  try {
    const options = { ...(message.options || {}), shouldCancel };
    const result = operation === "analyze"
      ? await analyzeWav(message.file, options, progress)
      : operation === "analyze-region"
        ? await analyzeRegion(message.file, options, progress)
        : operation === "spectral-diagnostics"
          ? await analyzeSpectralDiagnostics(message.file, options, progress)
          : operation === "spectrogram"
            ? await analyzeSpectrogram(message.file, options, progress)
            : await analyzeWaveformDetail(message.file, options, progress);
    if (shouldCancel()) post("cancelled", jobId, operation);
    else post("result", jobId, operation, { result });
  } catch (error) {
    if (error?.name === "AbortError" || shouldCancel()) {
      post("cancelled", jobId, operation);
    } else {
      post("error", jobId, operation, {
        message: error?.message || "Arbetet misslyckades.",
        code: error?.code || null,
        details: error?.details || null,
      });
    }
  } finally {
    cancelledJobs.delete(jobId);
  }
});
