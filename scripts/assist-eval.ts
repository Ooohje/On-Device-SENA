// 한국어로 도움받기 평가: 학습자가 한국어로 말한 내용을 대화 모델이 영어 따라 말하기 문장으로 바꾼 결과를 본다.
// 대화 모델: Ollama SIM_MODEL(기본 gemma3:4b = 앱 모델), 앱과 같은 코드(src/chat/assist.ts assistEnglish).
// 판정: ① 자동(영어만, 난이도별 단어 수 이내, 다시 만들기 횟수) ② qwen3:8b 심사(의미 보존·대화 맥락·자연스러움 1~5점)
// 실행: node scripts/run-ts.mjs scripts/assist-eval.ts [출력이름] → docs/assist-eval/<이름>.json, .md
import * as fs from 'fs';
import { assistEnglish } from '../src/chat/assist';
import { LEVELS } from '../src/chat/levels';
import { scenarioById } from '../src/chat/scenarios';
import { ChatMessage, ChatModel, GenerateOptions } from '../src/chat/types';
import { normalizeWords } from '../src/tutorial/textMatch';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:4b';
const JUDGE = process.env.JUDGE_MODEL ?? 'qwen3:8b';
const LEARNER = 'Jason';
const OUT = process.argv[2] ?? 'assist-eval';

async function ollama(model: string, messages: ChatMessage[], o: Partial<GenerateOptions> & { seed?: number; nctx?: number }) {
  const r = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature: o.temperature ?? 0.7, num_predict: o.maxTokens ?? 120, num_ctx: o.nctx ?? 2048, stop: o.stop, seed: o.seed ?? 7 } }),
  });
  const j: any = await r.json();
  return (j.message?.content ?? '') as string;
}
const model: ChatModel = { generate: (m: ChatMessage[], o: GenerateOptions) => ollama(MODEL, m, o) };

// 상황별 6문장: 대화 상대가 방금 한 말(partner, 비우면 첫 인사) + 학습자가 한국어로 하고 싶은 말.
// 구어체·생략(맥락을 알아야 바꿀 수 있는 말)·존댓말·한국식 표현을 섞었다
type Item = { scenario: string; partner?: string; ko: string };
const ITEMS: Item[] = [
  { scenario: 'free_talk', ko: '오늘 회사에서 너무 바빠서 점심도 못 먹었어' },
  { scenario: 'free_talk', partner: 'Oh no! So what did you do this weekend?', ko: '친구랑 한강에서 치맥 했어' },
  { scenario: 'free_talk', partner: 'That sounds fun. Do you go there often?', ko: '아니 한 달에 한 번 정도?' },
  { scenario: 'free_talk', partner: 'What kind of music do you like?', ko: '요즘은 잔잔한 노래가 좋더라' },
  { scenario: 'free_talk', partner: 'Are you a morning person?', ko: '전혀요. 알람을 다섯 번은 꺼요' },
  { scenario: 'free_talk', partner: 'Any plans for the holidays?', ko: '아직 정해진 건 없는데 제주도 갈까 생각 중이야' },
  { scenario: 'cafe', ko: '아이스 아메리카노 큰 사이즈로 한 잔 주세요' },
  { scenario: 'cafe', partner: 'Sure. For here or to go?', ko: '가져갈게요' },
  { scenario: 'cafe', partner: 'Would you like anything else?', ko: '케이크는 뭐가 제일 잘 나가요?' },
  { scenario: 'cafe', partner: 'Our cheesecake is really popular.', ko: '그럼 그걸로 하나 주세요' },
  { scenario: 'cafe', partner: 'Your total is 9 dollars and 50 cents.', ko: '카드 되나요?' },
  { scenario: 'cafe', partner: 'Here you go. Enjoy!', ko: '빨대는 어디 있어요?' },
  { scenario: 'airport', ko: '여행 왔어요. 일주일 있을 거예요' },
  { scenario: 'airport', partner: 'Where will you be staying?', ko: '시내에 있는 호텔에 묵을 거예요' },
  { scenario: 'airport', partner: 'Do you have a return ticket?', ko: '네, 다음 주 금요일 비행기예요' },
  { scenario: 'airport', partner: 'Is this your first time here?', ko: '아니요, 두 번째예요' },
  { scenario: 'airport', partner: 'Do you have anything to declare?', ko: '김이랑 과자밖에 없어요' },
  { scenario: 'airport', partner: 'Okay. What do you do for work?', ko: '회사원이에요. 마케팅 일 해요' },
  { scenario: 'hotel', ko: '네, 김제이슨 이름으로 예약했어요' },
  { scenario: 'hotel', partner: 'I see you booked two nights. Is that correct?', ko: '하루 더 연장할 수 있을까요?' },
  { scenario: 'hotel', partner: 'Would you like a high floor or a low floor?', ko: '조용한 방이면 상관없어요' },
  { scenario: 'hotel', partner: 'Breakfast is from 7 to 10.', ko: '체크아웃은 몇 시까지예요?' },
  { scenario: 'hotel', partner: 'Is there anything else I can help you with?', ko: '방에 수건이 하나밖에 없어요' },
  { scenario: 'hotel', partner: 'Here is your key. Room 1205.', ko: '와이파이 비밀번호 좀 알려주세요' },
  { scenario: 'directions', ko: '지하철역이 어디예요?' },
  { scenario: 'directions', partner: 'Go straight two blocks and turn left.', ko: '걸어서 얼마나 걸려요?' },
  { scenario: 'directions', partner: 'About ten minutes.', ko: '좀 멀다. 버스 타는 게 나을까요?' },
  { scenario: 'directions', partner: 'Which subway line do you need?', ko: '2호선이요. 시청 가야 돼요' },
  { scenario: 'directions', partner: 'Do you see the big bank over there?', ko: '아 저 빨간 건물이요?' },
  { scenario: 'directions', partner: 'Yes, the station is right behind it.', ko: '정말 감사합니다. 덕분에 살았어요' },
  { scenario: 'interview', ko: '저는 3년 동안 마케팅 일을 했습니다' },
  { scenario: 'interview', partner: 'Why do you want to work for us?', ko: '회사의 성장 가능성이 크다고 생각합니다' },
  { scenario: 'interview', partner: 'What is your biggest strength?', ko: '책임감이 강하고 꼼꼼한 편입니다' },
  { scenario: 'interview', partner: 'Tell me about a time you faced a challenge.', ko: '마감이 촉박했는데 팀원들과 밤새서 끝냈어요' },
  { scenario: 'interview', partner: 'Where do you see yourself in five years?', ko: '팀을 이끄는 리더가 되고 싶습니다' },
  { scenario: 'interview', partner: 'Do you have any questions for us?', ko: '입사하면 어떤 교육을 받나요?' },
  { scenario: 'shopping', ko: '그냥 구경하는 중이에요' },
  { scenario: 'shopping', partner: 'Let me know if you need any help.', ko: '이거 다른 색상도 있어요?' },
  { scenario: 'shopping', partner: 'We have it in black and navy.', ko: '네이비로 입어볼 수 있을까요?' },
  { scenario: 'shopping', partner: 'How does it fit?', ko: '좀 끼어요. 한 치수 큰 거 있어요?' },
  { scenario: 'shopping', partner: 'This one is 30 percent off today.', ko: '좀 더 깎아주시면 안 돼요?' },
  { scenario: 'shopping', partner: 'Will that be all?', ko: '네, 선물 포장도 해 주세요' },
];

const MAX_WORDS: Record<string, number> = { easy: 12, normal: 18, native: 20 };

const JUDGE_PROMPT = (partner: string, ko: string, en: string, level: string) => `You are checking an English-learning app. A Korean learner could not say something in English, so they said it in Korean, and the app suggested an English sentence for the learner to repeat.

Conversation partner just said: "${partner}"
Learner's Korean: "${ko}"
Suggested English: "${en}"
Target level: ${level === 'easy' ? 'beginner (simple words)' : level === 'native' ? 'advanced (native-like)' : 'intermediate (everyday English)'}

Rate 1-5 each:
meaning: Does the English keep the meaning of the Korean (nothing important added, missing, or wrong)?
context: Does it make sense as the learner's reply to the partner's line?
natural: Is it natural, correct English that a person would actually say, at the target level?
Answer only with JSON like {"meaning":5,"context":5,"natural":5}`;

async function judge(partner: string, ko: string, en: string, level: string) {
  for (let i = 0; i < 2; i++) {
    const out = await ollama(JUDGE, [{ role: 'user', content: JUDGE_PROMPT(partner, ko, en, level) }], { temperature: 0, maxTokens: 40, nctx: 4096 });
    const m = out.match(/\{[^}]*\}/);
    try {
      const j = JSON.parse(m![0]);
      if ([j.meaning, j.context, j.natural].every((x) => typeof x === 'number')) return j as { meaning: number; context: number; natural: number };
    } catch {
      // 다시 묻기
    }
  }
  return null;
}

(async () => {
  const rows: any[] = [];
  for (const level of LEVELS) {
    for (const it of ITEMS) {
      const sc = scenarioById(it.scenario)!;
      const partner = it.partner ?? sc.opening(LEARNER);
      const t0 = Date.now();
      const { en, attempts } = await assistEnglish(model, sc, LEARNER, level, partner, it.ko);
      const ms = Date.now() - t0;
      const words = normalizeWords(en).length;
      const j = en ? await judge(partner, it.ko, en, level.id) : null;
      rows.push({ level: level.id, scenario: it.scenario, partner, ko: it.ko, en, attempts, words, withinLimit: !!en && words <= MAX_WORDS[level.id], ms, judge: j });
      console.log(`[${level.id}] ${it.ko} → ${en || '(실패)'} ${j ? JSON.stringify(j) : ''}`);
    }
  }
  const by = (lv?: string) => {
    const r = rows.filter((x) => !lv || x.level === lv);
    const ok = r.filter((x) => x.en);
    const judged = ok.filter((x) => x.judge);
    const mean = (k: string) => judged.reduce((a, x) => a + x.judge[k], 0) / judged.length;
    const good = judged.filter((x) => x.judge.meaning >= 4 && x.judge.context >= 4 && x.judge.natural >= 4).length;
    return {
      n: r.length,
      produced: ok.length / r.length,
      firstTry: r.filter((x) => x.en && x.attempts === 1).length / r.length,
      withinLimit: r.filter((x) => x.withinLimit).length / r.length,
      meanWords: ok.reduce((a, x) => a + x.words, 0) / ok.length,
      maxWords: Math.max(...ok.map((x) => x.words)),
      judged: judged.length,
      meaning: mean('meaning'),
      context: mean('context'),
      natural: mean('natural'),
      allAtLeast4: good / judged.length,
    };
  };
  const summary = { all: by(), easy: by('easy'), normal: by('normal'), native: by('native') };
  fs.mkdirSync('docs/assist-eval', { recursive: true });
  fs.writeFileSync(`docs/assist-eval/${OUT}.json`, JSON.stringify({ model: MODEL, judge: JUDGE, items: ITEMS.length, summary, rows }, null, 1));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const md = [
    `# 한국어로 도움받기 평가 (${MODEL}, 심사 ${JUDGE})`,
    '',
    `7개 상황 × 6문장 = ${ITEMS.length}문장, 난이도 3단계 = ${rows.length}건. 앱과 같은 코드(src/chat/assist.ts).`,
    '',
    '| 난이도 | 건수 | 영어 문장 생성 | 첫 시도 성공 | 단어 수 제한 이내 | 평균 단어 | 의미 보존 | 맥락 적합 | 자연스러움 | 세 항목 모두 4점 이상 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...(['easy', 'normal', 'native', 'all'] as const).map((k) => {
      const s = summary[k];
      return `| ${k} | ${s.n} | ${pct(s.produced)} | ${pct(s.firstTry)} | ${pct(s.withinLimit)} | ${s.meanWords.toFixed(1)} | ${s.meaning.toFixed(2)} | ${s.context.toFixed(2)} | ${s.natural.toFixed(2)} | ${pct(s.allAtLeast4)} |`;
    }),
    '',
    '## 4점 미만 사례',
    '',
    ...rows
      .filter((x) => !x.judge || x.judge.meaning < 4 || x.judge.context < 4 || x.judge.natural < 4)
      .map((x) => `- [${x.level}] ${x.ko} → ${x.en || '(실패)'} ${x.judge ? JSON.stringify(x.judge) : ''}`),
    '',
    '## 전체 결과 (자연스럽게 난이도)',
    '',
    ...rows.filter((x) => x.level === 'normal').map((x) => `- ${x.ko} → ${x.en}`),
  ].join('\n');
  fs.writeFileSync(`docs/assist-eval/${OUT}.md`, md);
  console.log(JSON.stringify(summary, null, 1));
})();
