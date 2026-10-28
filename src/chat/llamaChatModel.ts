import * as Device from 'expo-device';
import { RAM_MIN_GB } from '../models/deviceCheck';
import { initLlama, LlamaContext } from 'llama.rn';
import { llmPath, PATHS } from '../paths';
import { ChatMessage, ChatModel, GenerateOptions } from './types';

// llama.rn 컨텍스트는 한 번에 한 생성만 가능하므로 호출을 순서대로 처리한다.
class LlamaChatModel implements ChatModel {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ctx: LlamaContext) {}

  generate(messages: ChatMessage[], opts: GenerateOptions, onToken?: (partial: string) => void): Promise<string> {
    const run = async () => {
      let partial = '';
      const r = await this.ctx.completion(
        { messages, n_predict: opts.maxTokens, temperature: opts.temperature, stop: opts.stop, jinja: true },
        onToken
          ? (d) => {
              partial += d.token;
              onToken(partial);
            }
          : undefined,
      );
      return r.text;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  release() {
    return this.ctx.release();
  }
}

let current: Promise<LlamaChatModel> | null = null;

// 대화 화면에서만 메모리에 올리고, 나가면 내린다 (평가 모델과 동시에 올리지 않기 위해)
export function loadChatModel(): Promise<ChatModel> {
  if (!current) {
    current = initLlama({
      model: llmPath(),
      n_ctx: 2048,
      n_threads: 4,
      n_gpu_layers: 0,
      // Gemma 3는 슬라이딩 윈도 어텐션(SWA)을 쓴다. 기본 SWA 캐시는 대화 일부를 되돌릴 수 없어, 앞부분이 조금만 달라져도
      // 매 턴 대화 전체를 처음부터 다시 계산했다(에뮬레이터 2·3턴 첫 글자 12초). swa_full로 전체 길이 캐시를 두면 되돌리기가 가능하다(+약 0.3GB)
      swa_full: true,
      use_mlock: false,
      // flash attention(flash_attn_type)은 켜지 않는다: 에뮬레이터에서 4B 로드 중 메모리 부족으로 앱이 종료됨(2026-10-23, v0.3.0 측정)
    })
      .then((ctx) => new LlamaChatModel(ctx))
      .catch((e) => {
        current = null;
        // Gemma 3 4B(약 2.5GB)는 RAM 6GB 이상 기기를 권장한다. 메모리가 부족하면 로드가 실패한다
        const gb = (Device.totalMemory ?? 0) / 1024 ** 3;
        if (gb && gb < RAM_MIN_GB) throw new Error(`대화 모델을 올리지 못했어요. 이 기기의 메모리(${gb.toFixed(1)}GB)가 부족할 수 있어요. 대화 기능은 RAM 6GB 이상 기기를 권장해요.
(${e?.message ?? e})`);
        throw e;
      });
  }
  return current;
}

export async function releaseChatModel() {
  const c = current;
  current = null;
  if (c) await (await c).release();
}
