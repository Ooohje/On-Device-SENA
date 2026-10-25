import { preprocess } from '../audio/preprocess';
import { SileroVad } from '../audio/sileroVad';
import { exists } from '../bench/files';
import { SR } from '../config';
import { PATHS } from '../paths';
import { Asr } from '../models/asr';
import { displayScore, Scorer } from '../models/scorer';
import { analyze, PronunciationAnalysis } from './pronunciation';
import { OFF_SCRIPT_WER, wordErrorRate } from './textMatch';

export type PracticeResult =
  | { kind: 'scored'; articulation: number; prosody: number; raw: { articulation: number; prosody: number }; transcript?: string; wer?: number; analysis?: PronunciationAnalysis; ms: number }
  | { kind: 'no_speech' }
  | { kind: 'too_short'; seconds: number }
  | { kind: 'off_script'; transcript: string; wer: number };

// 튜토리얼 화면 동안만 VAD·평가 모델(·whisper)을 메모리에 올린다
export class PracticeScorer {
  private constructor(private vad: SileroVad, private scorer: Scorer, private asr: Asr | null) {}

  static async load(): Promise<PracticeScorer> {
    if (!exists(PATHS.scorer) || !exists(PATHS.vad)) throw new Error('발음 평가 모델이 기기에 없습니다.\n개발 중에는 scripts/push-assets.ps1로 넣어주세요.');
    const [vad, scorer] = await Promise.all([SileroVad.load(PATHS.vad), Scorer.load(PATHS.scorer, 'cpu', 4)]);
    // whisper가 있으면 "제시 문장을 읽었는지" 확인한다 (없으면 점수만)
    const asr = exists(PATHS.whisper) ? await Asr.load(PATHS.whisper) : null;
    return new PracticeScorer(vad, scorer, asr);
  }

  get checksScript() {
    return !!this.asr;
  }

  async evaluate(samples16k: Float32Array, target: string): Promise<PracticeResult> {
    const t0 = Date.now();
    const pre = await preprocess(samples16k, this.vad);
    if (!pre.speechFound) return { kind: 'no_speech' };
    const seconds = (pre.end - pre.start) / SR;
    if (seconds < 0.6) return { kind: 'too_short', seconds };

    let transcript: string | undefined;
    let wer: number | undefined;
    if (this.asr) {
      transcript = (await this.asr.transcribe(pre.trimmed)).text;
      wer = wordErrorRate(target, transcript);
      if (wer > OFF_SCRIPT_WER) return { kind: 'off_script', transcript, wer };
    }
    const raw = await this.scorer.scoreRaw(pre.input);
    const analysis = transcript !== undefined ? analyze(target, transcript) : undefined;
    return { kind: 'scored', articulation: displayScore(raw.articulation), prosody: displayScore(raw.prosody), raw, transcript, wer, analysis, ms: Date.now() - t0 };
  }

  async release() {
    await Promise.all([this.vad.release(), this.scorer.release(), this.asr?.release()]);
  }
}

// 점수대별 한 줄 피드백
export function feedback(articulation: number, prosody: number): string {
  const avg = (articulation + prosody) / 2;
  if (avg >= 4.5) return '원어민처럼 자연스러워요!';
  if (avg >= 3.5) {
    if (prosody + 0.5 <= articulation) return '발음이 좋아요. 시범 음성처럼 강세와 억양을 조금 더 살려보세요.';
    if (articulation + 0.5 <= prosody) return '리듬이 좋아요. 팁을 보고 소리 하나하나를 또렷하게 해보세요.';
    return '좋아요! 한 번 더 하면 더 자연스러워질 거예요.';
  }
  if (avg >= 2.5) return '조금만 더! 시범 음성을 듣고 천천히 따라 해보세요.';
  return '먼저 시범 음성을 여러 번 듣고, 천천히 또박또박 말해보세요.';
}
