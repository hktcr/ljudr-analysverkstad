import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const app = await readFile(resolve(root, "src/app.js"), "utf8");
const css = await readFile(resolve(root, "styles.css"), "utf8");

test("trimfönstret har 20 minuter som redigerbart standardvärde", () => {
  assert.match(html, /id="trimWindowDurationInput"[^>]*value="20:00\.000"/);
  assert.match(html, /id="applyWindowFromStartButton"/);
  assert.match(html, /id="applyWindowAtPlayheadButton"/);
  assert.match(html, /id="applyWindowToEndButton"/);
  assert.match(app, /trimWindowSeconds:\s*20 \* 60/);
  assert.match(app, /function applyTrimWindow\(anchor\)/);
  assert.match(app, /Math\.min\(state\.trimWindowSeconds, sourceDuration\)/);
  assert.match(app, /trimWindowSeconds: state\.trimWindowSeconds/);
  for (const id of ["trimHud", "trimHudRange", "trimHudDuration", "exportTrimCanvas", "analysisTimeAxis", "centerWindowAtPlayheadButton"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-move-window="-60"/);
  assert.match(html, /data-move-window="60"/);
  assert.match(html, /data-fit-selection/);
  assert.match(html, /data-expand-timeline="analysisTimelineCard"/);
  assert.match(html, /data-expand-timeline="trimTimelineCard"/);
  assert.doesNotMatch(html, /<div class="time-axis"[^>]*><span>00:00/);
  assert.match(app, /function moveTrimWindow\(deltaSeconds/);
  assert.match(app, /function setTrimWindowPosition\(startSeconds/);
  assert.match(app, /const windowLength = Math\.min\(selectionDurationSeconds\(\), sourceDuration\)/);
  assert.match(app, /function fitTrimSelection\(\)/);
  assert.match(app, /function showTrimWindow\(\)/);
  assert.match(app, /data-fit-selection[\s\S]*showTrimWindow/);
  assert.match(app, /function activateTrimAudition/);
  assert.match(app, /state\.playback\.currentSeconds = state\.trim\.startSeconds/);
  assert.match(app, /if \(gesture\.target === "window"\) activateTrimAudition\(\)/);
  assert.match(html, /Visa och flytta trimfönstret/);
  assert.match(app, /function toggleTimelineExpansion\(cardId/);
  assert.match(html, /id="toggleTrimEditorButton"[^>]*>Lås upp trimfönstret/);
  assert.match(html, /id="applyTrimSelectionButton"[^>]*disabled>Trimma bort utanför A\/B/);
  assert.match(html, /id="revertTrimSelectionButton"[^>]*disabled>Återgå till aktivt urval/);
  assert.match(app, /trimEditor:\s*\{\s*unlocked:\s*false,\s*applied:\s*true/);
  assert.match(app, /function markTrimCandidateChanged/);
  assert.match(app, /function applyTrimSelection/);
  assert.match(app, /function revertTrimSelection/);
  assert.match(app, /if \(!state\.trimEditor\.unlocked\) return false/);
  assert.match(app, /state\.trimEditor\.applied = true;[\s\S]*markEditChanged\("trim-selection-applied"\)/);
  assert.match(app, /Tillämpa trimfönstret eller återgå till det aktiva urvalet före export/);
  assert.match(css, /\.trim-editor-state\.is-unlocked/);
  assert.match(css, /\.trim-timeline-card\.is-trim-unlocked/);
  assert.match(html, /id="globalPlayer"[\s\S]*id="transportSeek"/);
  assert.ok(html.indexOf('id="globalPlayer"') < html.indexOf('id="mainContent"'), "spelaren ska ligga utanför flikpanelerna");
  assert.equal((html.match(/id="audioPlayer"/g) || []).length, 1);
  assert.match(app, /function seekPlayback\(seconds/);
  assert.match(app, /requestAnimationFrame\(tick\)/);
  assert.match(app, /audioContext\.state !== "running"/);
  assert.match(app, /const playPromise = elements\.audio\.play\(\);[\s\S]*const graphPromise/);
  assert.match(app, /addEventListener\("error"/);
  assert.match(html, /data-peak-ceiling="-1"/);
  assert.match(html, /data-peak-ceiling="-2"/);
  assert.match(html, /data-peak-ceiling="-3"/);
  assert.match(app, /function applyNegativePeakCeiling/);
  assert.match(app, /const reduction = Math\.min\(0, target - peak\)/);
  assert.match(html, /id="gainNumber"[^>]*min="-60"/);
});

test("toningar är valfria, flexibla och har stora iPad-reglage", () => {
  assert.match(html, /id="fadeInToggle"/);
  assert.match(html, /id="fadeOutToggle"/);
  assert.match(html, /id="fadeInNumber"[^>]+type="number"/);
  assert.match(html, /id="fadeOutNumber"[^>]+type="number"/);
  assert.match(html, /id="fadeInRange"[^>]+type="range"/);
  assert.match(html, /id="fadeOutRange"[^>]+type="range"/);
  assert.doesNotMatch(html, /id="fade(?:In|Out)Toggle"[^>]+checked/);
  assert.match(css, /\.fade-switch\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.preset-row button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.nudge-group button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(html, />−10 ms<|>\+10 ms</);
});

test("medhörningen schemalägger samma linjära fadefunktion med AudioParam", () => {
  const scheduler = app.match(/function schedulePreviewEnvelope[\s\S]*?\n}\n\nfunction updateMonitoringGraph/)?.[0] || "";
  assert.match(scheduler, /fadeEnvelopeAt/);
  assert.match(scheduler, /cancelScheduledValues/);
  assert.match(scheduler, /setValueAtTime/);
  assert.match(scheduler, /linearRampToValueAtTime/);
  assert.doesNotMatch(scheduler, /requestAnimationFrame|setInterval/);
  assert.match(app, /fadeInFrames:\s*Math\.round\(state\.trim\.fadeInSeconds \* sampleRate\(\)\)/);
  assert.match(app, /fadeOutFrames:\s*Math\.round\(state\.trim\.fadeOutSeconds \* sampleRate\(\)\)/);
});

test("seriereferensen har tre uttryckliga steg och ingen dold toppsänkning", () => {
  assert.match(html, /id="calculateSeriesButton"[^>]*>Beräkna nivåförslag/);
  assert.match(html, /id="previewSeriesButton"[^>]*>Prova förslag/);
  assert.match(html, /id="applySeriesButton"[^>]*>Använd föreslagen global gain/);
  assert.match(html, /id="preserveSeriesButton"[^>]*>Bevara oförändrat/);
  assert.match(html, /-19 LUFS-I, acceptans -20 till -18 LUFS-I och -2 dBTP/);
  assert.match(html, /Ingen dold toppsänkning/);
  assert.match(html, /Redan klippt ljud repareras inte/);
});

test("exporten använder endast synlig global gain och sparar serieflödet", () => {
  assert.match(app, /series:\s*\{ status: "preserved"/);
  assert.match(app, /targetLufs:\s*TMH_SERIES_PROFILE\.targetLufs/);
  assert.match(app, /ceilingDbtp:\s*TMH_SERIES_PROFILE\.truePeakOrientationDbtp/);
  assert.match(app, /profileVersion:\s*TMH_SERIES_PROFILE\.version/);
  const projectEdit = app.match(/function projectEdit\(\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(projectEdit, /globalGainDb:\s*state\.trim\.gainDb/);
  assert.doesNotMatch(projectEdit, /peakHandling/);
  const exportCall = app.match(/exportWorker\.postMessage\([\s\S]*?\n\s*}\);/)?.[0] || "";
  assert.match(exportCall, /globalGainDb:\s*state\.trim\.gainDb/);
  assert.doesNotMatch(exportCall, /peakHandling/);
});

test("redigering ogiltigförklarar hela tidigare exportverifieringen", () => {
  const invalidation = app.match(/function markEditChanged\([^)]*\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(invalidation, /state\.regionAnalysis = null/);
  assert.match(invalidation, /state\.verifiedExport = null/);
  assert.match(invalidation, /state\.lastExportReport = null/);
  assert.match(invalidation, /state\.spectralDiagnostics = null/);
  assert.match(invalidation, /operation: "analyze-region"/);
  assert.match(invalidation, /operation: "spectral-diagnostics"/);
  assert.match(invalidation, /state\.jobs\.region = null/);
  assert.match(invalidation, /state\.jobs\.spectral = null/);
  assert.match(invalidation, /state\.exportStatus === "complete"/);
  assert.match(invalidation, /updateProjectedMetrics\(\)/);
  assert.match(invalidation, /updateExportRecommendation\(\)/);

  const report = app.match(/function reportInput\(\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(report, /state\.exportStatus === "complete" && Boolean\(state\.verifiedExport\)/);
  assert.match(report, /verifiedExport: hasCurrentVerifiedExport \? state\.verifiedExport : null/);

  const exportStart = app.match(/function startExport\(\)[\s\S]*?\n}\n\nfunction handleExportMessage/)?.[0] || "";
  assert.match(exportStart, /state\.lastExportReport = null/);
  assert.match(exportStart, /state\.verifiedExport = null/);
  assert.match(exportStart, /renderPublicationCard\(\)/);
  const handler = app.match(/function handleAnalysisMessage\(data = \{\}\)[\s\S]*?\n}\n\nfunction finishAnalysisJob/)?.[0] || "";
  const regionCancelled = handler.match(/if \(operation === "region"\) \{ state\.regionStatus = "cancelled";[^\n]+/)?.[0] || "";
  const regionError = handler.match(/if \(operation === "region" && elements\.regionMeasureStatus\) \{ state\.regionStatus = "error";[^\n]+/)?.[0] || "";
  assert.match(regionCancelled, /renderDeepMeasurements\(\)/);
  assert.match(regionError, /renderDeepMeasurements\(\)/);
});

test("adaptiv detalj, previewkanaler och workerjobb är operabla", () => {
  assert.match(app, /type:\s*"waveform-detail"/);
  assert.match(app, /function bindTimelineGestures/);
  assert.match(app, /timelinePointers\.size === 2/);
  assert.match(app, /function configureMonitorRouting/);
  assert.match(app, /mode === "mono" \? 0\.5 : 1/);
  assert.match(html, /name="previewMode" value="source"/);
  assert.match(html, /name="previewMode" value="export"/);
  assert.match(html, /name="monitorMode" value="left"/);
  assert.match(html, /name="monitorMode" value="right"/);
  assert.match(html, /name="monitorMode" value="mono"/);
  assert.match(app, /function nextJobId/);
  assert.match(app, /function isCurrentJob/);
  assert.match(app, /tracks\.correlation/);
  assert.match(app, /timelines\.correlation/);
  assert.match(app, /KORR/);
  assert.match(html, /Vågform L och R, separata spår/);
  assert.match(html, /separata spår för vänster och höger kanal/);
  assert.match(app, /const laneTop = track\.top \+ track\.height \* channelIndex \/ channelCount/);
  assert.match(app, /channelCount === 1 \? "MONO" : channelIndex === 0 \? "L" : "R"/);
  assert.match(app, /context\.lineTo\(width, laneTop\)/);
  assert.match(css, /\.timeline-card\.is-timeline-expanded/);
  assert.match(css, /@media\(pointer:coarse\).*\.timeline-canvas\{touch-action:pan-y\}/);
  assert.doesNotMatch(css, /touch-action:none/);
  assert.match(css, /\.button-small\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.legend-chip\s*\{[^}]*min-height:\s*44px/s);
  assert.match(app, /card\.setAttribute\("role", "dialog"\)/);
  assert.match(app, /card\.setAttribute\("aria-modal", "true"\)/);
  assert.match(app, /isolateExpandedTimeline\(card\)/);
  assert.match(app, /timelineFocusableElements\(expanded\)/);
  assert.match(app, /expandedTimelineRestoreFocus\.focus\(\)/);
  assert.match(html, /id="cancelAnalysisButton"/);
  assert.match(html, /id="cancelExportButton"/);
});

test("importerade markörtider normaliseras numeriskt före DOM-rendering", () => {
  const renderer = app.match(/function renderMarkers\(\)[\s\S]*?\n}\n\nfunction syncTrimUi/)?.[0] || "";
  assert.match(renderer, /finite\(marker\?\.seconds\)/);
  assert.match(renderer, /if \(seconds === null\) return null/);
  assert.match(renderer, /data-marker-jump="\$\{String\(marker\.seconds\)\}"/);
  assert.match(renderer, /escapeHtml\(marker\.text\)/);
  for (const field of ["endSeconds", "severity", "channel", "detail", "objective", "origin", "reviewStatus"]) assert.match(renderer, new RegExp(field));
});

test("mätkedja, canvastext och lokala arbetsfiler är synliga", () => {
  assert.match(html, />Källfil</);
  assert.match(html, />Beräknat exporturval</);
  assert.match(html, />Verifierad exportfil</);
  assert.match(html, /id="canvasTextAlternative"/);
  assert.match(html, /id="storedExportsList"/);
  assert.match(app, />Hämta igen</);
  assert.match(app, /item\.status \|\| "complete"/);
  assert.match(app, /item\.status === "partial" \? "Ofullständig kraschrest"/);
  assert.match(app, /const download = complete \?/);
  assert.match(app, /storage-list/);
  assert.match(app, /storage-get/);
  assert.match(app, /storage-remove/);
  assert.match(app, /storage-clear/);
  assert.match(html, /id="updateBanner"/);
  assert.match(app, /hasUnsafeUpdateState/);
});

test("poddflödet har publiceringskort, serieöversikt och handoff", () => {
  for (const id of ["publicationStatus", "publicationAutoChecks", "publicationExceptionNote", "exportEpisodeHandoffButton", "seriesReportsInput", "seriesOverviewResult", "runSpectralDiagnosticsButton"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function renderPublicationCard/);
  assert.match(app, /function exportEpisodeHandoff/);
  assert.match(app, /function importSeriesReports/);
  assert.match(app, /function episodeMasterFileName/);
  assert.match(app, /TMH_E\$\{episode\}_\$\{slug\}_MASTER\.wav/);
  assert.match(app, /state\.regionAnalysis\?\.processed\?\.summary/);
});
