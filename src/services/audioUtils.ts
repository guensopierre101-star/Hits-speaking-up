/**
 * Audio processing utilities for converting microphone recordings into 16 kHz mono 16-bit PCM WAV,
 * formatted directly as base64 for Gemini inlineData.
 */

export interface ProcessedAudio {
  base64: string;
  duration: number;
  isSilent: boolean;
}

export async function convertBlobTo16kHzMonoWav(blob: Blob): Promise<ProcessedAudio> {
  if (blob.size < 200) {
    return { base64: '', duration: 0, isSilent: true };
  }

  const arrayBuffer = await blob.arrayBuffer();

  // Create an AudioContext to decode whatever format the browser recorded (webm, ogg, mp4, wav)
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    if (audioCtx.state !== 'closed') {
      await audioCtx.close();
    }
  }

  const targetSampleRate = 16000;
  const duration = decodedBuffer.duration;
  if (duration < 0.2) {
    return { base64: '', duration, isSilent: true };
  }

  const targetLength = Math.max(1, Math.ceil(duration * targetSampleRate));

  // Use OfflineAudioContext to downsample/resample to 16 kHz mono (1 channel)
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const rawSamples = renderedBuffer.getChannelData(0);

  // Measure peak and RMS energy to detect muted mic / empty recording
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < rawSamples.length; i++) {
    const abs = Math.abs(rawSamples[i]);
    if (abs > peak) peak = abs;
    sumSq += rawSamples[i] * rawSamples[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, rawSamples.length));

  if (peak < 0.004 || rms < 0.0005) {
    return { base64: '', duration, isSilent: true };
  }

  // Keep the full untrimmed audio so soft fillers ("hmmm") and tiny edge words are never clipped
  const wavBytes = encodeWavPcm16(rawSamples, targetSampleRate);
  const base64 = uint8ArrayToBase64(wavBytes);

  return {
    base64,
    duration,
    isSilent: false,
  };
}

/**
 * Creates standard 44-byte RIFF header for 16-bit mono PCM WAV
 */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length (file size - 8)
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  writeString(view, 8, 'WAVE');

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  // Subchunk1Size (16 for PCM)
  view.setUint32(16, 16, true);
  // AudioFormat (1 for linear PCM)
  view.setUint16(20, 1, true);
  // NumChannels (1 for mono)
  view.setUint16(22, numChannels, true);
  // SampleRate
  view.setUint32(24, sampleRate, true);
  // ByteRate
  view.setUint32(28, byteRate, true);
  // BlockAlign
  view.setUint16(32, blockAlign, true);
  // BitsPerSample
  view.setUint16(34, 16, true);

  // "data" sub-chunk
  writeString(view, 36, 'data');
  // Subchunk2Size (data size)
  view.setUint32(40, dataSize, true);

  // Write PCM samples clamped to signed 16-bit integer [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks to prevent stack overflow
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}
