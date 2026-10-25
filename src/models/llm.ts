import { initLlama, LlamaContext } from 'llama.rn';

export type LlmBench = {
  loadMs: number;
  firstTokenMs: number;
  totalMs: number;
  promptTokens: number;
  promptPerSec: number;
  genTokens: number;
  genPerSec: number;
  text: string;
};

// llama.cpp GGUF. 대화 기능 검증용 최소 래퍼.
export class Llm {
  private constructor(private ctx: LlamaContext, readonly loadMs: number) {}

  static async load(path: string, threads = 4, gpuLayers = 0) {
    const t0 = Date.now();
    const ctx = await initLlama({ model: path, n_ctx: 2048, n_threads: threads, n_gpu_layers: gpuLayers, use_mlock: false });
    return new Llm(ctx, Date.now() - t0);
  }

  async chat(system: string, user: string, maxTokens = 128): Promise<Omit<LlmBench, 'loadMs'>> {
    const t0 = Date.now();
    let first = 0;
    const r = await this.ctx.completion(
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        n_predict: maxTokens,
        temperature: 0.7,
      },
      () => {
        if (!first) first = Date.now() - t0;
      },
    );
    return {
      firstTokenMs: first,
      totalMs: Date.now() - t0,
      promptTokens: r.timings.prompt_n,
      promptPerSec: r.timings.prompt_per_second,
      genTokens: r.timings.predicted_n,
      genPerSec: r.timings.predicted_per_second,
      text: r.text,
    };
  }

  release() {
    return this.ctx.release();
  }
}
