import { SR } from '../config';

export type Pcm = { samples: Float32Array; sampleRate: number };

// RIFF/WAVE (PCM16 / PCM32 / float32) → 모노 Float32 [-1, 1]
export function decodeWav(buf: ArrayBuffer): Pcm {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV 파일이 아님');

  let fmt = 0, channels = 0, sampleRate = 0, bits = 0;
  let dataOff = -1, dataLen = 0;
  for (let o = 12; o + 8 <= v.byteLength; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true);
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
      if (fmt === 0xfffe) fmt = v.getUint16(o + 32, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      dataOff = o + 8;
      dataLen = Math.min(size, v.byteLength - dataOff);
    }
    o += 8 + size + (size & 1);
  }
  if (dataOff < 0) throw new Error('data 청크 없음');

  const bytes = bits / 8;
  const frames = Math.floor(dataLen / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bytes;
      if (fmt === 3 && bits === 32) acc += v.getFloat32(p, true);
      else if (bits === 16) acc += v.getInt16(p, true) / 32768;
      else if (bits === 32) acc += v.getInt32(p, true) / 2147483648;
      else throw new Error(`지원하지 않는 형식: fmt=${fmt}, bits=${bits}`);
    }
    out[i] = acc / channels;
  }
  return { samples: out, sampleRate };
}

// 16kHz가 아니면 선형 보간으로 변환한다.
// 주의: librosa(soxr_hq)와 결과가 미세하게 다르다. 학습 데이터는 모두 16kHz라 골든 검증에는 쓰이지 않는다.
export function toMono16k(pcm: Pcm): Float32Array {
  if (pcm.sampleRate === SR) return pcm.samples;
  const ratio = pcm.sampleRate / SR;
  const n = Math.floor(pcm.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, pcm.samples.length - 1);
    out[i] = pcm.samples[i0] + (pcm.samples[i1] - pcm.samples[i0]) * (x - i0);
  }
  return out;
}
