import { analyzeWav } from "./dsp-core.js";

let cancellationRequested = false;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "cancel") {
    cancellationRequested = true;
    return;
  }
  if (message.type !== "analyze") return;
  cancellationRequested = false;
  try {
    const result = await analyzeWav(
      message.file,
      {
        ...(message.options || {}),
        shouldCancel: () => cancellationRequested,
      },
      ({ phase, fraction, message: progressMessage }) => {
        self.postMessage({
          type: "progress",
          phase,
          fraction,
          message: progressMessage,
        });
      },
    );
    if (!cancellationRequested) self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error?.name === "AbortError" ? "Analysen avbröts." : (error?.message || "Analysen misslyckades."),
    });
  }
});
