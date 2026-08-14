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
  trim: {
    startSeconds: 0,
    endSeconds: 0,
    startFrame: 0,
    endFrame: 0,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
    gainDb: 0,
  },
  peakHandling: {
    enabled: false,
    mode: "global-attenuation",
    ceilingDbtp: -2,
    sourceTruePeakDbtp: null,
  },
  monitoring: {
    volume: 0.8,
    levelMatched: false,
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
      markers: true,
    },
  },
  markers: [],
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
let projectTools = null;
let resizeFrame = 0;
let audioContext = null;
let audioSourceNode = null;
let previewGainNode = null;
let monitorGainNode = null;
let activeDownloadUrl = null;

const elements = {
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
  analysisProgress: $("#analysisProgress"),
  progressLabel: $("#progressLabel"),
  progressPercent: $("#progressPercent"),
  progressFill: $("#progressFill"),
  analysisCanvas: $("#analysisCanvas"),
  analysisCanvasEmpty: $("#analysisCanvasEmpty"),
  trimCanvas: $("#trimCanvas"),
  timelineRange: $("#timelineRange"),
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
  peakHandlingToggle: $("#peakHandlingToggle"),
  peakHandlingControls: $("#peakHandlingControls"),
  peakCeilingNumber: $("#peakCeilingNumber"),
  peakCeilingRange: $("#peakCeilingRange"),
  peakSourceValue: $("#peakSourceValue"),
  peakReductionValue: $("#peakReductionValue"),
  peakResultValue: $("#peakResultValue"),
  peakHandlingStatus: $("#peakHandlingStatus"),
  levelMatch: $("#levelMatchToggle"),
  metadataForm: $("#metadataForm"),
  exportAudio: $("#exportAudioButton"),
  exportReport: $("#exportReportButton"),
  exportJson: $("#exportJsonButton"),
  exportProgress: $("#exportProgress"),
  exportProgressLabel: $("#exportProgressLabel"),
  exportProgressPercent: $("#exportProgressPercent"),
  exportProgressFill: $("#exportProgressFill"),
  capabilityStatus: $("#capabilityStatus"),
  capabilityList: $("#capabilityList"),
  recordingType: $("#recordingType"),
  assessmentPurpose: $("#assessmentPurpose"),
  assessmentStatus: $("#assessmentStatus"),
  assessmentHeadline: $("#assessmentHeadline"),
  assessmentSummary: $("#assessmentSummary"),
  assessmentActions: $("#assessmentActions"),
  exportRecommendationText: $("#exportRecommendationText"),
  helpDialog: $("#helpDialog"),
  helpCopy: $("#helpCopy"),
  toastRegion: $("#toastRegion"),
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
        <li>Global toppmarginal sänker vid behov hela verket. Den formar inte enskilda toppar och är inte en limiter.</li>
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
        <li>Global toppmarginal kan endast sänka hela verket. Den är inte en limiter.</li>
        <li>Utjämnad medhörning påverkar bara det du hör under jämförelsen.</li>
      </ul>`,
  },
  export: {
    title: "Export, format och säkerhetskontroller",
    body: `
      <p class="help-lead">Exportmotorn läser och skriver långa filer blockvis. Före omräkning kontrolleras det valda utsnittet efter toningar och före gain.</p>
      <ul>
        <li>Ren trimning utan gain eller toningar bevarar ljuddatat bitidentiskt.</li>
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
      <p>Intervallet räknas som startbildrutan inkluderad och slutbildrutan exkluderad. Det ger reproducerbara exporter.</p>`,
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
  "peak-handling": {
    title: "Global toppmarginal",
    meaning: "Sänker vid behov hela det valda utsnittet så att det orienterande True Peak-estimatet når valt tak.",
    relation: "Beräkningen använder valt utsnitt efter toningar och före gain. Ingen enskild topp förändras separat.",
    caution: "Det är inte limitering och estimatet är inte en formell dBTP garanti.",
    recommendation: "Låt funktionen vara av om ingen sänkning behövs. Minus två dBTP ger försiktigare marginal än minus ett med nuvarande estimator.",
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
    caution: "En profil ändrar inte ljudet i smyg. Lyssningskopia är avstängd tills kodning av stora filer är verifierad på iPad.",
    recommendation: "Spara alltid en bevarande master innan en komprimerad lyssningskopia skapas i ett senare steg.",
  },
  "preservation-export": {
    title: "Bevarande master",
    meaning: "En förlustfri WAV som behåller källans samplingsfrekvens och kodningsformat.",
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
  "listening-export": {
    title: "Lyssningskopia",
    meaning: "En framtida mindre fil i ett komprimerat format för enkel distribution.",
    relation: "Den ska härledas från distributionsmastern, inte ersätta originalet eller bevarandemastern.",
    caution: "Funktionen är medvetet avstängd tills stora filer har verifierats på fysisk iPad.",
    recommendation: "Använd tills vidare den exporterade WAV filen i en betrodd kodare.",
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
    relation: "Kontrollen väger ihop utsnitt, toningar, gain, toppmarginal, källformat och aktuell analys.",
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

function emitState(reason) {
  window.dispatchEvent(new CustomEvent("ljudr:statechange", {
    detail: {
      reason,
      mode: state.mode,
      hasFile: Boolean(state.file),
      analysisStatus: state.analysisStatus,
      exportStatus: state.exportStatus,
      trim: { ...state.trim },
      peakHandling: { ...state.peakHandling },
      markers: state.markers.map((marker) => ({ ...marker })),
      metadata: { ...state.metadata },
      assessment: { ...state.assessment },
    },
  }));
}

function setMode(mode, options = {}) {
  if (!["open", "analyze", "trim", "export"].includes(mode)) return;
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
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  if (bytes.byteLength < 44) throw new Error("Filen är för kort för att vara en WAV-fil.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const container = text(0, 4);
  if (!["RIFF", "RF64", "BW64"].includes(container) || text(8, 4) !== "WAVE") {
    throw new Error("Filen har ingen igenkänd WAVE-rubrik.");
  }
  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt " && size >= 16 && start + 16 <= bytes.byteLength) {
      const tag = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      const blockAlign = view.getUint16(start + 12, true);
      const bits = view.getUint16(start + 14, true);
      let resolvedTag = tag;
      if (tag === 0xfffe && size >= 40 && start + 26 <= bytes.byteLength) resolvedTag = view.getUint16(start + 24, true);
      format = {
        container,
        channels,
        sampleRate: rate,
        blockAlign,
        bitsPerSample: bits,
        encoding: resolvedTag === 3 ? "IEEE_FLOAT" : resolvedTag === 1 ? "PCM" : `format ${resolvedTag}`,
      };
    }
    if (id === "data") {
      dataBytes = size === 0xffffffff ? null : size;
      break;
    }
    const next = start + size + (size % 2);
    if (next <= offset || next > bytes.byteLength) break;
    offset = next;
  }
  if (!format) throw new Error("WAV-filens formatblock kunde inte läsas.");
  const duration = dataBytes !== null && format.blockAlign && format.sampleRate
    ? dataBytes / format.blockAlign / format.sampleRate
    : null;
  return { ...format, dataBytes, durationSeconds: duration };
}

function technicalDescription() {
  const info = state.analysis?.format ?? state.fileInfo;
  if (!info) return `${formatBytes(state.file?.size)} · tekniska data läses i analysen`;
  const encoding = info.encoding === "IEEE_FLOAT" ? "float" : String(info.encoding || "").toLowerCase();
  const channelText = info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} kanaler`;
  const bits = info.bitsPerSample ? `${info.bitsPerSample}-bit ${encoding}` : encoding;
  const duration = finite(info.durationSeconds) !== null ? formatTime(info.durationSeconds, false) : "okänd längd";
  return `${bits} · ${formatRate(info.sampleRate)} · ${channelText} · ${duration} · ${formatBytes(state.file?.size)}`;
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
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = file;
  state.fileUrl = URL.createObjectURL(file);
  state.fileInfo = null;
  state.analysis = null;
  state.analysisStatus = "idle";
  state.lastExportReport = null;
  state.markers = [];
  state.trim.startSeconds = 0;
  state.trim.startFrame = 0;
  state.trim.gainDb = 0;
  state.trim.fadeInSeconds = 0;
  state.trim.fadeOutSeconds = 0;
  state.peakHandling = {
    enabled: false,
    mode: "global-attenuation",
    ceilingDbtp: -2,
    sourceTruePeakDbtp: null,
  };
  elements.audio.src = state.fileUrl;
  elements.fileName.textContent = file.name;
  elements.fileTechnical.textContent = `${formatBytes(file.size)} · läser WAVE-rubrik`;
  elements.fileStrip.hidden = false;
  enableWorkflow(true);
  elements.analysisCanvasEmpty.hidden = false;
  updateAnalysisProgress(0, "Redo att analysera", true);

  try {
    state.fileInfo = await inspectWaveHeader(file);
  } catch (error) {
    showToast(`${error.message} Analysmotorn gör en fullständig kontroll.`, "error", 7000);
  }
  const duration = durationSeconds();
  state.trim.endSeconds = duration;
  state.trim.endFrame = toFrame(duration);
  state.view.startSeconds = 0;
  state.view.endSeconds = duration;
  elements.fileTechnical.textContent = technicalDescription();
  syncTrimUi();
  renderMarkers();
  renderAnalysisSummary();
  if (state.pendingProject) await applyPendingProjectToFile();
  setMode("analyze");
  showToast("Filen öppnades lokalt. Originalet är oförändrat.");
  emitState("file-opened");
}

function updateAnalysisProgress(fraction, message, hidden = false) {
  const value = clamp(fraction, 0, 1);
  elements.analysisProgress.hidden = hidden;
  elements.progressFill.style.width = `${value * 100}%`;
  elements.progressPercent.textContent = `${Math.round(value * 100)} %`;
  elements.progressLabel.textContent = message || "Analyserar ljud";
}

function updateExportProgress(fraction, message, hidden = false) {
  const value = clamp(fraction, 0, 1);
  elements.exportProgress.hidden = hidden;
  elements.exportProgressFill.style.width = `${value * 100}%`;
  elements.exportProgressPercent.textContent = `${Math.round(value * 100)} %`;
  elements.exportProgressLabel.textContent = message || "Exporterar ljud";
}

function handleAnalysisMessage(data = {}) {
  if (data.type === "progress") {
    updateAnalysisProgress(data.fraction, data.message || data.phase);
    return;
  }
  if (data.type === "result" || data.result) {
    applyAnalysisResult(data.result ?? data);
    return;
  }
  if (data.type === "error" || data.error) {
    state.analysisStatus = "error";
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "Försök analysera igen";
    updateAnalysisProgress(0, data.message || data.error || "Analysen misslyckades");
    showToast(data.message || data.error || "Analysen misslyckades.", "error", 8000);
    updateCapabilities(false, state.capabilities.export);
    emitState("analysis-error");
  }
}

function startAnalysis() {
  if (!state.file || state.analysisStatus === "running") return;
  if (!state.capabilities.workers) {
    showToast("Den här webbläsaren saknar Worker-stöd som krävs för storfilsanalys.", "error");
    return;
  }
  try {
    analysisWorker?.terminate();
    analysisWorker = new Worker("./src/analysis-worker.js", { type: "module" });
    analysisWorker.onmessage = (event) => handleAnalysisMessage(event.data);
    analysisWorker.onerror = (event) => handleAnalysisMessage({ type: "error", message: event.message || "Analysmotorn kunde inte starta." });
    state.analysisStatus = "running";
    elements.analyzeButton.disabled = true;
    elements.analyzeButton.textContent = "Analys pågår";
    updateAnalysisProgress(0, "Förbereder blockvis analys");
    analysisWorker.postMessage({
      type: "analyze",
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
  const duration = durationSeconds();
  if (!state.trim.endFrame || state.trim.endSeconds <= 0) {
    state.trim.endSeconds = duration;
    state.trim.endFrame = toFrame(duration);
  } else {
    state.trim.endSeconds = clamp(state.trim.endSeconds, state.trim.startSeconds, duration);
    state.trim.endFrame = toFrame(state.trim.endSeconds);
  }
  state.view.startSeconds = 0;
  state.view.endSeconds = duration;
  elements.fileTechnical.textContent = technicalDescription();
  elements.analysisCanvasEmpty.hidden = true;
  elements.analyzeButton.disabled = false;
  elements.analyzeButton.textContent = "Analysera igen";
  updateAnalysisProgress(1, "Analysen är klar");
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
        type: "technical",
        text: suggestion.label || suggestion.title || suggestion.message || "Teknisk observation",
        suggested: true,
      });
    }
  });
  syncTrimUi();
  renderAnalysisSummary();
  renderObservations();
  renderMarkers();
  scheduleCanvasRender();
  updateCapabilities(true, state.capabilities.export);
  showToast("Analysen är klar. Inga ändringar har gjorts i ljudet.");
  emitState("analysis-complete");
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
  elements.assessmentActions.innerHTML = actions.map(action => `<span>${escapeHtml(action)}</span>`).join("");
}

function updateExportRecommendation() {
  if (!elements.exportRecommendationText) return;
  if (!state.file) {
    elements.exportRecommendationText.textContent = "Öppna och analysera en fil för en rekommendation före export.";
    return;
  }
  const changes = [];
  const trimmed = state.trim.startFrame > 0 || state.trim.endFrame < toFrame(durationSeconds());
  if (trimmed) changes.push("trimning");
  if (state.trim.fadeInSeconds > 0 || state.trim.fadeOutSeconds > 0) changes.push("toningar");
  if (Math.abs(state.trim.gainDb) > 1e-9) changes.push("global gain");
  if (state.peakHandling.enabled) changes.push("global toppmarginal");
  const peak = analysisTruePeakDbtp();
  const predicted = peak === null ? null : peak + state.trim.gainDb + peakAdjustmentDb();
  if (!changes.length) {
    elements.exportRecommendationText.textContent = "Inga bearbetningar är valda. Hela filen kan bevaras utan omräkning av ljudsamplingarna.";
  } else if (predicted !== null && predicted > 0) {
    elements.exportRecommendationText.textContent = `Valt: ${changes.join(", ")}. Det orienterande toppestimatet ligger över 0 dBTP. Sänk gain eller aktivera en försiktigare global toppmarginal före PCM export.`;
  } else {
    const ditherText = state.fileInfo?.encoding === "PCM" && changes.some(item => item !== "trimning")
      ? "PCM samplingarna räknas om med TPDF dither."
      : "Exportmotorn gör en ny toppförkontroll på exakt valt utsnitt.";
    elements.exportRecommendationText.textContent = `Valt: ${changes.join(", ")}. ${ditherText} Provlyssna den sparade filen.`;
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
  const markerTypes = new Set(["descriptive", "technical", "user", "note"]);
  state.markers = (Array.isArray(state.markers) ? state.markers : []).map((marker, index) => {
    const seconds = finite(marker?.seconds);
    if (seconds === null) return null;
    return {
      id: String(marker?.id || `imported-marker-${index}`),
      seconds: Math.max(0, seconds),
      type: markerTypes.has(marker?.type) ? marker.type : "user",
      text: String(marker?.text ?? marker?.label ?? "Markör"),
      suggested: Boolean(marker?.suggested),
    };
  }).filter(Boolean);
  const sorted = [...state.markers].sort((a, b) => a.seconds - b.seconds);
  if (!sorted.length) {
    elements.markerList.innerHTML = '<li class="list-placeholder">Inga markörer ännu</li>';
  } else {
    elements.markerList.innerHTML = sorted.map((marker) => `
      <li class="marker-item" data-marker-id="${escapeHtml(marker.id)}">
        <time datetime="PT${Math.max(0, marker.seconds)}S">${formatTime(marker.seconds, false)}</time>
        <button class="marker-jump" type="button" data-marker-jump="${String(marker.seconds)}">${escapeHtml(marker.text)}</button>
        <button class="marker-remove" type="button" data-marker-remove="${escapeHtml(marker.id)}" aria-label="Ta bort markör">×</button>
      </li>`).join("");
  }
  scheduleCanvasRender();
}

function syncTrimUi() {
  const duration = durationSeconds();
  state.trim.startSeconds = clamp(state.trim.startSeconds, 0, Math.max(0, duration));
  state.trim.endSeconds = clamp(state.trim.endSeconds || duration, state.trim.startSeconds, duration);
  state.trim.startFrame = toFrame(state.trim.startSeconds);
  state.trim.endFrame = toFrame(state.trim.endSeconds);
  elements.trimStartInput.value = formatTime(state.trim.startSeconds);
  elements.trimEndInput.value = formatTime(state.trim.endSeconds);
  elements.trimStartLabel.textContent = `Start ${formatTime(state.trim.startSeconds)}`;
  elements.trimEndLabel.textContent = `Slut ${formatTime(state.trim.endSeconds)}`;
  elements.selectedDuration.textContent = formatTime(state.trim.endSeconds - state.trim.startSeconds);
  elements.transportDuration.textContent = formatTime(duration);
  elements.currentTime.textContent = formatTime(state.playback.currentSeconds);
  syncFadeUi();
  syncPeakHandlingUi();
  updateExportSummary();
  scheduleCanvasRender();
  emitState("trim");
}

function setBoundary(boundary, seconds) {
  const duration = durationSeconds();
  if (boundary === "start") {
    state.trim.startSeconds = clamp(seconds, 0, Math.max(0, state.trim.endSeconds - 1 / sampleRate()));
  } else {
    state.trim.endSeconds = clamp(seconds, Math.min(duration, state.trim.startSeconds + 1 / sampleRate()), duration);
  }
  syncTrimUi();
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
  emitState("fade");
}

function analysisTruePeakDbtp() {
  const summary = state.analysis?.summary || {};
  return finite(summary.truePeakEstimateDbtp ?? summary.truePeakDbtp ?? summary.truePeak);
}

function normalizedPeakHandling(input = state.peakHandling) {
  const measuredSource = analysisTruePeakDbtp();
  const savedSource = finite(input?.sourceTruePeakDbtp);
  return {
    enabled: Boolean(input?.enabled),
    mode: "global-attenuation",
    ceilingDbtp: clamp(finite(input?.ceilingDbtp) ?? -2, -12, -0.1),
    sourceTruePeakDbtp: measuredSource ?? savedSource,
  };
}

function peakAdjustmentDb(config = normalizedPeakHandling()) {
  if (!config.enabled || config.sourceTruePeakDbtp === null) return 0;
  return Math.min(0, config.ceilingDbtp - (config.sourceTruePeakDbtp + state.trim.gainDb));
}

function effectiveGlobalGainDb() {
  return state.trim.gainDb + peakAdjustmentDb();
}

function syncPeakHandlingUi() {
  state.peakHandling = normalizedPeakHandling();
  const config = state.peakHandling;
  const adjustment = peakAdjustmentDb(config);
  const predicted = config.sourceTruePeakDbtp === null
    ? null
    : config.sourceTruePeakDbtp + state.trim.gainDb + adjustment;
  elements.peakHandlingToggle.checked = config.enabled;
  elements.peakHandlingControls.disabled = !config.enabled;
  elements.peakCeilingNumber.value = config.ceilingDbtp.toFixed(1);
  elements.peakCeilingRange.value = String(config.ceilingDbtp);
  elements.peakSourceValue.textContent = config.sourceTruePeakDbtp === null
    ? "förhandsvärde saknas"
    : `${formatDecimal(config.sourceTruePeakDbtp, 1)} dBTP`;
  elements.peakReductionValue.textContent = `${formatDecimal(adjustment, 1)} dB`;
  elements.peakResultValue.textContent = predicted === null ? "saknas" : `${formatDecimal(predicted, 1)} dBTP`;
  $$('[data-peak-ceiling]').forEach((button) => {
    button.classList.toggle("is-selected", Math.abs(Number(button.dataset.peakCeiling) - config.ceilingDbtp) < 0.05);
  });

  if (!config.enabled) {
    elements.peakHandlingStatus.textContent = "Funktionen är av. True Peak-värdet är orienterande och är ingen leveransgaranti.";
    elements.peakHandlingStatus.classList.remove("is-active");
  } else if (config.sourceTruePeakDbtp === null) {
    elements.peakHandlingStatus.textContent = "Medhörningen saknar förhandsvärde. Exporten gör ändå en egen blockvis toppförkontroll av det valda utsnittet.";
    elements.peakHandlingStatus.classList.remove("is-active");
  } else if (adjustment < -0.05) {
    elements.peakHandlingStatus.textContent = `Hela verket sänks orienterande ${formatDecimal(Math.abs(adjustment), 1)} dB. Exporten kontrollmäter det valda utsnittet blockvis.`;
    elements.peakHandlingStatus.classList.add("is-active");
  } else {
    elements.peakHandlingStatus.textContent = "Ingen extra sänkning beräknas behövas. Exporten kontrollmäter det valda utsnittet blockvis.";
    elements.peakHandlingStatus.classList.add("is-active");
  }
}

function updatePeakCeiling(value) {
  state.peakHandling.ceilingDbtp = clamp(finite(value) ?? -2, -12, -0.1);
  syncPeakHandlingUi();
  updateProjectedMetrics();
  updateExportSummary();
  updateMonitoringGraph();
  emitState("peak-ceiling");
}

function setPeakHandlingEnabled(enabled) {
  state.peakHandling.enabled = Boolean(enabled);
  syncPeakHandlingUi();
  updateProjectedMetrics();
  updateExportSummary();
  updateMonitoringGraph();
  emitState("peak-handling");
}

function updateGain(value) {
  const gain = clamp(value, -24, 24);
  state.trim.gainDb = Math.round(gain * 10) / 10;
  elements.gainNumber.value = state.trim.gainDb.toFixed(1);
  elements.gainRange.value = String(state.trim.gainDb);
  updateProjectedMetrics();
  updateExportSummary();
  updateMonitoringGraph();
  emitState("gain");
}

function updateProjectedMetrics() {
  const summary = state.analysis?.summary || {};
  const lufs = finite(summary.integratedLufs ?? summary.lufsI);
  const peak = analysisTruePeakDbtp();
  const gain = state.trim.gainDb;
  state.peakHandling = normalizedPeakHandling();
  const adjustment = peakAdjustmentDb();
  const effectiveGain = gain + adjustment;
  elements.projectedLufs.textContent = lufs === null ? "saknas" : `${formatDecimal(lufs + effectiveGain, 1)} LUFS`;
  elements.projectedPeak.textContent = peak === null ? "saknas" : `${formatDecimal(peak + effectiveGain, 1)} dBTP`;
  const projectedPeak = peak === null ? null : peak + effectiveGain;
  if (projectedPeak !== null && projectedPeak > 0) {
    elements.gainNotice.hidden = false;
    elements.gainNotice.textContent = "Nivåvalet ger ett orienterande True Peak-estimat över 0 dBTP. Sänk gain eller aktivera global toppmarginal.";
  } else {
    elements.gainNotice.hidden = true;
    elements.gainNotice.textContent = "";
  }
  syncPeakHandlingUi();
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
  const config = normalizedPeakHandling();
  const adjustment = peakAdjustmentDb(config);
  $("#exportPeakSummary").textContent = !config.enabled
    ? "Av"
    : config.sourceTruePeakDbtp === null
      ? `På, tak ${formatDecimal(config.ceilingDbtp, 1)} dBTP, förkontroll vid export`
      : adjustment < -0.05
        ? `${formatDecimal(adjustment, 1)} dB globalt, tak ${formatDecimal(config.ceilingDbtp, 1)} dBTP`
        : `På, tak ${formatDecimal(config.ceilingDbtp, 1)} dBTP`;
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
    audioSourceNode.connect(previewGainNode).connect(monitorGainNode).connect(audioContext.destination);
    elements.audio.volume = 1;
    updateMonitoringGraph();
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  return true;
}

function fadeGeometry() {
  const rate = sampleRate();
  const totalFrames = Math.max(0, state.trim.endFrame - state.trim.startFrame);
  const fadeInFrames = Math.min(totalFrames, Math.max(0, Math.round(state.trim.fadeInSeconds * rate)));
  const fadeOutFrames = Math.min(totalFrames, Math.max(0, Math.round(state.trim.fadeOutSeconds * rate)));
  return {
    rate,
    start: state.trim.startFrame / rate,
    end: state.trim.endFrame / rate,
    fadeInFrames,
    fadeOutFrames,
    fadeInEnd: state.trim.startFrame / rate + Math.max(0, fadeInFrames - 1) / rate,
    fadeOutStart: state.trim.endFrame / rate - fadeOutFrames / rate,
    fadeOutEnd: state.trim.endFrame / rate - 1 / rate,
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
  const previewDb = state.monitoring.levelMatched ? 0 : effectiveGlobalGainDb();
  const baseGain = 10 ** (previewDb / 20);
  const playbackRate = Math.max(0.01, finite(elements.audio.playbackRate) ?? 1);
  const parameter = previewGainNode.gain;
  parameter.cancelScheduledValues(now);
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
    if (current < state.trim.startSeconds || current >= state.trim.endSeconds) elements.audio.currentTime = state.trim.startSeconds;
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
  const viewStart = clamp(state.view.startSeconds, 0, fullDuration);
  const viewEnd = clamp(state.view.endSeconds || fullDuration, viewStart + 0.001, fullDuration);
  const viewDuration = viewEnd - viewStart;
  const labelWidth = width < 520 ? 44 : 58;
  const plotLeft = labelWidth;
  const plotRight = width - 10;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const xAtTime = (seconds) => plotLeft + (seconds - viewStart) / viewDuration * plotWidth;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0c1728";
  context.fillRect(0, 0, width, height);

  const visibleTracks = trimMode
    ? ["waveform", "markers"]
    : Object.entries(state.view.tracks).filter(([, visible]) => visible).map(([name]) => name);
  const weights = { waveform: trimMode ? 0.83 : 0.47, loudness: 0.29, peaks: 0.17, markers: trimMode ? 0.17 : 0.07 };
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
    const label = { waveform: "STEREO", loudness: "LUFS", peaks: "TOPP", markers: "MÄRKE" }[name];
    context.fillText(label, 7, track.top + 15);
  });

  if (analysis && tracks.waveform) {
    const channels = analysis.waveform?.channels || [];
    const bins = finite(analysis.waveform?.bins) ?? channels[0]?.min?.length ?? 0;
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
      const startBin = Math.max(0, Math.floor(viewStart / fullDuration * bins));
      const endBin = Math.min(bins, Math.ceil(viewEnd / fullDuration * bins));
      const step = Math.max(1, Math.floor((endBin - startBin) / Math.max(plotWidth, 1)));
      for (let index = startBin; index < endBin; index += step) {
        const seconds = index / Math.max(1, bins - 1) * fullDuration;
        const x = xAtTime(seconds);
        const minimum = clamp(finite(minSeries[index]) ?? 0, -1.35, 1.35);
        const maximum = clamp(finite(maxSeries[index]) ?? 0, -1.35, 1.35);
        context.moveTo(x, center - maximum * half);
        context.lineTo(x, center - minimum * half);
      }
      context.stroke();
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

  if (tracks.markers) {
    state.markers.forEach((marker) => {
      if (marker.seconds < viewStart || marker.seconds > viewEnd) return;
      const x = xAtTime(marker.seconds);
      context.strokeStyle = marker.type === "technical" ? "rgba(222,116,87,.9)" : "rgba(226,171,71,.9)";
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

  if (trimMode) {
    const startX = xAtTime(state.trim.startSeconds);
    const endX = xAtTime(state.trim.endSeconds);
    context.fillStyle = "rgba(4,10,18,.7)";
    context.fillRect(plotLeft, 0, Math.max(0, startX - plotLeft), height);
    context.fillRect(endX, 0, Math.max(0, plotRight - endX), height);
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
}

function scheduleCanvasRender() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    drawTimeline(elements.analysisCanvas, false);
    drawTimeline(elements.trimCanvas, true);
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
    gainDb: state.trim.gainDb,
    fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
    fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
    peakHandling: normalizedPeakHandling(),
  };
}

async function saveProjectFile() {
  if (!state.file) return;
  try {
    const input = {
      file: state.file,
      analysis: state.analysis,
      edit: projectEdit(),
      markers: state.markers,
      metadata: collectMetadata(),
      settings: { monitoring: state.monitoring, view: state.view, assessment: state.assessment },
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
          settings: { monitoring: state.monitoring, view: state.view, assessment: state.assessment },
          privacy: { audioIncluded: false },
        };
    const fileName = `${baseName(state.file.name)}.ljudr.json`;
    if (projectTools?.downloadProject) projectTools.downloadProject(project, fileName);
    else downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), fileName);
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
    state.analysis = project.analysis || null;
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
  let matches = project.source?.size === state.file.size && (!project.source?.name || project.source.name === state.file.name);
  let reason = matches ? "Filnamn och storlek stämmer." : "Filnamn eller storlek skiljer sig.";
  if (projectTools?.sourceMatchesProject && project.source?.fingerprint) {
    const check = await projectTools.sourceMatchesProject(state.file, project);
    matches = check.matches;
    reason = check.reason;
  }
  if (!matches) {
    showToast(`Källfilen matchar inte projektet. ${reason}`, "error", 8000);
    return;
  }
  state.analysis = project.analysis || state.analysis;
  state.markers = Array.isArray(project.markers) ? project.markers : state.markers;
  const edit = project.edit || {};
  if (finite(edit.startFrame) !== null) state.trim.startSeconds = toSeconds(edit.startFrame);
  if (finite(edit.endFrame) !== null) state.trim.endSeconds = toSeconds(edit.endFrame);
  state.trim.gainDb = finite(edit.gainDb) ?? 0;
  state.trim.fadeInSeconds = toSeconds(edit.fadeInFrames || 0);
  state.trim.fadeOutSeconds = toSeconds(edit.fadeOutFrames || 0);
  state.peakHandling = normalizedPeakHandling(edit.peakHandling || {
    enabled: false,
    mode: "global-attenuation",
    ceilingDbtp: -2,
    sourceTruePeakDbtp: analysisTruePeakDbtp(),
  });
  state.assessment = {
    ...state.assessment,
    ...(project.settings?.assessment || {}),
  };
  if (assessmentProfiles[state.assessment.recordingType]) elements.recordingType.value = state.assessment.recordingType;
  if (["distribution", "preservation"].includes(state.assessment.purpose)) elements.assessmentPurpose.value = state.assessment.purpose;
  syncFadeUi();
  syncPeakHandlingUi();
  updateGain(state.trim.gainDb);
  applyMetadata(project.metadata);
  state.pendingProject = null;
  state.analysisStatus = state.analysis ? "complete" : "idle";
  elements.analysisCanvasEmpty.hidden = Boolean(state.analysis);
  renderAnalysisSummary();
  renderObservations();
  renderMarkers();
  syncTrimUi();
  showToast("Projektet och källfilen matchar. Arbetet har återställts.");
  emitState("project-opened");
}

function reportInput() {
  return {
    file: state.file,
    analysis: state.analysis,
    edit: projectEdit(),
    markers: state.markers,
    metadata: collectMetadata(),
    exportReport: state.lastExportReport,
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

function startExport() {
  if (!state.file || state.exportStatus === "running") return;
  const selectedProfile = $("input[name='exportProfile']:checked")?.value;
  if (selectedProfile === "listening") {
    showToast("Lyssningskopian är ännu inte aktiverad för stora iPad-filer.", "error");
    return;
  }
  if (!state.capabilities.workers) {
    showToast("Den här webbläsaren saknar Worker-stöd som krävs för storfilsexport.", "error");
    return;
  }
  try {
    exportWorker?.terminate();
    exportWorker = new Worker("./src/export-worker.js", { type: "module" });
    exportWorker.onmessage = (event) => handleExportMessage(event.data);
    exportWorker.onerror = (event) => handleExportMessage({ type: "error", message: event.message || "Exportmotorn kunde inte starta." });
    state.exportStatus = "running";
    elements.exportAudio.disabled = true;
    elements.exportAudio.textContent = "Export pågår";
    updateExportProgress(0, "Förbereder blockvis WAV-export");
    exportWorker.postMessage({
      type: "export",
      file: state.file,
      options: {
        startFrame: state.trim.startFrame,
        endFrame: state.trim.endFrame,
        gainDb: state.trim.gainDb,
        fadeInFrames: Math.round(state.trim.fadeInSeconds * sampleRate()),
        fadeOutFrames: Math.round(state.trim.fadeOutSeconds * sampleRate()),
        peakHandling: normalizedPeakHandling(),
        fileName: state.metadata.title || state.file.name,
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
  if (data.type === "progress") {
    updateExportProgress(data.fraction, data.message || "Exporterar ljud");
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
    state.exportStatus = "complete";
    elements.exportAudio.disabled = false;
    elements.exportAudio.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3ZM5 19h14v2H5v-2Z"/></svg>Exportera ljudfil';
    updateExportProgress(1, "Exporten är klar");
    downloadBlob(blob, fileName);
    showToast("Ljudfilen skapades lokalt och är redo att sparas.", "info", 7000);
    emitState("export-complete");
    return;
  }
  if (data.type === "error" || data.error) {
    state.exportStatus = "error";
    elements.exportAudio.disabled = false;
    elements.exportAudio.textContent = "Försök exportera igen";
    const clippingRisk = data.code === "PCM_CLAMPING_RISK";
    const message = clippingRisk
      ? "Exporten stoppades före omkodning eftersom positiv gain riskerar att klampa PCM-sampel. Sänk gain eller välj en lägre global toppmarginal."
      : data.message || data.error || "Exporten misslyckades.";
    updateExportProgress(0, message);
    showToast(message, "error", clippingRisk ? 12000 : 9000);
    if (clippingRisk) {
      elements.gainNotice.hidden = false;
      elements.gainNotice.textContent = "PCM-förkontrollen stoppade exporten innan ljudfilen ändrades. Sänk gain eller aktivera global toppmarginal.";
      updateCapabilities(state.capabilities.analysis, true);
    } else {
      updateCapabilities(state.capabilities.analysis, false);
    }
    emitState("export-error");
  }
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
  const newLength = clamp(currentLength * (direction === "in" ? 0.5 : 2), Math.min(5, duration), duration);
  let start = center - newLength / 2;
  let end = center + newLength / 2;
  if (start < 0) { end -= start; start = 0; }
  if (end > duration) { start -= end - duration; end = duration; }
  state.view.startSeconds = Math.max(0, start);
  state.view.endSeconds = Math.min(duration, end);
  scheduleCanvasRender();
}

function fitTimeline() {
  state.view.startSeconds = 0;
  state.view.endSeconds = durationSeconds();
  scheduleCanvasRender();
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
    "peak-handling": [state.peakHandling.enabled ? `På, ${formatDecimal(state.peakHandling.ceilingDbtp, 1)} dBTP` : "Av", `Beräknad global sänkning ${formatDecimal(peakAdjustmentDb(), 2)} dB`],
    monitoring: [state.monitoring.levelMatched ? "Utjämnad" : "Faktisk nivåskillnad", `Medhörningsvolym ${formatDecimal(state.monitoring.volume * 100, 0)} procent`],
    "export-profiles": [$(`input[name='exportProfile']:checked`)?.value || "Ingen", "Se exportsammanfattningen för alla val"],
    "preservation-export": ["WAV med källformat", technicalDescription()],
    "distribution-export": ["WAV distributionsmaster", technicalDescription()],
    "listening-export": ["Avstängd", "Inväntar fysisk storfilsvalidering på iPad"],
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
  $$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $$('[data-mode-link="open"]').forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); setMode("open"); }));
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
  elements.recordingType.addEventListener("change", () => {
    state.assessment.recordingType = elements.recordingType.value;
    renderAssessmentReflection();
    updateExportRecommendation();
    emitState("assessment-context");
  });
  elements.assessmentPurpose.addEventListener("change", () => {
    state.assessment.purpose = elements.assessmentPurpose.value;
    renderAssessmentReflection();
    updateExportRecommendation();
    emitState("assessment-purpose");
  });
  elements.saveProject.addEventListener("click", saveProjectFile);
  elements.openProject.addEventListener("click", () => elements.projectInput.click());
  elements.projectInput.addEventListener("change", () => readProject(elements.projectInput.files?.[0]));

  $$('[data-zoom]').forEach((button) => button.addEventListener("click", () => zoomTimeline(button.dataset.zoom)));
  $("#fitTimelineButton").addEventListener("click", fitTimeline);
  $("#fitTrimButton").addEventListener("click", fitTimeline);
  $$(".legend-chip").forEach((button) => button.addEventListener("click", () => {
    const track = button.dataset.track;
    state.view.tracks[track] = !state.view.tracks[track];
    button.classList.toggle("is-on", state.view.tracks[track]);
    button.setAttribute("aria-pressed", String(state.view.tracks[track]));
    scheduleCanvasRender();
  }));

  elements.analysisCanvas.addEventListener("pointerdown", (event) => {
    if (!state.file) return;
    state.playback.currentSeconds = canvasTimeFromPointer(elements.analysisCanvas, event);
    elements.audio.currentTime = state.playback.currentSeconds;
    syncTrimUi();
  });
  elements.trimCanvas.addEventListener("pointerdown", (event) => {
    activeTrimHandle = findTrimHandle(elements.trimCanvas, event);
    if (activeTrimHandle) {
      elements.trimCanvas.setPointerCapture(event.pointerId);
      setBoundary(activeTrimHandle, canvasTimeFromPointer(elements.trimCanvas, event));
    } else {
      state.playback.currentSeconds = canvasTimeFromPointer(elements.trimCanvas, event);
      elements.audio.currentTime = state.playback.currentSeconds;
      syncTrimUi();
    }
  });
  elements.trimCanvas.addEventListener("pointermove", (event) => {
    if (activeTrimHandle) setBoundary(activeTrimHandle, canvasTimeFromPointer(elements.trimCanvas, event));
  });
  const releaseTrim = () => { activeTrimHandle = null; };
  elements.trimCanvas.addEventListener("pointerup", releaseTrim);
  elements.trimCanvas.addEventListener("pointercancel", releaseTrim);

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
      type: elements.markerType.value,
      text,
      suggested: false,
    });
    elements.markerText.value = "";
    elements.markerCompose.hidden = true;
    renderMarkers();
    emitState("marker-added");
  });
  elements.markerList.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-marker-jump]");
    if (jump) {
      state.playback.currentSeconds = clamp(jump.dataset.markerJump, 0, durationSeconds());
      elements.audio.currentTime = state.playback.currentSeconds;
      setMode("trim");
      syncTrimUi();
      return;
    }
    const remove = event.target.closest("[data-marker-remove]");
    if (remove) {
      state.markers = state.markers.filter((marker) => marker.id !== remove.dataset.markerRemove);
      renderMarkers();
      emitState("marker-removed");
    }
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
    else if (state.playback.previewStopAt === null && state.playback.currentSeconds >= state.trim.endSeconds) stopPlayback();
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
    updateMonitoringGraph();
    emitState("monitor-volume");
  });
  elements.levelMatch.addEventListener("change", () => {
    state.monitoring.levelMatched = elements.levelMatch.checked;
    updateMonitoringGraph();
    showToast(elements.levelMatch.checked ? "Utjämnad medhörning är på. Exporten påverkas inte." : "Medhörningen visar nu den faktiska nivåskillnaden.");
    emitState("monitoring-mode");
  });

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
  $("#setStartAtPlayhead").addEventListener("click", () => setBoundary("start", elements.audio.currentTime || state.playback.currentSeconds));
  $("#setEndAtPlayhead").addEventListener("click", () => setBoundary("end", elements.audio.currentTime || state.playback.currentSeconds));
  $$("[data-nudge]").forEach((button) => button.addEventListener("click", () => {
    const [boundary, delta] = button.dataset.nudge.split(":");
    const current = boundary === "start" ? state.trim.startSeconds : state.trim.endSeconds;
    setBoundary(boundary, current + Number(delta));
  }));
  $$("[data-preview-boundary]").forEach((button) => button.addEventListener("click", () => previewBoundary(button.dataset.previewBoundary)));
  $("#resetTrimButton").addEventListener("click", () => {
    state.trim.startSeconds = 0;
    state.trim.endSeconds = durationSeconds();
    syncTrimUi();
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
  elements.peakHandlingToggle.addEventListener("change", () => setPeakHandlingEnabled(elements.peakHandlingToggle.checked));
  elements.peakCeilingNumber.addEventListener("change", () => updatePeakCeiling(elements.peakCeilingNumber.value));
  elements.peakCeilingRange.addEventListener("input", () => updatePeakCeiling(elements.peakCeilingRange.value));
  $$('[data-peak-ceiling]').forEach((button) => button.addEventListener("click", () => updatePeakCeiling(button.dataset.peakCeiling)));

  elements.metadataForm.addEventListener("input", () => {
    collectMetadata();
    emitState("metadata");
  });
  $("#toggleMetadataButton").addEventListener("click", (event) => {
    const section = event.target.closest(".metadata-section");
    const collapsed = section.classList.toggle("is-collapsed");
    event.target.textContent = collapsed ? "Visa" : "Dölj";
    event.target.setAttribute("aria-expanded", String(!collapsed));
  });
  elements.exportAudio.addEventListener("click", startExport);
  elements.exportReport.addEventListener("click", () => exportReport("html"));
  elements.exportJson.addEventListener("click", () => exportReport("json"));

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
  window.addEventListener("pagehide", () => {
    if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = null;
  });
  window.addEventListener("ljudr:analysis", (event) => handleAnalysisMessage(event.detail));
  window.addEventListener("ljudr:analysis-result", (event) => applyAnalysisResult(event.detail?.result ?? event.detail));
  window.addEventListener("ljudr:export", (event) => handleExportMessage(event.detail));
}

async function initialize() {
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
  syncTrimUi();
  await loadProjectTools();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { scope: "./" }).catch(() => {});
  }
  document.documentElement.classList.add("is-ready");
  emitState("ready");
}

initialize();
