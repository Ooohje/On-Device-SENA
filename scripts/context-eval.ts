// 자유 대화 문맥 유지 평가: 앞에서 말한 정보를 기억하는지, 학습자 질문에 답하는지, 이미 끝난 단계를 다시 묻지 않는지.
// 대화 모델: Ollama SIM_MODEL(기본 gemma3:1b = 앱 모델). 판정: ① 키워드 프로브(자동) ② qwen3:8b 심사(1~5점, 오프라인)
// 실행: node scripts/run-ts.mjs scripts/context-eval.ts [출력이름]
import * as fs from 'fs';
import { ConversationEngine } from '../src/chat/engine';
import { scenarioById } from '../src/chat/scenarios';
import { ChatMessage, ChatModel, GenerateOptions } from '../src/chat/types';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:1b';
const JUDGE = process.env.JUDGE_MODEL ?? 'qwen3:8b';
const NCTX = Number(process.env.SIM_NCTX ?? 2048);
const LEARNER = 'Jason';
const OUT = process.argv[2] ?? 'context-eval';

async function ollama(model: string, messages: ChatMessage[], o: Partial<GenerateOptions> & { seed?: number; nctx?: number }) {
  const r = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature: o.temperature ?? 0.7, num_predict: o.maxTokens ?? 120, num_ctx: o.nctx ?? NCTX, stop: o.stop, seed: o.seed ?? 7 } }),
  });
  const j: any = await r.json();
  return (j.message?.content ?? '') as string;
}
class OllamaModel implements ChatModel {
  constructor(private seed: number) {}
  generate(messages: ChatMessage[], opts: GenerateOptions) {
    return ollama(MODEL, messages, { ...opts, seed: this.seed });
  }
}

// probe: 이 턴의 답에 있어야 할 말(하나라도) / 있으면 안 되는 말
type Turn = { say: string; must?: RegExp; mustNot?: RegExp; why?: string };
const CASES: { scenario: string; turns: Turn[] }[] = [
  {
    scenario: 'free_talk',
    turns: [
      { say: 'I went to Busan last weekend with my sister.' },
      { say: 'We ate a lot of seafood. Her name is Jiwoo.' },
      { say: 'Do you like seafood?', must: /\b(i (love|like|enjoy|don't|do not|am not|prefer|think)|i'm (a big|not)|yes|no|my favorite)\b/i, why: '질문에 답하기' },
      { say: 'The weather was very hot, so we went to the beach.' },
      { say: 'Next month I want to go there again. Any ideas for me?', must: /busan|beach|seafood|haeundae|market|jiwoo|sister/i, why: '앞 내용 활용' },
      { say: 'By the way, do you remember who I went with?', must: /sister|jiwoo/i, why: '사람 기억' },
      { say: 'And which city did I visit?', must: /busan/i, why: '장소 기억' },
      { say: 'I have to go now. Bye!' },
    ],
  },
  {
    scenario: 'free_talk',
    turns: [
      { say: 'I started a new job at a bank in Seoul.' },
      { say: 'It is hard because I have to wake up at 6.' },
      { say: 'I usually take the subway. It takes one hour.' },
      { say: 'What do you do to relax after work?', must: /\b(i |i'm|me|my)\b/i, why: '질문에 답하기' },
      { say: 'Can you guess what time I wake up?', must: /\b6\b|six/i, why: '숫자 기억' },
      { say: 'Where do I work again?', must: /bank/i, why: '직장 기억' },
      { say: 'Thanks. See you!' },
    ],
  },
  {
    scenario: 'cafe',
    turns: [
      { say: 'Hi, can I get a medium iced latte with oat milk?', mustNot: /what size|hot or iced|iced or hot|which milk|what (kind of )?milk/i, why: '이미 말한 주문을 다시 묻지 않기' },
      { say: 'No, just the drink.', mustNot: /what size|hot or iced|iced or hot|which milk|what (kind of )?milk/i, why: '이미 말한 주문을 다시 묻지 않기' },
      { say: 'For here, please.', mustNot: /for here or to go|here or to go/i, why: '이미 답한 것 다시 묻지 않기' },
      { say: 'Can I pay by card?', must: /card|sure|of course|yes|tap|insert/i, why: '질문에 답하기' },
      { say: 'Sorry, what did I order?', must: /latte/i, why: '주문 기억' },
      { say: 'Thank you!' },
    ],
  },
  {
    scenario: 'hotel',
    turns: [
      { say: 'Hi, I have a reservation under Jason Kim. Here is my passport.', mustNot: /(what|may i have|can i (have|get)) (is )?(your|the) name|passport\?/i, why: '이미 준 정보 다시 묻지 않기' },
      { say: 'What time is breakfast?', must: /\b\d|seven|six|eight|nine|am\b|a\.m/i, why: '질문에 답하기' },
      { say: 'Great. Is there a gym in the hotel?', must: /gym|fitness|floor|yes|no|sorry/i, why: '질문에 답하기' },
      { say: 'Sorry, what was the breakfast time again?', must: /\b\d|seven|six|eight|nine|am\b/i, why: '앞 답변 기억' },
      { say: 'Thank you so much.' },
    ],
  },
];

const JUDGE_PROMPT = (history: string, user: string, reply: string) =>
  [
    'You are grading an English conversation partner bot for a language learner.',
    'Rate the BOT REPLY from 1 to 5 for context: 5 = directly responds to the learner\'s last message and is fully consistent with earlier details; 3 = generic or only partly related; 1 = ignores the message, contradicts or forgets earlier details, or asks for information already given.',
    'Answer with only the number.',
    '',
    'Conversation so far:',
    history || '(start)',
    '',
    `LEARNER: ${user}`,
    `BOT REPLY: ${reply}`,
  ].join('\n');

(async () => {
  const seeds = (process.env.SIM_SEEDS ?? '7,8').split(',').map(Number);
  const out: any[] = [];
  let probes = 0, probesOk = 0;
  const scores: number[] = [];
  const byWhy: Record<string, [number, number]> = {};
  for (const seed of seeds)
    for (const c of CASES) {
      const sc = scenarioById(c.scenario)!;
      const eng = new ConversationEngine(new OllamaModel(seed), sc, LEARNER, []);
      const opening = await eng.open();
      const log: string[] = [`${sc.partnerName}: ${opening}`];
      const rows = [];
      for (const t of c.turns) {
        const history = log.join('\n');
        const reply = await eng.send(t.say);
        log.push(`${LEARNER}: ${t.say}`, `${sc.partnerName}: ${reply}`);
        let ok: boolean | undefined;
        if (t.must || t.mustNot) {
          ok = (!t.must || t.must.test(reply)) && (!t.mustNot || !t.mustNot.test(reply));
          probes++;
          if (ok) probesOk++;
          const k = t.why!;
          byWhy[k] = byWhy[k] ?? [0, 0];
          byWhy[k][1]++;
          if (ok) byWhy[k][0]++;
        }
        const j = await ollama(JUDGE, [{ role: 'user', content: JUDGE_PROMPT(history, t.say, reply) }], { temperature: 0, maxTokens: 5, nctx: 4096 });
        const score = Number(j.match(/[1-5]/)?.[0] ?? 0);
        if (score) scores.push(score);
        rows.push({ user: t.say, reply, probe: t.why, ok, judge: score });
        process.stdout.write(ok === false ? 'x' : '.');
      }
      out.push({ seed, scenario: c.scenario, summary: eng.summary, rows });
    }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const res = { model: MODEL, judge: JUDGE, nctx: NCTX, seeds, probeAcc: probesOk / probes, probes, judgeMean: mean, byWhy, conversations: out };
  fs.mkdirSync('docs/context-eval', { recursive: true });
  fs.writeFileSync(`docs/context-eval/${OUT}.json`, JSON.stringify(res, null, 1));
  console.log(`\n[${MODEL}] 프로브 ${probesOk}/${probes} (${((probesOk / probes) * 100).toFixed(0)}%) | 심사 평균 ${mean.toFixed(2)}/5`);
  for (const [k, [a, b]] of Object.entries(byWhy)) console.log(`  ${k}: ${a}/${b}`);
})();
