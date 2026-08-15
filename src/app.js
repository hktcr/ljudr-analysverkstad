import { inspectWav } from "./wav.js";
import { RELEASE } from "./release-meta.js";
import {
  TMH_SERIES_PROFILE,
  buildEditorialContext,
  buildEditorialCueSheet,
  buildEpisodeHandoff,
  publicationStatus,
  selectAnalysisStage,
  summarizeSeriesReports,
} from "./podcast-workflow.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  mode: "open",
  file: null,
  fileUrl: null,
  fileInfo: null,
  analysis: null,
  analysisStatus: "idle",
  exportStatus: "idle",
  lastExportReport: null,
  regionAnalysis: null,
  regionStatus: "idle",
  verifiedExport: null,
  exportProfile: "sample-payload-trim",
  dirty: false,
  trim: {
    startSeconds: 0,
    endSeconds: 0,
    startFrame: 0,
    endFrame: 0,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    gainDb: 0,
  },
  trimWindowSeconds: 20 * 60,
  trimEditor: {
    unlocked: false,
    applied: true,
    appliedStartSeconds: 0,
    appliedEndSeconds: 0,
  },
  series: { status: "preserved", proposedGainDb: null, profileId: TMH_SERIES_PROFILE.id, profileVersion: TMH_SERIES_PROFILE.version, targetLufs: TMH_SERIES_PROFILE.targetLufs, rangeMinLufs: TMH_SERIES_PROFILE.rangeMinLufs, rangeMaxLufs: TMH_SERIES_PROFILE.rangeMaxLufs, ceilingDbtp: TMH_SERIES_PROFILE.truePeakOrientationDbtp },
  spectralDiagnostics: null,
  publication: {
    manual: { fullListen: false, boundaries: false, stereo: false, mono: false, privacy: false, archiveSaved: false },
    exceptionNote: "",
  },
  seriesOverview: null,
  monitoring: {
    volume: 0.8,
    levelMatched: false,
    previewMode: "source",
    channelMode: "stereo",
    previewGainOverride: null,
    previewEditOverride: null,
  },
  assessment: {
    recordingType: "soundscape-quiet",
    purpose: "distribution",
  },
  playback: {
    currentSeconds: 0,
    playing: false,
    previewStopAt: null,
  },
  view: {
    startSeconds: 0,
    endSeconds: 0,
    tracks: {
      waveform: true,
      loudness: true,
      peaks: true,
      correlation: false,
      markers: true,
    },
    detail: null,
    detailStatus: "overview",
  },
  markerFilter: "all",
  markers: [],
  jobs: { analysis: null, region: null, detail: null, spectral: null, export: null, storage: null },
  storedExports: [],
  analysisExchange: {
    preview: null,
    lastBundle: null,
    lastBundleBlob: null,
    receipts: [],
    guidance: null,
    guidanceStatus: "empty",
    guidanceDecisions: {},
    auditLog: [],
    activeSuggestionId: null,
  },
  metadata: {
    title: "",
    series: "Twenty Minutes Here",
    episode: "",
    sessionId: "",
    project: "LjudR",
    date: "",
    localTime: "",
    lightConditions: "",
    place: "",
    latitude: "",
    longitude: "",
    coordinatePrecision: "rounded",
    tags: "",
    equipment: "",
    environment: "",
    notes: "",
    creator: "",
    license: "",
    relatedImage: "",
  },
  capabilities: {
    workers: typeof Worker !== "undefined",
    analysis: typeof Worker !== "undefined",
    export: typeof Worker !== "undefined",
    opfs: Boolean(navigator.storage?.getDirectory),
    projectModule: false,
  },
  pendingProject: null,
};

let analysisWorker = null;
let exportWorker = null;
let activeTrimHandle = null;
let trimGesture = null;
let expandedTimelineRestoreFocus = null;
let expandedTimelineInert = [];
let projectTools = null;
let analysisExchangeTools = null;
let resizeFrame = 0;
let audioContext = null;
let audioSourceNode = null;
let previewGainNode = null;
let monitorGainNode = null;
let channelSplitterNode = null;
let channelMergerNode = null;
let channelGainNodes = [];
let activeDownloadUrl = null;
let jobSequence = 0;
const timelinePointers = new Map();
let timelineGesture = null;
let detailTimer = 0;
let regionTimer = 0;
let exchangePreviewSequence = 0;

const ANALYSIS_PHASES = Object.freeze({
  header: {
    order: 0,
    label: "Filstruktur",
    title: "Kontrollerar WAV-filens struktur",
    purpose: "Kontrollerar container, ljudformat, kanaler, samplingsfrekvens och datagränser innan signalen läses.",
  },
  analysis: {
    order: 1,
    label: "Signal",
    title: "Läser och mäter ljudsignalen",
    purpose: "Läser filen blockvis och mäter loudness, toppar, dynamik, stereorelationer, vågform och möjliga tekniska avvikelser.",
  },
  statistics: {
    order: 2,
    label: "Sammanställning",
    title: "Sammanställer mätvärden och fynd",
    purpose: "Sammanför mätningen till LUFS-I, LRA, PLR, kanalvärden, observationer och navigerbara markörer.",
  },
  hash: {
    order: 3,
    label: "Källidentitet",
    title: "Binder analysen till källfilen",
    purpose: "Beräknar en lokal SHA-256 för hela filen, så att resultatet kan knytas till exakt rätt original.",
  },
  complete: {
    order: 4,
    label: "Klar",
    title: "Analysen är klar",
    purpose: "Resultaten beskriver signalen. Den regelbaserade reflektionen tolkar dem därefter utifrån vald inspelningstyp.",
  },
  cancelled: {
    order: -1,
    label: "Avbruten",
    title: "Analysen avbröts",
    purpose: "Inget ljud har ändrats. Du kan starta om analysen när du vill.",
  },
  error: {
    order: -1,
    label: "Fel",
    title: "Analysen kunde inte slutföras",
    purpose: "Originalfilen är orörd. Läs felmeddelandet och försök igen eller välj en annan WAV-fil.",
  },
});

const elements = {
  appVersion: $("#appVersion"),
  audioInput: $("#audioFileInput"),
  dropZone: $("#dropZone"),
  fileStrip: $("#fileStrip"),
  fileName: $("#fileName"),
  fileTechnical: $("#fileTechnical"),
  changeFile: $("#changeFileButton"),
  saveProject: $("#saveProjectButton"),
  openProject: $("#openProjectButton"),
  projectInput: $("#projectFileInput"),
  analyzeButton: $("#analyzeButton"),
  cancelAnalysis: $("#cancelAnalysisButton"),
  analysisProgress: $("#analysisProgress"),
  progressLabel: $("#progressLabel"),
  progressPercent: $("#progressPercent"),
  progressFill: $("#progressFill"),
  progressPhase: $("#progressPhase"),
  progressPurpose: $("#progressPurpose"),
  progressSteps: Array.from(document.querySelectorAll("[data-analysis-phase]")),
  analysisCanvas: $("#analysisCanvas"),
  analysisCanvasEmpty: $("#analysisCanvasEmpty"),
  trimCanvas: $("#trimCanvas"),
  timelineRange: $("#timelineRange"),
  detailStatus: $("#detailStatus"),
  cancelRegion: $("#cancelRegionButton"),
  cancelDetail: $("#cancelDetailButton"),
  canvasTextContent: $("#canvasTextContent"),
  observationList: $("#observationList"),
  observationCount: $("#observationCount"),
  markerList: $("#markerList"),
  markerCompose: $("#markerCompose"),
  markerText: $("#markerText"),
  markerType: $("#markerType"),
  addMarker: $("#addMarkerButton"),
  audio: $("#audioPlayer"),
  playButton: $("#playButton"),
  currentTime: $("#currentTime"),
  transportDuration: $("#transportDuration"),
  selectedDuration: $("#selectedDuration"),
  trimStartInput: $("#trimStartInput"),
  trimEndInput: $("#trimEndInput"),
  trimStartLabel: $("#trimStartLabel"),
  trimEndLabel: $("#trimEndLabel"),
  trimWindowDurationInput: $("#trimWindowDurationInput"),
  trimWindowStatus: $("#trimWindowStatus"),
  trimEditorState: $("#trimEditorState"),
  trimEditorDescription: $("#trimEditorModeDescription"),
  toggleTrimEditor: $("#toggleTrimEditorButton"),
  applyTrimSelection: $("#applyTrimSelectionButton"),
  revertTrimSelection: $("#revertTrimSelectionButton"),
  trimHudRange: $("#trimHudRange"),
  trimHudDuration: $("#trimHudDuration"),
  trimHudMoveLeft: $("#trimHudMoveLeft"),
  trimHudMoveRight: $("#trimHudMoveRight"),
  analysisTimeAxis: $("#analysisTimeAxis"),
  exportTrimCanvas: $("#exportTrimCanvas"),
  exportSelectionMapping: $("#exportSelectionMapping"),
  monitorVolume: $("#monitorVolume"),
  fadeInToggle: $("#fadeInToggle"),
  fadeInNumber: $("#fadeInNumber"),
  fadeInRange: $("#fadeInRange"),
  fadeInControls: $("#fadeInControls"),
  fadeOutToggle: $("#fadeOutToggle"),
  fadeOutNumber: $("#fadeOutNumber"),
  fadeOutRange: $("#fadeOutRange"),
  fadeOutControls: $("#fadeOutControls"),
  fadeOverlapNotice: $("#fadeOverlapNotice"),
  gainNumber: $("#gainNumber"),
  gainRange: $("#gainRange"),
  projectedLufs: $("#projectedLufs"),
  projectedPeak: $("#projectedPeak"),
  gainNotice: $("#gainNotice"),
  sourceMeasureStatus: $("#sourceMeasureStatus"),
  regionMeasureStatus: $("#regionMeasureStatus"),
  verifiedMeasureStatus: $("#verifiedMeasureStatus"),
  seriesGainValue: $("#seriesGainValue"),
  seriesStateValue: $("#seriesStateValue"),
  calculateSeries: $("#calculateSeriesButton"),
  previewSeries: $("#previewSeriesButton"),
  applySeries: $("#applySeriesButton"),
  preserveSeries: $("#preserveSeriesButton"),
  levelMatch: $("#levelMatchToggle"),
  metadataForm: $("#metadataForm"),
  exportAudio: $("#exportAudioButton"),
  exportReport: $("#exportReportButton"),
  exportJson: $("#exportJsonButton"),
  exportProgress: $("#exportProgress"),
  exportProgressLabel: $("#exportProgressLabel"),
  exportProgressPercent: $("#exportProgressPercent"),
  exportProgressFill: $("#exportProgressFill"),
  cancelExport: $("#cancelExportButton"),
  storedExportsList: $("#storedExportsList"),
  clearStoredExports: $("#clearStoredExportsButton"),
  runSpectralDiagnostics: $("#runSpectralDiagnosticsButton"),
  spectralDiagnosticsResult: $("#spectralDiagnosticsResult"),
  publicationStatus: $("#publicationStatus"),
  publicationAutoChecks: $("#publicationAutoChecks"),
  publicationExceptionNote: $("#publicationExceptionNote"),
  exportEpisodeHandoff: $("#exportEpisodeHandoffButton"),
  seriesReportsInput: $("#seriesReportsInput"),
  openSeriesReports: $("#openSeriesReportsButton"),
  seriesOverviewResult: $("#seriesOverviewResult"),
  capabilityStatus: $("#capabilityStatus"),
  capabilityList: $("#capabilityList"),
  recordingType: $("#recordingType"),
  assessmentPurpose: $("#assessmentPurpose"),
  assessmentStatus: $("#assessmentStatus"),
  assessmentHeadline: $("#assessmentHeadline"),
  assessmentSummary: $("#assessmentSummary"),
  assessmentActions: $("#assessmentActions"),
  assessmentActionPlan: $("#assessmentActionPlan"),
  assessmentActionCount: $("#assessmentActionCount"),
  reviewFindings: $("#reviewFindingsButton"),
  openRecommendations: $("#openRecommendationsButton"),
  preserveFromAnalysis: $("#preserveFromAnalysisButton"),
  exportRecommendationText: $("#exportRecommendationText"),
  helpDialog: $("#helpDialog"),
  helpCopy: $("#helpCopy"),
  toastRegion: $("#toastRegion"),
  auditionStatus: $("#auditionStatus"),
  updateBanner: $("#updateBanner"),
  applyUpdate: $("#applyUpdateButton"),
  dismissUpdate: $("#dismissUpdateButton"),
  exchangeCapabilityStatus: $("#exchangeCapabilityStatus"),
  openAnalysisExport: $("#openAnalysisExportButton"),
  importGuidance: $("#importGuidanceButton"),
  guidanceFileInput: $("#guidanceFileInput"),
  analysisExchangeStatus: $("#analysisExchangeStatus"),
  exchangeArtifact: $("#exchangeArtifact"),
  exchangeArtifactDetails: $("#exchangeArtifactDetails"),
  exchangeArtifactDigest: $("#exchangeArtifactDigest"),
  analysisExchangeText: $("#analysisExchangeText"),
  copyAnalysisExchange: $("#copyAnalysisExchangeButton"),
  downloadAnalysisAgain: $("#downloadAnalysisAgainButton"),
  guidanceTextInput: $("#guidanceTextInput"),
  pasteGuidance: $("#pasteGuidanceButton"),
  processGuidanceText: $("#processGuidanceTextButton"),
  guidanceOriginStatus: $("#guidanceOriginStatus"),
  guidanceVerification: $("#guidanceVerification"),
  guidanceList: $("#guidanceList"),
  analysisExchangeDialog: $("#analysisExchangeDialog"),
  analysisExchangeForm: $("#analysisExchangeForm"),
  exchangeManifestList: $("#exchangeManifestList"),
  exchangeJsonPreview: $("#exchangeJsonPreview"),
  exchangeDialogStatus: $("#exchangeDialogStatus"),
  createAnalysisBundle: $("#createAnalysisBundleButton"),
  suggestionTransferDialog: $("#suggestionTransferDialog"),
  suggestionTransferSummary: $("#suggestionTransferSummary"),
  suggestionBeforeValue: $("#suggestionBeforeValue"),
  suggestionAfterValue: $("#suggestionAfterValue"),
  confirmSuggestionTransfer: $("#confirmSuggestionTransferButton"),
};

const helpContent = {
  principles: {
    title: "Ett mätverktyg, inte en smakdomare",
    body: `
      <p>LjudR Analysverkstad är byggd för att göra tekniska förhållanden synliga utan att jämna ut ett ljudlandskaps naturliga dynamik.</p>
      <ul>
        <li>Originalfilen öppnas skrivskyddad och förändras aldrig.</li>
        <li>Ingen kompression, brusreducering eller automatisk normalisering används.</li>
        <li>Trimning sker bara i början och slutet.</li>
        <li>Gain, om du väljer den, gäller hela verket lika.</li>
        <li>Twenty Minutes Here-referensen kan föreslå en lägre synlig global gain, men ändrar aldrig ljudet automatiskt.</li>
      </ul>
      <p>Observationerna är underlag för ditt beslut. De är inte kvalitetsbetyg.</p>`,
  },
  lufs: {
    title: "LUFS beskriver upplevd ljudstyrka",
    body: `
      <p>LUFS-I sammanfattar hela det valda materialet. Momentary använder ett fönster på 400 ms och Short-term ett fönster på 3 sekunder. LRA beskriver spridningen i ljudstyrka över tid.</p>
      <p>I ett ljudlandskap kan tysta partier, plötsliga läten och stora avstånd vara själva innehållet. Ett lågt LUFS-värde är därför inte automatiskt ett problem.</p>
      <p>True Peak är en uppskattning av toppar mellan samplen. Se alltid rapportens valideringsstatus innan ett värde används som leveranskrav.</p>`,
  },
  measurements: {
    title: "Mätvärdena i sitt sammanhang",
    body: `
      <p class="help-lead">Klicka på informationsknappen bredvid ett värde för att se dess aktuella värde, vad det betyder, vilka andra mått det ska jämföras med och vad som inte kan utläsas av måttet.</p>
      <ul>
        <li>Loudness bedöms tillsammans med toppnivå, PLR och fördelningen över tid.</li>
        <li>Dynamik bedöms med LRA, crest factor och skillnaden mellan korta och integrerade nivåer.</li>
        <li>Stereo bedöms med kanalbalans, korrelation och Mid Side-förhållande tillsammans.</li>
        <li>Signalintegritet beskriver tekniska avvikelser. Den avgör inte om miljöljudet är estetiskt önskvärt.</li>
      </ul>`,
  },
  processing: {
    title: "Bearbetningar och deras konsekvenser",
    body: `
      <p class="help-lead">LjudR erbjuder bara ingrepp som är tydliga, globala och möjliga att redovisa exakt.</p>
      <ul>
        <li>Trimning tar bort material före startgränsen och efter slutgränsen.</li>
        <li>Linjära toningar påverkar endast ytterkanterna på det valda utsnittet.</li>
        <li>Gain ändrar samtliga samplingar lika mycket.</li>
        <li>Serieförslaget kan endast bli en synlig global gain efter ett separat beslut.</li>
        <li>Utjämnad medhörning påverkar bara det du hör under jämförelsen.</li>
      </ul>`,
  },
  export: {
    title: "Export, format och säkerhetskontroller",
    body: `
      <p class="help-lead">Exportmotorn läser och skriver långa filer blockvis. Före kvantisering kontrollmäts det valda utsnittet efter toningar och den enda synliga globala gainen.</p>
      <ul>
        <li>Ren trimning utan gain eller toningar bevarar vald sample-payload byte för byte.</li>
        <li>Gain och toningar beräknas med 64 bit float innan den slutliga kodningen.</li>
        <li>PCM får TPDF dither när samplingarna måste räknas om.</li>
        <li>IEEE float behöver inte kvantiseringsdither.</li>
        <li>Positiv gain som skulle klampa PCM stoppas före export.</li>
        <li>True Peak använder 49 taps FIR-oversampling och klarar EBU:s officiella minimikrav. Det är fortfarande ingen certifiering eller leveransgaranti.</li>
      </ul>`,
  },
  trim: {
    title: "Trimma varsamt vid ytterkanterna",
    body: `
      <p>Sätt startgränsen efter handhavandeljudet i början och slutgränsen före handhavandeljudet i slutet. Använd knapparna för 1, 10 och 100 ms när du vill finjustera.</p>
      <p>Toning är av som standard. Om ett snitt ändå ger ett klick kan en kort linjär toning vara relevant. Medhörning och export använder samma amplitudkurva.</p>
      <p>Intervallet inkluderar samplingen vid startgränsen men inte samplingen vid slutgränsen. Det ger reproducerbara exporter.</p>`,
  },
  privacy: {
    title: "Ljudfilen stannar på din enhet",
    body: `
      <p>Filen läses i små block av webbläsaren. Den skickas inte till GitHub, gAIa, någon analystjänst eller någon annan mottagare.</p>
      <p>Projektfiler och rapporter innehåller mätvärden, trimgränser, markörer och metadata, men inga ljudsamplingar. En ljudfil lämnar verktyget endast när du själv väljer Exportera.</p>
      <p>Om källfilen ligger i iCloud kan iPad först behöva hämta den från Apples lagring till enheten.</p>`,
  },
};

const helpTopics = {
  assessment: {
    title: "Regelbaserad första reflektion",
    meaning: "Vald inspelningstyp och användning bestämmer vilka referensintervall som används när mätvärdena beskrivs.",
    relation: "LUFS vägs samman med toppmarginal, LRA, PLR, crest factor och tekniska observationer.",
    caution: "Skalan är vägledning, inte en standard och inte ett kvalitetsbetyg. Ett lågmält soundscape kan vara avsiktligt mycket tyst.",
    recommendation: "Använd reflektionen som en startpunkt och kontrollera alltid med lyssning innan en nivåändring.",
  },
  momentary: {
    title: "Max LUFS M",
    meaning: "Den högsta momentana loudness som uppmätts i ett fönster på ungefär 400 millisekunder.",
    relation: "Jämför med LUFS S och LUFS I. En stor skillnad visar att en kort händelse är betydligt starkare än helheten.",
    caution: "Ett enstaka fågelrop, rop eller slag kan ge ett högt värde utan att resten av inspelningen är stark.",
    recommendation: "Öppna markören för högsta momentana loudness och lyssna innan du bedömer om toppen är problematisk.",
  },
  "short-term": {
    title: "Max LUFS S",
    meaning: "Den högsta korttidsnivån, beräknad över ungefär tre sekunder.",
    relation: "Jämför med LUFS I för att se hur mycket den starkaste passagen avviker från hela inspelningen.",
    caution: "Värdet beskriver nivå, inte om ljudhändelsen är önskvärd eller störande.",
    recommendation: "Använd tidsmarkören för att kontrollera den starkaste sammanhängande passagen.",
  },
  lufs: {
    title: "Integrerad loudness, LUFS I",
    meaning: "Ett grindat mått på den genomsnittligt upplevda ljudstyrkan i hela materialet.",
    relation: "Ska läsas tillsammans med True Peak, PLR, LRA och inspelningens typ. Gain ändrar normalt LUFS och toppnivå ungefär lika många decibel.",
    caution: "Lågt LUFS är inte automatiskt ett fel. Naturlig stillhet kan vara själva innehållet.",
    recommendation: "Bedöm nivån mot vald användning och provlyssna vid realistisk volym.",
  },
  lra: {
    title: "Loudness Range, LRA",
    meaning: "Beskriver spridningen i korttidsloudness över tid efter statistisk grindning.",
    relation: "Jämför med crest factor och PLR. LRA beskriver längre nivåvariationer, medan crest factor påverkas mer av korta toppar.",
    caution: "LRA är mindre stabilt för material kortare än ungefär en minut.",
    recommendation: "Stor LRA i ett soundscape är ofta naturlig och är inte i sig skäl för kompression.",
  },
  plr: {
    title: "Peak to Loudness Ratio, PLR",
    meaning: "Skillnaden mellan orienterande True Peak och integrerad loudness.",
    relation: "Hög PLR tyder på stor toppmarginal eller tydliga transienter i förhållande till medelnivån.",
    caution: "PLR är beroende av det orienterande True Peak-estimatet och är därför också orienterande.",
    recommendation: "Använd PLR som dynamikindikator, inte som ett mål som alltid ska höjas eller sänkas.",
  },
  "sample-peak": {
    title: "Sample peak",
    meaning: "Den högsta absoluta nivån bland de lagrade samplingarna.",
    relation: "Jämför med True Peak. True Peak kan vara högre eftersom den uppskattar signalen mellan samplingarna.",
    caution: "En sample peak vid full skala kan vara klippt, men själva toppvärdet bevisar inte distorsion.",
    recommendation: "Kontrollera toppens tid och lyssna. Floatvärden över full skala kan fortfarande återställas genom global sänkning.",
  },
  "peak-time": {
    title: "Tid för högsta sample peak",
    meaning: "Tidpunkten för den högsta lagrade samplen i den kanal som nådde högst nivå.",
    relation: "Använd tillsammans med vågformen, markörerna och observationer om nivåsprång eller platåer.",
    caution: "Tidpunkten anger var du ska kontrollera, inte att ett fel har konstaterats.",
    recommendation: "Hoppa till området och lyssna före varje beslut om trimning eller nivå.",
  },
  peak: {
    title: "Orienterande True Peak",
    meaning: "Ett översamplat estimat av möjliga toppar mellan de lagrade samplingarna.",
    relation: "Jämför med sample peak, LUFS I och vald gain. Skillnaden mot önskat tak anger möjlig global sänkning.",
    caution: "Metoden klarar EBU:s officiella minimikrav, men testresultatet är inte en produktcertifiering eller garanti för varje möjlig signal.",
    recommendation: "Använd marginal och gör en separat leveranskontroll när mottagaren ställer ett formellt True Peak-krav.",
  },
  rms: {
    title: "RMS",
    meaning: "Signalens kvadratiska medelnivå, ett rent energimått utan loudnessgrindning.",
    relation: "Jämför med sample peak för crest factor och med LUFS för att se skillnaden mellan rå energi och perceptuell viktning.",
    caution: "RMS tar inte hänsyn till människans frekvensberoende hörsel på samma sätt som LUFS.",
    recommendation: "Använd främst RMS för tekniska jämförelser och för att följa nivå över tid.",
  },
  crest: {
    title: "Crest factor",
    meaning: "Skillnaden mellan sample peak och RMS. Den visar hur toppig signalen är.",
    relation: "Jämför med PLR och LRA. De tre måtten beskriver olika tidsskalor av dynamik.",
    caution: "Hög crest factor kan vara ett naturligt läte mot en tyst bakgrund och är inte ett fel.",
    recommendation: "Undvik automatisk kompression enbart på grund av ett högt värde.",
  },
  correlation: {
    title: "Stereokorrelation",
    meaning: "Visar hur lika vänster och höger kanal är i samtidiga nivåförändringar, från minus ett till plus ett.",
    relation: "Läs tillsammans med Mid Side-förhållande och kanalbalans. Negativa perioder kan ge svagare återgivning i mono.",
    caution: "Ett brett naturligt stereofält kan ha låg korrelation utan att vara felaktigt.",
    recommendation: "Kontrollera i mono och hörlurar innan någon stereoförändring övervägs.",
  },
  stereo: {
    title: "Kanalbalans vänster mot höger",
    meaning: "Skillnaden i sammanlagd energi mellan vänster och höger kanal.",
    relation: "Jämför med balansens tidslinje och den verkliga scenens riktning. En konsekvent skillnad kan vara naturlig.",
    caution: "Noll decibel är inte alltid det korrekta målet för en dokumentär stereobild.",
    recommendation: "Ändra inte balansen utan att lyssningen visar ett faktiskt problem.",
  },
  "mid-side": {
    title: "Mid Side-förhållande",
    meaning: "Förhållandet mellan det gemensamma innehållet i båda kanalerna och skillnadsinnehållet mellan dem.",
    relation: "Jämför med korrelation. Mycket Side och låg korrelation kan indikera stor bredd eller möjlig monorisk.",
    caution: "Måttet avgör inte om stereobredden är naturtrogen.",
    recommendation: "Använd värdet för orientering och kontrollera alltid stereobilden med lyssning.",
  },
  dc: {
    title: "DC offset",
    meaning: "Visar om signalens medelvärde ligger förskjutet från elektrisk noll.",
    relation: "Jämför kanalerna och kontrollera om förskjutningen är ihållande eller lokal.",
    caution: "Ett litet numeriskt värde är normalt. Verktyget tar inte bort DC automatiskt.",
    recommendation: "Åtgärda endast en tydlig och relevant förskjutning med ett dokumenterat filter i ett lämpligt redigeringsprogram.",
  },
  overrange: {
    title: "Floatvärden över full skala",
    meaning: "Räknar 32 bit floatsamplingar vars absolutvärde överstiger 1,0.",
    relation: "Jämför med topparnas regioner och efterföljande PCM export. Float overrange är inte automatiskt klippning.",
    caution: "Värdena kan klampras om de exporteras till PCM utan tillräcklig global sänkning.",
    recommendation: "Använd exportens toppförkontroll och lämna marginal innan PCM export.",
  },
  "invalid-float": {
    title: "Ogiltiga floatvärden",
    meaning: "Räknar NaN och oändliga tal som inte är giltiga ljudsamplingar.",
    relation: "Relatera antalet till filens längd och markeringarna där värdena förekommer.",
    caution: "Sådana värden är ett tekniskt dataproblem, inte ett akustiskt fenomen.",
    recommendation: "Om antalet är större än noll bör källan och exporten kontrolleras noggrant.",
  },
  fades: {
    title: "Linjära toningar",
    meaning: "En linjär amplitudkurva från tystnad till full nivå eller tillbaka till tystnad.",
    relation: "Längden ska relateras till snittets karaktär. Korta toningar motverkar klick, längre toningar blir hörbara gestaltningsval.",
    caution: "Överlappande toningar använder den lägsta av kurvorna och kan sänka hela ett mycket kort utsnitt.",
    recommendation: "Börja kort och lyssna. För soundscape kan en längre toning vara lämplig, men den ska vara ett medvetet val.",
  },
  gain: {
    title: "Global gain",
    meaning: "Samma nivåändring appliceras på varje sampling och bevarar interna nivårelationer.",
    relation: "Relatera gain till både LUFS och toppnivå. Plus tre decibel höjer normalt båda ungefär tre decibel.",
    caution: "Gain förbättrar inte signalens brusförhållande och reparerar inte distorsion.",
    recommendation: "Välj nivån med både mätning och lyssning. Använd toppförkontrollen före positiv gain till PCM.",
  },
  "series-reference": {
    title: "Frivillig Twenty Minutes Here-referens",
    meaning: "En redaktionell orientering på minus 19 LUFS-I, acceptansintervallet minus 20 till minus 18 och toppreferensen minus 2 dBTP.",
    relation: "Förslaget använder exporturvalets mätning och begränsar positiv global gain om toppreferensen annars överskrids.",
    caution: "Detta är ingen plattformsstandard, inget kvalitetsbetyg och ingen automatisk normalisering.",
    recommendation: "Beräkna, provlyssna och applicera i tre skilda steg. Bevara oförändrat är alltid ett likvärdigt val.",
  },
  monitoring: {
    title: "Utjämnad medhörning",
    meaning: "Tar bort den valda globala nivåskillnaden under jämförelselyssning så att klang och toningar kan jämföras lättare.",
    relation: "Medhörningsvolym och utjämning ligger i en separat lyssningskedja och påverkar inte exporten.",
    caution: "Utjämnad lyssning kan dölja hur stor den verkliga nivåändringen blir.",
    recommendation: "Växla mellan faktisk och utjämnad nivå före export.",
  },
  "export-profiles": {
    title: "Exportprofiler",
    meaning: "Profilerna beskriver avsikten med filen. I denna version bevarar båda aktiva profilerna källans WAV format.",
    relation: "Profilen redovisas i exportrapporten tillsammans med trimning, gain, toningar och toppkontroll.",
    caution: "Sample-payload-identiskt trimutdrag blockerar gain och toningar. Redigerad WAV-master redovisar varje ingrepp.",
    recommendation: "Skapa distributionsformat i Ferrite från den verifierade WAV-mastern.",
  },
  "preservation-export": {
    title: "Sample-payload-identiskt trimutdrag",
    meaning: "Ett sammanhängande WAV-utdrag som behåller de valda samplebyten exakt och inte tillåter gain eller toningar.",
    relation: "Ren trimning kan vara bitidentisk i ljuddatat. Gain eller toningar kräver omräkning.",
    caution: "Metadata från okända WAV block kan inte alltid bevaras och redovisas därför i exportrapporten.",
    recommendation: "Använd denna som ny arbetsmaster och behåll alltid originalinspelningen separat.",
  },
  "distribution-export": {
    title: "Redigerad distributionsmaster",
    meaning: "En WAV avsedd som källa för publicering eller senare formatkodning.",
    relation: "Den innehåller de trimningar, toningar och globala nivåval som visas i exportsammanfattningen.",
    caution: "Den aktiva versionen skapar inte AAC eller MP3 och gör ingen automatisk loudnessnormalisering.",
    recommendation: "Kontrollera rapporten och provlyssna på den sparade filen innan den kodas för en plattform.",
  },
  "export-status": {
    title: "Teknisk status",
    meaning: "Visar om webbläsaren har de funktioner som analys, blockvis export och lokal storfilslagring behöver.",
    relation: "OPFS minskar behovet av att hålla en stor export helt i arbetsminnet. Minnesreserv används när OPFS saknas.",
    caution: "Redo betyder att funktionerna finns, inte att varje filstorlek har praktiskt verifierats på den aktuella enheten.",
    recommendation: "Provexportera och kontrollera en stor fil på din iPad innan ett viktigt original bearbetas.",
  },
  "export-safety": {
    title: "Exportkontroll och rekommendation",
    meaning: "Sammanfattar vad exporten kommer att ändra och om aktuella mätvärden visar en tydlig teknisk risk.",
    relation: "Kontrollen väger ihop utsnitt, toningar, synlig global gain, källformat och aktuell analys.",
    caution: "True Peak delen är orienterande. Den slutliga filen bör alltid provlyssnas efter sparande.",
    recommendation: "Exportera först när sammanfattningen stämmer med din avsikt och inga olösta varningar återstår.",
  },
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDecimal(value, digits = 1) {
  const number = finite(value);
  if (number === null) return "saknas";
  return number.toLocaleString("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTime(seconds, milliseconds = true) {
  const safe = Math.max(0, finite(seconds) ?? 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.min(999, Math.round((safe - Math.floor(safe)) * 1000));
  const base = hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return milliseconds ? `${base}.${String(millis).padStart(3, "0")}` : base;
}

function parseTime(value) {
  if (typeof value === "number") return value;
  const clean = String(value || "").trim().replace(",", ".");
  if (!clean) return null;
  const parts = clean.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function formatBytes(bytes) {
  const value = finite(bytes) ?? 0;
  if (value >= 1024 ** 3) return `${formatDecimal(value / 1024 ** 3, 2)} GiB`;
  if (value >= 1024 ** 2) return `${formatDecimal(value / 1024 ** 2, 1)} MiB`;
  return `${formatDecimal(value / 1024, 0)} KiB`;
}

function formatRate(rate) {
  const value = finite(rate);
  if (value === null) return "okänd frekvens";
  return `${formatDecimal(value / 1000, value % 1000 ? 1 : 0)} kHz`;
}

function baseName(name = "ljudr") {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9åäöÅÄÖ_-]+/g, "_") || "ljudr";
}

function sampleRate() {
  return finite(state.analysis?.format?.sampleRate ?? state.fileInfo?.sampleRate) ?? 48000;
}

function durationSeconds() {
  return finite(state.analysis?.format?.durationSeconds ?? state.analysis?.duration ?? state.fileInfo?.durationSeconds ?? elements.audio.duration) ?? 0;
}

function toFrame(seconds) {
  return Math.round(clamp(seconds, 0, durationSeconds()) * sampleRate());
}

function toSeconds(frame) {
  return Math.max(0, (finite(frame) ?? 0) / sampleRate());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "info", timeout = 4500) {
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " is-error" : ""}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), timeout);
}

function nextJobId(operation) {
  jobSequence += 1;
  return `${operation}-${Date.now()}-${jobSequence}`;
}

function isCurrentJob(operation, data = {}) {
  return !data.jobId || state.jobs[operation] === data.jobId;
}

function markEditChanged(reason = "edit") {
  const activeRegionJob = state.jobs.region;
  const activeSpectralJob = state.jobs.spectral;
  if (activeRegionJob) analysisWorker?.postMessage({ type: "cancel", jobId: activeRegionJob, operation: "analyze-region" });
  if (activeSpectralJob) analysisWorker?.postMessage({ type: "cancel", jobId: activeSpectralJob, operation: "spectral-diagnostics" });
  state.jobs.region = null;
  state.jobs.spectral = null;
  state.dirty = true;
  state.regionAnalysis = null;
  state.regionStatus = "stale";
  state.verifiedExport = null;
  state.lastExportReport = null;
  state.spectralDiagnostics = null;
  state.analysisExchange.preview = null;
  state.analysisExchange.lastBundle = null;
  state.analysisExchange.lastBundleBlob = null;
  elements.analysisExchangeText.value = "";
  if (elements.exchangeArtifact) elements.exchangeArtifact.hidden = true;
  if (state.analysisExchange.guidanceStatus === "matched") {
    state.analysisExchange.guidanceStatus = "unverified";
    elements.guidanceOriginStatus.textContent = "gAIa, osignerad, inaktuell";
    elements.guidanceOriginStatus.className = "guidance-origin is-unverified";
    elements.guidanceVerification.textContent = "Redigeringen har ändrats. Importera vägledningen igen efter att ett nytt analysunderlag har skapats.";
    renderGuidanceSuggestions();
  }
  syncAnalysisExchangeAvailability();
  if (state.exportStatus === "complete") state.exportStatus = "idle";
  if (elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = "Behöver beräknas på nytt";
  if (elements.verifiedMeasureStatus) elements.verifiedMeasureStatus.textContent = "Ogiltig efter ändring";
  renderSpectralDiagnostics();
  renderDeepMeasurements();
  updateProjectedMetrics();
  updateExportRecommendation();
  renderPublicationCard();
  syncTrimHud();
  window.clearTimeout(regionTimer);
  regionTimer = window.setTimeout(requestRegionAnalysis, 450);
  emitState(reason);
}

function invalidateSeriesProposal() {
  state.series.status = "preserved";
  state.series.proposedGainDb = null;
  state.monitoring.previewGainOverride = null;
  state.monitoring.previewEditOverride = null;
  syncSeriesUi();
}

function emitState(reason) {
  window.dispatchEvent(new CustomEvent("ljudr:statechange", {
    detail: {
      reason,
      mode: state.mode,
      hasFile: Boolean(state.file),
      analysisStatus: state.analysisStatus,
      exportStatus: state.exportStatus,
      trim: { ...state.trim },
      trimEditor: { ...state.trimEditor },
      series: { ...state.series },
      regionAnalysis: state.regionAnalysis,
      verifiedExport: state.verifiedExport,
      markers: state.markers.map((marker) => ({ ...marker })),
      metadata: { ...state.metadata },
      assessment: { ...state.assessment },
    },
  }));
  if (reloadWhenSafe && !hasUnsafeUpdateState()) location.reload();
}

function setMode(mode, options = {}) {
  if (!["open", "analyze", "trim", "export"].includes(mode)) return;
  if (!state.trimEditor.applied && mode !== "trim") {
    showToast("Lås trimfönstret och tillämpa det, eller återgå till det aktiva urvalet, innan du lämnar trimsteget.", "error", 7000);
    return;
  }
  if (mode !== "open" && !state.file) {
    showToast("Välj först en ljudfil.");
    return;
  }
  state.mode = mode;
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.panel === mode));
  const order = ["open", "analyze", "trim", "export"];
  const activeIndex = order.indexOf(mode);
  $$(".mode-tab").forEach((tab) => {
    const index = order.indexOf(tab.dataset.mode);
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
    tab.classList.toggle("is-complete", index < activeIndex);
    if (tab.dataset.mode === mode) tab.setAttribute("aria-current", "step");
    else tab.removeAttribute("aria-current");
  });
  if (mode === "analyze" || mode === "trim") scheduleCanvasRender();
  if (mode === "export") updateExportSummary();
  if (!options.silent) {
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  emitState("mode");
}

function enableWorkflow(enabled) {
  $$(".mode-tab").forEach((tab) => {
    if (tab.dataset.mode !== "open") tab.disabled = !enabled;
  });
  elements.saveProject.disabled = !enabled;
  elements.addMarker.disabled = !enabled;
}

async function inspectWaveHeader(file) {
  const inspected = await inspectWav(file);
  return {
    ...inspected.format,
    container: inspected.container,
    dataBytes: inspected.data?.completeDataBytes ?? null,
    durationSeconds: inspected.durationSeconds,
    frameCount: inspected.frameCount,
  };
}

function technicalDescription() {
  const info = state.analysis?.format ?? state.fileInfo;
  if (!info) return `${formatBytes(state.file?.size)} · tekniska data läses i analysen`;
  const encoding = info.encoding === "IEEE_FLOAT" ? "float" : String(info.encoding || "").toLowerCase();
  const channelText = info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} kanaler`;
  const bits = info.bitsPerSample ? `${info.bitsPerSample}-bit ${encoding}` : encoding;
  const validBits = finite(info.validBitsPerSample) !== null && info.validBitsPerSample !== info.bitsPerSample ? ` · ${info.validBitsPerSample} giltiga bitar` : "";
  const duration = finite(info.durationSeconds) !== null ? formatTime(info.durationSeconds, false) : "okänd längd";
  return `${bits}${validBits} · ${formatRate(info.sampleRate)} · ${channelText} · ${duration} · ${formatBytes(state.file?.size)}`;
}

function validBitsTransformBlocked() {
  const info = state.analysis?.format || state.fileInfo || {};
  return finite(info.validBitsPerSample) !== null && finite(info.bitsPerSample) !== null && info.validBitsPerSample !== info.bitsPerSample;
}

async function openAudioFile(file) {
  if (!file) return;
  if (!/\.(wav|wave)$/i.test(file.name) && !/wav/i.test(file.type || "")) {
    showToast("Välj en WAV-fil. Andra ljudformat är inte aktiverade ännu.", "error");
    return;
  }
  stopPlayback();
  analysisWorker?.terminate();
  analysisWorker = null;
  exportWorker?.terminate();
  exportWorker = null;
  state.jobs = { analysis: null, region: null, detail: null, spectral: null, export: null, storage: null };
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = file;
  state.fileUrl = URL.createObjectURL(file);
  state.fileInfo = null;
  state.analysis = null;
  state.regionAnalysis = null;
  state.regionStatus = "idle";
  state.verifiedExport = null;
  state.analysisStatus = "idle";
  state.exportStatus = "idle";
  state.lastExportReport = null;
  state.spectralDiagnostics = null;
  state.publication = {
    manual: { fullListen: false, boundaries: false, stereo: false, mono: false, privacy: false, archiveSaved: false },
    exceptionNote: "",
  };
  state.analysisExchange.preview = null;
  state.analysisExchange.lastBundle = null;
  state.analysisExchange.lastBundleBlob = null;
  state.analysisExchange.guidance = null;
  state.analysisExchange.guidanceStatus = "empty";
  state.analysisExchange.guidanceDecisions = {};
  state.analysisExchange.receipts = [];
  state.analysisExchange.auditLog = [];
  clearGuidancePreview();
  elements.exchangeArtifact.hidden = true;
  elements.analysisExchangeText.value = "";
  elements.guidanceTextInput.value = "";
  elements.guidanceOriginStatus.textContent = "Ingen text inläst";
  elements.guidanceOriginStatus.className = "guidance-origin";
  elements.guidanceVerification.textContent = "Vägledning måste matcha bundle-ID, analysdigest och den lokalt verifierade källfilen.";
  renderGuidanceSuggestions();
  syncAnalysisExchangeAvailability();
  state.markers = [];
  state.trim.startSeconds = 0;
  state.trim.startFrame = 0;
  state.trimEditor = { unlocked: false, applied: true, appliedStartSeconds: 0, appliedEndSeconds: 0 };
  state.trim.gainDb = 0;
  state.trim.fadeInSeconds = 0;
  state.trim.fadeOutSeconds = 0;
  state.series = { status: "preserved", proposedGainDb: null, profileId: TMH_SERIES_PROFILE.id, profileVersion: TMH_SERIES_PROFILE.version, targetLufs: TMH_SERIES_PROFILE.targetLufs, rangeMinLufs: TMH_SERIES_PROFILE.rangeMinLufs, rangeMaxLufs: TMH_SERIES_PROFILE.rangeMaxLufs, ceilingDbtp: TMH_SERIES_PROFILE.truePeakOrientationDbtp };
  elements.fileName.textContent = file.name;
  elements.fileTechnical.textContent = `${formatBytes(file.size)} · läser WAVE-rubrik`;
  elements.fileStrip.hidden = false;
  enableWorkflow(true);
  elements.analysisCanvasEmpty.hidden = false;
  updateAnalysisProgress(0, "Redo att analysera", true);

  try {
    state.fileInfo = await inspectWaveHeader(file);
    if (["RF64", "BW64"].includes(state.fileInfo.container)) throw new Error(`${state.fileInfo.container} ligger utanför version 1.0. Välj en RIFF/WAVE-fil.`);
    if (![44100, 48000, 88200, 96000, 176400, 192000].includes(state.fileInfo.sampleRate)) throw new Error("Samplingsfrekvensen stöds inte. Tillåtna värden är 44,1, 48, 88,2, 96, 176,4 och 192 kHz.");
  } catch (error) {
    showToast(error.message, "error", 9000);
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = null;
    state.file = null;
    elements.fileStrip.hidden = true;
    elements.audioInput.value = "";
    enableWorkflow(false);
    return;
  }
  elements.audio.src = state.fileUrl;
  const duration = durationSeconds();
  state.trim.endSeconds = duration;
  state.trim.endFrame = toFrame(duration);
  state.trimEditor.appliedEndSeconds = duration;
  state.view.startSeconds = 0;
  state.view.endSeconds = duration;
  elements.fileTechnical.textContent = technicalDescription();
  syncTrimUi();
  renderMarkers();
  renderAnalysisSummary();
  renderSpectralDiagnostics();
  renderPublicationCard();
  if (state.pendingProject) await applyPendingProjectToFile();
  setMode("analyze");
  showToast("Filen öppnades lokalt. Originalet är oförändrat.");
  emitState("file-opened");
}

function analysisOverallProgress(phase, fraction) {
  const value = clamp(fraction, 0, 1);
  if (phase === "header") return 0.02;
  if (phase === "analysis") return 0.04 + value * 0.76;
  if (phase === "statistics") return 0.84;
  if (phase === "hash") return 0.86 + value * 0.13;
  if (phase === "complete") return 1;
  return value;
}

function updateAnalysisProgress(fraction, message, hidden = false, phase = null) {
  const currentPhase = ANALYSIS_PHASES[phase] ? phase : null;
  const value = currentPhase ? analysisOverallProgress(currentPhase, fraction) : clamp(fraction, 0, 1);
  elements.analysisProgress.hidden = hidden;
  elements.progressFill.style.width = `${value * 100}%`;
  elements.progressPercent.textContent = `${Math.round(value * 100)} %`;
  const phaseInfo = currentPhase ? ANALYSIS_PHASES[currentPhase] : null;
  elements.progressLabel.textContent = phaseInfo?.title || message || "Analyserar ljud";
  if (elements.progressPhase) elements.progressPhase.textContent = phaseInfo?.label || "Pågående analys";
  if (elements.progressPurpose) elements.progressPurpose.textContent = phaseInfo?.purpose || "Mätningen pågår lokalt i webbläsaren.";
  if (currentPhase) {
    for (const step of elements.progressSteps) {
      const stepInfo = ANALYSIS_PHASES[step.dataset.analysisPhase];
      const isCurrent = step.dataset.analysisPhase === currentPhase;
      const isComplete = currentPhase === "complete" || (phaseInfo.order >= 0 && stepInfo.order < phaseInfo.order);
      step.classList.toggle("is-current", isCurrent);
      step.classList.toggle("is-complete", isComplete);
      if (isCurrent) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    }
  }
}

function updateExportProgress(fraction, message, hidden = false) {
  const value = clamp(fraction, 0, 1);
  elements.exportProgress.hidden = hidden;
  elements.exportProgressFill.style.width = `${value * 100}%`;
  elements.exportProgressPercent.textContent = `${Math.round(value * 100)} %`;
  elements.exportProgressLabel.textContent = message || "Exporterar ljud";
}

function setDetailStatus(message, busy = false) {
  const indicator = $(".status-dot", elements.detailStatus);
  const copy = $("span:nth-of-type(2)", elements.detailStatus);
  indicator?.classList.toggle("is-busy", busy);
  if (copy) copy.textContent = message;
  elements.cancelDetail.hidden = !busy;
}

function handleAnalysisMessage(data = {}) {
  const operation = data.operation === "analyze-region" ? "region"
    : data.operation === "waveform-detail" ? "detail"
      : data.operation === "spectral-diagnostics" ? "spectral" : "analysis";
  if (!isCurrentJob(operation, data)) return;
  if (data.type === "progress") {
    if (operation === "analysis") updateAnalysisProgress(data.fraction, data.message || data.phase, false, data.phase);
    else if (operation === "detail" && elements.detailStatus) setDetailStatus(data.message || "Läser detaljdata", true);
    else if (operation === "region" && elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = data.message || "Beräknar exporturval";
    else if (operation === "spectral" && elements.spectralDiagnosticsResult) elements.spectralDiagnosticsResult.innerHTML = `<div><dt>Status</dt><dd>${escapeHtml(data.message || "Samplar lokalt")}</dd></div>`;
    return;
  }
  if (data.type === "cancelled") {
    state.jobs[operation] = null;
    if (operation === "analysis") finishAnalysisJob("Analysen avbröts");
    if (operation === "region") { state.regionStatus = "cancelled"; elements.regionMeasureStatus.textContent = "Beräkningen avbröts"; elements.cancelRegion.hidden = true; renderDeepMeasurements(); updateProjectedMetrics(); }
    if (operation === "detail") setDetailStatus("Detaljläsningen avbröts", false);
    if (operation === "spectral") renderSpectralDiagnostics("Avbruten");
    if (operation === "region" || operation === "analysis") syncAnalysisExchangeAvailability();
    return;
  }
  if (data.type === "result" || data.result) {
    const result = data.result ?? data;
    if (operation === "region") applyRegionResult(result);
    else if (operation === "detail") applyDetailResult(result);
    else if (operation === "spectral") applySpectralDiagnosticsResult(result);
    else applyAnalysisResult(result);
    return;
  }
  if (data.type === "error" || data.error) {
    state.jobs[operation] = null;
    if (operation !== "analysis") {
      if (operation === "detail" && elements.detailStatus) setDetailStatus("Detaljdata kunde inte läsas", false);
      if (operation === "region" && elements.regionMeasureStatus) { state.regionStatus = "error"; elements.regionMeasureStatus.textContent = "Beräkningen misslyckades"; elements.cancelRegion.hidden = true; renderDeepMeasurements(); updateProjectedMetrics(); }
      if (operation === "spectral") renderSpectralDiagnostics("Kunde inte beräknas");
      if (operation === "region") syncAnalysisExchangeAvailability();
      return;
    }
    state.analysisStatus = "error";
    syncAnalysisExchangeAvailability();
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "Försök analysera igen";
    updateAnalysisProgress(0, data.message || data.error || "Analysen misslyckades", false, "error");
    showToast(data.message || data.error || "Analysen misslyckades.", "error", 8000);
    updateCapabilities(false, state.capabilities.export);
    emitState("analysis-error");
  }
}

function finishAnalysisJob(message) {
  state.analysisStatus = state.analysis ? "complete" : "idle";
  syncAnalysisExchangeAvailability();
  elements.analyzeButton.disabled = false;
  elements.analyzeButton.textContent = state.analysis ? "Analysera igen" : "Starta analys";
  elements.cancelAnalysis.hidden = true;
  elements.cancelAnalysis.disabled = false;
  updateAnalysisProgress(0, message, false, "cancelled");
}

function ensureAnalysisWorker() {
  if (analysisWorker) return analysisWorker;
  analysisWorker = new Worker("./src/analysis-worker.js", { type: "module" });
  analysisWorker.onmessage = (event) => handleAnalysisMessage(event.data);
  analysisWorker.onerror = (event) => showToast(event.message || "Analysmotorn rapporterade ett workerfel.", "error", 8000);
  return analysisWorker;
}

function startAnalysis() {
  if (!state.file || state.analysisStatus === "running") return;
  if (!state.capabilities.workers) {
    showToast("Den här webbläsaren saknar Worker-stöd som krävs för storfilsanalys.", "error");
    return;
  }
  try {
    state.analysisExchange.preview = null;
    state.analysisExchange.lastBundle = null;
    state.analysisExchange.lastBundleBlob = null;
    elements.analysisExchangeText.value = "";
    state.analysisExchange.guidance = null;
    state.analysisExchange.guidanceStatus = "empty";
    state.analysisExchange.guidanceDecisions = {};
    elements.exchangeArtifact.hidden = true;
    elements.guidanceOriginStatus.textContent = "Ingen aktiv vägledning";
    elements.guidanceOriginStatus.className = "guidance-origin";
    elements.guidanceVerification.textContent = "Analysen körs om. Tidigare vägledning kan inte användas utan ett nytt matchande underlag.";
    renderGuidanceSuggestions();
    analysisWorker?.terminate();
    analysisWorker = null;
    analysisWorker = ensureAnalysisWorker();
    const jobId = nextJobId("analysis");
    state.jobs.analysis = jobId;
    analysisWorker.onerror = (event) => handleAnalysisMessage({ type: "error", jobId, operation: "analyze", message: event.message || "Analysmotorn kunde inte starta." });
    state.analysisStatus = "running";
    syncAnalysisExchangeAvailability();
    elements.analyzeButton.disabled = true;
    elements.analyzeButton.textContent = "Analys pågår";
    elements.cancelAnalysis.hidden = false;
    elements.cancelAnalysis.disabled = false;
    updateAnalysisProgress(0, "Förbereder blockvis analys", false, "header");
    analysisWorker.postMessage({
      type: "analyze",
      jobId,
      file: state.file,
      options: { lowLevelThresholdDb: -60, lowLevelThresholdDbfs: -60 },
    });
    emitState("analysis-started");
  } catch (error) {
    handleAnalysisMessage({ type: "error", message: error.message });
  }
}

function applyAnalysisResult(result) {
  if (!result || typeof result !== "object") {
    handleAnalysisMessage({ type: "error", message: "Analysmotorn returnerade inget användbart resultat." });
    return;
  }
  state.analysis = result;
  state.analysisStatus = "complete";
  elements.cancelAnalysis.hidden = true;
  elements.cancelAnalysis.disabled = false;
  if (elements.sourceMeasureStatus) elements.sourceMeasureStatus.textContent = "Objektiv källanalys klar";
  const duration = durationSeconds();
  if (!state.trim.endFrame || state.trim.endSeconds <= 0) {
    state.trim.endSeconds = duration;
    state.trim.endFrame = toFrame(duration);
  } else {
    state.trim.endSeconds = clamp(state.trim.endSeconds, state.trim.startSeconds, duration);
    state.trim.endFrame = toFrame(state.trim.endSeconds);
  }
  if (state.trimEditor.applied) {
    state.trimEditor.appliedStartSeconds = state.trim.startSeconds;
    state.trimEditor.appliedEndSeconds = state.trim.endSeconds;
  }
  state.view.startSeconds = 0;
  state.view.endSeconds = duration;
  elements.fileTechnical.textContent = technicalDescription();
  elements.analysisCanvasEmpty.hidden = true;
  elements.analyzeButton.disabled = false;
  elements.analyzeButton.textContent = "Analysera igen";
  updateAnalysisProgress(1, "Analysen är klar", false, "complete");
  window.setTimeout(() => { if (state.analysisStatus === "complete") elements.analysisProgress.hidden = true; }, 1200);
  const suggestions = Array.isArray(result.markersSuggested) ? result.markersSuggested : [];
  const existingIds = new Set(state.markers.map((marker) => marker.id));
  suggestions.forEach((suggestion, index) => {
    const seconds = finite(suggestion.timeSeconds ?? suggestion.startSeconds ?? suggestion.time) ?? 0;
    const id = suggestion.id || `suggested-${index}-${Math.round(seconds * 1000)}`;
    if (!existingIds.has(id)) {
      state.markers.push({
        id,
        seconds,
        endSeconds: finite(suggestion.endSeconds) ?? seconds,
        type: suggestion.type || "technical",
        machineKind: suggestion.machineKind || suggestion.kind || suggestion.type || null,
        severity: suggestion.severity || "info",
        channel: suggestion.channel ?? null,
        detail: suggestion.detail || suggestion.message || "",
        objective: suggestion.objective !== false,
        origin: suggestion.origin || "analysis",
        reviewStatus: "unreviewed",
        text: suggestion.label || suggestion.title || suggestion.message || "Teknisk observation",
        suggested: true,
      });
    }
  });
  syncTrimUi();
  renderAnalysisSummary();
  renderObservations();
  renderMarkers();
  renderPublicationCard();
  scheduleCanvasRender();
  updateCapabilities(true, state.capabilities.export);
  requestRegionAnalysis();
  requestWaveformDetail();
  state.jobs.analysis = null;
  state.dirty = true;
  syncAnalysisExchangeAvailability();
  showToast("Analysen är klar. Inga ändringar har gjorts i ljudet.");
  emitState("analysis-complete");
}

function regionOptions(globalGainDb = state.trim.gainDb) {
  return {
    startFrame: state.trim.startFrame,
    endFrame: state.trim.endFrame,
    fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
    fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
    globalGainDb,
  };
}

function requestRegionAnalysis() {
  if (!state.file || !state.analysis || !state.capabilities.workers) return;
  ensureAnalysisWorker();
  const previous = state.jobs.region;
  if (previous) analysisWorker.postMessage({ type: "cancel", jobId: previous, operation: "analyze-region" });
  const jobId = nextJobId("region");
  state.jobs.region = jobId;
  state.regionStatus = "running";
  syncAnalysisExchangeAvailability();
  if (elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = "Beräknar exakt urval";
  elements.cancelRegion.hidden = false;
  analysisWorker.postMessage({ type: "analyze-region", jobId, file: state.file, options: regionOptions() });
}

function applyRegionResult(result) {
  state.regionAnalysis = result;
  state.regionStatus = "complete";
  state.jobs.region = null;
  syncAnalysisExchangeAvailability();
  elements.cancelRegion.hidden = true;
  const summary = result?.processed?.summary || result?.summary || {};
  const lufs = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  if (elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = `${lufs === null ? "LUFS saknas" : `${formatDecimal(lufs, 1)} LUFS-I`} · ${peak === null ? "TP saknas" : `${formatDecimal(peak, 1)} dBTP`}`;
  renderCanvasTextAlternative();
  renderDeepMeasurements();
  updateProjectedMetrics();
  updateExportSummary();
  renderPublicationCard();
  emitState("region-analysis-complete");
}

function requestSpectralDiagnostics() {
  if (!state.file || !state.analysis || !state.capabilities.workers || state.jobs.spectral) return;
  ensureAnalysisWorker();
  const jobId = nextJobId("spectral");
  state.jobs.spectral = jobId;
  elements.runSpectralDiagnostics.disabled = true;
  elements.spectralDiagnosticsResult.innerHTML = "<div><dt>Status</dt><dd>Förbereder lokal sampling</dd></div>";
  analysisWorker.postMessage({ type: "spectral-diagnostics", jobId, file: state.file, options: regionOptions() });
}

function applySpectralDiagnosticsResult(result) {
  state.jobs.spectral = null;
  state.spectralDiagnostics = result;
  elements.runSpectralDiagnostics.disabled = false;
  renderSpectralDiagnostics();
  emitState("spectral-diagnostics-complete");
}

function renderSpectralDiagnostics(status = null) {
  if (!elements.spectralDiagnosticsResult) return;
  if (status) {
    elements.spectralDiagnosticsResult.innerHTML = `<div><dt>Status</dt><dd>${escapeHtml(status)}</dd></div>`;
    if (elements.runSpectralDiagnostics) elements.runSpectralDiagnostics.disabled = !state.analysis;
    return;
  }
  const result = state.spectralDiagnostics;
  if (!result) {
    elements.spectralDiagnosticsResult.innerHTML = "<div><dt>Status</dt><dd>Inte körd</dd></div>";
    if (elements.runSpectralDiagnostics) elements.runSpectralDiagnostics.disabled = !state.analysis;
    return;
  }
  elements.spectralDiagnosticsResult.innerHTML = `
    <div><dt>Sampling</dt><dd>${Number(result.windowCount || 0)} fönster, ${formatDecimal(result.sampledSeconds, 1)} s totalt</dd></div>
    <div><dt>Lågfrekvent energi</dt><dd>median ${formatDecimal(result.lowFrequencyEnergyPercentMedian, 1)} %, max ${formatDecimal(result.lowFrequencyEnergyPercentMaximum, 1)} %</dd></div>
    <div><dt>50 Hz</dt><dd>median ${formatDecimal(result.mainsHum50RelativeDbMedian, 1)} dB, max ${formatDecimal(result.mainsHum50RelativeDbMaximum, 1)} dB relativt</dd></div>
    <div><dt>Tolkning</dt><dd>${escapeHtml(result.interpretation || "Samplad orientering för mänsklig granskning")}</dd></div>`;
}

function requestWaveformDetail() {
  if (!state.file || !state.analysis || !state.capabilities.workers || !elements.analysisCanvas) return;
  ensureAnalysisWorker();
  const width = Math.max(320, Math.round(elements.analysisCanvas.clientWidth || 800));
  const startFrame = toFrame(state.view.startSeconds);
  const endFrame = toFrame(state.view.endSeconds || durationSeconds());
  const framesPerPixel = Math.max(1, (endFrame - startFrame) / width);
  const includeSamples = framesPerPixel <= 8;
  const previous = state.jobs.detail;
  if (previous) analysisWorker.postMessage({ type: "cancel", jobId: previous, operation: "waveform-detail" });
  const jobId = nextJobId("detail");
  state.jobs.detail = jobId;
  state.view.detailStatus = "loading";
  if (elements.detailStatus) setDetailStatus("Läser verklig detaljdata lokalt", true);
  analysisWorker.postMessage({
    type: "waveform-detail",
    jobId,
    file: state.file,
    options: { startFrame, endFrame, pixelWidth: width, maxBinDurationSeconds: (state.view.endSeconds - state.view.startSeconds) / width, includeSamples },
  });
}

function applyDetailResult(result) {
  state.view.detail = result;
  state.jobs.detail = null;
  state.view.detailStatus = result?.channels?.some((channel) => Array.isArray(channel.samples) && channel.samples.length) ? "samples" : "detail";
  const framesPerBin = finite(result?.framesPerBin) ?? 0;
  if (elements.detailStatus) setDetailStatus(state.view.detailStatus === "samples" ? "Exakta samplingar" : `Detaljdata, ${framesPerBin} bildrutor per intervall`, false);
  scheduleCanvasRender();
  renderCanvasTextAlternative();
}

function scheduleDetailRequest() {
  window.clearTimeout(detailTimer);
  detailTimer = window.setTimeout(requestWaveformDetail, 160);
}

function renderCanvasTextAlternative() {
  if (!elements.canvasTextContent) return;
  const summary = state.analysis?.summary;
  if (!summary) {
    elements.canvasTextContent.innerHTML = "<p>Analysera filen för en navigerbar textöversikt.</p>";
    return;
  }
  const channels = Array.isArray(summary.channels) ? summary.channels : [];
  const markerRows = [...state.markers].sort((a, b) => a.seconds - b.seconds).map((marker) => `<li><button type="button" data-text-marker="${escapeHtml(marker.id)}">${formatTime(marker.seconds, false)}: ${escapeHtml(marker.text)}</button><span>${escapeHtml(marker.detail || "")}</span></li>`).join("") || "<li>Inga markörer</li>";
  const accessibleValue = (value, unit) => {
    const number = finite(value);
    return number === null ? "saknas" : `${formatDecimal(number, 2)} ${unit}`;
  };
  const channelRows = channels.map((channel, index) => `<tr><th>${index === 0 ? "Vänster" : index === 1 ? "Höger" : `Kanal ${index + 1}`}</th><td>${accessibleValue(channel.samplePeakDbfs, "dBFS")}</td><td>${accessibleValue(channel.truePeakEstimateDbtp ?? channel.truePeakDbtp, "dBTP")}</td><td>${accessibleValue(channel.rmsDbfs, "dBFS")}</td></tr>`).join("");
  elements.canvasTextContent.innerHTML = `<p>Synlig vy: ${formatTime(state.view.startSeconds)} till ${formatTime(state.view.endSeconds)}.</p><table><thead><tr><th>Kanal</th><th>Sample peak</th><th>True Peak</th><th>RMS</th></tr></thead><tbody>${channelRows}</tbody></table><h3>Markörer</h3><ol>${markerRows}</ol>`;
}

function renderAnalysisSummary() {
  const summary = state.analysis?.summary || {};
  const lufs = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  const lra = finite(summary.loudnessRangeLu ?? summary.lra);
  const balance = finite(summary.channelBalanceDb ?? summary.stereoBalanceDb);
  $("#metricLufs").textContent = lufs === null ? "ej analyserat" : `${formatDecimal(lufs, 1)} LUFS`;
  $("#metricPeak").textContent = peak === null ? "ej analyserat" : `${formatDecimal(peak, 1)} dBTP`;
  $("#metricLra").textContent = lra === null ? "ej analyserat" : `${formatDecimal(lra, 1)} LU`;
  $("#metricBalance").textContent = balance === null ? "ej analyserat" : `${balance >= 0 ? "L " : "R "}${formatDecimal(Math.abs(balance), 1)} dB`;
  updateProjectedMetrics();
  renderDeepMeasurements();
  renderAssessmentReflection();
  updateExportRecommendation();
}

const assessmentProfiles = {
  "soundscape-quiet": {
    label: "lågmält soundscape",
    bands: [-30, -24, -18, -14],
    reference: "Det interna publiceringsintervallet är försiktigt och lämnar plats för naturlig stillhet.",
  },
  "soundscape-active": {
    label: "stadsmiljö eller evenemang",
    bands: [-27, -21, -16, -12],
    reference: "Aktiva miljöer kan normalt bära en högre integrerad nivå än ett lågmält soundscape.",
  },
  interview: {
    label: "intervju eller tal",
    bands: [-24, -20, -16, -13],
    reference: "Tal behöver oftast ligga jämnare och högre än ett stilla ljudlandskap för att vara lätt att följa.",
  },
  music: {
    label: "musikframträdande",
    bands: [-24, -19, -14, -10],
    reference: "Musik varierar kraftigt mellan genrer. Intervallet är endast en grov orientering.",
  },
  other: {
    label: "annan inspelning",
    bands: [-28, -22, -16, -12],
    reference: "Utan en mer specifik typ används ett brett orienteringsintervall.",
  },
  objective: {
    label: "objektiv mätning",
    bands: null,
    reference: "Ingen nivåklassificering görs när endast objektiv mätning är vald.",
  },
};

function levelClass(value, bands) {
  if (value === null || !bands) return null;
  if (value < bands[0]) return { label: "Mycket låg", key: "very-low" };
  if (value < bands[1]) return { label: "Ganska låg", key: "low" };
  if (value <= bands[2]) return { label: "Inom referensområdet", key: "reference" };
  if (value <= bands[3]) return { label: "Ganska hög", key: "high" };
  return { label: "Mycket hög", key: "very-high" };
}

function renderAssessmentReflection() {
  if (!elements.assessmentHeadline) return;
  const profile = assessmentProfiles[state.assessment.recordingType] || assessmentProfiles.other;
  const summary = state.analysis?.summary || {};
  const integrated = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  const lra = finite(summary.loudnessRangeLu ?? summary.lra);
  const plr = finite(summary.plrEstimateLu) ?? (integrated === null || peak === null ? null : peak - integrated);
  const overrange = finite(summary.overrangeSamples) ?? 0;
  const invalid = finite(summary.nonFiniteSamples) ?? 0;

  if (!state.analysis) {
    elements.assessmentStatus.textContent = "Väntar på analys";
    elements.assessmentHeadline.textContent = "Första reflektion visas efter analysen";
    elements.assessmentSummary.textContent = "Verktyget väger samman nivå, dynamik, toppmarginal och signalintegritet enligt tydliga regler.";
    elements.assessmentActions.replaceChildren();
    elements.assessmentActionPlan.hidden = true;
    return;
  }

  if (state.assessment.purpose === "preservation" || state.assessment.recordingType === "objective") {
    elements.assessmentStatus.textContent = state.assessment.purpose === "preservation" ? "Arkivbedömning" : "Objektiv mätning";
    elements.assessmentHeadline.textContent = state.assessment.purpose === "preservation"
      ? "Ingen publiceringsnivå behöver eftersträvas i originalet"
      : "Mätvärdena visas utan nivåklassificering";
    const peakText = peak === null ? "Toppmarginal saknas." : `Det orienterande True Peak-estimatet är ${formatDecimal(peak, 1)} dBTP.`;
    elements.assessmentSummary.textContent = `${peakText} Bevara originalfilen och gör nivåval i en separat arbetskopia. ${profile.reference}`;
  } else if (integrated === null) {
    elements.assessmentStatus.textContent = "Kan inte klassificeras";
    elements.assessmentHeadline.textContent = "Ingen stabil integrerad loudness kunde beräknas";
    elements.assessmentSummary.textContent = "Materialet kan ligga under loudnessgrinden eller sakna tillräckligt giltigt signalinnehåll. Bedöm tidslinjen och lyssna innan någon nivåändring.";
  } else {
    const rating = levelClass(integrated, profile.bands);
    elements.assessmentStatus.textContent = rating.label;
    elements.assessmentHeadline.textContent = `${rating.label} nivå för ${profile.label}`;
    const dynamics = lra === null
      ? "Dynamisk spridning kan inte klassificeras."
      : lra >= 12
        ? "Den dynamiska spridningen är stor."
        : lra >= 6
          ? "Den dynamiska spridningen är måttlig."
          : "Den dynamiska spridningen är begränsad.";
    const peakText = peak === null
      ? "Toppmarginalen saknar värde."
      : peak > -1
        ? "Det orienterande toppvärdet ligger nära eller över en försiktig leveransmarginal."
        : peak < -8
          ? "Det finns gott om orienterande toppmarginal."
          : "Den orienterande toppmarginalen är användbar men bör kontrolleras före positiv gain.";
    elements.assessmentSummary.textContent = `${profile.reference} ${dynamics} ${peakText}`;
  }

  const actions = [];
  if (invalid > 0) actions.push("Prioritet: kontrollera ogiltiga floatvärden");
  if (overrange > 0) actions.push("Kontrollera float overrange före PCM export");
  if (plr !== null && plr >= 14) actions.push("Stor toppdynamik: undvik automatisk kompression");
  if (peak !== null && integrated !== null && state.assessment.purpose === "distribution") {
    const rating = levelClass(integrated, profile.bands);
    const available = Math.max(0, -2 - peak);
    if (rating && ["very-low", "low"].includes(rating.key) && available >= 0.5) {
      const desired = Math.max(0, profile.bands[1] - integrated);
      const trial = Math.min(desired, available, 6);
      if (trial >= 0.5) actions.push(`Prova högst cirka +${formatDecimal(trial, 1)} dB och lyssna`);
    }
    if (rating && ["high", "very-high"].includes(rating.key)) actions.push("Ingen nivåhöjning rekommenderas");
  }
  if (!actions.length) actions.push("Lyssna i hörlurar och vid låg högtalarvolym");
  elements.assessmentActions.innerHTML = actions.map((action, index) => `<li><span>${index + 1}</span><p>${escapeHtml(action)}</p></li>`).join("");
  elements.assessmentActionCount.textContent = `${actions.length} ${actions.length === 1 ? "förslag" : "förslag"}`;
  elements.assessmentActionPlan.hidden = false;
}

function updateExportRecommendation() {
  if (!elements.exportRecommendationText) return;
  if (!state.file) {
    elements.exportRecommendationText.textContent = "Öppna och analysera en fil för en rekommendation före export.";
    return;
  }
  if (!state.trimEditor.applied) {
    elements.exportRecommendationText.textContent = "Det placerade A/B-fönstret är inte tillämpat. Lås det och välj om allt utanför ska trimmas bort.";
    return;
  }
  const changes = [];
  const trimmed = state.trim.startFrame > 0 || state.trim.endFrame < toFrame(durationSeconds());
  if (trimmed) changes.push("trimning");
  if (state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0) changes.push("toningar");
  if (Math.abs(state.trim.gainDb) > 1e-9) changes.push("global gain");
  const decision = decisionMeasurement();
  const peak = analysisTruePeakDbtp();
  const predicted = peak === null ? null : peak + decision.gainAdjustmentDb;
  if (!changes.length) {
    elements.exportRecommendationText.textContent = "Inga bearbetningar är valda. Hela filen kan bevaras utan omräkning av ljudsamplingarna.";
  } else if (decision.stage === "waiting") {
    elements.exportRecommendationText.textContent = `Valt: ${changes.join(", ")}. Beräknar aktuellt exporturval innan rekommendationen visas.`;
  } else if (predicted !== null && predicted > 0) {
    elements.exportRecommendationText.textContent = `Valt: ${changes.join(", ")}. Det orienterande toppestimatet ligger över 0 dBTP. Sänk den synliga globala gainen före export. Ingen dold toppsänkning görs.`;
  } else {
    const ditherText = state.fileInfo?.encoding === "PCM" && changes.some(item => item !== "trimning")
      ? "PCM samplingarna räknas om med TPDF dither."
      : "Exportmotorn gör en ny toppförkontroll på exakt valt utsnitt.";
    const seriesText = predicted !== null && predicted > state.series.ceilingDbtp
      ? ` Det ligger över den frivilliga serieorienteringen ${formatDecimal(state.series.ceilingDbtp, 1)} dBTP, men innebär inte i sig teknisk klamprisk.` : "";
    elements.exportRecommendationText.textContent = `Valt: ${changes.join(", ")}. ${ditherText}${seriesText} Provlyssna den sparade filen.`;
  }
}

function renderDeepMeasurements() {
  const summary = state.analysis?.summary || {};
  const channels = Array.isArray(summary.channels) ? summary.channels : [];
  const integrated = finite(summary.integratedLufs ?? summary.lufsI);
  const truePeak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  const samplePeak = finite(summary.samplePeakDbfs ?? summary.samplePeak);
  const highestPeakChannel = [...channels].sort((left, right) => (finite(right.samplePeak) ?? -Infinity) - (finite(left.samplePeak) ?? -Infinity))[0];
  const set = (selector, text) => { const element = $(selector); if (element) element.textContent = text; };
  const db = (value, unit = "dB") => finite(value) === null ? "saknas" : `${formatDecimal(value, 2)} ${unit}`;
  set("#deepMomentary", db(summary.momentaryMaxLufs, "LUFS"));
  set("#deepShortTerm", db(summary.shortTermMaxLufs, "LUFS"));
  set("#deepIntegrated", db(integrated, "LUFS"));
  set("#deepLra", db(summary.loudnessRangeLu ?? summary.lra, "LU"));
  set("#deepPlr", integrated === null || truePeak === null ? "saknas" : `${formatDecimal(truePeak - integrated, 2)} dB`);
  set("#deepSamplePeak", db(samplePeak, "dBFS"));
  set("#deepSamplePeakTime", finite(highestPeakChannel?.samplePeakTimeSeconds) === null ? "saknas" : formatTime(highestPeakChannel.samplePeakTimeSeconds));
  set("#deepTruePeak", db(truePeak, "dBTP"));
  set("#deepRms", db(summary.rmsDbfs, "dBFS"));
  set("#deepCrest", db(summary.crestFactorDb, "dB"));
  set("#deepCorrelation", finite(summary.correlation) === null ? "saknas" : formatDecimal(summary.correlation, 4));
  set("#deepChannelBalance", db(summary.channelBalanceDb, "dB"));
  set("#deepMidSide", db(summary.midSideRatioDb, "dB"));
  const monoSummary = state.regionAnalysis?.processed?.summary || null;
  const mono = monoSummary?.monoCompatibility || {};
  const monoWaiting = Boolean(state.analysis && !monoSummary && !["error", "cancelled"].includes(state.regionStatus));
  set("#deepMonoDelta", monoWaiting ? "beräknar urval" : db(mono.energyDeltaDb, "dB"));
  set("#deepMonoPeak", monoWaiting ? "beräknar urval" : db(mono.samplePeakDbfs, "dBFS"));
  set("#deepNegativeCorrelation", monoWaiting ? "beräknar urval" : finite(mono.negativeCorrelationPercent) === null ? "saknas" : `${formatDecimal(mono.negativeCorrelationPercent, 1)} % · ${Array.isArray(mono.negativeCorrelationRegions) ? mono.negativeCorrelationRegions.length : 0} regioner`);
  set("#deepDcLeft", finite(channels[0]?.dcOffset) === null ? "saknas" : Number(channels[0].dcOffset).toExponential(4));
  set("#deepDcRight", finite(channels[1]?.dcOffset) === null ? (channels.length === 1 ? "mono" : "saknas") : Number(channels[1].dcOffset).toExponential(4));
  set("#deepOverrange", finite(summary.overrangeSamples) === null ? "saknas" : `${Number(summary.overrangeSamples).toLocaleString("sv-SE")} samplingar`);
  set("#deepInvalid", finite(summary.nonFiniteSamples) === null ? "saknas" : `${Number(summary.nonFiniteSamples).toLocaleString("sv-SE")} samplingar`);

  const validation = state.analysis?.validation;
  const validationElement = $("#measurementValidation");
  if (validationElement && validation) {
    const parts = [validation.loudnessStatus, validation.truePeakStatus, validation.lraStatus].filter(Boolean);
    validationElement.innerHTML = `<span class="validation-dot" aria-hidden="true"></span><p><strong>Valideringsstatus.</strong> ${parts.map(escapeHtml).join(" ")}</p>`;
  } else if (validationElement) {
    validationElement.innerHTML = '<span class="validation-dot" aria-hidden="true"></span><p><strong>Valideringsstatus visas efter analys.</strong> Motorn klarar relevanta officiella EBU- och ITU-testfall, men ett mätresultat är inte i sig en leveransgaranti.</p>';
  }
}

function normalizeObservations() {
  const raw = Array.isArray(state.analysis?.observations) ? state.analysis.observations : [];
  return raw.map((item, index) => {
    if (typeof item === "string") return { id: `observation-${index}`, title: "Observation", message: item, severity: "neutral" };
    return {
      id: item.id || `observation-${index}`,
      title: item.title || item.label || "Observation",
      message: item.message || item.description || "",
      severity: item.severity || item.type || "neutral",
    };
  });
}

function renderObservations() {
  const observations = normalizeObservations();
  elements.observationCount.textContent = String(observations.length);
  if (!observations.length) {
    const message = state.analysis ? "Analysen gav inga särskilda tekniska observationer." : "Observationer visas när analysen är klar.";
    elements.observationList.innerHTML = `<div class="empty-state-small"><p>${escapeHtml(message)}</p></div>`;
    return;
  }
  elements.observationList.innerHTML = observations.map((item) => {
    const tone = /warning|technical|error|high/i.test(item.severity) ? "is-technical" : /info|neutral/i.test(item.severity) ? "is-neutral" : "";
    return `<article class="observation-item ${tone}"><i class="observation-dot" aria-hidden="true"></i><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p></div></article>`;
  }).join("");
}

function renderMarkers() {
  const markerTypes = new Set(["descriptive", "technical", "privacy", "keep", "remove", "chapter", "user", "note"]);
  state.markers = (Array.isArray(state.markers) ? state.markers : []).map((marker, index) => {
    const seconds = finite(marker?.seconds);
    if (seconds === null) return null;
    return {
      id: String(marker?.id || `imported-marker-${index}`),
      seconds: Math.max(0, seconds),
      endSeconds: Math.max(0, finite(marker?.endSeconds) ?? seconds),
      type: markerTypes.has(marker?.type) ? marker.type : "user",
      machineKind: marker?.machineKind || marker?.kind || null,
      text: String(marker?.text ?? marker?.label ?? "Markör"),
      detail: String(marker?.detail ?? ""),
      severity: ["critical", "review", "info"].includes(marker?.severity) ? marker.severity : /warning|error|critical/i.test(marker?.severity || "") ? "critical" : /notice|technical/i.test(marker?.severity || "") ? "review" : "info",
      channel: marker?.channel ?? null,
      objective: marker?.objective !== false,
      origin: String(marker?.origin || (marker?.suggested ? "analysis" : "user")),
      reviewStatus: ["unreviewed", "accepted", "false-positive"].includes(marker?.reviewStatus) ? marker.reviewStatus : "unreviewed",
      suggested: Boolean(marker?.suggested),
    };
  }).filter(Boolean);
  const sorted = [...state.markers]
    .filter((marker) => state.markerFilter === "all" || marker.severity === state.markerFilter)
    .sort((a, b) => a.seconds - b.seconds);
  if (!sorted.length) {
    elements.markerList.innerHTML = '<li class="list-placeholder">Inga markörer ännu</li>';
  } else {
    elements.markerList.innerHTML = sorted.map((marker) => `
      <li class="marker-item severity-${marker.severity}" data-marker-id="${escapeHtml(marker.id)}">
        <div class="marker-item-head"><span class="severity-label">${marker.severity === "critical" ? "Kritisk" : marker.severity === "review" ? "Granska" : "Information"}</span><time datetime="PT${Math.max(0, marker.seconds)}S">${formatTime(marker.seconds, false)}${marker.endSeconds > marker.seconds ? ` till ${formatTime(marker.endSeconds, false)}` : ""}</time></div>
        <button class="marker-jump" type="button" data-marker-jump="${String(marker.seconds)}" data-marker-id="${escapeHtml(marker.id)}"><strong>${escapeHtml(marker.text)}</strong><small>${escapeHtml(marker.detail || `${marker.objective ? "Objektiv" : "Heuristisk"} · ${marker.channel === null ? "Alla kanaler" : `Kanal ${marker.channel}`}`)}</small></button>
        <div class="marker-review"><label><span class="visually-hidden">Granskningsstatus</span><select data-marker-review="${escapeHtml(marker.id)}"><option value="unreviewed"${marker.reviewStatus === "unreviewed" ? " selected" : ""}>Ej granskad</option><option value="accepted"${marker.reviewStatus === "accepted" ? " selected" : ""}>Bekräftad</option><option value="false-positive"${marker.reviewStatus === "false-positive" ? " selected" : ""}>Falsk positiv</option></select></label>${marker.origin === "user" ? `<button class="marker-remove" type="button" data-marker-remove="${escapeHtml(marker.id)}" aria-label="Ta bort egen markör">×</button>` : ""}</div>
      </li>`).join("");
  }
  renderCanvasTextAlternative();
  scheduleCanvasRender();
}

function syncTrimEditorUi() {
  if (!elements.trimEditorState) return;
  const unlocked = Boolean(state.trimEditor.unlocked);
  const pending = !state.trimEditor.applied;
  const stateText = unlocked ? "Upplåst för placering" : pending ? "Låst, inte tillämpat" : "Låst och aktivt";
  elements.trimEditorState.textContent = stateText;
  elements.trimEditorState.className = `trim-editor-state ${unlocked ? "is-unlocked" : pending ? "is-pending" : "is-locked"}`;
  elements.trimEditorDescription.textContent = unlocked
    ? "Flytta A, B eller hela fönstret. Alla lyssningskontroller är tillgängliga. Lås fönstret när placeringen känns rätt."
    : pending
      ? "Fönstret är låst för provlyssning. Välj Trimma bort utanför A/B för att använda det, eller återgå till det aktiva urvalet."
      : "Lås upp fönstret för att flytta A och B med finger, penna, mus eller tangentbord. Inget nytt trimurval används förrän du bekräftar det.";
  elements.toggleTrimEditor.disabled = !state.file;
  elements.toggleTrimEditor.setAttribute("aria-pressed", String(unlocked));
  elements.toggleTrimEditor.textContent = unlocked ? "Lås trimfönstret" : pending ? "Lås upp igen" : "Lås upp trimfönstret";
  elements.applyTrimSelection.disabled = unlocked || !pending;
  elements.revertTrimSelection.disabled = !pending;
  $("#trimTimelineCard")?.classList.toggle("is-trim-unlocked", unlocked);
  if ($("#trimCanvasInstructions")) {
    $("#trimCanvasInstructions").textContent = unlocked
      ? "Dra A eller B för att ändra längden. Dra inne i fönstret för att flytta båda gränserna. Alt + vänster- eller högerpil flyttar hela fönstret."
      : pending
        ? "Fönstret är låst för provlyssning men ännu inte tillämpat som trimurval."
        : "Fönstret är låst. Lås upp det för att dra A, B eller hela det markerade området.";
  }
  const editingControls = [
    elements.trimWindowDurationInput,
    $("#applyWindowFromStartButton"), $("#applyWindowAtPlayheadButton"), $("#applyWindowToEndButton"),
    $("#centerWindowAtPlayheadButton"), elements.trimStartInput, elements.trimEndInput,
    $("#setStartAtPlayhead"), $("#setEndAtPlayhead"), $("#resetTrimButton"),
    ...$$('[data-move-window]'), ...$$('[data-nudge]'),
  ];
  editingControls.forEach(control => { if (control) control.disabled = !unlocked; });
  const processingControls = [
    elements.fadeInToggle, elements.fadeInNumber, elements.fadeInRange,
    elements.fadeOutToggle, elements.fadeOutNumber, elements.fadeOutRange,
    elements.gainNumber, elements.gainRange, $("#resetGainButton"),
    elements.calculateSeries, elements.previewSeries, elements.applySeries, elements.preserveSeries,
    ...$$('[data-fade-preset]'),
  ];
  processingControls.forEach(control => {
    if (control && (unlocked || pending)) control.disabled = true;
  });
  if (!unlocked && !pending) {
    elements.gainNumber.disabled = false;
    elements.gainRange.disabled = false;
    $("#resetGainButton").disabled = false;
  }
}

function markTrimCandidateChanged(message = "Trimfönstret har flyttats men är ännu inte tillämpat.") {
  state.trimEditor.applied = false;
  state.dirty = true;
  if (elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = "Väntar på att trimfönstret tillämpas";
  syncTrimEditorUi();
  syncTrimHud();
  updateProjectedMetrics();
  updateExportRecommendation();
  syncTrimWindowUi(message);
  emitState("trim-candidate-changed");
}

function toggleTrimEditor() {
  if (!state.file) return;
  state.trimEditor.unlocked = !state.trimEditor.unlocked;
  if (state.trimEditor.unlocked) stopPlayback();
  if (!state.trimEditor.unlocked && state.trimEditor.applied) {
    syncFadeUi();
    syncSeriesUi();
  }
  syncTrimEditorUi();
  scheduleCanvasRender();
  showToast(state.trimEditor.unlocked
    ? "Trimfönstret är upplåst. Dra med finger, penna eller mus och provlyssna med kontrollerna."
    : state.trimEditor.applied
      ? "Trimfönstret är låst."
      : "Trimfönstret är låst för provlyssning. Det är ännu inte tillämpat.");
}

function requireTrimEditorUnlocked() {
  if (state.trimEditor.unlocked) return true;
  showToast("Lås upp trimfönstret först.", "error");
  elements.toggleTrimEditor?.focus();
  return false;
}

function applyTrimSelection() {
  if (state.trimEditor.unlocked) {
    showToast("Lås trimfönstret innan du tillämpar urvalet.", "error");
    return;
  }
  if (state.trimEditor.applied) return;
  state.trim.startFrame = toFrame(state.trim.startSeconds);
  state.trim.endFrame = toFrame(state.trim.endSeconds);
  state.trimEditor.appliedStartSeconds = state.trim.startSeconds;
  state.trimEditor.appliedEndSeconds = state.trim.endSeconds;
  state.trimEditor.applied = true;
  invalidateSeriesProposal();
  markEditChanged("trim-selection-applied");
  syncTrimUi({ emit: false });
  syncTrimEditorUi();
  syncTrimWindowUi(`Aktivt trimurval: ${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)}. Vid export tas allt utanför bort.`);
  showToast("A/B är nu aktivt trimurval. Originalfilen ändras inte.");
  emitState("trim-selection-applied");
}

function revertTrimSelection() {
  if (state.trimEditor.applied) return;
  stopPlayback();
  state.trim.startSeconds = state.trimEditor.appliedStartSeconds;
  state.trim.endSeconds = state.trimEditor.appliedEndSeconds || durationSeconds();
  state.trimEditor.unlocked = false;
  state.trimEditor.applied = true;
  syncTrimUi({ emit: false });
  syncTrimEditorUi();
  syncTrimWindowUi("Det senast aktiva trimurvalet har återställts.");
  showToast("Det tillfälliga trimfönstret återställdes.");
  emitState("trim-candidate-reverted");
}

function syncTrimUi({ emit = true } = {}) {
  const duration = durationSeconds();
  state.trim.startSeconds = clamp(state.trim.startSeconds, 0, Math.max(0, duration));
  state.trim.endSeconds = clamp(state.trim.endSeconds || duration, state.trim.startSeconds, duration);
  state.trim.startFrame = toFrame(state.trim.startSeconds);
  state.trim.endFrame = toFrame(state.trim.endSeconds);
  elements.trimStartInput.value = formatTime(state.trim.startSeconds);
  elements.trimEndInput.value = formatTime(state.trim.endSeconds);
  elements.trimStartLabel.textContent = `A ${formatTime(state.trim.startSeconds)}`;
  elements.trimEndLabel.textContent = `B ${formatTime(state.trim.endSeconds)}`;
  elements.selectedDuration.textContent = formatTime(state.trim.endSeconds - state.trim.startSeconds);
  elements.transportDuration.textContent = formatTime(duration);
  elements.currentTime.textContent = formatTime(state.playback.currentSeconds);
  syncFadeUi();
  syncSeriesUi();
  updateExportSummary();
  syncTrimEditorUi();
  syncTrimHud();
  scheduleCanvasRender();
  if (emit) emitState("trim");
}

function syncTrimHud() {
  if (!elements.trimHudRange || !elements.trimHudDuration) return;
  const sourceDuration = durationSeconds();
  const selectedDuration = selectionDurationSeconds();
  const hasFile = Boolean(state.file && sourceDuration > 0);
  elements.trimHudRange.textContent = hasFile
    ? `A ${formatTime(state.trim.startSeconds)} · B ${formatTime(state.trim.endSeconds)}`
    : "A 00:00.000 · B 00:00.000";
  const wholeSource = hasFile && state.trim.startSeconds <= 0.0005 && Math.abs(state.trim.endSeconds - sourceDuration) <= 0.0005;
  const verifiedDuration = finite(state.verifiedExport?.format?.durationSeconds ?? state.verifiedExport?.durationSeconds ?? state.verifiedExport?.summary?.durationSeconds);
  elements.trimHudDuration.textContent = !hasFile
    ? "Ingen källfil"
    : !state.trimEditor.applied
      ? `${formatTime(selectedDuration)} placerat · inte tillämpat`
    : state.exportStatus === "complete" && verifiedDuration !== null
      ? `${formatTime(selectedDuration)} valt · verifierad fil 00:00.000 till ${formatTime(verifiedDuration)}`
      : wholeSource
        ? `Hela källfilen · mållängd ${formatTime(state.trimWindowSeconds)}`
        : `${formatTime(selectedDuration)} valt · mållängd ${formatTime(state.trimWindowSeconds)}`;
  const movable = hasFile && selectedDuration < sourceDuration - 1 / Math.max(1, sampleRate());
  elements.trimHudMoveLeft.disabled = !state.trimEditor.unlocked || !movable || state.trim.startSeconds <= 0;
  elements.trimHudMoveRight.disabled = !state.trimEditor.unlocked || !movable || state.trim.endSeconds >= sourceDuration;
  if (elements.exportSelectionMapping) {
    elements.exportSelectionMapping.textContent = !hasFile
      ? "Källan är ännu inte vald"
      : state.exportStatus === "complete" && verifiedDuration !== null
        ? `Källa ${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)} · verifierad fil 00:00.000 till ${formatTime(verifiedDuration)}`
        : `Källa ${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)} · export ${formatTime(selectedDuration)}`;
  }
}

function syncTrackControls() {
  $$("[data-track]").forEach(control => {
    const active = Boolean(state.view.tracks[control.dataset.track]);
    control.classList.toggle("is-on", active);
    control.setAttribute("aria-pressed", String(active));
  });
}

function syncTrimWindowUi(message = "") {
  const target = Math.max(1 / sampleRate(), finite(state.trimWindowSeconds) ?? 20 * 60);
  state.trimWindowSeconds = target;
  elements.trimWindowDurationInput.value = formatTime(target);
  elements.trimWindowStatus.textContent = message || `Mållängd: ${formatTime(target)}`;
}

function updateTrimWindowDuration(value) {
  const parsed = parseTime(value);
  if (parsed === null || parsed <= 0) {
    syncTrimWindowUi("Ange en längd större än noll, exempelvis 20:00.");
    showToast("Fönsterlängden kunde inte tolkas.", "error");
    return false;
  }
  state.trimWindowSeconds = parsed;
  state.dirty = true;
  syncTrimWindowUi();
  emitState("trim-window-duration");
  return true;
}

function setTrimWindowPosition(startSeconds, { commit = true } = {}) {
  if (!state.trimEditor.unlocked) return false;
  const sourceDuration = durationSeconds();
  const windowLength = Math.min(selectionDurationSeconds(), sourceDuration);
  if (!(sourceDuration > 0) || !(windowLength > 0)) return false;
  const start = clamp(startSeconds, 0, Math.max(0, sourceDuration - windowLength));
  if (Math.abs(start - state.trim.startSeconds) < 0.5 / Math.max(1, sampleRate())) return false;
  state.trim.startSeconds = start;
  state.trim.endSeconds = start + windowLength;
  syncTrimUi({ emit: false });
  if (commit) {
    markTrimCandidateChanged(`Trimfönstret placerades vid ${formatTime(start)} till ${formatTime(start + windowLength)}. Lås och provlyssna innan det tillämpas.`);
  }
  return true;
}

function moveTrimWindow(deltaSeconds, options = {}) {
  const delta = finite(deltaSeconds);
  if (delta === null || delta === 0) return false;
  return setTrimWindowPosition(state.trim.startSeconds + delta, options);
}

function centerTrimWindowAt(seconds, { commit = true } = {}) {
  const center = clamp(finite(seconds) ?? state.playback.currentSeconds, 0, durationSeconds());
  return setTrimWindowPosition(center - selectionDurationSeconds() / 2, { commit, reason: "trim-window-centered" });
}

function resizeTrimWindowToTarget() {
  if (!requireTrimEditorUnlocked()) return;
  const sourceDuration = durationSeconds();
  if (!(sourceDuration > 0)) return;
  const windowLength = Math.min(state.trimWindowSeconds, sourceDuration);
  const currentCenter = selectionDurationSeconds() > 0
    ? (state.trim.startSeconds + state.trim.endSeconds) / 2
    : state.playback.currentSeconds;
  state.trim.startSeconds = clamp(currentCenter - windowLength / 2, 0, Math.max(0, sourceDuration - windowLength));
  state.trim.endSeconds = state.trim.startSeconds + windowLength;
  syncTrimUi({ emit: false });
  markTrimCandidateChanged(`Trimfönstret är ${formatTime(windowLength)} från ${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)}. Lås det när placeringen känns rätt.`);
}

function applyTrimWindow(anchor) {
  if (!requireTrimEditorUnlocked()) return;
  if (!updateTrimWindowDuration(elements.trimWindowDurationInput.value)) return;
  const sourceDuration = durationSeconds();
  if (sourceDuration <= 0) {
    showToast("Ljudfilens längd är inte tillgänglig ännu.", "error");
    return;
  }
  const windowLength = Math.min(state.trimWindowSeconds, sourceDuration);
  let start = 0;
  if (anchor === "start") {
    start = clamp(state.trim.startSeconds, 0, Math.max(0, sourceDuration - windowLength));
  } else if (anchor === "end") {
    const end = clamp(state.trim.endSeconds || sourceDuration, windowLength, sourceDuration);
    start = end - windowLength;
  } else {
    const center = clamp(elements.audio.currentTime || state.playback.currentSeconds, 0, sourceDuration);
    start = clamp(center - windowLength / 2, 0, Math.max(0, sourceDuration - windowLength));
  }
  state.trim.startSeconds = start;
  state.trim.endSeconds = start + windowLength;
  syncTrimUi({ emit: false });
  markTrimCandidateChanged(state.trimWindowSeconds > sourceDuration
    ? `Källan är kortare än mållängden. Hela ${formatTime(sourceDuration)} valdes.`
    : `Trimfönstret är ${formatTime(windowLength)} från ${formatTime(start)} till ${formatTime(start + windowLength)}. Lås det när placeringen känns rätt.`);
}

function setBoundary(boundary, seconds) {
  if (!requireTrimEditorUnlocked()) return;
  const duration = durationSeconds();
  if (boundary === "start") {
    state.trim.startSeconds = clamp(seconds, 0, Math.max(0, state.trim.endSeconds - 1 / sampleRate()));
  } else {
    state.trim.endSeconds = clamp(seconds, Math.min(duration, state.trim.startSeconds + 1 / sampleRate()), duration);
  }
  syncTrimUi({ emit: false });
  markTrimCandidateChanged(`${boundary === "start" ? "A" : "B"} flyttades. Lås och provlyssna innan trimurvalet tillämpas.`);
}

function selectionDurationSeconds() {
  return Math.max(0, state.trim.endSeconds - state.trim.startSeconds);
}

function syncFadeUi() {
  const selectionDuration = selectionDurationSeconds();
  const rangeMaximum = Math.max(0.01, Math.min(30, selectionDuration || 30));
  const numberMaximum = Math.max(0.01, selectionDuration || 60);
  const configurations = [
    {
      key: "fadeInSeconds",
      toggle: elements.fadeInToggle,
      number: elements.fadeInNumber,
      range: elements.fadeInRange,
      controls: elements.fadeInControls,
    },
    {
      key: "fadeOutSeconds",
      toggle: elements.fadeOutToggle,
      number: elements.fadeOutNumber,
      range: elements.fadeOutRange,
      controls: elements.fadeOutControls,
    },
  ];

  configurations.forEach(({ key, toggle, number, range, controls }) => {
    const enabled = state.trim[key] > 0;
    let displayed = enabled ? state.trim[key] : finite(number.dataset.lastValue) ?? finite(number.value) ?? 1;
    displayed = clamp(displayed, 0.01, numberMaximum);
    if (enabled) state.trim[key] = displayed;
    number.dataset.lastValue = String(displayed);
    number.max = String(numberMaximum);
    number.value = displayed.toFixed(displayed < 10 ? 2 : 1);
    range.max = String(rangeMaximum);
    range.value = String(Math.min(displayed, rangeMaximum));
    toggle.checked = enabled;
    number.disabled = !enabled;
    range.disabled = !enabled;
    controls.setAttribute("aria-disabled", String(!enabled));
    $$("button", controls).forEach((button) => { button.disabled = !enabled; });
  });

  if (state.trim.fadeInSeconds + state.trim.fadeOutSeconds > selectionDuration && selectionDuration > 0) {
    elements.fadeOverlapNotice.textContent = "Toningarna överlappar. Export och medhörning följer den lägsta av de två linjära kurvorna.";
    elements.fadeOverlapNotice.classList.add("is-caution");
  } else {
    elements.fadeOverlapNotice.textContent = "Toningarna påverkar bara det valda utsnittets ytterkanter.";
    elements.fadeOverlapNotice.classList.remove("is-caution");
  }
}

function updateFade(kind, value, enabled = true) {
  const key = kind === "in" ? "fadeInSeconds" : "fadeOutSeconds";
  const number = kind === "in" ? elements.fadeInNumber : elements.fadeOutNumber;
  const maximum = Math.max(0.01, selectionDurationSeconds() || 60);
  if (!enabled) {
    if (state.trim[key] > 0) number.dataset.lastValue = String(state.trim[key]);
    state.trim[key] = 0;
  } else {
    const next = clamp(finite(value) ?? finite(number.dataset.lastValue) ?? 1, 0.01, maximum);
    state.trim[key] = next;
    number.dataset.lastValue = String(next);
  }
  syncFadeUi();
  updateExportSummary();
  updateMonitoringGraph();
  scheduleCanvasRender();
  invalidateSeriesProposal();
  markEditChanged("fade");
}

function decisionMeasurement() {
  if (state.regionAnalysis?.processed?.summary) return { summary: state.regionAnalysis.processed.summary, stage: "calculated", gainAdjustmentDb: 0 };
  const waiting = Boolean(state.analysis && !["error", "cancelled"].includes(state.regionStatus));
  return { summary: state.analysis?.summary || {}, stage: waiting ? "waiting" : "source", gainAdjustmentDb: state.trim.gainDb };
}

function analysisTruePeakDbtp() {
  const summary = decisionMeasurement().summary;
  return finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
}

function calculateSeriesProposal() {
  const summary = state.regionAnalysis?.processed?.summary || state.regionAnalysis?.summary || null;
  if (!summary) {
    requestRegionAnalysis();
    showToast("Exporturvalet beräknas först. Tryck igen när Beräknat exporturval är klart.");
    return;
  }
  const integrated = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  if (integrated === null || peak === null) {
    showToast("Analysera källan och exporturvalet innan ett nivåförslag beräknas.", "error");
    return;
  }
  const targetDelta = state.series.targetLufs - integrated;
  const peakDelta = state.series.ceilingDbtp - peak;
  state.series.proposedGainDb = Math.round((state.trim.gainDb + Math.min(targetDelta, peakDelta)) * 10) / 10;
  state.series.status = "calculated";
  syncSeriesUi();
  emitState("series-calculated");
}

function syncSeriesUi() {
  const proposal = finite(state.series.proposedGainDb);
  if (elements.seriesGainValue) elements.seriesGainValue.textContent = proposal === null ? "Inte beräknat" : `${proposal >= 0 ? "+" : ""}${formatDecimal(proposal, 1)} dB globalt`;
  const labels = { preserved: "Bevara oförändrat", calculated: "Beräknat, inte applicerat", previewing: "Provlyssnar, inte applicerat", applied: "Applicerat som synlig global gain" };
  if (elements.seriesStateValue) elements.seriesStateValue.textContent = labels[state.series.status] || labels.preserved;
  if (elements.previewSeries) elements.previewSeries.disabled = proposal === null;
  if (elements.applySeries) elements.applySeries.disabled = proposal === null;
}

function preserveSeries() {
  state.series.status = "preserved";
  state.series.proposedGainDb = null;
  state.monitoring.previewGainOverride = null;
  syncSeriesUi();
  emitState("series-preserved");
}

function updateGain(value, options = {}) {
  const gain = clamp(value, -24, 24);
  state.trim.gainDb = Math.round(gain * 10) / 10;
  if (!options.seriesApply) invalidateSeriesProposal();
  elements.gainNumber.value = state.trim.gainDb.toFixed(1);
  elements.gainRange.value = String(state.trim.gainDb);
  updateProjectedMetrics();
  updateExportSummary();
  updateMonitoringGraph();
  syncSeriesUi();
  markEditChanged("gain");
}

function updateProjectedMetrics() {
  if (!state.trimEditor.applied) {
    elements.projectedLufs.textContent = "väntar på trimval";
    elements.projectedPeak.textContent = "väntar på trimval";
    elements.gainNotice.hidden = true;
    return;
  }
  const decision = decisionMeasurement();
  const summary = decision.summary;
  const lufs = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = analysisTruePeakDbtp();
  const gain = decision.gainAdjustmentDb;
  if (decision.stage === "waiting") {
    elements.projectedLufs.textContent = "beräknar urval";
    elements.projectedPeak.textContent = "beräknar urval";
    elements.gainNotice.hidden = true;
    return;
  }
  elements.projectedLufs.textContent = lufs === null ? "saknas" : `${formatDecimal(lufs + gain, 1)} LUFS`;
  elements.projectedPeak.textContent = peak === null ? "saknas" : `${formatDecimal(peak + gain, 1)} dBTP`;
  const projectedPeak = peak === null ? null : peak + gain;
  if (projectedPeak !== null && projectedPeak > 0) {
    elements.gainNotice.hidden = false;
    elements.gainNotice.textContent = "Nivåvalet ger ett orienterande True Peak-estimat över 0 dBTP. Sänk den synliga globala gainen. Ingen dold toppsänkning görs.";
  } else {
    elements.gainNotice.hidden = true;
    elements.gainNotice.textContent = "";
  }
  syncSeriesUi();
}

function updateExportSummary() {
  const duration = Math.max(0, state.trim.endSeconds - state.trim.startSeconds);
  $("#exportFileName").textContent = state.file?.name || "Ingen fil vald";
  $("#exportDuration").textContent = formatTime(duration);
  const untrimmed = Math.abs(state.trim.startSeconds) < 0.0005 && Math.abs(state.trim.endSeconds - durationSeconds()) < 0.0005;
  $("#exportTrimSummary").textContent = untrimmed ? "Oförändrad" : `${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)}`;
  $("#exportGainSummary").textContent = `${state.trim.gainDb >= 0 ? "+" : ""}${formatDecimal(state.trim.gainDb, 1)} dB`;
  const fadeIn = state.trim.fadeInSeconds;
  const fadeOut = state.trim.fadeOutSeconds;
  $("#exportFadeSummary").textContent = fadeIn || fadeOut
    ? `In ${formatDecimal(fadeIn, fadeIn < 1 ? 2 : 1)} s, ut ${formatDecimal(fadeOut, fadeOut < 1 ? 2 : 1)} s`
    : "Av";
  $("#exportPeakSummary").textContent = "Ingen dold toppsänkning";
  updateExportRecommendation();
}

async function ensureAudioGraph() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    audioContext = new Context();
    audioSourceNode = audioContext.createMediaElementSource(elements.audio);
    previewGainNode = audioContext.createGain();
    monitorGainNode = audioContext.createGain();
    channelSplitterNode = audioContext.createChannelSplitter(2);
    channelMergerNode = audioContext.createChannelMerger(2);
    channelGainNodes = [audioContext.createGain(), audioContext.createGain()];
    audioSourceNode.connect(previewGainNode).connect(channelSplitterNode);
    channelMergerNode.connect(monitorGainNode).connect(audioContext.destination);
    configureMonitorRouting();
    elements.audio.volume = 1;
    updateMonitoringGraph();
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  return true;
}

function configureMonitorRouting() {
  if (!channelSplitterNode || !channelMergerNode) return;
  channelGainNodes.forEach((node) => { try { node.disconnect(); } catch {} });
  try { channelSplitterNode.disconnect(); } catch {}
  const leftGain = channelGainNodes[0];
  const rightGain = channelGainNodes[1];
  const mode = state.monitoring.channelMode;
  if ((state.analysis?.format?.channels ?? state.fileInfo?.channels) === 1) {
    leftGain.gain.value = 1;
    channelSplitterNode.connect(leftGain, 0);
    leftGain.connect(channelMergerNode, 0, 0);
    leftGain.connect(channelMergerNode, 0, 1);
    return;
  }
  leftGain.gain.value = mode === "mono" ? 0.5 : 1;
  rightGain.gain.value = mode === "mono" ? 0.5 : 1;
  if (mode === "stereo") {
    channelSplitterNode.connect(leftGain, 0); leftGain.connect(channelMergerNode, 0, 0);
    channelSplitterNode.connect(rightGain, 1); rightGain.connect(channelMergerNode, 0, 1);
  } else if (mode === "left") {
    channelSplitterNode.connect(leftGain, 0); leftGain.connect(channelMergerNode, 0, 0); leftGain.connect(channelMergerNode, 0, 1);
  } else if (mode === "right") {
    channelSplitterNode.connect(rightGain, 1); rightGain.connect(channelMergerNode, 0, 0); rightGain.connect(channelMergerNode, 0, 1);
  } else {
    channelSplitterNode.connect(leftGain, 0); channelSplitterNode.connect(rightGain, 1);
    leftGain.connect(channelMergerNode, 0, 0); leftGain.connect(channelMergerNode, 0, 1);
    rightGain.connect(channelMergerNode, 0, 0); rightGain.connect(channelMergerNode, 0, 1);
  }
}

function fadeGeometry() {
  const rate = sampleRate();
  const edit = state.monitoring.previewMode === "export" && state.monitoring.previewEditOverride
    ? state.monitoring.previewEditOverride
    : state.trim;
  const startFrame = edit === state.trim ? state.trim.startFrame : Math.round(edit.startSeconds * rate);
  const endFrame = edit === state.trim ? state.trim.endFrame : Math.round(edit.endSeconds * rate);
  const totalFrames = Math.max(0, endFrame - startFrame);
  const fadeInFrames = Math.min(totalFrames, Math.max(0, Math.round(edit.fadeInSeconds * rate)));
  const fadeOutFrames = Math.min(totalFrames, Math.max(0, Math.round(edit.fadeOutSeconds * rate)));
  return {
    rate,
    start: startFrame / rate,
    end: endFrame / rate,
    fadeInFrames,
    fadeOutFrames,
    fadeInEnd: startFrame / rate + Math.max(0, fadeInFrames - 1) / rate,
    fadeOutStart: endFrame / rate - fadeOutFrames / rate,
    fadeOutEnd: endFrame / rate - 1 / rate,
  };
}

function fadeEnvelopeAt(mediaSeconds, geometry = fadeGeometry()) {
  if (mediaSeconds < geometry.start || mediaSeconds >= geometry.end) return 0;
  let envelope = 1;
  if (geometry.fadeInFrames > 0 && mediaSeconds <= geometry.fadeInEnd) {
    const span = geometry.fadeInEnd - geometry.start;
    envelope = Math.min(envelope, span > 0 ? (mediaSeconds - geometry.start) / span : 0);
  }
  if (geometry.fadeOutFrames > 0 && mediaSeconds >= geometry.fadeOutStart) {
    const span = geometry.fadeOutEnd - geometry.fadeOutStart;
    envelope = Math.min(envelope, span > 0 ? (geometry.fadeOutEnd - mediaSeconds) / span : 0);
  }
  return clamp(envelope, 0, 1);
}

function previewEnvelopeBreakpoints(geometry = fadeGeometry()) {
  const points = [geometry.start, geometry.fadeInEnd, geometry.fadeOutStart, geometry.fadeOutEnd, geometry.end];
  if (geometry.fadeInFrames === 1) points.push(geometry.start + 1 / geometry.rate);
  if (geometry.fadeOutFrames === 1) points.push(geometry.fadeOutStart - 1 / geometry.rate);
  const inSpan = geometry.fadeInEnd - geometry.start;
  const outSpan = geometry.fadeOutEnd - geometry.fadeOutStart;
  if (inSpan > 0 && outSpan > 0) {
    const intersection = (inSpan * geometry.fadeOutEnd + outSpan * geometry.start) / (inSpan + outSpan);
    if (intersection >= Math.max(geometry.start, geometry.fadeOutStart)
      && intersection <= Math.min(geometry.fadeInEnd, geometry.fadeOutEnd)) points.push(intersection);
  }
  return [...new Set(points.filter(Number.isFinite))].sort((left, right) => left - right);
}

function schedulePreviewEnvelope(mediaSeconds = finite(elements.audio.currentTime) ?? state.trim.startSeconds) {
  if (!previewGainNode || !audioContext) return;
  const now = audioContext.currentTime;
  const geometry = fadeGeometry();
  const sourceMode = state.monitoring.previewMode === "source";
  const previewDb = sourceMode || state.monitoring.levelMatched ? 0 : (finite(state.monitoring.previewGainOverride) ?? state.trim.gainDb);
  const baseGain = 10 ** (previewDb / 20);
  const playbackRate = Math.max(0.01, finite(elements.audio.playbackRate) ?? 1);
  const parameter = previewGainNode.gain;
  parameter.cancelScheduledValues(now);
  if (sourceMode) {
    parameter.setValueAtTime(1, now);
    return;
  }
  parameter.setValueAtTime(baseGain * fadeEnvelopeAt(mediaSeconds, geometry), now);
  previewEnvelopeBreakpoints(geometry)
    .filter((point) => point > mediaSeconds)
    .forEach((point) => {
      const contextTime = now + (point - mediaSeconds) / playbackRate;
      const value = baseGain * fadeEnvelopeAt(point, geometry);
      const isHardStart = point === geometry.start && geometry.fadeInFrames === 0;
      const isHardEnd = point === geometry.end && geometry.fadeOutFrames === 0;
      if (isHardStart || isHardEnd) parameter.setValueAtTime(value, contextTime);
      else parameter.linearRampToValueAtTime(value, contextTime);
    });
}

function updateMonitoringGraph() {
  const now = audioContext?.currentTime ?? 0;
  schedulePreviewEnvelope();
  monitorGainNode?.gain.setTargetAtTime(state.monitoring.volume, now, 0.015);
  configureMonitorRouting();
  if (!audioContext) elements.audio.volume = state.monitoring.volume;
}

async function playFrom(seconds) {
  if (!state.file) return;
  await ensureAudioGraph();
  elements.audio.currentTime = clamp(seconds, 0, durationSeconds());
  schedulePreviewEnvelope(elements.audio.currentTime);
  elements.audio.play().catch((error) => showToast(`Uppspelningen kunde inte starta: ${error.message}`, "error"));
}

function stopPlayback() {
  elements.audio.pause();
  state.playback.playing = false;
  state.playback.previewStopAt = null;
  elements.playButton?.classList.remove("is-playing");
  elements.playButton?.setAttribute("aria-label", "Spela");
}

async function togglePlayback() {
  if (elements.audio.paused) {
    await ensureAudioGraph();
    const current = finite(elements.audio.currentTime) ?? 0;
    if (state.monitoring.previewMode === "export" && (current < state.trim.startSeconds || current >= state.trim.endSeconds)) elements.audio.currentTime = state.trim.startSeconds;
    schedulePreviewEnvelope(elements.audio.currentTime);
    elements.audio.play().catch((error) => showToast(`Uppspelningen kunde inte starta: ${error.message}`, "error"));
  } else {
    stopPlayback();
  }
}

function previewBoundary(boundary) {
  const point = boundary === "start" ? state.trim.startSeconds : state.trim.endSeconds;
  const start = clamp(point - 1.5, 0, durationSeconds());
  state.playback.previewStopAt = clamp(point + 1.5, 0, durationSeconds());
  playFrom(start);
}

function canvasMetrics(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
}

function drawLineSeries(context, values, xAtIndex, yAtValue, color, width = 1.4) {
  if (!Array.isArray(values) || !values.length) return;
  context.beginPath();
  let drawing = false;
  const step = Math.max(1, Math.floor(values.length / 5000));
  for (let index = 0; index < values.length; index += step) {
    const value = finite(values[index]);
    if (value === null) {
      drawing = false;
      continue;
    }
    const x = xAtIndex(index);
    const y = yAtValue(value);
    if (!drawing) context.moveTo(x, y);
    else context.lineTo(x, y);
    drawing = true;
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.stroke();
}

function drawTimeline(canvas, trimMode = false) {
  if (!canvas) return;
  const { context, width, height } = canvasMetrics(canvas);
  const analysis = state.analysis;
  const fullDuration = Math.max(0.001, durationSeconds());
  const compactExport = canvas === elements.exportTrimCanvas;
  const viewStart = compactExport ? 0 : clamp(state.view.startSeconds, 0, fullDuration);
  const viewEnd = compactExport ? fullDuration : clamp(state.view.endSeconds || fullDuration, viewStart + 0.001, fullDuration);
  const viewDuration = viewEnd - viewStart;
  const labelWidth = width < 520 ? 44 : 58;
  const plotLeft = labelWidth;
  const plotRight = width - 10;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const xAtTime = (seconds) => plotLeft + (seconds - viewStart) / viewDuration * plotWidth;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0c1728";
  context.fillRect(0, 0, width, height);

  const visibleTracks = compactExport
    ? ["waveform", "markers"]
    : Object.entries(state.view.tracks).filter(([, visible]) => visible).map(([name]) => name);
  const weights = { waveform: compactExport ? 0.86 : trimMode ? 0.55 : 0.47, loudness: 0.25, peaks: 0.15, correlation: 0.14, markers: compactExport ? 0.14 : 0.08 };
  const totalWeight = visibleTracks.reduce((sum, track) => sum + weights[track], 0) || 1;
  let cursorY = 0;
  const tracks = {};
  visibleTracks.forEach((track, index) => {
    const trackHeight = index === visibleTracks.length - 1 ? height - cursorY : height * weights[track] / totalWeight;
    tracks[track] = { top: cursorY, height: trackHeight, bottom: cursorY + trackHeight };
    cursorY += trackHeight;
  });

  context.save();
  context.strokeStyle = "rgba(255,255,255,.075)";
  context.lineWidth = 1;
  const gridCount = width < 600 ? 4 : 8;
  for (let index = 0; index <= gridCount; index += 1) {
    const x = plotLeft + plotWidth * index / gridCount;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    const seconds = viewStart + viewDuration * index / gridCount;
    context.fillStyle = "rgba(255,255,255,.43)";
    context.font = "10px ui-monospace, SFMono-Regular, monospace";
    context.fillText(formatTime(seconds, false), Math.min(x + 4, plotRight - 40), height - 6);
  }
  context.restore();

  Object.entries(tracks).forEach(([name, track], index) => {
    if (index > 0) {
      context.strokeStyle = "rgba(255,255,255,.13)";
      context.beginPath();
      context.moveTo(0, track.top);
      context.lineTo(width, track.top);
      context.stroke();
    }
    context.fillStyle = "rgba(255,255,255,.53)";
    context.font = "600 9px ui-sans-serif, system-ui";
    const label = { waveform: "L / R", loudness: "LUFS", peaks: "TOPP", correlation: "KORR", markers: "MARKÖR" }[name];
    context.fillText(label, 7, track.top + 15);
  });

  if (analysis && tracks.waveform) {
    const detail = state.view.detail;
    const detailMatches = detail && toSeconds(detail.startFrame) <= viewStart + 0.001 && toSeconds(detail.endFrame) >= viewEnd - 0.001;
    const channels = detailMatches ? (detail.channels || []) : (analysis.waveform?.channels || []);
    const bins = channels[0]?.min?.length ?? finite(analysis.waveform?.bins) ?? 0;
    const dataStart = detailMatches ? toSeconds(detail.startFrame) : 0;
    const dataEnd = detailMatches ? toSeconds(detail.endFrame) : fullDuration;
    const track = tracks.waveform;
    const channelCount = Math.max(1, channels.length);
    channels.slice(0, 2).forEach((channel, channelIndex) => {
      const center = track.top + track.height * (channelIndex + 0.5) / channelCount;
      const half = track.height * 0.39 / channelCount;
      const minSeries = channel.min || [];
      const maxSeries = channel.max || [];
      const color = channelIndex === 0 ? "rgba(89,151,209,.88)" : "rgba(154,126,207,.78)";
      context.strokeStyle = color;
      context.lineWidth = Math.max(0.7, plotWidth / Math.max(1, bins));
      context.beginPath();
      const startBin = Math.max(0, Math.floor((viewStart - dataStart) / Math.max(0.001, dataEnd - dataStart) * bins));
      const endBin = Math.min(bins, Math.ceil((viewEnd - dataStart) / Math.max(0.001, dataEnd - dataStart) * bins));
      const step = Math.max(1, Math.floor((endBin - startBin) / Math.max(plotWidth, 1)));
      for (let index = startBin; index < endBin; index += step) {
        const seconds = dataStart + index / Math.max(1, bins - 1) * (dataEnd - dataStart);
        const x = xAtTime(seconds);
        const minimum = clamp(finite(minSeries[index]) ?? 0, -1.35, 1.35);
        const maximum = clamp(finite(maxSeries[index]) ?? 0, -1.35, 1.35);
        context.moveTo(x, center - maximum * half);
        context.lineTo(x, center - minimum * half);
      }
      context.stroke();
      const sampleChannel = detailMatches ? channel : null;
      if (sampleChannel?.samples?.length && sampleChannel.samples.length <= plotWidth * 12) {
        context.beginPath();
        Array.from(sampleChannel.samples).forEach((value, sampleIndex) => {
          const x = plotLeft + sampleIndex / Math.max(1, sampleChannel.samples.length - 1) * plotWidth;
          const y = center - clamp(value, -1.35, 1.35) * half;
          if (sampleIndex) context.lineTo(x, y); else context.moveTo(x, y);
        });
        context.strokeStyle = color;
        context.lineWidth = 1.25;
        context.stroke();
      }
      context.strokeStyle = "rgba(255,255,255,.12)";
      context.beginPath();
      context.moveTo(plotLeft, center);
      context.lineTo(plotRight, center);
      context.stroke();
    });
  } else if (tracks.waveform) {
    const track = tracks.waveform;
    context.strokeStyle = "rgba(255,255,255,.13)";
    context.beginPath();
    context.moveTo(plotLeft, track.top + track.height / 2);
    context.lineTo(plotRight, track.top + track.height / 2);
    context.stroke();
  }

  if (analysis && tracks.loudness) {
    const timelines = analysis.timelines || analysis.timeline || {};
    const interval = finite(timelines.intervalSeconds) ?? 0.1;
    const count = Math.max(timelines.momentaryLufs?.length || 0, timelines.shortTermLufs?.length || 0, timelines.integratedLufs?.length || 0);
    const xAtIndex = (index) => xAtTime((timelines.timeSeconds?.[index] ?? (index + 1) * interval));
    const track = tracks.loudness;
    const yAtValue = (value) => track.top + 7 + (clamp(value, -70, -5) + 70) / 65 * -(track.height - 14) + (track.height - 14);
    context.save();
    context.beginPath();
    context.rect(plotLeft, track.top, plotWidth, track.height);
    context.clip();
    if (count) {
      drawLineSeries(context, timelines.momentaryLufs, xAtIndex, yAtValue, "rgba(150,115,214,.72)", 1);
      drawLineSeries(context, timelines.shortTermLufs, xAtIndex, yAtValue, "rgba(67,183,184,.92)", 1.4);
      drawLineSeries(context, timelines.integratedLufs, xAtIndex, yAtValue, "rgba(226,171,71,.94)", 1.5);
    }
    context.restore();
  }

  if (analysis && tracks.peaks) {
    const timelines = analysis.timelines || {};
    const interval = finite(timelines.intervalSeconds) ?? 0.1;
    const track = tracks.peaks;
    const xAtIndex = (index) => xAtTime(timelines.timeSeconds?.[index] ?? (index + 1) * interval);
    const yAtValue = (value) => track.bottom - 5 - (clamp(value, -60, 6) + 60) / 66 * (track.height - 10);
    context.save();
    context.beginPath();
    context.rect(plotLeft, track.top, plotWidth, track.height);
    context.clip();
    drawLineSeries(context, timelines.samplePeakDbfs, xAtIndex, yAtValue, "rgba(84,205,197,.92)", 1.2);
    const zeroY = yAtValue(0);
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(229,116,88,.65)";
    context.beginPath();
    context.moveTo(plotLeft, zeroY);
    context.lineTo(plotRight, zeroY);
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  if (analysis && tracks.correlation) {
    const timelines = analysis.timelines || {};
    const values = timelines.correlation || [];
    const interval = finite(timelines.intervalSeconds) ?? 0.1;
    const track = tracks.correlation;
    const xAtIndex = (index) => xAtTime(timelines.timeSeconds?.[index] ?? (index + 1) * interval);
    const yAtValue = (value) => track.top + 6 + (1 - (clamp(value, -1, 1) + 1) / 2) * (track.height - 12);
    context.save();
    context.beginPath();
    context.rect(plotLeft, track.top, plotWidth, track.height);
    context.clip();
    const riskY = yAtValue(-0.25);
    context.fillStyle = "rgba(238,91,77,.10)";
    context.fillRect(plotLeft, riskY, plotWidth, track.bottom - riskY);
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(255,255,255,.22)";
    context.beginPath();
    context.moveTo(plotLeft, yAtValue(0));
    context.lineTo(plotRight, yAtValue(0));
    context.stroke();
    context.setLineDash([]);
    drawLineSeries(context, values, xAtIndex, yAtValue, "rgba(239,143,104,.96)", 1.4);
    context.restore();
  }

  if (tracks.markers) {
    state.markers.forEach((marker) => {
      if (state.markerFilter !== "all" && marker.severity !== state.markerFilter) return;
      if ((marker.endSeconds ?? marker.seconds) < viewStart || marker.seconds > viewEnd) return;
      const x = xAtTime(marker.seconds);
      const endX = xAtTime(marker.endSeconds ?? marker.seconds);
      context.strokeStyle = marker.severity === "critical" ? "rgba(238,91,77,.95)" : marker.severity === "review" ? "rgba(226,171,71,.95)" : "rgba(92,181,190,.9)";
      if (endX - x > 2) {
        context.fillStyle = marker.severity === "critical" ? "rgba(238,91,77,.18)" : marker.severity === "review" ? "rgba(226,171,71,.14)" : "rgba(92,181,190,.12)";
        context.fillRect(x, 0, Math.max(2, endX - x), height);
      }
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.beginPath();
      context.moveTo(x - 5, 0);
      context.lineTo(x + 5, 0);
      context.lineTo(x, 8);
      context.closePath();
      context.fill();
    });
  }

  const selectionVisible = state.file && (trimMode || compactExport
    || state.trim.startSeconds > 0.0005
    || Math.abs(state.trim.endSeconds - fullDuration) > 0.0005);
  if (selectionVisible) {
    const startX = xAtTime(state.trim.startSeconds);
    const endX = xAtTime(state.trim.endSeconds);
    context.fillStyle = trimMode || compactExport ? "rgba(4,10,18,.7)" : "rgba(4,10,18,.48)";
    context.fillRect(plotLeft, 0, Math.max(0, startX - plotLeft), height);
    context.fillRect(endX, 0, Math.max(0, plotRight - endX), height);
    context.strokeStyle = trimMode ? "rgba(217,239,236,.75)" : "rgba(226,171,71,.92)";
    context.lineWidth = trimMode ? 1 : 2;
    context.setLineDash(trimMode ? [] : [7, 5]);
    context.strokeRect(Math.max(plotLeft, startX), 1, Math.max(0, Math.min(plotRight, endX) - Math.max(plotLeft, startX)), Math.max(0, height - 2));
    context.setLineDash([]);
  }

  if (trimMode) {
    const startX = xAtTime(state.trim.startSeconds);
    const endX = xAtTime(state.trim.endSeconds);
    const geometry = fadeGeometry();
    context.save();
    context.beginPath();
    context.rect(Math.max(plotLeft, startX), 0, Math.max(0, Math.min(plotRight, endX) - Math.max(plotLeft, startX)), height);
    context.clip();
    if (geometry.fadeInFrames > 0) {
      const fadeEndX = xAtTime(geometry.fadeInEnd);
      context.fillStyle = "rgba(69,164,165,.11)";
      context.beginPath();
      context.moveTo(startX, height - 12);
      context.lineTo(fadeEndX, 12);
      context.lineTo(fadeEndX, height - 12);
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(101,211,208,.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(startX, height - 12);
      context.lineTo(fadeEndX, 12);
      context.stroke();
    }
    if (geometry.fadeOutFrames > 0) {
      const fadeStartX = xAtTime(geometry.fadeOutStart);
      const fadeEndX = xAtTime(geometry.fadeOutEnd);
      context.fillStyle = "rgba(189,98,78,.11)";
      context.beginPath();
      context.moveTo(fadeStartX, 12);
      context.lineTo(fadeEndX, height - 12);
      context.lineTo(fadeStartX, height - 12);
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(235,140,116,.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(fadeStartX, 12);
      context.lineTo(fadeEndX, height - 12);
      context.stroke();
    }
    context.restore();
    [{ x: startX, color: "#45a4a5" }, { x: endX, color: "#bd624e" }].forEach(({ x, color }) => {
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.fillStyle = color;
      context.fillRect(x - 7, height / 2 - 22, 14, 44);
    });
  }

  if (state.file && state.playback.currentSeconds >= viewStart && state.playback.currentSeconds <= viewEnd) {
    const x = xAtTime(state.playback.currentSeconds);
    context.strokeStyle = "rgba(255,255,255,.88)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  return { startX: xAtTime(state.trim.startSeconds), endX: xAtTime(state.trim.endSeconds), plotLeft, plotRight, width, viewStart, viewEnd };
}

function renderTimeAxis() {
  if (!elements.analysisTimeAxis) return;
  const start = state.view.startSeconds;
  const end = state.view.endSeconds || durationSeconds();
  const count = matchMedia("(max-width: 720px)").matches ? 3 : 5;
  elements.analysisTimeAxis.innerHTML = Array.from({ length: count }, (_, index) => {
    const seconds = start + (end - start) * index / Math.max(1, count - 1);
    return `<span>${formatTime(seconds, false)}</span>`;
  }).join("");
}

function positionTrimLabels(geometry) {
  if (!geometry || !elements.trimStartLabel || !elements.trimEndLabel) return;
  const { startX, endX, plotLeft, plotRight, viewStart, viewEnd } = geometry;
  const startHidden = state.trim.startSeconds < viewStart;
  const endHidden = state.trim.endSeconds > viewEnd;
  const startPosition = clamp(startX, plotLeft + 4, plotRight - 4);
  const endPosition = clamp(endX, plotLeft + 4, plotRight - 4);
  elements.trimStartLabel.style.left = `${startPosition}px`;
  elements.trimStartLabel.style.right = "auto";
  elements.trimStartLabel.style.transform = startHidden ? "translateX(0)" : "translateX(-2px)";
  elements.trimEndLabel.style.left = `${endPosition}px`;
  elements.trimEndLabel.style.right = "auto";
  elements.trimEndLabel.style.transform = endHidden ? "translateX(-100%)" : "translateX(calc(-100% + 2px))";
  elements.trimStartLabel.textContent = startHidden
    ? `A ligger ${formatTime(viewStart - state.trim.startSeconds, false)} åt vänster`
    : `A ${formatTime(state.trim.startSeconds)}`;
  elements.trimEndLabel.textContent = endHidden
    ? `B ligger ${formatTime(state.trim.endSeconds - viewEnd, false)} åt höger`
    : `B ${formatTime(state.trim.endSeconds)}`;
}

function scheduleCanvasRender() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    drawTimeline(elements.analysisCanvas, false);
    const trimGeometry = drawTimeline(elements.trimCanvas, true);
    drawTimeline(elements.exportTrimCanvas, false);
    positionTrimLabels(trimGeometry);
    renderTimeAxis();
    const rangeStart = state.view.startSeconds;
    const rangeEnd = state.view.endSeconds || durationSeconds();
    elements.timelineRange.textContent = rangeStart === 0 && Math.abs(rangeEnd - durationSeconds()) < 0.01
      ? "Hela inspelningen"
      : `${formatTime(rangeStart, false)} till ${formatTime(rangeEnd, false)}`;
  });
}

function canvasTimeFromPointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const labelWidth = rect.width < 520 ? 44 : 58;
  const x = clamp(event.clientX - rect.left, labelWidth, rect.width - 10);
  const ratio = (x - labelWidth) / Math.max(1, rect.width - 10 - labelWidth);
  return state.view.startSeconds + ratio * (state.view.endSeconds - state.view.startSeconds);
}

function findTrimHandle(canvas, event) {
  const time = canvasTimeFromPointer(canvas, event);
  const secondsPerPixel = (state.view.endSeconds - state.view.startSeconds) / Math.max(1, canvas.clientWidth - 68);
  const tolerance = secondsPerPixel * 28;
  if (Math.abs(time - state.trim.startSeconds) <= tolerance) return "start";
  if (Math.abs(time - state.trim.endSeconds) <= tolerance) return "end";
  if (time > state.trim.startSeconds && time < state.trim.endSeconds) return "window";
  return null;
}

async function loadProjectTools() {
  try {
    projectTools = await import("./project.js");
    state.capabilities.projectModule = true;
  } catch (error) {
    state.capabilities.projectModule = false;
  }
  updateCapabilities(state.capabilities.analysis, state.capabilities.export);
}

async function loadAnalysisExchangeTools() {
  try {
    analysisExchangeTools = await import("./analysis-exchange.js");
    elements.exchangeCapabilityStatus.textContent = "Lokalt tillgängligt";
    elements.exchangeCapabilityStatus.classList.add("is-ready");
  } catch {
    analysisExchangeTools = null;
    elements.exchangeCapabilityStatus.textContent = "Modul saknas";
    elements.analysisExchangeStatus.textContent = "Analysutbyte är inte tillgängligt i den här byggnaden.";
  }
  syncAnalysisExchangeAvailability();
}

function syncAnalysisExchangeAvailability() {
  const analysisReady = Boolean(analysisExchangeTools && state.file && state.analysisStatus === "complete" && state.analysis);
  const requestedStage = exchangeStage();
  const stageReady = requestedStage === "source"
    || (requestedStage === "calculated-export-selection" && state.regionAnalysis && !state.jobs.region)
    || (requestedStage === "verified-output" && state.exportStatus === "complete" && state.verifiedExport);
  const ready = Boolean(analysisReady && stageReady);
  elements.openAnalysisExport.disabled = !ready;
  elements.importGuidance.disabled = !ready;
  elements.pasteGuidance.disabled = !ready;
  elements.processGuidanceText.disabled = !ready || !elements.guidanceTextInput.value.trim();
  if (ready && !state.analysisExchange.lastBundle) elements.analysisExchangeStatus.textContent = "Valt signalsteg är klart. Du kan skapa kopierbar text eller klistra in vägledning.";
  else if (analysisReady) elements.analysisExchangeStatus.textContent = requestedStage === "verified-output" ? "Exportera och verifiera WAV-filen först." : "Väntar på Beräknat exporturval.";
}

function exchangePrivacyOptions() {
  const form = new FormData(elements.analysisExchangeForm);
  return {
    includeIdentity: form.has("includeIdentity"),
    includeFileName: form.has("includeFileName"),
    includeLocation: form.has("includeLocation"),
    includeNotes: form.has("includeNotes"),
    includeCreator: form.has("includeCreator"),
    includeEditorialCueSheet: form.has("includeEditorialCueSheet"),
  };
}

function exchangeStage() {
  return new FormData(elements.analysisExchangeForm).get("exchangeStage") || "calculated-export-selection";
}

function exchangeProfile() {
  return new FormData(elements.analysisExchangeForm).get("exchangeProfile") || "minimal";
}

function exchangeMetadata() {
  const privacy = exchangePrivacyOptions();
  const source = collectMetadata();
  return {
    ...(privacy.includeIdentity ? { title: source.title, series: source.series, episode: source.episode, sessionId: source.sessionId, project: source.project, date: source.date, localTime: source.localTime, lightConditions: source.lightConditions } : {}),
    ...(privacy.includeFileName ? { sourceFileName: state.file?.name || "" } : {}),
    ...(privacy.includeLocation ? { place: source.place, latitude: source.coordinatePrecision === "hidden" ? null : finite(source.latitude), longitude: source.coordinatePrecision === "hidden" ? null : finite(source.longitude) } : {}),
    ...(privacy.includeNotes ? { tags: source.tags, environment: source.environment, notes: source.notes, relatedImage: source.relatedImage } : {}),
    ...(privacy.includeCreator ? { creator: source.creator, equipment: source.equipment, license: source.license } : {}),
  };
}

function analysisExchangeInput() {
  const privacySelection = exchangePrivacyOptions();
  const metadata = exchangeMetadata();
  const requestedStage = exchangeStage();
  const selected = selectAnalysisStage({
    source: state.analysis,
    calculated: state.regionAnalysis?.processed || null,
    verified: state.exportStatus === "complete" ? state.verifiedExport : null,
    stage: requestedStage,
  });
  if (selected.stage !== requestedStage) throw new Error(requestedStage === "verified-output" ? "Verifierad WAV saknas." : "Beräknat exporturval saknas.");
  const selectionStartSeconds = requestedStage === "source" ? 0 : state.trim.startSeconds;
  const selectionEndSeconds = requestedStage === "source" ? durationSeconds() : state.trim.endSeconds;
  return {
    file: state.file,
    analysis: state.analysis,
    selectedAnalysis: selected.analysis,
    signalStage: selected.stage,
    markers: selected.analysis?.markersSuggested || [],
    metadata,
    edit: projectEdit(),
    editorialContext: buildEditorialContext({ purpose: state.assessment.purpose, targetDurationSeconds: state.trimWindowSeconds }),
    editorialCueSheet: privacySelection.includeEditorialCueSheet
      ? buildEditorialCueSheet(state.markers, { selectionStartSeconds, selectionEndSeconds }) : null,
    profile: exchangeProfile() === "temporal-diagnostics" ? "temporal-diagnostic" : "minimal",
    privacy: privacySelection.includeLocation && state.metadata.coordinatePrecision === "exact" ? "exact" : "redacted",
    privacySelection,
    release: RELEASE,
  };
}

function analysisBundleBuilder() {
  return analysisExchangeTools?.buildAnalysisBundle
    || analysisExchangeTools?.createAnalysisBundle
    || analysisExchangeTools?.buildExchangeBundle
    || null;
}

function normalizeBundleResult(result) {
  const bundle = result?.bundle || result?.publicBundle || result;
  if (!bundle || typeof bundle !== "object") throw new Error("Utbytesmodulen returnerade inget analysunderlag.");
  const serialized = typeof result?.json === "string" ? result.json : analysisExchangeTools?.serializeAnalysisBundle?.(bundle);
  const json = typeof serialized === "string" ? serialized : typeof serialized?.json === "string" ? serialized.json : JSON.stringify(bundle, null, 2);
  const fileName = result?.fileName || `ljudr-analysis-${bundle.bundleId || "local"}.json`;
  const digest = result?.analysisDigest || result?.digest || bundle.analysisDigest || bundle.binding?.analysisDigest || "digest saknas";
  return { bundle, json, fileName, digest, receipt: result?.receipt || result?.localReceipt || null };
}

function auditEditSnapshot() {
  return {
    globalGainDb: state.trim.gainDb,
    trimStartFrame: state.trim.startFrame,
    trimEndFrame: state.trim.endFrame,
    fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
    fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
  };
}

function appendAnalysisExchangeAudit(action, { bundleId, analysisDigest, suggestionId = null, before = auditEditSnapshot(), after = auditEditSnapshot() } = {}) {
  if (!analysisExchangeTools?.appendAuditEntry || !bundleId || !analysisDigest) return;
  state.analysisExchange.auditLog = analysisExchangeTools.appendAuditEntry(state.analysisExchange.auditLog, { action, bundleId, analysisDigest, suggestionId, before, after });
}

function renderExchangeManifest(profile = exchangeProfile(), bundle = null) {
  const privacy = exchangePrivacyOptions();
  const rows = [
    `Signalsteg: ${{ source: "källfil", "calculated-export-selection": "beräknat exporturval", "verified-output": "verifierad WAV" }[exchangeStage()]}`,
    "Objektiva sammanfattningsvärden, redaktionell seriekontext och metodstatus",
    "Observationer, markörer och synliga redigeringsval",
    profile === "temporal-diagnostics"
      ? "Grova 5-sekundersaggregat, högst 720 segment: Momentary p10, median och max, Short-term median och max, program-sample-peak max, låg-nivåandel samt stereokorrelation median och min"
      : "Ingen kontinuerlig mätserie",
    "Bundle-ID och analysdigest. Full källhash stannar lokalt",
    "Aldrig ljud, vågform, L/R-nivåserier, RMS-serier eller råa samplingar",
  ];
  const selected = Object.entries(privacy).filter(([, enabled]) => enabled).map(([key]) => ({
    includeIdentity: "Titel och sessionsuppgifter",
    includeFileName: "Källfilens namn",
    includeLocation: "Plats enligt aktiv koordinatprecision",
    includeNotes: "Taggar, miljö, anteckningar och länk",
    includeCreator: "Skapare, utrustning och licens",
    includeEditorialCueSheet: "Integritetsgranskat redaktionellt cue sheet",
  })[key]);
  rows.push(selected.length ? `Frivillig metadata: ${selected.join(", ")}` : "Ingen frivillig metadata");
  if (privacy.includeLocation && state.metadata.coordinatePrecision === "exact") rows.push("Exakt platsprofil är vald. Markörtider kan därför behålla decimalprecision. Granska JSON-preview före export.");
  if (bundle?.temporalSegments?.length) rows.push(`${bundle.temporalSegments.length} temporala segment`);
  elements.exchangeManifestList.innerHTML = rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("");
}

async function refreshAnalysisBundlePreview() {
  const builder = analysisBundleBuilder();
  if (!builder || !state.analysis) return;
  const requestSequence = ++exchangePreviewSequence;
  elements.createAnalysisBundle.disabled = true;
  elements.exchangeDialogStatus.textContent = "Sammanställer och integritetsgranskar lokalt";
  try {
    const result = await builder(analysisExchangeInput());
    if (requestSequence !== exchangePreviewSequence) return;
    const normalized = normalizeBundleResult(result);
    const receiptIdentity = exchangeStage() === "verified-output" ? state.verifiedExport?.sourceIdentity : state.analysis?.sourceIdentity;
    if (analysisExchangeTools?.createLocalReceipt) normalized.receipt = await analysisExchangeTools.createLocalReceipt(normalized.bundle, { sourceIdentity: receiptIdentity || null });
    state.analysisExchange.preview = normalized;
    elements.exchangeJsonPreview.textContent = normalized.json;
    renderExchangeManifest(exchangeProfile(), normalized.bundle);
    elements.exchangeDialogStatus.textContent = `Preview klar. ${formatBytes(new Blob([normalized.json]).size)}. Kontrollera innehållet innan texten visas för kopiering.`;
    elements.createAnalysisBundle.disabled = false;
  } catch (error) {
    if (requestSequence !== exchangePreviewSequence) return;
    state.analysisExchange.preview = null;
    elements.exchangeJsonPreview.textContent = "Preview kunde inte skapas.";
    elements.exchangeDialogStatus.textContent = error.message || "Analysunderlaget kunde inte skapas.";
  }
}

async function openAnalysisExchangeReview() {
  if (!state.analysis || !analysisExchangeTools) return;
  const requestedStage = exchangeStage();
  if ((requestedStage === "calculated-export-selection" && (!state.regionAnalysis || state.jobs.region))
    || (requestedStage === "verified-output" && (!state.verifiedExport || state.exportStatus !== "complete"))) {
    showToast(requestedStage === "verified-output" ? "Exportera och verifiera WAV-filen först." : "Vänta tills Beräknat exporturval är klart.", "error", 6500);
    return;
  }
  state.analysisExchange.preview = null;
  renderExchangeManifest();
  elements.exchangeJsonPreview.textContent = "Skapar exakt JSON-preview lokalt.";
  elements.analysisExchangeDialog.showModal();
  await refreshAnalysisBundlePreview();
}

function createLocalAnalysisBundle() {
  const preview = state.analysisExchange.preview;
  if (!preview) return;
  const blob = new Blob([preview.json], { type: "application/json" });
  state.analysisExchange.lastBundle = preview;
  state.analysisExchange.lastBundleBlob = blob;
  if (preview.receipt) state.analysisExchange.receipts = [preview.receipt, ...state.analysisExchange.receipts.filter((item) => item?.bundleId !== preview.receipt?.bundleId)];
  appendAnalysisExchangeAudit("export", { bundleId: preview.bundle.bundleId, analysisDigest: preview.digest });
  elements.exchangeArtifact.hidden = false;
  elements.analysisExchangeText.value = preview.json;
  elements.exchangeArtifactDetails.textContent = `${formatBytes(blob.size)} kopierbar JSON-text. Fil är valfri reserv.`;
  elements.exchangeArtifactDigest.textContent = `Analysdigest: ${preview.digest}`;
  elements.analysisExchangeStatus.textContent = "Analysunderlaget är klart att kopiera. Inget har laddats upp eller sparats som fil.";
  elements.analysisExchangeDialog.close();
  elements.exchangeArtifact.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  state.dirty = true;
  emitState("analysis-bundle-created");
}

async function writeClipboardText(text, fallbackElement) {
  if (!text) throw new Error("Det finns ingen text att kopiera.");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackElement.focus();
    fallbackElement.select();
    if (!document.execCommand?.("copy")) throw new Error("Kopieringen blockerades. Markera texten och kopiera manuellt.");
  }
}

async function readClipboardText() {
  if (!navigator.clipboard?.readText) throw new Error("Webbläsaren tillåter inte automatisk inklistring. Klistra in direkt i rutan.");
  return navigator.clipboard.readText();
}

function guidanceImporter() {
  return analysisExchangeTools?.parseGuidanceFile
    || analysisExchangeTools?.importGuidanceFile
    || analysisExchangeTools?.validateGuidance
    || analysisExchangeTools?.readGuidance
    || null;
}

function normalizedGuidanceResult(result) {
  const guidance = result?.guidance || result?.data || result;
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : Array.isArray(guidance?.suggestions) ? guidance.suggestions : [];
  const moduleMatch = result?.matched === true || result?.verified === true || result?.match === true || result?.match?.matches === true || result?.status === "matched" || result?.status === "bound-current";
  const hasCurrentDigest = Boolean(state.analysisExchange.lastBundle?.digest);
  const matched = moduleMatch && hasCurrentDigest;
  const reason = !hasCurrentDigest
    ? "Skapa ett nytt aktuellt analysunderlag innan vägledningen kan aktiveras."
    : result?.match?.reason || result?.reason || result?.message || guidance?.verification?.message || "Ingen verifieringsförklaring angavs.";
  return { guidance, suggestions, matched, receipt: result?.receipt || null, reason };
}

function guidanceSourceIdentity() {
  const signalStage = state.analysisExchange.lastBundle?.bundle?.analysis?.signalStage;
  return signalStage === "verified-output"
    ? state.verifiedExport?.sourceIdentity || null
    : state.analysis?.sourceIdentity || null;
}

async function importGuidanceText(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    showToast("Klistra in vägledningstext först.", "error");
    return;
  }
  clearGuidancePreview();
  if (new Blob([normalizedText]).size > 2 * 1024 * 1024) {
    showToast("Vägledningstexten är större än 2 MB och avvisades.", "error", 8000);
    return;
  }
  const importer = guidanceImporter();
  if (!importer) return;
  elements.guidanceVerification.textContent = "Verifierar bundle-ID, analysdigest och lokal källidentitet";
  try {
    JSON.parse(normalizedText);
    const result = await importer(normalizedText, {
      bundleReceipts: state.analysisExchange.receipts,
      sourceIdentity: guidanceSourceIdentity(),
      currentAnalysisDigest: state.analysisExchange.lastBundle?.digest || null,
    });
    const normalized = normalizedGuidanceResult(result);
    state.analysisExchange.guidance = normalized;
    state.analysisExchange.guidanceStatus = normalized.matched ? "matched" : "unverified";
    state.analysisExchange.guidanceDecisions = {};
    appendAnalysisExchangeAudit("import", { bundleId: normalized.guidance?.bundleId, analysisDigest: normalized.guidance?.analysisDigest });
    elements.guidanceOriginStatus.textContent = normalized.matched ? "gAIa, osignerad, matchad" : "gAIa, osignerad, overifierad";
    elements.guidanceOriginStatus.className = `guidance-origin ${normalized.matched ? "is-matched" : "is-unverified"}`;
    elements.guidanceVerification.textContent = normalized.matched
      ? "Bundle-ID och analysdigest matchar. Källfilen har verifierats lokalt. Inget förslag har använts."
      : `Förslagen är endast läsbara och kan inte överföras. ${normalized.reason}`;
    renderGuidanceSuggestions();
    showToast(normalized.matched ? "Vägledningen matchar aktuell lokal analys." : "Vägledningen kunde inte bindas säkert till aktuell analys.", normalized.matched ? "info" : "error", 8000);
    emitState("guidance-imported");
  } catch (error) {
    state.analysisExchange.guidance = null;
    state.analysisExchange.guidanceStatus = "rejected";
    elements.guidanceOriginStatus.textContent = "Text avvisad";
    elements.guidanceOriginStatus.className = "guidance-origin is-unverified";
    elements.guidanceVerification.textContent = error.message || "Vägledningstexten kunde inte valideras.";
    renderGuidanceSuggestions();
    showToast("Vägledningstexten avvisades. Inga kontroller ändrades.", "error", 8000);
  }
}

async function importGuidanceFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast("Vägledningsfilen är större än 2 MB och avvisades.", "error", 8000);
    return;
  }
  try {
    const text = await file.text();
    elements.guidanceTextInput.value = text;
    syncAnalysisExchangeAvailability();
    await importGuidanceText(text);
  } finally {
    elements.guidanceFileInput.value = "";
  }
}

function normalizeSuggestion(suggestion, index) {
  const action = suggestion?.action || suggestion?.type || suggestion?.kind || "review-region";
  const proposedValue = suggestion?.proposedValue ?? suggestion?.globalGainDb ?? suggestion?.value ?? suggestion?.after ?? null;
  const startSeconds = finite(suggestion?.startSeconds ?? suggestion?.region?.startSeconds ?? suggestion?.timeSeconds);
  const endSeconds = finite(suggestion?.endSeconds ?? suggestion?.region?.endSeconds);
  return {
    ...suggestion,
    id: String(suggestion?.id || `guidance-${index + 1}`),
    action,
    proposedValue,
    startSeconds,
    endSeconds,
    title: String(suggestion?.title || suggestion?.summary || suggestion?.label || "Externt förslag"),
    rationale: String(suggestion?.rationale || suggestion?.reason || suggestion?.description || "Ingen motivering angavs."),
  };
}

function suggestionEvidence(suggestion) {
  const evidence = Array.isArray(suggestion.evidenceRefs) ? suggestion.evidenceRefs.join(" · ") : Array.isArray(suggestion.evidence) ? suggestion.evidence.join(" · ") : suggestion.evidence || suggestion.measurement || "Inget särskilt mätunderlag angavs";
  const region = suggestion.startSeconds === null ? "" : ` · Region ${formatTime(suggestion.startSeconds)}${suggestion.endSeconds === null ? "" : ` till ${formatTime(suggestion.endSeconds)}`}`;
  return `${evidence}${region}`;
}

function renderGuidanceSuggestions() {
  const normalized = state.analysisExchange.guidance;
  const suggestions = normalized?.suggestions?.map(normalizeSuggestion) || [];
  if (!suggestions.length) {
    elements.guidanceList.innerHTML = '<li class="list-placeholder">Inga externa förslag</li>';
    return;
  }
  const actionable = state.analysisExchange.guidanceStatus === "matched";
  elements.guidanceList.innerHTML = suggestions.map((suggestion) => {
    const decision = state.analysisExchange.guidanceDecisions[suggestion.id] || "Ogranskat";
    const disabled = actionable ? "" : " disabled";
    const canTransfer = actionable && suggestion.action === "global-gain" && !validBitsTransformBlocked();
    const canPreview = actionable && suggestion.action === "global-gain";
    const classification = { objective: "Objektivt underlag", heuristic: "Heuristisk tolkning", artistic: "Konstnärligt förslag" }[suggestion.classification] || "Extern tolkning";
    const prediction = [finite(suggestion.predictedIntegratedLufs) === null ? null : `${formatDecimal(suggestion.predictedIntegratedLufs, 1)} LUFS-I`, finite(suggestion.predictedTruePeakDbtp) === null ? null : `${formatDecimal(suggestion.predictedTruePeakDbtp, 1)} dBTP`].filter(Boolean).join(" · ");
    return `<li class="guidance-card" data-guidance-id="${escapeHtml(suggestion.id)}"><div class="guidance-card-head"><h4>${escapeHtml(suggestion.title)}</h4><span class="guidance-decision">${escapeHtml(decision)}</span></div><small>${escapeHtml(classification)}${finite(suggestion.confidence) === null ? "" : ` · Konfidens ${formatDecimal(suggestion.confidence, 2)}`}</small><p>${escapeHtml(suggestion.rationale)}</p><div class="guidance-evidence"><strong>Evidens</strong><span>${escapeHtml(suggestionEvidence(suggestion))}${prediction ? ` · Förutsagt: ${escapeHtml(prediction)}` : ""}</span></div><div class="guidance-card-actions"><button class="button button-quiet button-small" type="button" data-guidance-action="show"${disabled}>Visa i tidslinjen</button><button class="button button-secondary button-small" type="button" data-guidance-action="preview"${canPreview ? "" : " disabled"}>Prova i medhörning</button><button class="button button-primary button-small" type="button" data-guidance-action="transfer"${canTransfer ? "" : " disabled"}>Överför till kontroller</button><button class="button button-quiet button-small" type="button" data-guidance-action="reject"${disabled}>Avvisa</button><button class="button button-quiet button-small" type="button" data-guidance-action="preserve"${disabled}>Bevara oförändrat</button></div></li>`;
  }).join("");
}

function guidanceSuggestions() {
  return state.analysisExchange.guidance?.suggestions?.map(normalizeSuggestion) || [];
}

function currentSuggestionValue(suggestion) {
  if (["global-gain", "globalGainDb", "gain"].includes(suggestion.action)) return `${formatDecimal(state.trim.gainDb, 1)} dB`;
  if (["trim-start", "startFrame", "startSeconds"].includes(suggestion.action)) return formatTime(state.trim.startSeconds);
  if (["trim-end", "endFrame", "endSeconds"].includes(suggestion.action)) return formatTime(state.trim.endSeconds);
  if (["fade-in", "fadeInSeconds"].includes(suggestion.action)) return `${formatDecimal(state.trim.fadeInSeconds, 3)} s`;
  if (["fade-out", "fadeOutSeconds"].includes(suggestion.action)) return `${formatDecimal(state.trim.fadeOutSeconds, 3)} s`;
  if (["add-marker", "marker"].includes(suggestion.action)) return "Ingen egen markör";
  return "Oförändrat";
}

function proposedSuggestionValue(suggestion) {
  if (typeof suggestion.proposedValue === "object" && suggestion.proposedValue !== null) return JSON.stringify(suggestion.proposedValue);
  return String(suggestion.proposedValue ?? "Bevara nuvarande värde");
}

function showGuidanceSuggestion(suggestion) {
  const references = Array.isArray(suggestion.evidenceRefs) ? suggestion.evidenceRefs : [];
  const marker = state.markers.find((item) => references.includes(item.id)
    || references.includes(item.type)
    || (references.includes("true-peak") && /true peak|topp/i.test(`${item.text || ""} ${item.detail || ""}`)));
  if (marker) {
    const center = finite(marker.seconds) ?? 0;
    const end = finite(marker.endSeconds) ?? center;
    setZoomAround(center + (end - center) / 2, Math.max(2, (end - center) * 2));
    state.playback.currentSeconds = clamp(center, 0, durationSeconds());
    elements.audio.currentTime = state.playback.currentSeconds;
  } else fitTimeline();
  setMode("analyze");
  scheduleCanvasRender();
  showToast(marker ? "Evidensmarkören visas i källkontext." : "Hela analysens tidslinje visas. Förslaget saknar en specifik tidsregion.");
}

function clearGuidancePreview() {
  state.monitoring.previewEditOverride = null;
  state.monitoring.previewGainOverride = null;
  updateMonitoringGraph();
}

function previewGuidanceSuggestion(suggestion) {
  state.monitoring.previewMode = "export";
  state.monitoring.previewEditOverride = { ...state.trim };
  state.monitoring.previewGainOverride = null;
  const value = finite(suggestion.proposedValue);
  if (["global-gain", "globalGainDb", "gain"].includes(suggestion.action) && value !== null) state.monitoring.previewGainOverride = value;
  else if (["trim-start", "startSeconds"].includes(suggestion.action) && value !== null) state.monitoring.previewEditOverride.startSeconds = value;
  else if (["trim-end", "endSeconds"].includes(suggestion.action) && value !== null) state.monitoring.previewEditOverride.endSeconds = value;
  else if (["fade-in", "fadeInSeconds"].includes(suggestion.action) && value !== null) state.monitoring.previewEditOverride.fadeInSeconds = value;
  else if (["fade-out", "fadeOutSeconds"].includes(suggestion.action) && value !== null) state.monitoring.previewEditOverride.fadeOutSeconds = value;
  const radio = $("input[name='previewMode'][value='export']");
  if (radio) radio.checked = true;
  updateMonitoringGraph();
  syncAuditionUi();
  state.analysisExchange.guidanceDecisions[suggestion.id] = "Provas tillfälligt";
  renderGuidanceSuggestions();
  state.playback.previewStopAt = state.monitoring.previewEditOverride.endSeconds;
  playFrom(suggestion.startSeconds ?? state.monitoring.previewEditOverride.startSeconds);
}

function openSuggestionTransfer(suggestion) {
  state.analysisExchange.activeSuggestionId = suggestion.id;
  elements.suggestionTransferSummary.textContent = `${suggestion.title}. ${suggestion.rationale}`;
  elements.suggestionBeforeValue.textContent = currentSuggestionValue(suggestion);
  elements.suggestionAfterValue.textContent = proposedSuggestionValue(suggestion);
  elements.suggestionTransferDialog.showModal();
}

function applyGuidanceSuggestion(suggestion) {
  const value = finite(suggestion.proposedValue);
  if (suggestion.action !== "global-gain" || value === null) throw new Error("Förslagstypen kan inte överföras till en kontroll i denna version.");
  const before = auditEditSnapshot();
  updateGain(value);
  if (Math.abs(value) > 1e-9) {
    const editedRadio = $("input[name='exportProfile'][value='edited-wav']");
    if (editedRadio) editedRadio.checked = true;
    setExportProfile("edited-wav");
  }
  clearGuidancePreview();
  state.analysisExchange.guidanceDecisions[suggestion.id] = "Övertaget till kontroller";
  appendAnalysisExchangeAudit("accept", { bundleId: state.analysisExchange.guidance?.guidance?.bundleId, analysisDigest: state.analysisExchange.guidance?.guidance?.analysisDigest, suggestionId: suggestion.id, before, after: auditEditSnapshot() });
  elements.suggestionTransferDialog.close();
  renderGuidanceSuggestions();
  showToast("Förslaget överfördes efter ditt uttryckliga beslut. Exporturvalet beräknas om.");
  emitState("guidance-transferred");
}

function handleGuidanceAction(event) {
  const button = event.target.closest("[data-guidance-action]");
  const card = button?.closest("[data-guidance-id]");
  if (!button || !card || state.analysisExchange.guidanceStatus !== "matched") return;
  const suggestion = guidanceSuggestions().find((item) => item.id === card.dataset.guidanceId);
  if (!suggestion) return;
  const action = button.dataset.guidanceAction;
  if (action === "show") showGuidanceSuggestion(suggestion);
  if (action === "preview") previewGuidanceSuggestion(suggestion);
  if (action === "transfer") openSuggestionTransfer(suggestion);
  if (action === "reject" || action === "preserve") {
    clearGuidancePreview();
    state.analysisExchange.guidanceDecisions[suggestion.id] = action === "reject" ? "Avvisat" : "Bevara oförändrat";
    appendAnalysisExchangeAudit("reject", { bundleId: state.analysisExchange.guidance?.guidance?.bundleId, analysisDigest: state.analysisExchange.guidance?.guidance?.analysisDigest, suggestionId: suggestion.id });
    renderGuidanceSuggestions();
    state.dirty = true;
    emitState(`guidance-${action}`);
  }
}

function collectMetadata() {
  const data = Object.fromEntries(new FormData(elements.metadataForm).entries());
  state.metadata = { ...state.metadata, ...data };
  return { ...state.metadata };
}

function applyMetadata(metadata = {}) {
  state.metadata = { ...state.metadata, ...metadata };
  Object.entries(state.metadata).forEach(([name, value]) => {
    const field = elements.metadataForm.elements.namedItem(name);
    if (field) field.value = value ?? "";
  });
}

function projectEdit() {
  return {
    startFrame: state.trim.startFrame,
    endFrame: state.trim.endFrame,
    globalGainDb: state.trim.gainDb,
    gainDb: state.trim.gainDb,
    fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
    fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
    profile: state.exportProfile,
  };
}

function projectSettings() {
  return {
    trimWindowSeconds: state.trimWindowSeconds,
    monitoring: {
      volume: state.monitoring.volume,
      levelMatched: state.monitoring.levelMatched,
      previewMode: state.monitoring.previewMode,
      channelMode: state.monitoring.channelMode,
    },
    view: {
      startSeconds: state.view.startSeconds,
      endSeconds: state.view.endSeconds,
      tracks: { ...state.view.tracks },
    },
    assessment: { ...state.assessment },
    series: { ...state.series },
    publication: { manual: { ...state.publication.manual }, exceptionNote: state.publication.exceptionNote },
    analysisExchange: {
      receipts: state.analysisExchange.receipts.map((receipt) => ({ ...receipt })),
      guidance: state.analysisExchange.guidance?.guidance || null,
      guidanceStatus: state.analysisExchange.guidanceStatus,
      guidanceDecisions: { ...state.analysisExchange.guidanceDecisions },
      auditLog: state.analysisExchange.auditLog.map((entry) => ({ ...entry })),
    },
  };
}

async function saveProjectFile() {
  if (!state.file) return;
  if (!state.trimEditor.applied) {
    showToast("Tillämpa trimfönstret eller återgå till det aktiva urvalet innan projektet sparas.", "error", 7000);
    return;
  }
  if (!state.analysis?.sourceIdentity) {
    showToast("Kör källanalysen först så att projektet kan bindas till filens fulla lokala SHA-256.", "error", 8000);
    return;
  }
  try {
    const input = {
      file: state.file,
      analysis: state.analysis,
      edit: projectEdit(),
      markers: state.markers,
      metadata: collectMetadata(),
      settings: projectSettings(),
    };
    const project = projectTools?.buildProject
      ? await projectTools.buildProject(input)
      : {
          schema: "se.gaia.ljudr.analysis-project/1",
          createdAt: new Date().toISOString(),
          source: { name: state.file.name, size: state.file.size, lastModified: state.file.lastModified },
          analysis: state.analysis,
          edit: projectEdit(),
          markers: state.markers,
          metadata: collectMetadata(),
          settings: projectSettings(),
          privacy: { audioIncluded: false },
        };
    const fileName = `${baseName(state.file.name)}.ljudr.json`;
    if (projectTools?.downloadProject) projectTools.downloadProject(project, fileName);
    else downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), fileName);
    state.dirty = false;
    showToast("Projektfilen sparades utan ljudsamplingar.");
  } catch (error) {
    showToast(`Projektet kunde inte sparas: ${error.message}`, "error");
  }
}

async function readProject(file) {
  try {
    const project = projectTools?.readProjectFile
      ? await projectTools.readProjectFile(file)
      : JSON.parse(await file.text());
    if (project?.privacy?.audioIncluded !== false) throw new Error("Projektets integritetsmarkering saknas.");
    state.pendingProject = project;
    state.analysis = null;
    state.markers = Array.isArray(project.markers) ? project.markers : [];
    applyMetadata(project.metadata);
    if (state.file) await applyPendingProjectToFile();
    else {
      renderAnalysisSummary();
      renderObservations();
      renderMarkers();
      showToast(`Projektet öppnades. Välj källfilen ${project.source?.name || "som hör till projektet"}.`, "info", 7500);
      elements.audioInput.click();
    }
  } catch (error) {
    showToast(`Projektet kunde inte öppnas: ${error.message}`, "error", 7000);
  }
}

async function applyPendingProjectToFile() {
  const project = state.pendingProject;
  if (!project || !state.file) return;
  const descriptorMatches = project.source?.size === state.file.size && (!project.source?.name || project.source.name === state.file.name);
  let matches = descriptorMatches;
  let reason = matches ? "Filnamn och storlek stämmer." : "Filnamn eller storlek skiljer sig.";
  let requiresReanalysis = false;
  if (projectTools?.sourceMatchesProject && project.source) {
    const check = await projectTools.sourceMatchesProject(state.file, project);
    matches = check.matches;
    reason = check.reason;
    requiresReanalysis = Boolean(check.requiresReanalysis);
  }
  if (!matches && !(requiresReanalysis && descriptorMatches)) {
    showToast(`Källfilen matchar inte projektet. ${reason}`, "error", 8000);
    return;
  }
  state.analysis = requiresReanalysis ? null : (project.analysis || state.analysis);
  state.markers = Array.isArray(project.markers) ? project.markers : state.markers;
  const edit = project.edit || {};
  if (finite(edit.startFrame) !== null) state.trim.startSeconds = toSeconds(edit.startFrame);
  if (finite(edit.endFrame) !== null) state.trim.endSeconds = toSeconds(edit.endFrame);
  state.trim.gainDb = finite(edit.globalGainDb ?? edit.gainDb) ?? 0;
  state.trim.fadeInSeconds = toSeconds(edit.fadeInFrames || 0);
  state.trim.fadeOutSeconds = toSeconds(edit.fadeOutFrames || 0);
  state.trimEditor = {
    unlocked: false,
    applied: true,
    appliedStartSeconds: state.trim.startSeconds,
    appliedEndSeconds: state.trim.endSeconds,
  };
  state.exportProfile = edit.profile || (Math.abs(state.trim.gainDb) > 1e-9 || state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0 ? "edited-wav" : "sample-payload-trim");
  const profileRadio = $(`input[name='exportProfile'][value='${state.exportProfile}']`);
  if (profileRadio) profileRadio.checked = true;
  state.series = { ...state.series, ...(project.settings?.series || {}) };
  const savedPublication = project.settings?.publication || {};
  state.publication = {
    manual: { ...state.publication.manual, ...(savedPublication.manual || {}) },
    exceptionNote: String(savedPublication.exceptionNote || "").slice(0, 1_000),
  };
  state.trimWindowSeconds = Math.max(1 / sampleRate(), finite(project.settings?.trimWindowSeconds) ?? 20 * 60);
  const savedExchange = project.settings?.analysisExchange || {};
  if (Array.isArray(savedExchange.receipts)) state.analysisExchange.receipts = savedExchange.receipts.filter((receipt) => receipt && typeof receipt === "object");
  if (Array.isArray(savedExchange.auditLog)) {
    try {
      analysisExchangeTools?.validateAuditLog?.(savedExchange.auditLog);
      state.analysisExchange.auditLog = savedExchange.auditLog.map((entry) => ({ ...entry }));
    } catch {
      state.analysisExchange.auditLog = [];
      showToast("Projektets auditlogg kunde inte verifieras och lästes inte in.", "error", 8000);
    }
  }
  if (savedExchange.guidance && typeof savedExchange.guidance === "object") {
    state.analysisExchange.guidance = normalizedGuidanceResult({ guidance: savedExchange.guidance, status: "unverified", reason: "Klistra in vägledningstexten igen för ny lokal verifiering." });
    state.analysisExchange.guidanceStatus = "unverified";
    state.analysisExchange.guidanceDecisions = { ...(savedExchange.guidanceDecisions || {}) };
    elements.guidanceOriginStatus.textContent = "gAIa, osignerad, kräver ny verifiering";
    elements.guidanceOriginStatus.className = "guidance-origin is-unverified";
    elements.guidanceVerification.textContent = "Projektet innehåller tidigare vägledning. Klistra in originaltexten igen innan någon åtgärd kan användas.";
    renderGuidanceSuggestions();
  }
  const savedMonitoring = project.settings?.monitoring || {};
  state.monitoring = {
    ...state.monitoring,
    volume: clamp(finite(savedMonitoring.volume) ?? state.monitoring.volume, 0, 1),
    levelMatched: Boolean(savedMonitoring.levelMatched),
    previewMode: ["source", "export"].includes(savedMonitoring.previewMode) ? savedMonitoring.previewMode : state.monitoring.previewMode,
    channelMode: ["stereo", "left", "right", "mono"].includes(savedMonitoring.channelMode) ? savedMonitoring.channelMode : state.monitoring.channelMode,
    previewGainOverride: null,
    previewEditOverride: null,
  };
  const savedView = project.settings?.view || {};
  const savedViewStart = clamp(finite(savedView.startSeconds) ?? state.view.startSeconds, 0, durationSeconds());
  const savedViewEnd = clamp(finite(savedView.endSeconds) ?? state.view.endSeconds, 0, durationSeconds());
  state.view = {
    ...state.view,
    startSeconds: savedViewEnd > savedViewStart ? savedViewStart : 0,
    endSeconds: savedViewEnd > savedViewStart ? savedViewEnd : durationSeconds(),
    tracks: { ...state.view.tracks, ...(savedView.tracks || {}) },
    detail: null,
    detailStatus: "overview",
  };
  state.assessment = {
    ...state.assessment,
    ...(project.settings?.assessment || {}),
  };
  if (assessmentProfiles[state.assessment.recordingType]) elements.recordingType.value = state.assessment.recordingType;
  if (["distribution", "preservation"].includes(state.assessment.purpose)) elements.assessmentPurpose.value = state.assessment.purpose;
  elements.monitorVolume.value = String(state.monitoring.volume);
  elements.levelMatch.checked = state.monitoring.levelMatched;
  const previewRadio = $(`input[name='previewMode'][value='${state.monitoring.previewMode}']`);
  if (previewRadio) previewRadio.checked = true;
  const monitorRadio = $(`input[name='monitorMode'][value='${state.monitoring.channelMode}']`);
  if (monitorRadio) monitorRadio.checked = true;
  syncFadeUi();
  syncSeriesUi();
  setExportProfile(state.exportProfile, { dirty: false, force: true });
  updateGain(state.trim.gainDb);
  applyMetadata(project.metadata);
  state.pendingProject = null;
  state.analysisStatus = state.analysis ? "complete" : "idle";
  state.regionStatus = state.analysis ? "stale" : "idle";
  elements.analysisCanvasEmpty.hidden = Boolean(state.analysis);
  renderAnalysisSummary();
  renderObservations();
  renderMarkers();
  renderPublicationCard();
  syncTrackControls();
  syncTrimUi();
  syncTrimWindowUi();
  syncAuditionUi();
  updateMonitoringGraph();
  if (state.analysis) requestRegionAnalysis();
  if (requiresReanalysis) {
    showToast("Det äldre projektet saknar full säker hash. Metadata och redigering har återställts, men mätningen körs om lokalt.", "info", 9000);
    startAnalysis();
  } else showToast("Projektet och källfilen matchar. Arbetet har återställts.");
  emitState("project-opened");
}

function reportInput() {
  const hasCurrentVerifiedExport = state.exportStatus === "complete" && Boolean(state.verifiedExport);
  return {
    file: state.file,
    analysis: state.analysis,
    edit: projectEdit(),
    markers: state.markers,
    metadata: collectMetadata(),
    exportReport: {
      ...(hasCurrentVerifiedExport ? state.lastExportReport || {} : {}),
      regionAnalysis: state.regionAnalysis,
      verifiedExport: hasCurrentVerifiedExport ? state.verifiedExport : null,
      series: state.series,
      analysisExchange: {
        guidanceStatus: state.analysisExchange.guidanceStatus,
        guidanceDecisions: { ...state.analysisExchange.guidanceDecisions },
        auditLog: state.analysisExchange.auditLog.map((entry) => ({ ...entry })),
      },
      publication: currentPublicationStatus(),
      spectralDiagnostics: state.spectralDiagnostics,
    },
  };
}

function downloadBlob(blob, fileName) {
  if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
  const url = URL.createObjectURL(blob);
  activeDownloadUrl = url;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

function exportReport(format) {
  if (!state.file) return;
  const reportName = `${baseName(state.file.name)}_analysrapport`;
  if (projectTools?.downloadReport) {
    projectTools.downloadReport(reportInput(), format, reportName);
  } else {
    const data = {
      createdAt: new Date().toISOString(),
      source: { name: state.file.name, size: state.file.size },
      analysis: state.analysis,
      edit: projectEdit(),
      markers: state.markers,
      metadata: collectMetadata(),
      privacy: "Rapporten innehåller inga ljudsamplingar.",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${reportName}.json`);
  }
  showToast(format === "html" ? "HTML-rapporten skapades." : "JSON-rapporten skapades.");
}

const publicationLabels = Object.freeze({
  duration: "Exakt 20:00 eller dokumenterad avvikelse",
  verifiedWav: "Verifierad WAV är aktuell",
  markersReviewed: "Inga kritiska markörer är ogranskade",
  fullListen: "Hela exporten är genomlyssnad",
  boundaries: "Början och slutet är kontrollerade",
  stereo: "Stereo är provlyssnat",
  mono: "Mono är provlyssnat",
  privacy: "Röster, privat information och platsdata är bedömda",
  metadata: "Titel, avsnitt och plats är ifyllda",
  archiveSaved: "Projekt, rapport och master är sparade",
});

function currentPublicationStatus() {
  return publicationStatus({
    durationSeconds: selectionDurationSeconds(),
    verifiedCurrent: state.exportStatus === "complete" && Boolean(state.verifiedExport),
    criticalUnreviewed: state.markers.filter(marker => marker.severity === "critical" && marker.reviewStatus === "unreviewed").length,
    metadata: collectMetadata(),
    manual: state.publication.manual,
    exceptionNote: state.publication.exceptionNote,
  });
}

function renderPublicationCard() {
  if (!elements.publicationStatus || !elements.publicationAutoChecks) return;
  const result = currentPublicationStatus();
  elements.publicationStatus.textContent = result.status === "ready" ? "Redo för publicering" : "Granskning krävs";
  elements.publicationStatus.classList.toggle("is-ready", result.status === "ready");
  elements.publicationAutoChecks.innerHTML = Object.entries(result.checks).map(([key, passed]) => `<div class="${passed ? "is-pass" : "is-review"}"><span aria-hidden="true">${passed ? "✓" : "○"}</span><p>${escapeHtml(publicationLabels[key] || key)}</p></div>`).join("");
  $$('input[name="publicationCheck"]').forEach(input => { input.checked = Boolean(state.publication.manual[input.value]); });
  if (elements.publicationExceptionNote && elements.publicationExceptionNote.value !== state.publication.exceptionNote) elements.publicationExceptionNote.value = state.publication.exceptionNote;
  elements.exportEpisodeHandoff.disabled = !state.verifiedExport;
}

function episodeMasterFileName() {
  const metadata = collectMetadata();
  const episode = String(metadata.episode || "XX").replace(/\D/g, "").padStart(3, "0");
  const slug = String(metadata.title || baseName(state.file?.name || "avsnitt"))
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "avsnitt";
  return `TMH_E${episode}_${slug}_MASTER.wav`;
}

function exportEpisodeHandoff() {
  if (!state.verifiedExport) return;
  const publication = currentPublicationStatus();
  const reportId = state.lastExportReport?.reportId || state.lastExportReport?.fullFileHash?.value || null;
  const handoff = buildEpisodeHandoff({
    metadata: collectMetadata(),
    verifiedOutput: state.verifiedExport,
    sourceIdentity: state.analysis?.sourceIdentity || null,
    publication,
    reportId,
  });
  const fileName = episodeMasterFileName().replace(/_MASTER\.wav$/i, "_HANDOFF.json");
  downloadBlob(new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json" }), fileName);
  showToast("Avsnittsmanifestet skapades utan ljudsamplingar.");
}

function renderSeriesOverview() {
  if (!elements.seriesOverviewResult) return;
  const overview = state.seriesOverview;
  if (!overview?.rows?.length) {
    elements.seriesOverviewResult.innerHTML = "<p>Inga tidigare verifierade rapporter inlästa.</p>";
    return;
  }
  const cell = (value, digits = 1) => finite(value) === null ? "saknas" : formatDecimal(value, digits);
  const rows = overview.rows.map(row => `<tr><th>${escapeHtml(row.id)}</th><td>${finite(row.durationSeconds) === null ? "saknas" : formatTime(row.durationSeconds, false)}</td><td>${cell(row.integratedLufs)}</td><td>${cell(row.truePeakDbtp)}</td><td>${cell(row.loudnessRangeLu)}</td><td>${cell(row.plrLu)}</td><td>${cell(row.channelBalanceDb)}</td><td>${cell(row.monoDeltaDb)}</td></tr>`).join("");
  const med = overview.statistics;
  elements.seriesOverviewResult.innerHTML = `<p>${overview.count} verifierade rapporter. Medianer visas för jämförelse, ingen normalisering görs.</p><table><thead><tr><th>Rapport</th><th>Längd</th><th>LUFS-I</th><th>dBTP</th><th>LRA</th><th>PLR</th><th>Balans</th><th>Mono Δ</th></tr></thead><tbody>${rows}<tr><th>Median</th><td>${finite(med.durationSeconds.median) === null ? "saknas" : formatTime(med.durationSeconds.median, false)}</td><td>${cell(med.integratedLufs.median)}</td><td>${cell(med.truePeakDbtp.median)}</td><td>${cell(med.loudnessRangeLu.median)}</td><td>${cell(med.plrLu.median)}</td><td>${cell(med.channelBalanceDb.median)}</td><td>${cell(med.monoDeltaDb.median)}</td></tr></tbody></table>`;
}

async function importSeriesReports(files) {
  const reports = [];
  for (const file of Array.from(files || [])) {
    try { reports.push(JSON.parse(await file.text())); }
    catch { showToast(`${file.name} är inte en giltig JSON-rapport.`, "error", 7000); }
  }
  state.seriesOverview = summarizeSeriesReports(reports);
  renderSeriesOverview();
}

function startExport() {
  if (!state.file || state.exportStatus === "running") return;
  if (!state.trimEditor.applied) {
    showToast("Tillämpa trimfönstret eller återgå till det aktiva urvalet före export.", "error", 7000);
    return;
  }
  const selectedProfile = $("input[name='exportProfile']:checked")?.value;
  const edited = Math.abs(state.trim.gainDb) > 1e-9 || state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0;
  if (selectedProfile === "sample-payload-trim" && edited) {
    showToast("Sample-payload-identiskt trimutdrag tillåter inte gain eller toningar. Välj Redigerad WAV-master eller återställ ingreppen.", "error", 9000);
    return;
  }
  if (!state.capabilities.workers) {
    showToast("Den här webbläsaren saknar Worker-stöd som krävs för storfilsexport.", "error");
    return;
  }
  try {
    state.lastExportReport = null;
    state.verifiedExport = null;
    if (elements.verifiedMeasureStatus) elements.verifiedMeasureStatus.textContent = "Ny export verifieras efter skrivning";
    exportWorker?.terminate();
    exportWorker = new Worker("./src/export-worker.js", { type: "module" });
    exportWorker.onmessage = (event) => handleExportMessage(event.data);
    const jobId = nextJobId("export");
    state.jobs.export = jobId;
    exportWorker.onerror = (event) => handleExportMessage({ type: "error", jobId, operation: "export", message: event.message || "Exportmotorn kunde inte starta." });
    state.exportStatus = "running";
    renderPublicationCard();
    syncTrimHud();
    elements.exportAudio.disabled = true;
    elements.exportAudio.textContent = "Export pågår";
    updateExportProgress(0, "Förbereder blockvis WAV-export");
    exportWorker.postMessage({
      type: "export",
      jobId,
      file: state.file,
      options: {
        startFrame: state.trim.startFrame,
        endFrame: state.trim.endFrame,
        globalGainDb: state.trim.gainDb,
        enforceTruePeakCeiling: state.series.status === "applied",
        truePeakCeilingDbtp: state.series.ceilingDbtp,
        fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
        fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
        fileName: episodeMasterFileName(),
        preferOpfs: true,
        profile: selectedProfile,
      },
    });
    emitState("export-started");
  } catch (error) {
    handleExportMessage({ type: "error", message: error.message });
  }
}

function handleExportMessage(data = {}) {
  const operation = data.operation || "export";
  if (["storage-list", "storage-remove", "storage-clear", "storage-get"].includes(operation)) {
    if (!isCurrentJob("storage", data)) return;
    if (["storage-list", "result", "error", "cancelled"].includes(data.type)) state.jobs.storage = null;
    if (Array.isArray(data.items)) {
      state.storedExports = data.items.map((item) => ({ ...item, name: item.fileName || item.name, status: item.status || "complete" }));
      renderStoredExports();
    }
    if (data.type === "result") {
      const output = data.output || data.blob || data.file || data.result?.output || data.result?.file;
      if (output instanceof Blob) downloadBlob(output, data.fileName || data.result?.fileName || "ljudr-export.wav");
      if (data.items || data.result?.items) state.storedExports = data.items || data.result.items;
      renderStoredExports();
      if (["storage-remove", "storage-clear"].includes(operation)) requestStoredExports();
    }
    if (data.type === "error") showToast(data.message || "Den lokala arbetsfilen kunde inte hanteras.", "error");
    return;
  }
  if (!isCurrentJob("export", data)) return;
  if (data.type === "progress") {
    updateExportProgress(data.fraction, data.message || "Exporterar ljud");
    return;
  }
  if (data.type === "cancelled") {
    state.jobs.export = null;
    state.exportStatus = "idle";
    elements.exportAudio.disabled = false;
    elements.exportAudio.textContent = "Exportera ljudfil";
    updateExportProgress(0, "Exporten avbröts och partiell arbetsfil rensades");
    showToast("Exporten avbröts. Ingen ofullständig WAV behölls.");
    requestStoredExports();
    return;
  }
  if (data.type === "result" || data.blob || data.output) {
    const blob = data.blob || data.output || data.result?.blob || data.result?.output;
    const fileName = data.fileName || data.result?.fileName || `${baseName(state.file?.name)}_trim.wav`;
    if (!(blob instanceof Blob)) {
      handleExportMessage({ type: "error", message: "Exportmotorn returnerade ingen ljudfil." });
      return;
    }
    state.lastExportReport = data.report || data.result?.report || null;
    state.jobs.export = null;
    state.regionAnalysis = data.preflight || data.result?.preflight || state.regionAnalysis;
    state.regionStatus = state.regionAnalysis ? "complete" : state.regionStatus;
    state.verifiedExport = data.verifiedOutput || data.result?.verifiedOutput || null;
    state.exportStatus = "complete";
    syncTrimHud();
    elements.exportAudio.disabled = false;
    elements.exportAudio.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3ZM5 19h14v2H5v-2Z"/></svg>Exportera ljudfil';
    updateExportProgress(1, "Exporten är klar");
    if (elements.regionMeasureStatus) elements.regionMeasureStatus.textContent = "Förkontroll sparad i exportprotokollet";
    if (elements.verifiedMeasureStatus) {
      const verifiedSummary = state.verifiedExport?.summary || {};
      const lufs = finite(verifiedSummary.integratedLufs ?? verifiedSummary.lufsI);
      const peak = finite(verifiedSummary.truePeakEstimateDbtp ?? verifiedSummary.truePeakDbtp);
      elements.verifiedMeasureStatus.textContent = state.verifiedExport ? `${lufs === null ? "LUFS saknas" : `${formatDecimal(lufs, 1)} LUFS-I`} · ${peak === null ? "TP saknas" : `${formatDecimal(peak, 1)} dBTP`}` : "Exportmotorn returnerade ingen verifiering";
    }
    downloadBlob(blob, fileName);
    if (data.storage || data.result?.storage) requestStoredExports();
    else {
      state.storedExports = [{ id: `memory-${Date.now()}`, name: fileName, size: blob.size, createdAt: new Date().toISOString(), status: "complete", blob }, ...state.storedExports];
      renderStoredExports();
    }
    showToast("Ljudfilen skapades lokalt och är redo att sparas.", "info", 7000);
    renderPublicationCard();
    emitState("export-complete");
    return;
  }
  if (data.type === "error" || data.error) {
    state.jobs.export = null;
    state.exportStatus = "error";
    elements.exportAudio.disabled = false;
    elements.exportAudio.textContent = "Försök exportera igen";
    const clippingRisk = data.code === "PCM_CLAMPING_RISK";
    const message = clippingRisk
      ? "Exporten stoppades före omkodning eftersom synlig positiv gain riskerar att klampa PCM-sampel. Sänk global gain. Ingen dold toppsänkning görs."
      : data.message || data.error || "Exporten misslyckades.";
    updateExportProgress(0, message);
    showToast(message, "error", clippingRisk ? 12000 : 9000);
    if (clippingRisk) {
      elements.gainNotice.hidden = false;
      elements.gainNotice.textContent = "PCM-förkontrollen stoppade exporten innan ljudfilen ändrades. Sänk den synliga globala gainen.";
      updateCapabilities(state.capabilities.analysis, true);
    } else {
      updateCapabilities(state.capabilities.analysis, false);
    }
    emitState("export-error");
  }
}

function cancelExportJob() {
  if (!state.jobs.export || state.exportStatus !== "running") return;
  exportWorker?.postMessage({ type: "cancel", jobId: state.jobs.export, operation: "export" });
  state.exportStatus = "cancelling";
  updateExportProgress(0, "Avbryter och rensar partiell arbetsfil");
}

function requestStoredExports() {
  if (!exportWorker) return;
  const jobId = nextJobId("storage");
  state.jobs.storage = jobId;
  exportWorker.postMessage({ type: "storage-list", jobId });
}

function renderStoredExports() {
  if (!elements.storedExportsList) return;
  if (!state.storedExports.length) {
    elements.storedExportsList.innerHTML = '<li class="list-placeholder">Inga lokala arbetsfiler</li>';
    return;
  }
  elements.storedExportsList.innerHTML = state.storedExports.map((item) => {
    const complete = item.status === "complete";
    const status = complete ? "Komplett" : item.status === "partial" ? "Ofullständig kraschrest" : escapeHtml(item.status || "Okänd");
    const download = complete ? `<button class="button button-secondary button-small" type="button" data-storage-download="${escapeHtml(item.id || item.name)}">Hämta igen</button>` : "";
    return `<li class="stored-export-item" data-storage-id="${escapeHtml(item.id || item.name)}"><div><strong>${escapeHtml(item.name || "WAV-export")}</strong><small>${formatBytes(item.size || 0)} · ${status} · ${item.createdAt ? new Date(item.createdAt).toLocaleString("sv-SE") : "tid saknas"}</small></div><div>${download}<button class="button button-quiet button-small" type="button" data-storage-remove="${escapeHtml(item.id || item.name)}">Radera</button></div></li>`;
  }).join("");
}

function ensureStorageWorker() {
  if (exportWorker) return exportWorker;
  exportWorker = new Worker("./src/export-worker.js", { type: "module" });
  exportWorker.onmessage = (event) => handleExportMessage(event.data);
  return exportWorker;
}

function sendStorageCommand(type, id = null) {
  if (!state.capabilities.workers) return;
  const jobId = nextJobId("storage");
  state.jobs.storage = jobId;
  ensureStorageWorker().postMessage({ type, operation: type, jobId, id });
}

function handleStoredExportAction(event) {
  const download = event.target.closest("[data-storage-download]");
  const remove = event.target.closest("[data-storage-remove]");
  if (download) {
    const item = state.storedExports.find((candidate) => String(candidate.id || candidate.name) === download.dataset.storageDownload);
    if (item?.blob instanceof Blob) downloadBlob(item.blob, item.name || "ljudr-export.wav");
    else sendStorageCommand("storage-get", download.dataset.storageDownload);
  }
  if (remove) {
    const item = state.storedExports.find((candidate) => String(candidate.id || candidate.name) === remove.dataset.storageRemove);
    if (item?.blob) {
      state.storedExports = state.storedExports.filter((candidate) => candidate !== item);
      renderStoredExports();
    } else sendStorageCommand("storage-remove", remove.dataset.storageRemove);
  }
}

function clearStoredExports() {
  state.storedExports = state.storedExports.filter((item) => !item.blob);
  renderStoredExports();
  if (state.capabilities.opfs) sendStorageCommand("storage-clear");
  else { state.storedExports = []; renderStoredExports(); }
}

function setExportProfile(profile, options = {}) {
  const hasEdits = state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0 || Math.abs(state.trim.gainDb) > 1e-9;
  if (profile === "edited-wav" && validBitsTransformBlocked()) {
    const trimRadio = $("input[name='exportProfile'][value='sample-payload-trim']");
    if (trimRadio) trimRadio.checked = true;
    state.exportProfile = "sample-payload-trim";
    showToast("Källans validBits avviker från containerstorleken. Analys och sample-payload-identisk trim är tillåtna, men omräkning blockeras.", "error", 9000);
    return;
  }
  if (profile === "sample-payload-trim" && hasEdits && !options.force) {
    const editedRadio = $("input[name='exportProfile'][value='edited-wav']");
    if (editedRadio) editedRadio.checked = true;
    showToast("Återställ gain och toningar innan du väljer ett sample-payload-identiskt trimutdrag.", "error", 8000);
    return;
  }
  state.exportProfile = profile;
  const edited = profile === "edited-wav";
  [elements.fadeInToggle, elements.fadeOutToggle, elements.gainNumber, elements.gainRange].forEach((control) => { if (control) control.disabled = !edited; });
  $$("[data-fade-preset]").forEach((button) => { button.disabled = !edited || button.closest("[aria-disabled='true']"); });
  $(".fade-section")?.classList.toggle("is-profile-disabled", !edited);
  $(".gain-section")?.classList.toggle("is-profile-disabled", !edited);
  if (!edited && (state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0 || Math.abs(state.trim.gainDb) > 1e-9)) {
    elements.exportAudio.disabled = true;
    showToast("Återställ gain och toningar för ett sample-payload-identiskt trimutdrag, eller välj Redigerad WAV-master.", "error", 8000);
  } else if (state.exportStatus !== "running") elements.exportAudio.disabled = false;
  updateExportSummary();
  if (options.dirty !== false) state.dirty = true;
  emitState("export-profile");
}

function syncAuditionUi() {
  if (!elements.auditionStatus) return;
  const preview = state.monitoring.previewMode === "source" ? "Källkontext: inga toningar eller nivåval hörs." : "Exportförhandsvisning: exakt trim, toningar och synlig global gain hörs.";
  const monoSource = (state.analysis?.format?.channels ?? state.fileInfo?.channels) === 1;
  const mode = monoSource ? "Monokällan till båda öron" : { stereo: "Stereo", left: "Vänster till båda öron", right: "Höger till båda öron", mono: "Mono som 0,5 × (L + R)" }[state.monitoring.channelMode];
  elements.auditionStatus.textContent = `${preview} Monitor: ${mode}. Monitorval påverkar aldrig export.`;
}

let waitingServiceWorker = null;
let serviceWorkerRegistration = null;
let updateCheckPromise = null;
let reloadWhenSafe = false;

function hasUnsafeUpdateState() {
  return state.dirty || Object.values(state.jobs).some(Boolean);
}

function applyWaitingUpdate() {
  if (hasUnsafeUpdateState()) {
    showToast("Spara projektet och avsluta pågående jobb innan appen uppdateras.", "error", 7000);
    return;
  }
  waitingServiceWorker?.postMessage({ type: "SKIP_WAITING" });
}

function maybeActivateWaitingUpdate() {
  if (!waitingServiceWorker || hasUnsafeUpdateState()) return false;
  waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
  return true;
}

async function checkForAppUpdate() {
  if (!serviceWorkerRegistration || !navigator.onLine) return;
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = serviceWorkerRegistration.update()
    .catch(() => {})
    .finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

function watchServiceWorkerRegistration(registration) {
  serviceWorkerRegistration = registration;
  const showWaiting = (worker) => {
    if (!worker) return;
    waitingServiceWorker = worker;
    if (!maybeActivateWaitingUpdate()) elements.updateBanner.hidden = false;
  };
  showWaiting(registration.waiting);
  registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) showWaiting(worker); });
  });
  checkForAppUpdate();
}

function updateCapabilities(analysisAvailable = state.capabilities.analysis, exportAvailable = state.capabilities.export) {
  state.capabilities.analysis = analysisAvailable;
  state.capabilities.export = exportAvailable;
  const allCore = analysisAvailable && exportAvailable;
  elements.capabilityStatus.textContent = allCore ? "Redo" : "Begränsat";
  elements.capabilityList.innerHTML = `
    <li><span>Analysmotor</span><strong>${analysisAvailable ? "Tillgänglig" : "Inte tillgänglig"}</strong></li>
    <li><span>WAV-export</span><strong>${exportAvailable ? "Tillgänglig" : "Inte tillgänglig"}</strong></li>
    <li><span>Storfilslagring</span><strong>${state.capabilities.opfs ? "OPFS tillgängligt" : "Minnesreserv"}</strong></li>
    <li><span>Projektfil</span><strong>${state.capabilities.projectModule ? "Full modul" : "Inbyggd reserv"}</strong></li>`;
}

function zoomTimeline(direction) {
  const duration = durationSeconds();
  if (!duration) return;
  const currentStart = state.view.startSeconds;
  const currentEnd = state.view.endSeconds || duration;
  const currentLength = currentEnd - currentStart;
  const center = state.playback.currentSeconds >= currentStart && state.playback.currentSeconds <= currentEnd
    ? state.playback.currentSeconds
    : currentStart + currentLength / 2;
  const newLength = clamp(currentLength * (direction === "in" ? 0.5 : 2), Math.min(0.01, duration), duration);
  let start = center - newLength / 2;
  let end = center + newLength / 2;
  if (start < 0) { end -= start; start = 0; }
  if (end > duration) { start -= end - duration; end = duration; }
  state.view.startSeconds = Math.max(0, start);
  state.view.endSeconds = Math.min(duration, end);
  scheduleCanvasRender();
  scheduleDetailRequest();
  renderCanvasTextAlternative();
}

function fitTimeline() {
  state.view.startSeconds = 0;
  state.view.endSeconds = durationSeconds();
  state.view.detail = null;
  scheduleCanvasRender();
  scheduleDetailRequest();
  renderCanvasTextAlternative();
}

function fitTrimSelection() {
  const duration = durationSeconds();
  const selection = selectionDurationSeconds();
  if (!(duration > 0) || !(selection > 0)) return;
  const padding = Math.min(Math.max(selection * 0.04, 0.25), Math.max(0, (duration - selection) / 2));
  state.view.startSeconds = Math.max(0, state.trim.startSeconds - padding);
  state.view.endSeconds = Math.min(duration, state.trim.endSeconds + padding);
  state.view.detail = null;
  scheduleCanvasRender();
  scheduleDetailRequest();
  renderCanvasTextAlternative();
}

function updateTimelineExpansionButtons(cardId = null) {
  $$('[data-expand-timeline]').forEach(button => {
    const active = Boolean(cardId && button.dataset.expandTimeline === cardId);
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "Stäng expanderad vy" : "Expandera tidslinjen";
  });
}

function restoreExpandedTimeline({ restoreFocus = true } = {}) {
  const expanded = $(".timeline-card.is-timeline-expanded");
  if (expanded) {
    expanded.classList.remove("is-timeline-expanded");
    expanded.removeAttribute("role");
    expanded.removeAttribute("aria-modal");
    expanded.removeAttribute("aria-label");
    expanded.removeAttribute("tabindex");
  }
  expandedTimelineInert.forEach(({ element, inert }) => { element.inert = inert; });
  expandedTimelineInert = [];
  document.body.classList.remove("has-expanded-timeline");
  updateTimelineExpansionButtons();
  if (restoreFocus && expandedTimelineRestoreFocus?.isConnected) expandedTimelineRestoreFocus.focus();
  expandedTimelineRestoreFocus = null;
}

function isolateExpandedTimeline(card) {
  let branch = card;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    [...parent.children].forEach(element => {
      if (element === branch || !(element instanceof HTMLElement)) return;
      expandedTimelineInert.push({ element, inert: element.inert });
      element.inert = true;
    });
    if (parent === document.body) break;
    branch = parent;
  }
}

function timelineFocusableElements(card) {
  return [...card.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function toggleTimelineExpansion(cardId, force = null) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const next = force === null ? !card.classList.contains("is-timeline-expanded") : Boolean(force);
  if (!next) {
    restoreExpandedTimeline();
    window.setTimeout(scheduleCanvasRender, 30);
    return;
  }
  if ($(".timeline-card.is-timeline-expanded")) restoreExpandedTimeline({ restoreFocus: false });
  expandedTimelineRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  card.classList.add("is-timeline-expanded");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Expanderad ljudtidslinje");
  card.tabIndex = -1;
  isolateExpandedTimeline(card);
  document.body.classList.add("has-expanded-timeline");
  updateTimelineExpansionButtons(cardId);
  window.setTimeout(() => {
    scheduleCanvasRender();
    const closeButton = card.querySelector(`[data-expand-timeline="${cardId}"]`);
    (closeButton || timelineFocusableElements(card)[0] || card).focus();
  }, 30);
}

function panTimeline(deltaSeconds) {
  const duration = durationSeconds();
  const length = state.view.endSeconds - state.view.startSeconds;
  let start = clamp(state.view.startSeconds + deltaSeconds, 0, Math.max(0, duration - length));
  state.view.startSeconds = start;
  state.view.endSeconds = Math.min(duration, start + length);
  scheduleCanvasRender();
  scheduleDetailRequest();
}

function setZoomAround(centerSeconds, newLength) {
  const duration = durationSeconds();
  const length = clamp(newLength, Math.min(0.01, duration), duration);
  let start = centerSeconds - length / 2;
  start = clamp(start, 0, Math.max(0, duration - length));
  state.view.startSeconds = start;
  state.view.endSeconds = Math.min(duration, start + length);
  scheduleCanvasRender();
  scheduleDetailRequest();
}

function bindTimelineGestures(canvas) {
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", (event) => {
    if (!state.file) return;
    canvas.setPointerCapture(event.pointerId);
    timelinePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (timelinePointers.size === 1) timelineGesture = { startX: event.clientX, startView: { start: state.view.startSeconds, end: state.view.endSeconds }, moved: false };
    if (timelinePointers.size === 2) {
      const points = [...timelinePointers.values()];
      timelineGesture = { distance: Math.abs(points[1].x - points[0].x) || 1, startView: { start: state.view.startSeconds, end: state.view.endSeconds } };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!timelinePointers.has(event.pointerId)) return;
    timelinePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const viewLength = timelineGesture.startView.end - timelineGesture.startView.start;
    if (timelinePointers.size === 2) {
      const points = [...timelinePointers.values()];
      const distance = Math.abs(points[1].x - points[0].x) || 1;
      const rect = canvas.getBoundingClientRect();
      const centerX = (points[0].x + points[1].x) / 2;
      const ratio = clamp((centerX - rect.left - 58) / Math.max(1, rect.width - 68), 0, 1);
      const center = timelineGesture.startView.start + ratio * viewLength;
      setZoomAround(center, viewLength * timelineGesture.distance / distance);
      return;
    }
    if (timelinePointers.size === 1 && timelineGesture?.startX !== undefined) {
      const deltaPixels = event.clientX - timelineGesture.startX;
      if (Math.abs(deltaPixels) > 5) timelineGesture.moved = true;
      const secondsPerPixel = viewLength / Math.max(1, canvas.clientWidth - 68);
      const start = timelineGesture.startView.start - deltaPixels * secondsPerPixel;
      const duration = durationSeconds();
      state.view.startSeconds = clamp(start, 0, Math.max(0, duration - viewLength));
      state.view.endSeconds = state.view.startSeconds + viewLength;
      scheduleCanvasRender();
      scheduleDetailRequest();
    }
  });
  const release = (event) => {
    if (timelinePointers.size === 1 && !timelineGesture?.moved) {
      state.playback.currentSeconds = canvasTimeFromPointer(canvas, event);
      elements.audio.currentTime = state.playback.currentSeconds;
      syncTrimUi();
    }
    timelinePointers.delete(event.pointerId);
    if (!timelinePointers.size) timelineGesture = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("keydown", (event) => {
    const length = state.view.endSeconds - state.view.startSeconds;
    if (["ArrowLeft", "ArrowRight", "+", "=", "-", "0", "Home"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") panTimeline(-length * (event.shiftKey ? 0.5 : 0.1));
    if (event.key === "ArrowRight") panTimeline(length * (event.shiftKey ? 0.5 : 0.1));
    if (event.key === "+" || event.key === "=") zoomTimeline("in");
    if (event.key === "-") zoomTimeline("out");
    if (event.key === "0" || event.key === "Home") fitTimeline();
  });
}

function helpTopicLive(topic) {
  const summary = state.analysis?.summary || {};
  const integrated = finite(summary.integratedLufs ?? summary.lufsI);
  const truePeak = finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
  const samplePeak = finite(summary.samplePeakDbfs ?? summary.samplePeak);
  const momentary = finite(summary.momentaryMaxLufs);
  const shortTerm = finite(summary.shortTermMaxLufs);
  const lra = finite(summary.loudnessRangeLu ?? summary.lra);
  const plr = finite(summary.plrEstimateLu) ?? (integrated === null || truePeak === null ? null : truePeak - integrated);
  const values = {
    momentary: [momentary === null ? "Saknas" : `${formatDecimal(momentary, 2)} LUFS`, integrated === null || momentary === null ? "Analysera för jämförelse" : `${formatDecimal(momentary - integrated, 2)} LU över LUFS I`],
    "short-term": [shortTerm === null ? "Saknas" : `${formatDecimal(shortTerm, 2)} LUFS`, integrated === null || shortTerm === null ? "Analysera för jämförelse" : `${formatDecimal(shortTerm - integrated, 2)} LU över LUFS I`],
    lufs: [integrated === null ? "Saknas" : `${formatDecimal(integrated, 2)} LUFS`, integrated === null ? "Välj fil och analysera" : `${levelClass(integrated, assessmentProfiles[state.assessment.recordingType]?.bands)?.label || "Ingen klassificering"} för valt sammanhang`],
    lra: [lra === null ? "Saknas" : `${formatDecimal(lra, 2)} LU`, lra === null ? "Analysera för jämförelse" : lra >= 12 ? "Stor dynamisk spridning" : lra >= 6 ? "Måttlig dynamisk spridning" : "Begränsad dynamisk spridning"],
    plr: [plr === null ? "Saknas" : `${formatDecimal(plr, 2)} dB`, plr === null ? "Kräver LUFS I och True Peak" : plr >= 14 ? "Stor skillnad mellan topp och helhet" : plr >= 9 ? "Måttlig skillnad mellan topp och helhet" : "Begränsad skillnad mellan topp och helhet"],
    "sample-peak": [samplePeak === null ? "Saknas" : `${formatDecimal(samplePeak, 2)} dBFS`, truePeak === null || samplePeak === null ? "Analysera för jämförelse" : `True Peak-estimatet är ${formatDecimal(truePeak - samplePeak, 2)} dB högre`],
    "peak-time": [$("#deepSamplePeakTime")?.textContent || "Saknas", "Jämför med toppmarkörerna i tidslinjen"],
    peak: [truePeak === null ? "Saknas" : `${formatDecimal(truePeak, 2)} dBTP`, truePeak === null ? "Analysera för jämförelse" : `${formatDecimal(-2 - truePeak, 2)} dB till verktygets försiktiga orienteringstak på minus 2 dBTP`],
    rms: [finite(summary.rmsDbfs) === null ? "Saknas" : `${formatDecimal(summary.rmsDbfs, 2)} dBFS`, integrated === null || finite(summary.rmsDbfs) === null ? "Analysera för jämförelse" : `${formatDecimal(integrated - summary.rmsDbfs, 2)} dB skillnad mot LUFS I`],
    crest: [finite(summary.crestFactorDb) === null ? "Saknas" : `${formatDecimal(summary.crestFactorDb, 2)} dB`, plr === null ? "Jämför med PLR efter analys" : `PLR är ${formatDecimal(plr, 2)} dB`],
    correlation: [finite(summary.correlation) === null ? "Saknas" : formatDecimal(summary.correlation, 4), finite(summary.midSideRatioDb) === null ? "Jämför med Mid Side efter analys" : `Mid Side-förhållandet är ${formatDecimal(summary.midSideRatioDb, 2)} dB`],
    stereo: [finite(summary.channelBalanceDb) === null ? "Saknas" : `${formatDecimal(summary.channelBalanceDb, 2)} dB`, finite(summary.channelBalanceDb) === null ? "Analysera för jämförelse" : Math.abs(summary.channelBalanceDb) < 1 ? "Liten sammanlagd energiskillnad" : "Tydlig sammanlagd energiskillnad, kontrollera scenen"],
    "mid-side": [finite(summary.midSideRatioDb) === null ? "Saknas" : `${formatDecimal(summary.midSideRatioDb, 2)} dB`, finite(summary.correlation) === null ? "Jämför med korrelation efter analys" : `Korrelationen är ${formatDecimal(summary.correlation, 4)}`],
    dc: [$("#deepDcLeft")?.textContent || "Saknas", `Höger kanal: ${$("#deepDcRight")?.textContent || "saknas"}`],
    overrange: [$("#deepOverrange")?.textContent || "Saknas", state.fileInfo?.encoding === "IEEE_FLOAT" ? "Floatkälla, kontrollera före PCM export" : "Inte tillämpligt på vanlig PCM på samma sätt"],
    "invalid-float": [$("#deepInvalid")?.textContent || "Saknas", "Noll är det förväntade tekniska utfallet"],
    assessment: [assessmentProfiles[state.assessment.recordingType]?.label || "Annan inspelning", state.assessment.purpose === "distribution" ? "Bedöms för publicering" : "Bedöms som original eller arkivmaster"],
    fades: [`In ${formatDecimal(state.trim.fadeInSeconds, 2)} s, ut ${formatDecimal(state.trim.fadeOutSeconds, 2)} s`, `Valt utsnitt är ${formatTime(Math.max(0, state.trim.endSeconds - state.trim.startSeconds))}`],
    gain: [`${state.trim.gainDb >= 0 ? "+" : ""}${formatDecimal(state.trim.gainDb, 1)} dB`, truePeak === null ? "Toppjämförelse saknas" : `Beräknat True Peak före exportkontroll: ${formatDecimal(truePeak + state.trim.gainDb, 2)} dBTP`],
    "series-reference": [elements.seriesStateValue?.textContent || "Bevara oförändrat", elements.seriesGainValue?.textContent || "Inte beräknat"],
    monitoring: [state.monitoring.levelMatched ? "Utjämnad" : "Faktisk nivåskillnad", `Medhörningsvolym ${formatDecimal(state.monitoring.volume * 100, 0)} procent`],
    "export-profiles": [$(`input[name='exportProfile']:checked`)?.value || "Ingen", "Se exportsammanfattningen för alla val"],
    "preservation-export": ["WAV med källformat", technicalDescription()],
    "distribution-export": ["WAV distributionsmaster", technicalDescription()],
    "export-status": [elements.capabilityStatus?.textContent || "Kontrollerar", state.capabilities.opfs ? "OPFS är tillgängligt" : "Minnesreserv används"],
    "export-safety": [state.analysis ? "Analys finns" : "Analys saknas", elements.exportRecommendationText?.textContent || "Ingen rekommendation ännu"],
  };
  return values[topic] || ["Se aktuell vy", "Relatera alltid värdet till inspelningstyp och användning"];
}

function openHelp(section = "principles") {
  renderHelp(section);
  if (typeof elements.helpDialog.showModal === "function") elements.helpDialog.showModal();
  else elements.helpDialog.setAttribute("open", "");
}

function renderHelp(section) {
  const topic = helpTopics[section];
  if (topic) {
    const [current, comparison] = helpTopicLive(section);
    elements.helpCopy.innerHTML = `
      <h3>${escapeHtml(topic.title)}</h3>
      <p class="help-lead">${escapeHtml(topic.meaning)}</p>
      <dl class="help-facts">
        <div><dt>Aktuellt värde eller val</dt><dd>${escapeHtml(current)}</dd></div>
        <div><dt>Ställt i relation till</dt><dd>${escapeHtml(comparison)}</dd></div>
        <div><dt>Ska läsas tillsammans med</dt><dd>${escapeHtml(topic.relation)}</dd></div>
        <div><dt>Typ av slutsats</dt><dd>Regelbaserad vägledning. Ingen AI och ingen automatisk ljudändring.</dd></div>
      </dl>
      <div class="help-recommendation"><strong>Rekommendation</strong><p>${escapeHtml(topic.recommendation)}</p></div>
      <div class="help-caution"><strong>Begränsning</strong><p>${escapeHtml(topic.caution)}</p></div>`;
  } else {
    const content = helpContent[section] || helpContent.principles;
    elements.helpCopy.innerHTML = `<h3>${content.title}</h3>${content.body}`;
  }
  $$("[data-help-section]").forEach((button) => button.classList.toggle("is-active", !topic && button.dataset.helpSection === section));
}

function bindEvents() {
  document.addEventListener("keydown", event => {
    const expanded = $(".timeline-card.is-timeline-expanded");
    if (!expanded) return;
    if (event.key === "Escape") {
      event.preventDefault();
      toggleTimelineExpansion(expanded.id, false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = timelineFocusableElements(expanded);
    if (!focusable.length) {
      event.preventDefault();
      expanded.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !expanded.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !expanded.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  $$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $$('[data-mode-link]').forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); setMode(link.dataset.modeLink); }));
  elements.audioInput.addEventListener("change", () => openAudioFile(elements.audioInput.files?.[0]));
  elements.changeFile.addEventListener("click", () => elements.audioInput.click());
  ["dragenter", "dragover"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((name) => elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  }));
  elements.dropZone.addEventListener("drop", (event) => openAudioFile(event.dataTransfer?.files?.[0]));

  elements.analyzeButton.addEventListener("click", startAnalysis);
  elements.cancelAnalysis.addEventListener("click", () => {
    if (!state.jobs.analysis) return;
    analysisWorker?.postMessage({ type: "cancel", jobId: state.jobs.analysis, operation: "analyze" });
    elements.cancelAnalysis.disabled = true;
    updateAnalysisProgress(0, "Avbryter efter aktuellt block");
  });
  elements.cancelRegion.addEventListener("click", () => {
    if (state.jobs.region) analysisWorker?.postMessage({ type: "cancel", jobId: state.jobs.region, operation: "analyze-region" });
  });
  elements.cancelDetail.addEventListener("click", () => {
    if (state.jobs.detail) analysisWorker?.postMessage({ type: "cancel", jobId: state.jobs.detail, operation: "waveform-detail" });
  });
  elements.recordingType.addEventListener("change", () => {
    state.assessment.recordingType = elements.recordingType.value;
    state.dirty = true;
    renderAssessmentReflection();
    updateExportRecommendation();
    emitState("assessment-context");
  });
  elements.assessmentPurpose.addEventListener("change", () => {
    state.assessment.purpose = elements.assessmentPurpose.value;
    state.dirty = true;
    renderAssessmentReflection();
    updateExportRecommendation();
    emitState("assessment-purpose");
  });
  elements.reviewFindings.addEventListener("click", () => {
    state.markerFilter = "all";
    $$('[data-marker-filter]').forEach((button) => {
      const active = button.dataset.markerFilter === "all";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderMarkers();
    elements.markerList.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  });
  elements.openRecommendations.addEventListener("click", () => {
    setMode("trim");
    requestRegionAnalysis();
    window.setTimeout(() => $("#recommendationWorkbench")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 120);
  });
  elements.preserveFromAnalysis.addEventListener("click", () => {
    preserveSeries();
    showToast("Bevara oförändrat är valt. Inga förslag har applicerats.");
  });
  elements.saveProject.addEventListener("click", saveProjectFile);
  elements.openProject.addEventListener("click", () => elements.projectInput.click());
  elements.projectInput.addEventListener("change", () => readProject(elements.projectInput.files?.[0]));

  $$('[data-zoom]').forEach((button) => button.addEventListener("click", () => zoomTimeline(button.dataset.zoom)));
  $("#fitTimelineButton").addEventListener("click", fitTimeline);
  $("#fitTrimButton").addEventListener("click", fitTimeline);
  $$('[data-fit-selection]').forEach(button => button.addEventListener("click", fitTrimSelection));
  $$('[data-expand-timeline]').forEach(button => button.addEventListener("click", () => toggleTimelineExpansion(button.dataset.expandTimeline)));
  $$(".legend-chip").forEach((button) => button.addEventListener("click", () => {
    const track = button.dataset.track;
    state.view.tracks[track] = !state.view.tracks[track];
    $$(`[data-track="${track}"]`).forEach(control => {
      control.classList.toggle("is-on", state.view.tracks[track]);
      control.setAttribute("aria-pressed", String(state.view.tracks[track]));
    });
    scheduleCanvasRender();
  }));

  bindTimelineGestures(elements.analysisCanvas);
  elements.trimCanvas.addEventListener("pointerdown", (event) => {
    if (!state.trimEditor.unlocked) {
      trimGesture = {
        pointerId: event.pointerId,
        target: null,
        startX: event.clientX,
        startTime: canvasTimeFromPointer(elements.trimCanvas, event),
        startBoundary: state.trim.startSeconds,
        endBoundary: state.trim.endSeconds,
        moved: false,
      };
      return;
    }
    activeTrimHandle = findTrimHandle(elements.trimCanvas, event);
    if (activeTrimHandle) elements.trimCanvas.setPointerCapture(event.pointerId);
    trimGesture = {
      pointerId: event.pointerId,
      target: activeTrimHandle,
      startX: event.clientX,
      startTime: canvasTimeFromPointer(elements.trimCanvas, event),
      startBoundary: state.trim.startSeconds,
      endBoundary: state.trim.endSeconds,
      moved: false,
    };
  });
  elements.trimCanvas.addEventListener("pointermove", (event) => {
    if (!trimGesture || trimGesture.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - trimGesture.startX) > 5) trimGesture.moved = true;
    if (!trimGesture.moved || !trimGesture.target) return;
    const time = canvasTimeFromPointer(elements.trimCanvas, event);
    if (trimGesture.target === "window") {
      setTrimWindowPosition(trimGesture.startBoundary + time - trimGesture.startTime, { commit: false });
    } else if (trimGesture.target === "start") {
      state.trim.startSeconds = clamp(time, 0, Math.max(0, state.trim.endSeconds - 1 / sampleRate()));
      syncTrimUi({ emit: false });
    } else if (trimGesture.target === "end") {
      state.trim.endSeconds = clamp(time, Math.min(durationSeconds(), state.trim.startSeconds + 1 / sampleRate()), durationSeconds());
      syncTrimUi({ emit: false });
    }
  });
  const releaseTrim = (event, cancelled = false) => {
    if (!trimGesture || trimGesture.pointerId !== event.pointerId) return;
    const gesture = trimGesture;
    trimGesture = null;
    activeTrimHandle = null;
    if (cancelled && gesture.moved) {
      state.trim.startSeconds = gesture.startBoundary;
      state.trim.endSeconds = gesture.endBoundary;
      syncTrimUi({ emit: false });
      return;
    }
    if (cancelled) return;
    if (gesture.moved && gesture.target) {
      markTrimCandidateChanged(`Trimfönstret är ${formatTime(selectionDurationSeconds())} från ${formatTime(state.trim.startSeconds)} till ${formatTime(state.trim.endSeconds)}. Lås det när placeringen känns rätt.`);
      return;
    }
    state.playback.currentSeconds = canvasTimeFromPointer(elements.trimCanvas, event);
    elements.audio.currentTime = state.playback.currentSeconds;
    syncTrimUi();
  };
  elements.trimCanvas.addEventListener("pointerup", event => releaseTrim(event));
  elements.trimCanvas.addEventListener("pointercancel", event => releaseTrim(event, true));
  elements.trimCanvas.tabIndex = 0;
  elements.trimCanvas.addEventListener("keydown", event => {
    const step = event.shiftKey ? 10 : 1;
    if (["ArrowLeft", "ArrowRight", "+", "=", "-", "0", "Home"].includes(event.key)) event.preventDefault();
    if (event.altKey && event.key === "ArrowLeft") {
      if (requireTrimEditorUnlocked()) moveTrimWindow(-step);
    }
    else if (event.altKey && event.key === "ArrowRight") {
      if (requireTrimEditorUnlocked()) moveTrimWindow(step);
    }
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      state.playback.currentSeconds = clamp(state.playback.currentSeconds + (event.key === "ArrowLeft" ? -step : step), 0, durationSeconds());
      elements.audio.currentTime = state.playback.currentSeconds;
      syncTrimUi();
    } else if (event.key === "+" || event.key === "=") zoomTimeline("in");
    else if (event.key === "-") zoomTimeline("out");
    else if (event.key === "0") fitTrimSelection();
    else if (event.key === "Home") fitTimeline();
  });

  elements.addMarker.addEventListener("click", () => {
    elements.markerCompose.hidden = false;
    elements.markerText.focus();
  });
  $("#cancelMarkerButton").addEventListener("click", () => { elements.markerCompose.hidden = true; });
  $("#confirmMarkerButton").addEventListener("click", () => {
    const text = elements.markerText.value.trim();
    if (!text) { elements.markerText.focus(); return; }
    state.markers.push({
      id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      seconds: state.playback.currentSeconds,
      endSeconds: state.playback.currentSeconds,
      type: elements.markerType.value,
      text,
      severity: "info",
      detail: "Egen markör",
      objective: false,
      origin: "user",
      reviewStatus: "accepted",
      suggested: false,
    });
    elements.markerText.value = "";
    elements.markerCompose.hidden = true;
    renderMarkers();
    renderPublicationCard();
    state.dirty = true;
    emitState("marker-added");
  });
  elements.markerList.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-marker-jump]");
    if (jump) {
      state.playback.currentSeconds = clamp(jump.dataset.markerJump, 0, durationSeconds());
      elements.audio.currentTime = state.playback.currentSeconds;
      const marker = state.markers.find((item) => item.id === jump.dataset.markerId);
      if (marker) setZoomAround(marker.seconds, Math.max(0.25, Math.min(10, (marker.endSeconds - marker.seconds || 0) * 4 || 3)));
      state.monitoring.previewMode = "source";
      const sourceRadio = $("input[name='previewMode'][value='source']");
      if (sourceRadio) sourceRadio.checked = true;
      syncAuditionUi();
      setMode("trim");
      syncTrimUi();
      return;
    }
    const remove = event.target.closest("[data-marker-remove]");
    if (remove) {
    state.markers = state.markers.filter((marker) => marker.id !== remove.dataset.markerRemove);
      renderMarkers();
      renderPublicationCard();
      state.dirty = true;
      emitState("marker-removed");
    }
  });
  elements.markerList.addEventListener("change", (event) => {
    const select = event.target.closest("[data-marker-review]");
    if (!select) return;
    const marker = state.markers.find((item) => item.id === select.dataset.markerReview);
    if (marker) marker.reviewStatus = select.value;
    renderPublicationCard();
    state.dirty = true;
    emitState("marker-reviewed");
  });
  $$("[data-marker-filter]").forEach((button) => button.addEventListener("click", () => {
    state.markerFilter = button.dataset.markerFilter;
    $$("[data-marker-filter]").forEach((item) => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
    renderMarkers();
  }));
  elements.canvasTextContent?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-text-marker]");
    const marker = state.markers.find((item) => item.id === button?.dataset.textMarker);
    if (marker) { state.playback.currentSeconds = marker.seconds; setZoomAround(marker.seconds, Math.max(1, (marker.endSeconds - marker.seconds) * 4)); }
  });

  elements.playButton.addEventListener("click", togglePlayback);
  $("#backTenButton").addEventListener("click", () => playFrom((elements.audio.currentTime || 0) - 10));
  $("#forwardTenButton").addEventListener("click", () => playFrom((elements.audio.currentTime || 0) + 10));
  $("#jumpStartButton").addEventListener("click", () => { elements.audio.currentTime = state.trim.startSeconds; });
  $("#jumpEndButton").addEventListener("click", () => { elements.audio.currentTime = Math.max(state.trim.startSeconds, state.trim.endSeconds - 1 / sampleRate()); });
  elements.audio.addEventListener("play", () => {
    state.playback.playing = true;
    schedulePreviewEnvelope(elements.audio.currentTime);
    elements.playButton.classList.add("is-playing");
    elements.playButton.setAttribute("aria-label", "Pausa");
  });
  elements.audio.addEventListener("pause", () => {
    state.playback.playing = false;
    elements.playButton.classList.remove("is-playing");
    elements.playButton.setAttribute("aria-label", "Spela");
  });
  elements.audio.addEventListener("timeupdate", () => {
    state.playback.currentSeconds = finite(elements.audio.currentTime) ?? 0;
    if (state.playback.previewStopAt !== null && state.playback.currentSeconds >= state.playback.previewStopAt) stopPlayback();
    else if (state.monitoring.previewMode === "export" && state.playback.previewStopAt === null && state.playback.currentSeconds >= state.trim.endSeconds) stopPlayback();
    elements.currentTime.textContent = formatTime(state.playback.currentSeconds);
    scheduleCanvasRender();
  });
  elements.audio.addEventListener("loadedmetadata", () => {
    if (!state.fileInfo?.durationSeconds && Number.isFinite(elements.audio.duration)) {
      state.fileInfo = { ...(state.fileInfo || {}), durationSeconds: elements.audio.duration };
      if (!state.trim.endSeconds) state.trim.endSeconds = elements.audio.duration;
      syncTrimUi();
    }
  });
  elements.audio.addEventListener("seeked", () => schedulePreviewEnvelope(elements.audio.currentTime));
  elements.audio.addEventListener("ratechange", () => schedulePreviewEnvelope(elements.audio.currentTime));
  elements.monitorVolume.addEventListener("input", () => {
    state.monitoring.volume = clamp(elements.monitorVolume.value, 0, 1);
    state.dirty = true;
    updateMonitoringGraph();
    emitState("monitor-volume");
  });
  elements.levelMatch.addEventListener("change", () => {
    state.monitoring.levelMatched = elements.levelMatch.checked;
    state.dirty = true;
    updateMonitoringGraph();
    showToast(elements.levelMatch.checked ? "Utjämnad medhörning är på. Exporten påverkas inte." : "Medhörningen visar nu den faktiska nivåskillnaden.");
    emitState("monitoring-mode");
  });
  $$('input[name="previewMode"]').forEach((input) => input.addEventListener("change", () => {
    state.monitoring.previewMode = input.value;
    state.dirty = true;
    syncAuditionUi();
    updateMonitoringGraph();
    emitState("preview-mode");
  }));
  $$('input[name="monitorMode"]').forEach((input) => input.addEventListener("change", () => {
    state.monitoring.channelMode = input.value;
    state.dirty = true;
    syncAuditionUi();
    updateMonitoringGraph();
    emitState("monitor-mode");
  }));

  elements.toggleTrimEditor.addEventListener("click", toggleTrimEditor);
  elements.applyTrimSelection.addEventListener("click", applyTrimSelection);
  elements.revertTrimSelection.addEventListener("click", revertTrimSelection);

  elements.trimStartInput.addEventListener("change", () => {
    const value = parseTime(elements.trimStartInput.value);
    if (value === null) showToast("Starttiden kunde inte tolkas.", "error");
    else setBoundary("start", value);
  });
  elements.trimEndInput.addEventListener("change", () => {
    const value = parseTime(elements.trimEndInput.value);
    if (value === null) showToast("Sluttiden kunde inte tolkas.", "error");
    else setBoundary("end", value);
  });
  elements.trimWindowDurationInput.addEventListener("change", () => {
    if (updateTrimWindowDuration(elements.trimWindowDurationInput.value)) resizeTrimWindowToTarget();
  });
  $("#applyWindowFromStartButton").addEventListener("click", () => applyTrimWindow("start"));
  $("#applyWindowAtPlayheadButton").addEventListener("click", () => applyTrimWindow("playhead"));
  $("#applyWindowToEndButton").addEventListener("click", () => applyTrimWindow("end"));
  $$('[data-move-window]').forEach(button => button.addEventListener("click", () => moveTrimWindow(Number(button.dataset.moveWindow))));
  $("#centerWindowAtPlayheadButton").addEventListener("click", () => centerTrimWindowAt(elements.audio.currentTime || state.playback.currentSeconds));
  elements.trimHudMoveLeft.addEventListener("click", () => moveTrimWindow(-10));
  elements.trimHudMoveRight.addEventListener("click", () => moveTrimWindow(10));
  $("#trimHudOpen").addEventListener("click", () => { setMode("trim"); window.setTimeout(fitTrimSelection, 60); });
  $("#setStartAtPlayhead").addEventListener("click", () => setBoundary("start", elements.audio.currentTime || state.playback.currentSeconds));
  $("#setEndAtPlayhead").addEventListener("click", () => setBoundary("end", elements.audio.currentTime || state.playback.currentSeconds));
  $$("[data-nudge]").forEach((button) => button.addEventListener("click", () => {
    const [boundary, delta] = button.dataset.nudge.split(":");
    const current = boundary === "start" ? state.trim.startSeconds : state.trim.endSeconds;
    setBoundary(boundary, current + Number(delta));
  }));
  $$("[data-preview-boundary]").forEach((button) => button.addEventListener("click", () => previewBoundary(button.dataset.previewBoundary)));
  $("#resetTrimButton").addEventListener("click", () => {
    if (!requireTrimEditorUnlocked()) return;
    state.trim.startSeconds = 0;
    state.trim.endSeconds = durationSeconds();
    syncTrimUi({ emit: false });
    markTrimCandidateChanged("Hela källfilen är placerad i fönstret. Lås och tillämpa om det ska bli det aktiva urvalet.");
  });
  elements.fadeInToggle.addEventListener("change", () => updateFade("in", elements.fadeInNumber.value, elements.fadeInToggle.checked));
  elements.fadeOutToggle.addEventListener("change", () => updateFade("out", elements.fadeOutNumber.value, elements.fadeOutToggle.checked));
  elements.fadeInNumber.addEventListener("change", () => updateFade("in", elements.fadeInNumber.value));
  elements.fadeOutNumber.addEventListener("change", () => updateFade("out", elements.fadeOutNumber.value));
  elements.fadeInRange.addEventListener("input", () => updateFade("in", elements.fadeInRange.value));
  elements.fadeOutRange.addEventListener("input", () => updateFade("out", elements.fadeOutRange.value));
  $$('[data-fade-preset]').forEach((button) => button.addEventListener("click", () => {
    const [kind, seconds] = button.dataset.fadePreset.split(":");
    updateFade(kind, Number(seconds));
  }));
  elements.gainNumber.addEventListener("change", () => updateGain(elements.gainNumber.value));
  elements.gainRange.addEventListener("input", () => updateGain(elements.gainRange.value));
  $("#resetGainButton").addEventListener("click", () => updateGain(0));
  elements.calculateSeries.addEventListener("click", calculateSeriesProposal);
  elements.previewSeries.addEventListener("click", () => {
    if (finite(state.series.proposedGainDb) === null) return;
    state.series.status = "previewing";
    state.monitoring.previewMode = "export";
    state.monitoring.previewGainOverride = state.series.proposedGainDb;
    $("input[name='previewMode'][value='export']").checked = true;
    syncSeriesUi(); syncAuditionUi();
    playFrom(state.trim.startSeconds);
  });
  elements.applySeries.addEventListener("click", () => {
    if (finite(state.series.proposedGainDb) === null) return;
    state.series.status = "applied";
    state.monitoring.previewGainOverride = null;
    updateGain(state.series.proposedGainDb, { seriesApply: true });
    state.series.status = "applied";
    const editedRadio = $("input[name='exportProfile'][value='edited-wav']");
    if (editedRadio) editedRadio.checked = true;
    setExportProfile("edited-wav");
    syncSeriesUi();
  });
  elements.preserveSeries.addEventListener("click", preserveSeries);

  elements.metadataForm.addEventListener("input", () => {
    collectMetadata();
    state.analysisExchange.preview = null;
    state.analysisExchange.lastBundle = null;
    state.analysisExchange.lastBundleBlob = null;
    elements.analysisExchangeText.value = "";
    elements.exchangeArtifact.hidden = true;
    if (state.analysisExchange.guidanceStatus === "matched") {
      state.analysisExchange.guidanceStatus = "unverified";
      elements.guidanceOriginStatus.textContent = "gAIa, osignerad, inaktuell";
      elements.guidanceOriginStatus.className = "guidance-origin is-unverified";
      elements.guidanceVerification.textContent = "Metadata som ingick i analysunderlaget har ändrats. Skapa ett nytt underlag och importera vägledningen igen.";
      renderGuidanceSuggestions();
    }
    if (state.analysis) elements.analysisExchangeStatus.textContent = "Metadata har ändrats. Skapa och granska ett nytt analysunderlag.";
    state.dirty = true;
    renderPublicationCard();
    emitState("metadata");
  });
  $("#toggleMetadataButton").addEventListener("click", (event) => {
    const section = event.target.closest(".metadata-section");
    const collapsed = section.classList.toggle("is-collapsed");
    event.target.textContent = collapsed ? "Visa" : "Dölj";
    event.target.setAttribute("aria-expanded", String(!collapsed));
  });
  elements.exportAudio.addEventListener("click", startExport);
  elements.cancelExport.addEventListener("click", cancelExportJob);
  elements.exportReport.addEventListener("click", () => exportReport("html"));
  elements.exportJson.addEventListener("click", () => exportReport("json"));
  $$("input[name='exportProfile']").forEach((input) => input.addEventListener("change", () => setExportProfile(input.value)));
  elements.storedExportsList.addEventListener("click", handleStoredExportAction);
  elements.clearStoredExports.addEventListener("click", clearStoredExports);
  elements.runSpectralDiagnostics.addEventListener("click", requestSpectralDiagnostics);
  $$('input[name="publicationCheck"]').forEach(input => input.addEventListener("change", () => {
    state.publication.manual[input.value] = input.checked;
    state.dirty = true;
    renderPublicationCard();
    emitState("publication-check");
  }));
  elements.publicationExceptionNote.addEventListener("input", () => {
    state.publication.exceptionNote = elements.publicationExceptionNote.value.slice(0, 1_000);
    state.dirty = true;
    renderPublicationCard();
  });
  elements.exportEpisodeHandoff.addEventListener("click", exportEpisodeHandoff);
  elements.openSeriesReports.addEventListener("click", () => elements.seriesReportsInput.click());
  elements.seriesReportsInput.addEventListener("change", () => importSeriesReports(elements.seriesReportsInput.files));

  elements.openAnalysisExport.addEventListener("click", openAnalysisExchangeReview);
  elements.importGuidance.addEventListener("click", () => elements.guidanceFileInput.click());
  elements.guidanceFileInput.addEventListener("change", () => importGuidanceFile(elements.guidanceFileInput.files?.[0]));
  $("#closeAnalysisExchangeButton").addEventListener("click", () => elements.analysisExchangeDialog.close());
  $("#cancelAnalysisExchangeButton").addEventListener("click", () => elements.analysisExchangeDialog.close());
  $("#refreshAnalysisPreviewButton").addEventListener("click", refreshAnalysisBundlePreview);
  elements.createAnalysisBundle.addEventListener("click", () => {
    try { createLocalAnalysisBundle(); } catch (error) { showToast(`Analysunderlaget kunde inte sparas: ${error.message}`, "error", 8000); }
  });
  elements.analysisExchangeForm.addEventListener("change", (event) => {
    if (event.target.matches("input[name='exchangeProfile'], input[name='exchangeStage'], input[type='checkbox']")) {
      syncAnalysisExchangeAvailability();
      refreshAnalysisBundlePreview();
    }
  });
  elements.analysisExchangeDialog.addEventListener("click", (event) => { if (event.target === elements.analysisExchangeDialog) elements.analysisExchangeDialog.close(); });
  elements.copyAnalysisExchange.addEventListener("click", async () => {
    try {
      await writeClipboardText(elements.analysisExchangeText.value, elements.analysisExchangeText);
      showToast("Analysunderlaget har kopierats.");
    } catch (error) { showToast(error.message, "error", 7000); }
  });
  elements.downloadAnalysisAgain.addEventListener("click", () => {
    if (state.analysisExchange.lastBundleBlob) downloadBlob(state.analysisExchange.lastBundleBlob, state.analysisExchange.lastBundle.fileName);
  });
  elements.guidanceTextInput.addEventListener("input", syncAnalysisExchangeAvailability);
  elements.pasteGuidance.addEventListener("click", async () => {
    try {
      elements.guidanceTextInput.value = await readClipboardText();
      syncAnalysisExchangeAvailability();
      showToast("Texten har klistrats in. Granska den när du är redo.");
    } catch (error) {
      elements.guidanceTextInput.focus();
      showToast(error.message, "error", 7000);
    }
  });
  elements.processGuidanceText.addEventListener("click", () => importGuidanceText(elements.guidanceTextInput.value));
  elements.guidanceList.addEventListener("click", (event) => {
    try { handleGuidanceAction(event); } catch (error) { showToast(`Beslutet kunde inte sparas: ${error.message}`, "error", 8000); }
  });
  $("#closeSuggestionTransferButton").addEventListener("click", () => elements.suggestionTransferDialog.close());
  $("#cancelSuggestionTransferButton").addEventListener("click", () => elements.suggestionTransferDialog.close());
  elements.confirmSuggestionTransfer.addEventListener("click", () => {
    const suggestion = guidanceSuggestions().find((item) => item.id === state.analysisExchange.activeSuggestionId);
    if (!suggestion || state.analysisExchange.guidanceStatus !== "matched") return;
    try { applyGuidanceSuggestion(suggestion); } catch (error) { showToast(error.message, "error", 7000); }
  });

  $("#helpButton").addEventListener("click", () => openHelp());
  $("#closeHelpButton").addEventListener("click", () => elements.helpDialog.close());
  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) elements.helpDialog.close();
  });
  $$("[data-help-section]").forEach((button) => button.addEventListener("click", () => renderHelp(button.dataset.helpSection)));
  $$("[data-help-topic]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openHelp(button.dataset.helpTopic);
  }));

  window.addEventListener("resize", scheduleCanvasRender, { passive: true });
  window.addEventListener("orientationchange", scheduleCanvasRender, { passive: true });
  window.addEventListener("online", checkForAppUpdate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForAppUpdate();
  });
  window.addEventListener("pagehide", () => {
    if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = null;
  });
  window.addEventListener("ljudr:analysis", (event) => handleAnalysisMessage(event.detail));
  window.addEventListener("ljudr:analysis-result", (event) => applyAnalysisResult(event.detail?.result ?? event.detail));
  window.addEventListener("ljudr:export", (event) => handleExportMessage(event.detail));
  elements.applyUpdate.addEventListener("click", applyWaitingUpdate);
  elements.dismissUpdate.addEventListener("click", () => { elements.updateBanner.hidden = true; });
}

async function initialize() {
  elements.appVersion.textContent = `v${RELEASE.version}`;
  elements.appVersion.title = RELEASE.commit && RELEASE.commit !== "local-working-tree"
    ? `Version ${RELEASE.version}, commit ${RELEASE.commit.slice(0, 12)}`
    : `Version ${RELEASE.version}`;
  bindEvents();
  applyMetadata(state.metadata);
  elements.recordingType.value = state.assessment.recordingType;
  elements.assessmentPurpose.value = state.assessment.purpose;
  elements.audio.volume = state.monitoring.volume;
  if (!(window.AudioContext || window.webkitAudioContext)) {
    elements.levelMatch.disabled = true;
    elements.levelMatch.closest(".switch-row")?.setAttribute("title", "Web Audio saknas i den här webbläsaren. Gain för export fungerar fortfarande.");
  }
  enableWorkflow(false);
  updateCapabilities();
  renderHelp("principles");
  renderAnalysisSummary();
  renderObservations();
  renderMarkers();
  syncTrackControls();
  syncTrimUi();
  syncTrimWindowUi();
  syncSeriesUi();
  syncAuditionUi();
  setExportProfile(state.exportProfile, { dirty: false, force: true });
  renderStoredExports();
  renderSpectralDiagnostics();
  renderPublicationCard();
  renderSeriesOverview();
  await loadProjectTools();
  await loadAnalysisExchangeTools();
  if (state.capabilities.opfs && state.capabilities.workers) sendStorageCommand("storage-list");
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const serviceWorkerUrl = new URL("../sw.js", import.meta.url);
    serviceWorkerUrl.searchParams.set("v", RELEASE.version);
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: "./", updateViaCache: "none" }).then(watchServiceWorkerRegistration).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      waitingServiceWorker = null;
      if (hasUnsafeUpdateState()) {
        reloadWhenSafe = true;
        elements.updateBanner.hidden = false;
        return;
      }
      location.reload();
    });
  }
  document.documentElement.classList.add("is-ready");
  emitState("ready");
}

initialize();
