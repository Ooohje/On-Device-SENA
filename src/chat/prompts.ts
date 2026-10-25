import { ChatLevel, levelById } from './levels';
import { ChatMessage, Memory, Scenario } from './types';

// 1B급 모델은 긴 지시를 잘 따르지 못하므로, 규칙을 짧은 번호 목록으로 주고 가장 중요한 것(짧게, 역할 유지, 질문으로 끝내기)을 앞에 둔다.
export function buildSystemPrompt(s: Scenario, learner: string, memory: Memory, level: ChatLevel = levelById('normal')): string {
  const lines = [
    `You are ${s.partnerName}, ${s.partnerRole}.`,
    s.setting,
    `You are speaking with ${learner}, a Korean person practicing spoken English with you.`,
    '',
    `What to do: ${s.goal}`,
    '',
    'Rules:',
    `1. Stay in character as ${s.partnerName}. Never say you are an AI or a language model.`,
    `2. ${level.rules[0]}`,
    `3. Usually end with one simple question so ${learner} keeps talking. Ask only one question at a time.`,
    `4. ${level.rules[1]}`,
    `5. Use the name ${learner} sometimes, but not in every reply.`,
    `6. If ${learner} makes a grammar mistake, do not explain it. Just say the correct version naturally in your reply.`,
    `7. If ${learner} writes in Korean or asks how to say something, give the English expression in quotes, then continue in English.`,
    '8. Write plain spoken text only. No emojis, no lists, no headings, and no actions like *smiles*.',
  ];
  if (memory.summary) lines.push('', `Conversation so far: ${memory.summary}`);
  if (memory.pastSessions.length) lines.push('', `From earlier conversations with ${learner}: ${memory.pastSessions.join(' ')}`);
  return lines.join('\n');
}

const transcript = (msgs: ChatMessage[], learner: string, partner: string) =>
  msgs.map((m) => `${m.role === 'user' ? learner : partner}: ${m.plain ?? m.content}`).join('\n');

// 오래된 턴을 요약에 합친다. 모델이 대화를 이어 쓰지 않도록 "요약만" 요구하고, 형식을 한 단락으로 고정한다.
export function buildSummaryPrompt(s: Scenario, learner: string, prev: string, msgs: ChatMessage[]): ChatMessage[] {
  return [
    {
      role: 'user',
      content: [
        `Summarize this conversation between ${learner} (an English learner) and ${s.partnerName} (${s.partnerRole}).`,
        `Write at most 3 short sentences in English. Keep facts ${learner} shared (names, places, likes, plans, choices) and what was already asked or decided.`,
        'Use only information that is written in the conversation below. Do not guess or add anything.',
        'Do not continue the conversation. Write only the summary.',
        '',
        prev ? `Earlier summary: ${prev}` : '',
        'Conversation:',
        transcript(msgs, learner, s.partnerName),
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

// 대화를 마칠 때 다음 대화에서 기억할 내용을 남긴다.
export function buildRecapPrompt(s: Scenario, learner: string, summary: string, msgs: ChatMessage[]): ChatMessage[] {
  return [
    {
      role: 'user',
      content: [
        `${learner} (an English learner) just finished a conversation with ${s.partnerName} (${s.partnerRole}).`,
        `Write 1 or 2 sentences in English about ${learner} that ${s.partnerName} should remember for next time: personal facts ${learner} shared and topics they talked about.`,
        `Write in the third person and start with "${learner}". Use only facts that ${learner} actually said in the conversation below. Do not guess or add anything.`,
        // 개인 정보가 없는 대화(카페 주문 등)에서 4B가 "캐나다에서 왔다" 같은 사실을 지어냈다(2026-10-23, scripts/recap-check.ts) → 그럴 때 할 일을 정해 준다
        `If ${learner} did not share personal facts, write one sentence about what ${learner} did in this conversation (for example, what ${learner} ordered or asked). Never invent where ${learner} is from, their job, or why they are learning English.`,
        'Write only those sentences.',
        '',
        summary ? `Summary of the first part: ${summary}` : '',
        'Conversation:',
        transcript(msgs, learner, s.partnerName),
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

// 학습자가 막혔을 때 "이렇게 말해보세요" 예시 한 문장
export function buildHintPrompt(s: Scenario, learner: string, lastPartnerLine: string): ChatMessage[] {
  return [
    {
      role: 'user',
      content: [
        `${s.partnerName} (${s.partnerRole}) just said to ${learner}: "${lastPartnerLine}"`,
        `Write one short, natural reply that ${learner}, an English learner, could say. Use simple everyday English, under 15 words.`,
        'Write only the reply sentence, without quotes.',
      ].join('\n'),
    },
  ];
}

// 이전 대화를 기억하고 있을 때의 첫 인사 (자유 대화만)
export function buildReturningOpeningPrompt(s: Scenario, learner: string, pastSessions: string[]): ChatMessage[] {
  return [
    {
      role: 'user',
      content: [
        `You are ${s.partnerName}, ${s.partnerRole}. You are meeting ${learner} again.`,
        `What you remember: ${pastSessions.join(' ')}`,
        `Greet ${learner} warmly in 1 or 2 short sentences and ask one question about something you remember.`,
        'Write only what you say. No emojis.',
      ].join('\n'),
    },
  ];
}
