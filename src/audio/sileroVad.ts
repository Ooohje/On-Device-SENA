import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { SR } from '../config';

// Silero VAD v6.0.0 ONNX + get_speech_timestamps 포팅.
// 원본: ~/.cache/torch/hub/snakers4_silero-vad_master/src/silero_vad/utils_vad.py (학습 전처리에 사용한 버전)
// 기본값(threshold 0.5, min_speech 250ms, min_silence 100ms, speech_pad 30ms, max_speech = ∞)만 지원한다.
// max_speech = ∞ 이면 원본의 최대 길이 분할 분기는 실행되지 않으므로 생략했다.

const WINDOW = 512;
const CONTEXT = 64;

export type SpeechSegment = { start: number; end: number };

export class SileroVad {
  private constructor(private session: InferenceSession) {}

  static async load(path: string) {
    return new SileroVad(await InferenceSession.create(path, { executionProviders: ['cpu'], intraOpNumThreads: 1 }));
  }

  async speechProbs(audio: Float32Array): Promise<Float32Array> {
    let state = new Float32Array(2 * 128);
    let context = new Float32Array(CONTEXT);
    const sr = new Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);
    const n = Math.ceil(audio.length / WINDOW);
    const probs = new Float32Array(n);
    const input = new Float32Array(CONTEXT + WINDOW);
    for (let k = 0; k < n; k++) {
      input.fill(0);
      input.set(context, 0);
      input.set(audio.subarray(k * WINDOW, Math.min(audio.length, (k + 1) * WINDOW)), CONTEXT);
      const out = await this.session.run({
        input: new Tensor('float32', input.slice(), [1, CONTEXT + WINDOW]),
        state: new Tensor('float32', state, [2, 1, 128]),
        sr,
      });
      probs[k] = (out.output.data as Float32Array)[0];
      state = new Float32Array(out.stateN.data as Float32Array);
      context = input.slice(WINDOW); // 마지막 64샘플
    }
    return probs;
  }

  async getSpeechTimestamps(audio: Float32Array, threshold = 0.5): Promise<SpeechSegment[]> {
    const probs = await this.speechProbs(audio);
    const minSpeech = (SR * 250) / 1000;
    const minSilence = (SR * 100) / 1000;
    const pad = (SR * 30) / 1000;
    const negThreshold = Math.max(threshold - 0.15, 0.01);
    const len = audio.length;

    const speeches: SpeechSegment[] = [];
    let triggered = false;
    let cur: Partial<SpeechSegment> = {};
    let tempEnd = 0;

    for (let i = 0; i < probs.length; i++) {
      const p = probs[i];
      const pos = WINDOW * i;
      if (p >= threshold && tempEnd) tempEnd = 0;
      if (p >= threshold && !triggered) {
        triggered = true;
        cur = { start: pos };
        continue;
      }
      if (p < negThreshold && triggered) {
        if (!tempEnd) tempEnd = pos;
        if (pos - tempEnd < minSilence) continue;
        cur.end = tempEnd;
        if (cur.end - cur.start! > minSpeech) speeches.push(cur as SpeechSegment);
        cur = {};
        tempEnd = 0;
        triggered = false;
      }
    }
    if (cur.start !== undefined && len - cur.start > minSpeech) speeches.push({ start: cur.start, end: len });

    for (let i = 0; i < speeches.length; i++) {
      const s = speeches[i];
      if (i === 0) s.start = Math.trunc(Math.max(0, s.start - pad));
      if (i !== speeches.length - 1) {
        const gap = speeches[i + 1].start - s.end;
        if (gap < 2 * pad) {
          s.end += Math.trunc(Math.floor(gap / 2));
          speeches[i + 1].start = Math.trunc(Math.max(0, speeches[i + 1].start - Math.floor(gap / 2)));
        } else {
          s.end = Math.trunc(Math.min(len, s.end + pad));
          speeches[i + 1].start = Math.trunc(Math.max(0, speeches[i + 1].start - pad));
        }
      } else {
        s.end = Math.trunc(Math.min(len, s.end + pad));
      }
    }
    return speeches;
  }

  release() {
    return this.session.release();
  }
}
