const RIFF_LIMIT = 0xffffffff;
export const SUPPORTED_SAMPLE_RATES = Object.freeze([44100, 48000, 88200, 96000, 176400, 192000]);
const EXTENSIBLE_GUID_TAIL = Object.freeze([
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa,
  0x00, 0x38, 0x9b, 0x71,
]);

const ascii = (view, offset, length) => {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
};

const readSlice = async (blob, start, length) => {
  const end = Math.min(blob.size, start + length);
  if (start < 0 || end < start) throw new Error("Ogiltigt byteintervall.");
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
};

const getUint64LE = (view, offset) => {
  if (typeof view.getBigUint64 === "function") return view.getBigUint64(offset, true);
  const low = BigInt(view.getUint32(offset, true));
  const high = BigInt(view.getUint32(offset + 4, true));
  return (high << 32n) | low;
};

const setUint64LE = (view, offset, value) => {
  const number = BigInt(value);
  view.setUint32(offset, Number(number & 0xffffffffn), true);
  view.setUint32(offset + 4, Number((number >> 32n) & 0xffffffffn), true);
};

const parseFormat = (bytes) => {
  if (bytes.byteLength < 16) throw new Error("fmt-blocket är kortare än 16 byte.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatTag = view.getUint16(0, true);
  const channels = view.getUint16(2, true);
  const sampleRate = view.getUint32(4, true);
  const byteRate = view.getUint32(8, true);
  const blockAlign = view.getUint16(12, true);
  const bitsPerSample = view.getUint16(14, true);
  let validBitsPerSample = bitsPerSample;
  let channelMask = null;
  let effectiveFormatTag = formatTag;
  let subFormatGuid = null;
  let extensible = false;

  if (formatTag === 0xfffe) {
    if (bytes.byteLength < 40) throw new Error("WAVE_FORMAT_EXTENSIBLE saknar obligatoriska fält.");
    const extensionSize = view.getUint16(16, true);
    if (extensionSize < 22) throw new Error("WAVE_FORMAT_EXTENSIBLE saknar obligatoriska fält.");
    validBitsPerSample = view.getUint16(18, true) || bitsPerSample;
    channelMask = view.getUint32(20, true);
    effectiveFormatTag = view.getUint32(24, true);
    subFormatGuid = Array.from(bytes.slice(24, 40), value => value.toString(16).padStart(2, "0")).join("");
    const canonicalTail = EXTENSIBLE_GUID_TAIL.every((value, index) => view.getUint8(28 + index) === value);
    if (!canonicalTail || ![1, 3].includes(effectiveFormatTag)) {
      throw new Error("WAVE_FORMAT_EXTENSIBLE använder en subformat-GUID som inte stöds.");
    }
    extensible = true;
  }

  const encoding = effectiveFormatTag === 1
    ? "PCM"
    : effectiveFormatTag === 3
      ? "IEEE_FLOAT"
      : "UNSUPPORTED";

  if (![1, 2].includes(channels)) throw new Error(`Filen har ${channels} kanaler. LjudR 1.0 stöder mono och stereo.`);
  if (!SUPPORTED_SAMPLE_RATES.includes(sampleRate)) {
    throw new Error(`Samplingsfrekvensen ${sampleRate} Hz stöds inte. Tillåtna värden är ${SUPPORTED_SAMPLE_RATES.join(", ")} Hz.`);
  }
  if (encoding === "UNSUPPORTED") throw new Error(`Ljudformat ${effectiveFormatTag} stöds inte. Använd PCM eller IEEE float.`);
  if (encoding === "IEEE_FLOAT" && bitsPerSample !== 32) throw new Error("IEEE float stöds endast med 32 bitar.");
  if (encoding === "PCM" && ![16, 24, 32].includes(bitsPerSample)) {
    throw new Error("PCM stöds endast med 16, 24 eller 32 bitar.");
  }
  if (validBitsPerSample < 1 || validBitsPerSample > bitsPerSample) {
    throw new Error("WAVE_FORMAT_EXTENSIBLE har ett ogiltigt antal giltiga bitar.");
  }
  if (encoding === "IEEE_FLOAT" && validBitsPerSample !== 32) {
    throw new Error("IEEE float kräver 32 giltiga bitar.");
  }
  if (blockAlign !== channels * (bitsPerSample / 8)) {
    throw new Error("blockAlign stämmer inte med kanalantal och bitdjup.");
  }
  if (byteRate !== sampleRate * blockAlign) {
    throw new Error("byteRate stämmer inte med samplingsfrekvens och blockAlign.");
  }
  const warnings = [];

  return {
    formatTag,
    effectiveFormatTag,
    encoding,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    validBitsPerSample,
    channelMask,
    subFormatGuid,
    extensible,
    requiresValidBitsAwareProcessing: encoding === "PCM" && validBitsPerSample !== bitsPerSample,
    canReencode: encoding !== "PCM" || validBitsPerSample === bitsPerSample,
    warnings,
    raw: bytes
  };
};

export async function inspectWav(blob) {
  if (!blob || typeof blob.slice !== "function") throw new TypeError("En File eller Blob krävs.");
  if (blob.size < 12) throw new Error("Filen är för kort för att vara en WAV-fil.");

  const lead = await readSlice(blob, 0, 12);
  const leadView = new DataView(lead.buffer, lead.byteOffset, lead.byteLength);
  const container = ascii(leadView, 0, 4);
  const wave = ascii(leadView, 8, 4);
  if (["RF64", "BW64"].includes(container)) {
    throw new Error("RF64 och BW64 ligger utanför LjudR 1.0 och kan inte öppnas.");
  }
  if (container !== "RIFF" || wave !== "WAVE") {
    throw new Error("Filen är inte en little-endian RIFF/WAVE-fil.");
  }

  let offset = 12;
  let format = null;
  let data = null;
  let ds64 = null;
  const chunks = [];
  const warnings = [];

  while (offset + 8 <= blob.size) {
    const header = await readSlice(blob, offset, 8);
    if (header.byteLength < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const id = ascii(view, 0, 4);
    const declaredSize = view.getUint32(4, true);
    let size = declaredSize;

    if (id === "data" && declaredSize === RIFF_LIMIT && ds64?.dataSize != null) {
      size = Number(ds64.dataSize);
    }

    const dataOffset = offset + 8;
    const available = Math.max(0, blob.size - dataOffset);
    const boundedSize = Math.min(size, available);
    const chunk = { id, headerOffset: offset, dataOffset, declaredSize, size, boundedSize };
    chunks.push(chunk);

    if (id === "fmt ") {
      const body = await readSlice(blob, dataOffset, Math.min(boundedSize, 256));
      format = parseFormat(body);
    } else if (id === "data" && !data) {
      data = chunk;
    }

    if (size > available) {
      warnings.push(`${id}-blocket är avklippt: ${size} byte angavs, ${available} byte finns.`);
      break;
    }
    offset = dataOffset + size + (size & 1);
  }

  if (!format) throw new Error("WAV-filen saknar fmt-block.");
  if (!data) throw new Error("WAV-filen saknar data-block.");
  warnings.push(...format.warnings);
  const completeDataBytes = data.boundedSize - (data.boundedSize % format.blockAlign);
  if (completeDataBytes !== data.boundedSize) warnings.push("Data-blocket slutar mitt i en ljudbildruta.");
  const frameCount = Math.floor(completeDataBytes / format.blockAlign);
  const durationSeconds = format.sampleRate ? frameCount / format.sampleRate : 0;

  return {
    container,
    fileSize: blob.size,
    format,
    chunks,
    data: { ...data, completeDataBytes },
    frameCount,
    durationSeconds,
    ds64,
    warnings,
    isTruncated: data.size > data.boundedSize
  };
}

export async function parseWavHeader(blob) {
  const inspected = await inspectWav(blob);
  return {
    container: "RIFF/WAVE",
    formatTag: inspected.format.effectiveFormatTag,
    encoding: inspected.format.encoding === "IEEE_FLOAT" ? "IEEE float" : "PCM",
    channels: inspected.format.channels,
    sampleRate: inspected.format.sampleRate,
    byteRate: inspected.format.byteRate,
    blockAlign: inspected.format.blockAlign,
    bitsPerSample: inspected.format.bitsPerSample,
    validBitsPerSample: inspected.format.validBitsPerSample,
    channelMask: inspected.format.channelMask,
    extensible: inspected.format.extensible,
    byteRateConsistent: true,
    dataOffset: inspected.data.dataOffset,
    dataBytes: inspected.data.completeDataBytes,
    declaredDataBytes: inspected.data.declaredSize,
    truncated: inspected.isTruncated || inspected.data.completeDataBytes !== inspected.data.boundedSize,
    frameCount: inspected.frameCount,
    durationSeconds: inspected.durationSeconds,
    chunks: inspected.chunks.map(chunk => ({
      id: chunk.id,
      offset: chunk.dataOffset,
      declaredSize: chunk.declaredSize,
      availableSize: chunk.boundedSize,
    })),
    inspected,
  };
}

export function decodeSampleAt(view, offset, format) {
  const encoding = format.encoding === "IEEE float" ? "IEEE_FLOAT" : format.encoding;
  const bits = format.bitsPerSample;
  if (encoding === "IEEE_FLOAT" && bits === 32) return view.getFloat32(offset, true);
  if (encoding !== "PCM") throw new Error(`Kodningen ${encoding} ${bits} bit stöds inte.`);

  let integer;
  if (bits === 16) integer = view.getInt16(offset, true);
  else if (bits === 24) {
    integer = view.getUint8(offset)
      | (view.getUint8(offset + 1) << 8)
      | (view.getUint8(offset + 2) << 16);
    if (integer & 0x800000) integer |= 0xff000000;
  } else if (bits === 32) integer = view.getInt32(offset, true);
  else throw new Error(`PCM ${bits} bit stöds inte.`);

  const validBits = format.validBitsPerSample || bits;
  const paddingBits = bits - validBits;
  if (paddingBits > 0) integer >>= paddingBits;
  return integer / (2 ** (validBits - 1));
}

export function decodeInterleaved(bytes, format, target = null) {
  const { channels, bitsPerSample, encoding, blockAlign } = format;
  const frameCount = Math.floor(bytes.byteLength / blockAlign);
  // Bearbetningsvägen använder 64 bit float. Det bevarar hela precisionen
  // hos PCM32 genom gain och fades. IEEE float32 avrundas först när den nya
  // WAV-filen kodas, inte mellan de enskilda bearbetningsstegen.
  const output = target || new Float64Array(frameCount * channels);
  if (output.length < frameCount * channels) throw new RangeError("Målbufferten är för liten.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * blockAlign);
  let byteOffset = 0;
  let sampleIndex = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      let value;
      value = decodeSampleAt(view, byteOffset, format);
      byteOffset += bitsPerSample / 8;
      output[sampleIndex] = value;
      sampleIndex += 1;
    }
  }
  return output;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createTpdf(seed = 0x6d2b79f5) {
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return () => random() - random();
}

export function encodeInterleaved(samples, format, { dither = false, ditherSource = createTpdf() } = {}) {
  const { bitsPerSample, encoding } = format;
  if (encoding === "PCM" && (format.validBitsPerSample || bitsPerSample) !== bitsPerSample) {
    throw new Error("Omräkning av PCM med avvikande validBitsPerSample är blockerad i LjudR 1.0.");
  }
  const bytesPerSample = Math.ceil(bitsPerSample / 8);
  const bytes = new Uint8Array(samples.length * bytesPerSample);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  for (const input of samples) {
    const sample = Number.isFinite(input) ? input : 0;
    if (encoding === "IEEE_FLOAT" && bitsPerSample === 32) {
      view.setFloat32(offset, sample, true);
      offset += 4;
      continue;
    }
    if (encoding !== "PCM") throw new Error("Endast PCM och 32 bit float kan kodas.");

    const scale = 2 ** (bitsPerSample - 1);
    const noise = dither ? ditherSource() / scale : 0;
    const quantized = Math.round(clamp(sample + noise, -1, 1 - 1 / scale) * scale);
    if (bitsPerSample === 16) {
      view.setInt16(offset, quantized, true);
      offset += 2;
    } else if (bitsPerSample === 24) {
      view.setUint8(offset, quantized & 0xff);
      view.setUint8(offset + 1, (quantized >> 8) & 0xff);
      view.setUint8(offset + 2, (quantized >> 16) & 0xff);
      offset += 3;
    } else if (bitsPerSample === 32) {
      view.setInt32(offset, quantized, true);
      offset += 4;
    } else {
      throw new Error(`PCM ${bitsPerSample} bit kan inte kodas.`);
    }
  }
  return bytes;
}

const chunkBytes = (id, payload) => {
  const padded = payload.byteLength + (payload.byteLength & 1);
  const bytes = new Uint8Array(8 + padded);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 4; index += 1) view.setUint8(index, id.charCodeAt(index) || 32);
  view.setUint32(4, payload.byteLength, true);
  bytes.set(payload, 8);
  return bytes;
};

export async function createWaveHeader(source, selectionFrames, startFrame = 0) {
  const dataBytes = selectionFrames * source.format.blockAlign;
  const dataPadBytes = dataBytes & 1;
  const safeIds = new Set(["fmt ", "fact", "bext", "LIST"]);
  const chunks = [];
  const droppedChunks = [];

  for (const chunk of source.chunks) {
    if (["data", "ds64"].includes(chunk.id)) continue;
    if (!safeIds.has(chunk.id) || chunk.boundedSize > 8 * 1024 * 1024) {
      if (!['JUNK', 'PAD ', 'FLLR'].includes(chunk.id)) droppedChunks.push(chunk.id);
      continue;
    }
    const payload = await readSlice(source.blob, chunk.dataOffset, chunk.boundedSize);
    if (chunk.id === "LIST") {
      const listType = payload.byteLength >= 4 ? String.fromCharCode(...payload.slice(0, 4)) : "";
      if (listType !== "INFO") {
        droppedChunks.push("LIST:" + (listType || "okänd"));
        continue;
      }
    }
    if (chunk.id === "bext" && payload.byteLength >= 346 && startFrame > 0) {
      const copy = payload.slice();
      const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
      const original = getUint64LE(view, 338);
      setUint64LE(view, 338, original + BigInt(startFrame));
      chunks.push(chunkBytes(chunk.id, copy));
    } else if (chunk.id === "fact" && payload.byteLength >= 4) {
      const copy = payload.slice();
      new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(0, selectionFrames, true);
      chunks.push(chunkBytes(chunk.id, copy));
    } else {
      chunks.push(chunkBytes(chunk.id, payload));
    }
  }

  if (!chunks.some(bytes => String.fromCharCode(...bytes.slice(0, 4)) === "fmt ")) {
    chunks.unshift(chunkBytes("fmt ", source.format.raw));
  }

  const headerLength = 12 + chunks.reduce((total, bytes) => total + bytes.byteLength, 0) + 8;
  const riffSize = headerLength - 8 + dataBytes + dataPadBytes;
  if (riffSize > RIFF_LIMIT) throw new Error("Exporten överskrider RIFF-gränsen 4 GiB. RF64-export är ännu inte aktiverad.");
  const header = new Uint8Array(headerLength);
  const view = new DataView(header.buffer);
  for (const [index, value] of Array.from("RIFF").entries()) view.setUint8(index, value.charCodeAt(0));
  view.setUint32(4, riffSize, true);
  for (const [index, value] of Array.from("WAVE").entries()) view.setUint8(8 + index, value.charCodeAt(0));
  let cursor = 12;
  for (const bytes of chunks) {
    header.set(bytes, cursor);
    cursor += bytes.byteLength;
  }
  for (const [index, value] of Array.from("data").entries()) view.setUint8(cursor + index, value.charCodeAt(0));
  view.setUint32(cursor + 4, dataBytes, true);
  return { header, dataBytes, dataPadBytes, droppedChunks };
}

export function attachBlob(source, blob) {
  return { ...source, blob };
}

export const wavInternals = { ascii, readSlice, getUint64LE, setUint64LE, parseFormat, RIFF_LIMIT, EXTENSIBLE_GUID_TAIL };
