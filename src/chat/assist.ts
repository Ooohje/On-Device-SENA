import { ChatLevel } from './levels';
import { cleanOneLine } from './sanitize';
import { ChatMessage, ChatModel, Scenario } from './types';
import { normalizeWords, wordErrorRate } from '../tutorial/textMatch';

// 한국어로 도움받기: 자유 대화 중 영어로 말이 막히면 하고 싶은 말을 한국어로 말한다 →
// 대화 모델(Gemma 3 4B)이 지금 대화 흐름과 난이도에 맞는 영어 한두 문장을 만든다 → 학습자가 그 문장을 영어로 따라 말한다 →
// 따라 말한 문장이 그대로 이번 차례 입력이 되어 상대가 바로 다음 대답을 한다(같은 말을 다시 할 필요 없음).
// 정답 문장이 있으므로 자유 대화 중에도 튜토리얼과 같은 발음·운율 점수와 단어별 발음 분석을 줄 수 있다.

// 평가 모델은 앞 8초만 보므로, 따라 말할 문장은 8초 안에 말할 수 있는 길이로 자른다(초보자 말 속도 약 2.5단어/초)
const MAX_WORDS: Record<string, number> = { easy: 12, normal: 18, native: 20 };

export function buildAssistPrompt(s: Scenario, learner: string, level: ChatLevel, lastPartnerLine: string, korean: string): ChatMessage[] {
  const max = MAX_WORDS[level.id] ?? 18;
  const style =
    level.id === 'easy'
      ? 'Use only very common, simple words and short sentences.'
      : level.id === 'native'
        ? 'Sound like a native speaker. Natural phrasal verbs and common expressions are good.'
        : 'Use natural everyday spoken English.';
  return [
    {
      role: 'user',
      content: [
        `Translate what a Korean English learner wants to say into English that the learner can repeat out loud.`,
        '',
        'Rules:',
        '- Translate only what the Korean says. Do not add reactions, greetings, thanks, or details that are not in the Korean.',
        '- Keep every specific thing the Korean mentions (food, numbers, places, times).',
        '- If the Korean is a question, write a direct question. If it is a request, write a polite request.',
        '- Use the conversation only to understand short Korean like "그걸로 주세요" or "네".',
        `- ${style}`,
        `- 1 or 2 short sentences, at most ${max} words.`,
        '- Write only the English.',
        '',
        // 예시 3개 (평가 문장과 겹치지 않게): 직접 질문, 짧은 말의 맥락 풀이, 덧붙이지 않기
        'Example 1',
        'Partner: "What can I get for you?"',
        'Korean: "따뜻한 라떼 작은 거 하나요"',
        'English: Can I get a small hot latte, please?',
        '',
        'Example 2',
        'Partner: "We have it in blue and white."',
        'Korean: "흰색으로 할게요"',
        "English: I'll take the white one.",
        '',
        'Example 3',
        'Partner: "How was your trip?"',
        'Korean: "좋았는데 비가 많이 왔어요. 화장실은 어디예요?"',
        'English: It was good, but it rained a lot. Where is the restroom?',
        '',
        `Now the real one. Situation: ${s.setting}`,
        `Partner (${s.partnerName}): "${lastPartnerLine}"`,
        `Korean: "${korean}"`,
        'English:',
      ].join('\n'),
    },
  ];
}

// 대화 엔진(ConversationEngine.assist)과 PC 평가(scripts/assist-eval.ts)가 같이 쓴다. 형식에 맞지 않으면 온도를 올려 한 번 더 만든다
export async function assistEnglish(model: ChatModel, s: Scenario, learner: string, level: ChatLevel, lastPartnerLine: string, korean: string): Promise<{ en: string; attempts: number }> {
  const prompt = buildAssistPrompt(s, learner, level, lastPartnerLine, korean.trim());
  const temps = [0.2, 0.6];
  for (let i = 0; i < temps.length; i++) {
    const en = cleanAssist(await model.generate(prompt, { maxTokens: 60, temperature: temps[i] }), level);
    if (en) return { en, attempts: i + 1 };
  }
  return { en: '', attempts: temps.length };
}

// 모델 출력에서 따라 말할 영어 문장만 남긴다. 쓸 수 없으면 빈 문자열
export function cleanAssist(out: string, level: ChatLevel): string {
  // 예시 형식(Example/Korean:)을 이어 쓰면 첫 줄만 쓴다
  let t = cleanOneLine(out.trim().split('\n')[0])
    .replace(/^(english|answer|reply|you could say|say)\s*:\s*/i, '')
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .replace(/\s*\([^)]*[가-힣][^)]*\)/g, '') // (한국어 설명) 제거
    .trim();
  if (!t || /[가-힣]/.test(t)) return '';
  const max = MAX_WORDS[level.id] ?? 18;
  const sentences = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((x) => x.trim()) ?? [t];
  let kept = '';
  for (const x of sentences.slice(0, 2)) {
    const next = kept ? `${kept} ${x}` : x;
    if (kept && normalizeWords(next).length > max) break;
    kept = next;
  }
  if (normalizeWords(kept).length > max + 4) return ''; // 한 문장이 지나치게 길면 쓰지 않는다
  return /[.!?]$/.test(kept) ? kept : `${kept}.`;
}

// 따라 말하기 통과 기준: 받아쓰기와 목표 문장의 단어 오류율. 튜토리얼(0.6, "다른 문장을 읽었나")보다 엄격하게 둔다 —
// 여기서는 따라 말한 문장이 대화 입력이 되므로 대부분 맞게 말했는지를 본다. 학습자 발음 때문에 받아쓰기가 조금 틀리는 것은 허용
export const SHADOW_PASS_WER = 0.35;
export const shadowPassed = (target: string, heard: string) => wordErrorRate(target, heard) <= SHADOW_PASS_WER;
// 이 횟수만큼 실패하면 "이 문장으로 보내기"를 보여 준다
export const SHADOW_TRIES_BEFORE_SKIP = 2;

// 메시지에 함께 저장하는 도움받기 기록 (리포트 "도움받은 표현")
export type AssistMeta = {
  ko: string;
  en: string;
  heard?: string; // 마지막으로 따라 말한 받아쓰기
  tries: number;
  passed: boolean; // 따라 말하기 통과(false면 "이 문장으로 보내기")
  articulation?: number; // 화면 표시 점수(1~5)
  prosody?: number;
};
