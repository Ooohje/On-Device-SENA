import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { MAX_LEN } from '../config';

export type Backend = 'cpu' | 'xnnpack' | 'nnapi';
export type RawScores = { articulation: number; prosody: number };

// 발음·운율 평가 모델 (track_a/outputs/mobile/sena_scorer.onnx, 입력 [1,128000] → 출력 scores [1,2])
export class Scorer {
  private constructor(private session: InferenceSession, readonly backend: Backend) {}

  static async load(path: string, backend: Backend = 'cpu', threads = 4) {
    const session = await InferenceSession.create(path, {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: threads,
    });
    return new Scorer(session, backend);
  }

  async scoreRaw(input: Float32Array): Promise<RawScores> {
    if (input.length !== MAX_LEN) throw new Error(`입력 길이는 ${MAX_LEN}이어야 함 (현재 ${input.length})`);
    const out = await this.session.run({ input_values: new Tensor('float32', input, [1, MAX_LEN]) });
    const d = out.scores.data as Float32Array;
    return { articulation: d[0], prosody: d[1] };
  }

  release() {
    return this.session.release();
  }
}

// 화면 표시용: [1, 5]로 자르고 0.5 단위 반올림
export const displayScore = (x: number) => Math.round(Math.min(5, Math.max(1, x)) * 2) / 2;
