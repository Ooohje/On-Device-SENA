import { normalizeWords } from '../tutorial/textMatch';
import { AssistMeta } from './assist';
import { cleanOneLine } from './sanitize';
import { ChatModel } from './types';

// 음성으로 말한 메시지의 말하기 지표 (대화 화면에서 녹음할 때 기록)
export type SpeechMeta = { speechSec: number; pauses: number; words: number };

export type Correction = { original: string; corrected: string };

export type ConversationReport = {
  turns: number;
  avgWords: number;
  voiceTurns: number;
  wpm: number | null; // 음성으로 말한 턴의 분당 단어 수
  longPauses: number; // 0.6초 넘는 쉼 횟수 (음성 턴 합계)
  corrections: Correction[];
  practice: string[]; // 튜토리얼 "내 문장"으로 보낼 문장
  assisted?: AssistMeta[]; // 한국어로 도움받아 따라 말한 표현 (v0.3.1부터)
  createdAt: number;
};

// 1B 모델에 "맞으면 OK"를 고르게 하면 틀린 문장에도 OK만 답한다(재현율 0/15).
// 그래서 판단은 시키지 않고 항상 고쳐 쓰게 한 뒤, 원문과 달라졌는지를 코드(acceptCorrection)로 판정한다.
export function buildCorrectionPrompt(sentence: string) {
  return [
    {
      role: 'user' as const,
      content: [
        'Rewrite this sentence from a Korean English learner so that it is grammatically correct, natural spoken English.',
        'Keep the same meaning and change as few words as possible. If it is already correct, copy it exactly.',
        'Write only the sentence.',
        '',
        `Sentence: ${sentence}`,
      ].join('\n'),
    },
  ];
}

// 문법 교정은 대부분 기능어(관사·전치사·조동사·대명사)나 같은 단어의 변화형(go→went, going→go)을 바꾼다.
// 그 밖의 내용어 교체(autumn→fall, jogging→run, join→work for)는 문법 오류가 아니라 말투 바꾸기이므로 교정으로 인정하지 않는다.
const FUNCTION_WORDS = new Set(
  (
    'a an the to for at in on by with of from about into than that this these those it its ' +
    'i me my you your he him his she her we us our they them their ' +
    'is am are was were be been being have has had having do does did done not no ' +
    'will would can could shall should may might must ' +
    'and or but so very really too much many more most ever just also there here then'
  ).split(' '),
);
const IRREGULAR: [string, string][] = [
  ['go', 'went'], ['eat', 'ate'], ['buy', 'bought'], ['see', 'saw'], ['come', 'came'], ['take', 'took'], ['make', 'made'],
  ['get', 'got'], ['give', 'gave'], ['find', 'found'], ['think', 'thought'], ['bring', 'brought'], ['teach', 'taught'],
  ['meet', 'met'], ['leave', 'left'], ['feel', 'felt'], ['keep', 'kept'], ['sleep', 'slept'], ['spend', 'spent'],
  ['send', 'sent'], ['tell', 'told'], ['say', 'said'], ['pay', 'paid'], ['buy', 'bought'], ['run', 'ran'], ['write', 'wrote'],
  ['drink', 'drank'], ['swim', 'swam'], ['begin', 'began'], ['know', 'knew'], ['fly', 'flew'], ['drive', 'drove'],
  ['ride', 'rode'], ['speak', 'spoke'], ['wake', 'woke'], ['wear', 'wore'], ['win', 'won'], ['lose', 'lost'], ['sit', 'sat'],
  ['stand', 'stood'], ['understand', 'understood'], ['hear', 'heard'], ['read', 'read'], ['put', 'put'], ['cut', 'cut'],
  ['good', 'well'], ['child', 'children'], ['person', 'people'], ['man', 'men'], ['woman', 'women'],
];
const irregular = new Set(IRREGULAR.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
const sameStem = (a: string, b: string) => {
  if (irregular.has(`${a}|${b}`)) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return (s.length >= 2 && l.startsWith(s)) || (s.length >= 3 && s.slice(0, 3) === l.slice(0, 3)); // go→going, live→lived
};

// 원문→교정문에서 빠진 단어와 새로 들어간 단어(순서 이동은 상쇄)가 모두 문법 교정으로 설명되는지
export function isGrammarEdit(original: string[], fixed: string[]): boolean {
  const count = (ws: string[]) => ws.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
  const a = count(original);
  const b = count(fixed);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [w, n] of a) for (let i = 0; i < n - (b.get(w) ?? 0); i++) removed.push(w);
  for (const [w, n] of b) for (let i = 0; i < n - (a.get(w) ?? 0); i++) added.push(w);
  const freeR = removed.filter((w) => !FUNCTION_WORDS.has(w));
  const freeA = added.filter((w) => !FUNCTION_WORDS.has(w));
  // 남은 내용어는 서로 변화형으로 짝지어져야 한다
  const pool = [...freeA];
  for (const r of freeR) {
    const k = pool.findIndex((x) => sameStem(r, x));
    if (k < 0) return false;
    pool.splice(k, 1);
  }
  return pool.length === 0;
}

const wordDistance = (a: string[], b: string[]) => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
};

// 교정 결과를 그대로 믿지 않는다: 바뀐 게 없거나(대소문자·문장부호만), 너무 많이 바뀌었으면(다시 쓰기·환각) 버린다.
export function acceptCorrection(original: string, output: string): string | null {
  const fixed = cleanOneLine(output)
    .replace(/^(ok[.!]?\s+)/i, '')
    .replace(/^(corrected|rewritten)?\s*(sentence)?\s*:\s*/i, '')
    .replace(/^["“]|["”]$/g, '')
    .trim();
  if (!fixed || /^ok[.!]?$/i.test(fixed)) return null;
  if (/[가-힣]/.test(fixed)) return null;
  const a = normalizeWords(original);
  const b = normalizeWords(fixed);
  const d = wordDistance(a, b);
  if (d === 0) return null;
  if (d > Math.max(2, Math.ceil(a.length * 0.5))) return null;
  if (b.length > 16) return null;
  if (!isGrammarEdit(a, b)) return null;
  return /[.!?]$/.test(fixed) ? fixed : `${fixed}.`;
}

// 교정할 문장 후보: 3단어 이상, 영어만, 질문·인사 같은 짧은 상투어 제외
function candidates(texts: string[]): string[] {
  const seen = new Set<string>();
  return texts
    .map((t) => t.trim())
    .filter((t) => !/[가-힣]/.test(t) && normalizeWords(t).length >= 3)
    .flatMap((t) => t.match(/[^.!?]+[.!?]?/g) ?? [t])
    .map((t) => t.trim())
    .filter((t) => normalizeWords(t).length >= 3 && !/^(thank|thanks|bye|see you|nice to)/i.test(t))
    .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
    .slice(0, 8);
}

export async function buildReport(
  model: ChatModel,
  userMessages: { content: string; meta: (SpeechMeta & { assist?: undefined }) | { assist: AssistMeta } | null }[],
): Promise<ConversationReport> {
  const turns = userMessages.length;
  const words = userMessages.map((m) => normalizeWords(m.content).length);
  // 한국어로 도움받아 따라 말한 문장은 모델이 만든 문장이므로 문법 교정·말 속도 계산에서 뺀다
  const assisted = userMessages.flatMap((m) => (m.meta?.assist ? [m.meta.assist] : []));
  const own = userMessages.filter((m) => !m.meta?.assist);
  const voice = own.filter((m): m is { content: string; meta: SpeechMeta } => !!m.meta && 'speechSec' in m.meta && m.meta.speechSec > 0);
  const voiceWords = voice.reduce((a, m) => a + m.meta.words, 0);
  const voiceSec = voice.reduce((a, m) => a + m.meta.speechSec, 0);

  const corrections: Correction[] = [];
  for (const sentence of candidates(own.map((m) => m.content))) {
    if (corrections.length >= 5) break;
    try {
      const out = await model.generate(buildCorrectionPrompt(sentence), { maxTokens: 40, temperature: 0 });
      const fixed = acceptCorrection(sentence, out);
      if (fixed) corrections.push({ original: sentence, corrected: fixed });
    } catch {
      // 한 문장 교정 실패는 건너뛴다
    }
  }

  return {
    turns,
    avgWords: turns ? words.reduce((a, b) => a + b, 0) / turns : 0,
    voiceTurns: voice.length,
    wpm: voiceSec > 3 ? (voiceWords / voiceSec) * 60 : null,
    longPauses: voice.reduce((a, m) => a + m.meta.pauses, 0),
    corrections,
    // 교정된 문장 + 도움받은 표현을 튜토리얼 "내 문장"으로 보낸다
    practice: [...corrections.map((c) => c.corrected), ...assisted.map((x) => x.en)].filter((t) => normalizeWords(t).length <= 12).slice(0, 5),
    assisted,
    createdAt: Date.now(),
  };
}
