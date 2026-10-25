import { initWhisper, WhisperContext } from 'whisper.rn/index'; // 패키지 exports에 '.' 항목이 없어 index를 직접 지정

// whisper.cpp (ggml-base.en.bin 등). 16kHz 모노 float32 PCM을 그대로 넣는다.
export class Asr {
  private constructor(private ctx: WhisperContext) {}

  static async load(path: string) {
    return new Asr(await initWhisper({ filePath: path, useGpu: false }));
  }

  async transcribe(pcm16k: Float32Array, threads = 4) {
    // 문서에는 "float32 PCM"이라고 되어 있지만 네이티브(RNWhisperJSI.cpp decodePcm16)는 16비트 정수로 읽는다.
    // float32를 그대로 넘기면 잡음으로 해석돼 "(Music)", "(static)" 같은 결과가 나온다.
    const i16 = new Int16Array(pcm16k.length);
    for (let i = 0; i < pcm16k.length; i++) i16[i] = Math.max(-1, Math.min(1, pcm16k[i])) * 32767;
    const buf = i16.buffer as ArrayBuffer;
    const t0 = Date.now();
    const { promise } = this.ctx.transcribeData(buf, { language: 'en', maxThreads: threads, tokenTimestamps: true });
    const r = await promise;
    return { text: r.result.trim(), segments: r.segments, ms: Date.now() - t0 };
  }

  release() {
    return this.ctx.release();
  }
}
