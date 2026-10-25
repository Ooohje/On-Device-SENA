import { MAX_LEN, VAD_PAD } from '../config';
import { SileroVad } from './sileroVad';

// 학습 전처리(model_utils.preprocess_audio)와 동일한 순서:
// Peak 정규화 → Silero VAD(threshold 0.5) → 첫 구간 시작/마지막 구간 끝 ±250ms로 자르기 → 8초 0 패딩

// librosa.util.normalize(norm=inf): 최댓값으로 나눈다. 최댓값이 float32 최소 정규수보다 작으면 그대로 둔다.
export function peakNormalize(x: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  if (m < 1.1754943508222875e-38) return x.slice();
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] / m;
  return out;
}

// 앞에서부터 MAX_LEN까지 자르고, 부족하면 뒤를 0으로 채운다 (attention mask 없음 — 길이를 바꾸면 점수가 달라짐)
export function padOrTrim(x: Float32Array, maxLen = MAX_LEN): Float32Array {
  const out = new Float32Array(maxLen);
  out.set(x.subarray(0, Math.min(x.length, maxLen)));
  return out;
}

export type Preprocessed = {
  trimmed: Float32Array; // VAD로 자른 음성 (학습 데이터 preprocessed/*.wav와 동일)
  input: Float32Array; // 모델 입력 [128000]
  start: number;
  end: number;
  speechFound: boolean;
  vadMs: number;
};

export async function preprocess(raw16k: Float32Array, vad: SileroVad): Promise<Preprocessed> {
  const peak = peakNormalize(raw16k);
  const t0 = Date.now();
  const ts = await vad.getSpeechTimestamps(peak, 0.5);
  const vadMs = Date.now() - t0;
  let start = 0;
  let end = peak.length;
  if (ts.length) {
    start = Math.max(0, ts[0].start - VAD_PAD);
    end = Math.min(peak.length, ts[ts.length - 1].end + VAD_PAD);
  }
  const trimmed = peak.slice(start, end);
  return { trimmed, input: padOrTrim(trimmed), start, end, speechFound: ts.length > 0, vadMs };
}
