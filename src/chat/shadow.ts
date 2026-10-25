import { preprocess } from '../audio/preprocess';
import { SileroVad } from '../audio/sileroVad';
import { Asr } from '../models/asr';
import { displayScore, Scorer } from '../models/scorer';
import { shadowPassed } from './assist';
import { wordErrorRate } from '../tutorial/textMatch';

// 한국어로 도움받기의 따라 말하기 확인: whisper 받아쓰기 → 목표 문장과 비교(통과 기준 assist.ts SHADOW_PASS_WER) →
// 통과하면 평가 모델로 발음·운율 점수. 대화 화면과 기술 검증 화면(src/bench/tests.ts assistBench)이 같이 쓴다
export type ShadowModels = { asr: Asr; vad: SileroVad | null; scorer: Scorer | null };
export type ShadowResult = { heard: string; wer: number; passed: boolean; articulation?: number; prosody?: number; ms: number };

export async function evaluateShadow(m: ShadowModels, samples16k: Float32Array, target: string): Promise<ShadowResult> {
  const t0 = Date.now();
  const heard = (await m.asr.transcribe(samples16k)).text.replace(/^\[.*\]$|^\(.*\)$/, '').trim();
  const wer = heard ? wordErrorRate(target, heard) : 1;
  if (!heard || !shadowPassed(target, heard)) return { heard, wer, passed: false, ms: Date.now() - t0 };
  let scores: { articulation: number; prosody: number } | undefined;
  if (m.vad && m.scorer) {
    try {
      const pre = await preprocess(samples16k, m.vad);
      if (pre.speechFound) {
        const raw = await m.scorer.scoreRaw(pre.input);
        scores = { articulation: displayScore(raw.articulation), prosody: displayScore(raw.prosody) };
      }
    } catch {
      // 점수 없이 통과만 기록
    }
  }
  return { heard, wer, passed: true, ...scores, ms: Date.now() - t0 };
}
