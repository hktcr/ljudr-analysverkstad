import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAnalysisBundle } from "../src/analysis-exchange.js";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const app = await readFile(resolve(root, "src/app.js"), "utf8");
const css = await readFile(resolve(root, "styles.css"), "utf8");

test("analysutbytet är lokalt, granskat och uttryckligt", () => {
  assert.match(html, /id="openAnalysisExportButton"[^>]*>Exportera analysunderlag för gAIa/);
  assert.match(html, /Appen ansluter inte till gAIa och laddar aldrig upp något automatiskt/);
  assert.match(html, /id="analysisExchangeDialog"/);
  assert.match(html, /id="exchangeJsonPreview"/);
  assert.match(html, /id="createAnalysisBundleButton"[^>]*>Skapa lokal JSON-fil/);
  assert.match(html, /id="downloadAnalysisAgainButton"[^>]*>Hämta igen/);
  assert.match(app, /state\.analysisExchange\.lastBundleBlob/);
  assert.match(app, /downloadBlob\(blob, preview\.fileName\)/);
});

test("profilerna följer den låsta integritetspolicyn", () => {
  assert.match(html, /name="exchangeProfile" value="minimal" checked/);
  assert.match(html, /name="exchangeProfile" value="temporal-diagnostics"/);
  assert.match(html, /Grova 5-sekundersaggregat/);
  assert.match(html, /högst 720 segment/);
  assert.match(html, /Aldrig waveform, L\/R-nivåserier, RMS, råa samples eller ljud/);
  assert.doesNotMatch(html, /Nedsamplad L\/R min, max och RMS/);
  for (const option of ["includeIdentity", "includeFileName", "includeLocation", "includeNotes", "includeCreator"]) {
    assert.match(html, new RegExp(`name="${option}"`));
    assert.doesNotMatch(html, new RegExp(`name="${option}"[^>]*checked`));
  }
  assert.match(app, /profile: exchangeProfile\(\) === "temporal-diagnostics" \? "temporal-diagnostic" : "minimal"/);
  assert.match(app, /privacy: privacySelection\.includeLocation && state\.metadata\.coordinatePrecision === "exact" \? "exact" : "redacted"/);
});

test("app-lik temporal input accepteras av den faktiska buildern", () => {
  const count = 100;
  const bundle = buildAnalysisBundle({
    analysis: {
      sourceIdentity: { value: "ab".repeat(32) },
      region: { startFrame: 0, endFrame: 240000, selectedFrames: 240000 },
      format: { container: "RIFF/WAVE", encoding: "IEEE float", channels: 2, sampleRate: 48000, bitsPerSample: 32, validBitsPerSample: 32, frameCount: 240000, durationSeconds: 5 },
      duration: 5,
      summary: { integratedLufs: -22, samplePeakDbfs: -4, truePeakEstimateDbtp: -3.8, channels: [] },
      timelines: {
        intervalSeconds: 0.05,
        timeSeconds: Array.from({ length: count }, (_, index) => index * 0.05),
        momentaryLufs: Array(count).fill(-21),
        shortTermLufs: Array(count).fill(-22),
        samplePeakDbfs: Array(count).fill(-4),
        rmsDbfs: Array(count).fill(-28),
        correlation: Array(count).fill(0.8),
      },
      markersSuggested: [],
    },
    regionAnalysis: null,
    markers: [],
    metadata: {},
    privacy: "redacted",
    privacySelection: { includeIdentity: false, includeFileName: false, includeLocation: false, includeNotes: false, includeCreator: false },
    profile: "temporal-diagnostic",
    release: { version: "test", commit: "test" },
  }, { bundleId: "123e4567-e89b-42d3-a456-426614174000", createdAt: "2026-08-15T12:00:00Z" });
  assert.equal(bundle.profile, "temporal-diagnostic");
  assert.equal(bundle.analysis.temporalDiagnostic.length, 1);
  assert.equal(bundle.analysis.temporalDiagnostic[0].programSamplePeakDbfs, -4);
  assert.equal(bundle.analysis.temporalDiagnostic[0].programTruePeakDbtp, null);
});

test("bundle-ID och digest binds lokalt utan källhash i UI-paketet", () => {
  assert.match(app, /import\("\.\/analysis-exchange\.js"\)/);
  assert.match(app, /analysisExchangeTools\?\.buildAnalysisBundle/);
  assert.match(app, /analysisExchangeTools\?\.createLocalReceipt/);
  assert.match(app, /sourceIdentity: state\.analysis\?\.sourceIdentity \|\| null/);
  assert.match(app, /bundleReceipts: state\.analysisExchange\.receipts/);
  assert.match(app, /analysisExchangeTools\?\.parseGuidanceFile/);
  assert.match(app, /currentAnalysisDigest: state\.analysisExchange\.lastBundle\?\.digest \|\| null/);
  assert.match(app, /const hasCurrentDigest = Boolean\(state\.analysisExchange\.lastBundle\?\.digest\)/);
  assert.match(app, /const matched = moduleMatch && hasCurrentDigest/);
  assert.match(app, /Full källhash stannar lokalt/);
});

test("extern vägledning är separat, osignerad och aldrig autoapplicerad", () => {
  assert.match(html, /id="importGuidanceButton"[^>]*>Importera vägledning från gAIa/);
  assert.match(html, /<h3 id="externalGuidanceTitle">Extern vägledning<\/h3>/);
  assert.match(app, /gAIa, osignerad, matchad/);
  assert.match(app, /guidanceStatus !== "matched"/);
  assert.match(app, /data-guidance-action="show"/);
  assert.match(app, /data-guidance-action="preview"/);
  assert.match(app, /data-guidance-action="transfer"/);
  assert.match(app, /data-guidance-action="reject"/);
  assert.match(app, /data-guidance-action="preserve"/);
  assert.doesNotMatch(`${html}\n${app}`, /Använd alla|autoApply\s*===\s*true/);
  assert.match(app, /function openSuggestionTransfer/);
  assert.match(app, /function applyGuidanceSuggestion/);
  assert.match(html, /id="confirmSuggestionTransferButton"[^>]*>Bekräfta överföring/);
});

test("endast strikt global gain kan överföras från guidance v1", () => {
  const renderer = app.match(/function renderGuidanceSuggestions\(\)[\s\S]*?\n}\n\nfunction guidanceSuggestions/)?.[0] || "";
  assert.match(renderer, /suggestion\.action === "global-gain"/);
  assert.match(renderer, /canTransfer \? "" : " disabled"/);
  const apply = app.match(/function applyGuidanceSuggestion\(suggestion\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(apply, /updateGain\(value\)/);
  assert.match(apply, /throw new Error\("Förslagstypen kan inte överföras/);
  assert.match(apply, /markEditChanged|updateGain/);
});

test("redigering gör bundle och matchad vägledning inaktuella men behåller auditkvitton", () => {
  const invalidation = app.match(/function markEditChanged\([^)]*\)[\s\S]*?\n}/)?.[0] || "";
  assert.match(invalidation, /state\.analysisExchange\.preview = null/);
  assert.match(invalidation, /state\.analysisExchange\.lastBundle = null/);
  assert.match(invalidation, /state\.analysisExchange\.lastBundleBlob = null/);
  assert.match(invalidation, /guidanceStatus === "matched"/);
  assert.match(invalidation, /guidanceStatus = "unverified"/);
  assert.match(invalidation, /renderGuidanceSuggestions\(\)/);
  assert.doesNotMatch(invalidation, /receipts\s*=/);
});

test("export, import, beslut och före efter sparas i kedjad auditlogg", () => {
  assert.match(app, /function auditEditSnapshot\(\)/);
  assert.match(app, /analysisExchangeTools\.appendAuditEntry/);
  assert.match(app, /appendAnalysisExchangeAudit\("export"/);
  assert.match(app, /appendAnalysisExchangeAudit\("import"/);
  assert.match(app, /appendAnalysisExchangeAudit\("accept"/);
  assert.match(app, /appendAnalysisExchangeAudit\("reject"/);
  assert.match(app, /const before = auditEditSnapshot\(\)/);
  assert.match(app, /after: auditEditSnapshot\(\)/);
  assert.match(app, /validateAuditLog/);
  assert.match(app, /auditLog: state\.analysisExchange\.auditLog/);
});

test("utbytesytan är iPad-anpassad och har status för hjälpmedel", () => {
  assert.match(html, /id="analysisExchangeStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="exchangeDialogStatus" role="status" aria-live="polite"/);
  assert.match(css, /\.analysis-exchange-actions \.button\s*\{[^}]*min-height:\s*48px/s);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /orientation: portrait/);
});
