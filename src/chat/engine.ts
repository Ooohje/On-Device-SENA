import {
  buildHintPrompt,
  buildRecapPrompt,
  buildReturningOpeningPrompt,
  buildSummaryPrompt,
  buildSystemPrompt,
} from './prompts';
import { assistEnglish } from './assist';
import { ChatLevel, levelById } from './levels';
import { cleanOneLine, cleanReply } from './sanitize';
import { ChatMessage, ChatModel, Memory, Scenario } from './types';

// 작은 모델(n_ctx 2048)에 맞춘 대화 메모리 설정.
// 최근 대화는 그대로 두고, 오래된 턴은 요약으로 압축해 시스템 프롬프트에 넣는다.
// 요약(압축)은 모델의 KV 캐시를 덮어써 다음 턴에 대화 전체를 다시 계산하게 만든다 → 창을 넉넉히 두고 가끔만 압축한다
const KEEP_MAX = 16; // 창에 이만큼 쌓이면 압축
const KEEP_AFTER = 8; // 압축 후 남길 최근 메시지 수
const WINDOW_TOKEN_BUDGET = 1100;
const NOTES_CHAR_BUDGET = 600; // 학습자가 말한 사실 메모 (약 170토큰)
const estTokens = (s: string) => Math.ceil(s.length / 3.5);

// 학습자가 질문했는가 (물음표가 없어도 의문사로 시작하면 질문으로 본다)
const isQuestion = (t: string) => /\?\s*$|\?\s|^\s*(do|does|did|can|could|would|will|what|where|when|who|why|how|is|are)\b/i.test(t);

export type EngineSnapshot = { messages: ChatMessage[]; memory: Memory };

export class ConversationEngine {
  readonly messages: ChatMessage[] = []; // 화면·DB용 전체 기록
  private window: ChatMessage[] = []; // 모델에 그대로 넣는 최근 대화
  private memory: Memory;
  private maintenance: Promise<void> | null = null;
  private stepPtr = 0; // 다음에 안내할 역할극 단계

  constructor(
    private model: ChatModel,
    readonly scenario: Scenario,
    readonly learner: string,
    pastSessions: string[] = [],
    readonly level: ChatLevel = levelById('normal'),
  ) {
    this.memory = { summary: '', pastSessions: pastSessions.slice(0, 2) };
  }

  get summary() {
    return this.memory.summary;
  }

  // 첫 마디: 이전 대화 기억이 있으면 자유 대화에서만 LLM으로 인사를 만들고, 아니면 정해진 문장을 쓴다.
  async open(): Promise<string> {
    let line = this.scenario.opening(this.learner);
    if (this.scenario.id === 'free_talk' && this.memory.pastSessions.length) {
      try {
        const out = await this.model.generate(buildReturningOpeningPrompt(this.scenario, this.learner, this.memory.pastSessions), {
          maxTokens: 60,
          temperature: 0.7,
        });
        const cleaned = cleanReply(out, this.scenario.partnerName, this.learner, 2);
        if (cleaned.length > 5) line = cleaned;
      } catch {
        // 실패하면 기본 인사
      }
    }
    this.push({ role: 'assistant', content: line });
    return line;
  }

  // 첫 인사를 보여 주는 동안 시스템 프롬프트와 첫 인사를 미리 계산해 KV 캐시에 올려 둔다.
  // 첫 턴에는 약 400토큰의 시스템 프롬프트를 처리하느라 첫 토큰까지 몇 초가 걸렸다(에뮬레이터 4.5초) → 학습자가 말하는 동안 끝낸다.
  // 이후 send()는 앞부분이 같으므로 학습자 발화와 이번 턴 지시만 새로 계산한다.
  warm(): Promise<void> {
    const msgs = this.buildInput(); // 마지막이 상대의 첫 인사라 이번 턴 지시는 붙지 않는다
    this.maintenance = this.model
      .generate(msgs, { maxTokens: 1, temperature: 0 })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => (this.maintenance = null));
    return this.maintenance;
  }

  async send(userText: string, onToken?: (partial: string) => void): Promise<string> {
    if (this.maintenance) await this.maintenance; // 이전 턴 요약이 끝날 때까지 대기
    const text = userText.trim();
    // 이번 턴 지시는 사용자 발화 뒤에 붙여 창(모델 입력)에 그대로 남긴다. 다음 턴의 입력이 '이번 입력 + 답 + 새 발화'로
    // 이어 붙기만 하므로 llama.cpp가 앞부분 계산(KV 캐시)을 재사용하고, 새 발화와 지시만 계산한다.
    // (예전처럼 지난 지시를 지우면 앞부분이 달라져 매 턴 대화 전체를 다시 계산했다)
    this.messages.push({ role: 'user', content: text });
    this.window.push({ role: 'user', content: `${text}\n\n${this.turnDirective(text)}`, plain: text });

    const stop = [`\n${this.learner}:`, `${this.learner}:`, '\nUser:'];
    const raw = await this.model.generate(
      this.buildInput(),
      { maxTokens: this.level.maxTokens, temperature: 0.7, stop },
      onToken ? (p) => onToken(cleanReply(p, this.scenario.partnerName, this.learner, 3)) : undefined,
    );
    // 질문에 대한 답은 예전에 한 말과 같아도 지우지 않는다 ("조식 시간 다시 알려줘" → 같은 답이 맞음)
    const cleaned = cleanReply(raw, this.scenario.partnerName, this.learner, 3);
    let reply = isQuestion(userText) ? cleaned : this.dropRepeats(cleaned);
    if (!reply) {
      // 답 전체가 이전 대사의 반복이면 한 번 더 만든다 (온도를 올리고 반복 금지를 덧붙임)
      const input = this.buildInput();
      const lastMsg = input[input.length - 1];
      input[input.length - 1] = { ...lastMsg, content: `${lastMsg.content}\n[Say something new. Do not repeat anything you said before.]` };
      const retry = await this.model.generate(input, { maxTokens: this.level.maxTokens, temperature: 0.9, stop });
      reply = this.dropRepeats(cleanReply(retry, this.scenario.partnerName, this.learner, 3));
    }
    if (!reply) reply = 'That sounds nice! Can you tell me more about it?';
    this.push({ role: 'assistant', content: reply });

    // 학습자가 답을 생각하는 동안 오래된 턴을 요약한다
    this.maintenance = this.compressIfNeeded().finally(() => (this.maintenance = null));
    return reply;
  }

  async hint(): Promise<string> {
    if (this.maintenance) await this.maintenance;
    const last = [...this.window].reverse().find((m) => m.role === 'assistant');
    if (!last) return '';
    const out = await this.model.generate(buildHintPrompt(this.scenario, this.learner, last.content), { maxTokens: 30, temperature: 0.6 });
    return cleanOneLine(out).split(/(?<=[.!?])\s/)[0];
  }

  // 한국어로 도움받기: 학습자가 한국어로 말한 내용을 지금 대화와 난이도에 맞는 영어로 바꾼다 (src/chat/assist.ts)
  // 대화 창(KV 캐시)과 별개의 짧은 프롬프트라 대화 기록에는 남지 않는다. 결과가 형식에 맞지 않으면 한 번 더 만든다
  async assist(korean: string): Promise<string> {
    if (this.maintenance) await this.maintenance;
    const last = [...this.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const { en } = await assistEnglish(this.model, this.scenario, this.learner, this.level, last, korean);
    if (!en) throw new Error('영어 문장을 만들지 못했어요. 조금 더 짧게 다시 말해 주세요.');
    return en;
  }

  // 대화를 마치며 다음에 기억할 내용(1~2문장)을 만든다
  async end(): Promise<string> {
    if (this.maintenance) await this.maintenance;
    if (!this.window.some((m) => m.role === 'user')) return '';
    const out = await this.model.generate(buildRecapPrompt(this.scenario, this.learner, this.memory.summary, this.window), {
      maxTokens: 80,
      temperature: 0,
    });
    return cleanOneLine(out);
  }

  // 시스템 프롬프트 + 최근 대화. Gemma 템플릿은 user로 시작해야 하므로 앞쪽 상대 대사는 시스템 프롬프트로 옮긴다.
  // 1B 모델은 대화가 길어지면 시스템 규칙을 잊으므로, 마지막 사용자 메시지 뒤에 이번 턴의 지시를 붙인다(모델 입력에만, 기록에는 남기지 않음).
  buildInput(): ChatMessage[] {
    const msgs = [...this.window];
    // 상대의 첫 인사로 시작하는 창은 앞에 가상의 시작 신호를 넣어 실제 대화 기록처럼 만든다.
    // (시스템 프롬프트에 "이미 이렇게 말했다"고 인용하면 1B 모델이 그 문장을 그대로 따라 말했다 — 에뮬레이터 실측)
    if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', content: `(${this.learner} joins the conversation.)` });
    const system = buildSystemPrompt(this.scenario, this.learner, this.memory, this.level);
    return [{ role: 'system', content: system }, ...msgs.map((m) => ({ role: m.role, content: m.content }))];
  }

  // 학습자가 말한 사실을 원문 그대로 모은 메모. 1B 모델은 몇 턴 전 대화나 요약 속 사실을 잘 못 찾아 쓰지만(실측: "어디서 일하죠?" → 엉뚱한 답),
  // 바로 앞에 원문을 다시 보여 주면 정확히 인용한다. 질문·한국어 질문은 빼고, 최근 것부터 예산 안에서 담는다.
  private learnerNotes(): string {
    const said = this.messages.filter((m) => m.role === 'user').slice(0, -1).map((m) => m.content.trim());
    const facts: string[] = [];
    let len = 0;
    for (let i = said.length - 1; i >= 0; i--) {
      const sentences = (said[i].match(/[^.!?]+[.!?]*/g) ?? []).map((x) => x.trim()).filter((x) => x && !x.endsWith('?') && !/[가-힣]/.test(x) && x.split(/\s+/).length >= 3);
      for (const x of sentences.reverse()) {
        if (len + x.length > NOTES_CHAR_BUDGET) return facts.reverse().join(' ');
        facts.push(x);
        len += x.length + 1;
      }
    }
    return facts.reverse().join(' ');
  }

  // 메모는 3인칭으로 바꿔 넣는다. "I went with my sister"를 그대로 주면 1B 모델이 I를 자기로 읽어 "you went with me"라고 답했다(실측).
  private thirdPerson(text: string): string {
    const n = this.learner;
    return text
      .replace(/\bI'm\b|\bI am\b/g, `${n} is`)
      .replace(/\bI've\b|\bI have\b/g, `${n} has`)
      .replace(/\bI'll\b|\bI will\b/g, `${n} will`)
      .replace(/\bI'd\b/g, `${n} would`)
      .replace(/\bI was\b/g, `${n} was`)
      .replace(/\bI\b/g, n)
      .replace(/\b[Mm]y\b|\b[Mm]ine\b/g, `${n}'s`)
      .replace(/\b[Mm]e\b|\b[Mm]yself\b/g, n);
  }

  // 이번 턴에 안내할 단계: 학습자가 이미 말한 정보의 단계는 건너뛴다
  private nextStep(advance = true): string | undefined {
    const steps = this.scenario.steps;
    if (!steps?.length) return undefined;
    const userText = this.messages.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
    let i = this.stepPtr;
    while (i < steps.length - 1 && this.scenario.stepDone?.[i]?.test(userText)) i++;
    this.stepPtr = advance ? Math.min(i + 1, steps.length - 1) : i;
    return steps[i];
  }

  private turnDirective(userText: string): string {
    const p = this.scenario.partnerName;
    const n = this.learner;
    const replies = this.messages.filter((m) => m.role === 'assistant').length;
    // 학습자 메모는 학습자가 자기 이야기를 물을 때만 붙인다("누구랑 갔지?", "어디서 일한다고 했지?").
    // 지시가 대화 기록에 계속 남으므로, 매 턴 메모를 붙이면 문맥(2,048토큰)이 빨리 찬다.
    const aboutMe = isQuestion(userText) && /\b(I|my|me)\b|remember/i.test(userText) && !/^\s*(can|could|may) I\b/i.test(userText); // '카드로 내도 돼요?' 같은 부탁은 제외
    const notes = aboutMe ? this.thirdPerson(this.learnerNotes()) : '';
    const memo = notes ? `[Notes about ${n} (facts ${n} told you): ${notes} Use these facts when they matter. Never make up facts about ${n}.]
` : '';
    if (/\b(bye|goodbye|see you|have to go|gotta go|good night)\b/i.test(userText))
      return `[${p}: say a warm, short goodbye to ${n}. Do not ask a question.]`;
    // 감사 인사만 했을 때: 할 일이 끝났으면 마무리, 아니면 다음 단계로
    if (/^\s*(ok(ay)?[,!. ]*)?(thank you|thanks)( so much| very much| for your time| a lot)?[!. ]*$/i.test(userText))
      return `[${p}: reply politely in one sentence. If everything is done, close the conversation kindly. Otherwise, ask about the next step.]`;
    const parts: string[] = [];
    if (/[가-힣]/.test(userText)) parts.push(`first tell ${n} how to say what they asked in natural English, in quotes`);
    const asked = isQuestion(userText);
    if (asked) {
      // 질문을 그대로 다시 보여 줘야 1B 모델이 질문에 답한다 (실측: 앞 화제에 반응만 하고 답을 안 함)
      const q = userText.replace(/\s+/g, ' ').trim();
      parts.push(`${n} asked you: "${q}" Answer this question first, clearly, in one sentence${notes ? ` (if it asks about ${n}, answer only from the notes about ${n})` : ''}`);
    } else {
      parts.push('react to what they just said in one or two short sentences');
    }
    // 이름은 세 번에 한 번만 (4B는 매번 이름을 부르는 경향이 있어 다른 턴에는 명시적으로 막는다)
    parts.push(replies % 3 === 0 ? `use the name ${n} once` : `do not say the name ${n} this time`);
    // 질문에 답하는 턴에는 역할극 단계를 넘기지 않는다 (답 대신 다음 단계를 말해 버리는 것을 막음)
    const next = this.nextStep(!asked);
    if (next) parts.push(`then end with one simple question. Your next step: ${next}. Do not ask for anything ${n} already told you`);
    else parts.push(`then ask ${n} one simple question about what they said`);
    return `${memo}[${p}: ${parts.join(', ')}.]`;
  }

  // 1B 모델은 자기가 이미 한 문장(특히 첫 인사)을 다시 말하곤 한다. 이전 상대 대사와 같은 문장은 지운다.
  private dropRepeats(reply: string): string {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const split = (x: string) => x.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g) ?? [x];
    const said = new Set(this.messages.filter((m) => m.role === 'assistant').flatMap((m) => split(m.content).map(norm)));
    const kept = split(reply).filter((s) => !said.has(norm(s)));
    return kept.length ? kept.join(' ').replace(/^["“]\s*/, '').replace(/\s{2,}/g, ' ').trim() : ''; // 전부 반복이면 빈 문자열 → send()가 다시 생성
  }

  private push(m: ChatMessage) {
    this.messages.push(m);
    this.window.push(m);
  }

  private async compressIfNeeded() {
    const tokens = this.window.reduce((a, m) => a + estTokens(m.content), 0);
    if (this.window.length <= KEEP_MAX && tokens <= WINDOW_TOKEN_BUDGET) return;
    // 남는 창이 user 메시지로 시작하도록 자를 위치를 맞춘다
    let cut = this.window.length - KEEP_AFTER;
    while (cut < this.window.length && this.window[cut].role !== 'user') cut++;
    const old = this.window.slice(0, cut);
    if (!old.length) return;
    try {
      const out = await this.model.generate(buildSummaryPrompt(this.scenario, this.learner, this.memory.summary, old), {
        maxTokens: 110,
        temperature: 0,
      });
      const s = cleanOneLine(out);
      if (s) {
        this.memory.summary = s;
        this.window = this.window.slice(cut);
      }
    } catch {
      // 요약에 실패하면 창을 그대로 두고 다음 턴에 다시 시도한다
    }
    // 요약이 계속 실패해도 컨텍스트(2048)를 넘지 않도록 오래된 턴을 버린다
    if (this.window.length > KEEP_MAX + 6) this.window = this.window.slice(cut);
  }
}
