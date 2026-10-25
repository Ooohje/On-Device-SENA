// 자유 대화 난이도. 상/중/하 대신 "상대가 어떻게 말해 주는지"로 이름을 붙인다.
// 난이도는 시스템 프롬프트의 말투 규칙, 답 길이(maxTokens), 대화 상대 음성 속도에 반영된다.

export type LevelId = 'easy' | 'normal' | 'native';

export type ChatLevel = {
  id: LevelId;
  name: string; // 화면 표시
  short: string; // 한 줄 요약
  description: string; // 난이도 설명
  icon: string; // Ionicons
  maxTokens: number;
  ttsRate: number;
  rules: string[]; // 시스템 프롬프트에 들어가는 말투 규칙 (영어)
};

export const LEVELS: ChatLevel[] = [
  {
    id: 'easy',
    name: '천천히',
    short: '쉬운 단어, 짧은 문장',
    description: '대화 상대가 쉬운 단어와 짧은 문장으로 천천히 말해요. 한 번에 하나씩 묻고, 영어로 말하기가 아직 낯선 분께 좋아요.',
    icon: 'leaf',
    maxTokens: 60,
    ttsRate: 0.85,
    rules: [
      'Keep every reply very short: 1 or 2 sentences, under 25 words.',
      'Use only very common, simple words and short sentences (under 12 words each). Avoid idioms and slang.',
    ],
  },
  {
    id: 'normal',
    name: '자연스럽게',
    short: '일상 대화 속도와 표현',
    description: '실제 일상 대화처럼 자연스러운 표현과 보통 속도로 이야기해요. 기본 문장은 말할 수 있고 대화를 이어가는 연습을 하고 싶은 분께 좋아요.',
    icon: 'chatbubbles',
    maxTokens: 90,
    ttsRate: 1.0,
    rules: [
      'Keep every reply short: 1 to 3 sentences, under 40 words.',
      'Use everyday spoken English. If the learner uses simple English, use simple words too.',
    ],
  },
  {
    id: 'native',
    name: '원어민처럼',
    short: '생생한 표현, 깊은 대화',
    description: '원어민이 자주 쓰는 표현과 관용구를 섞고, 더 깊이 묻고 길게 이야기해요. 실전처럼 빠르고 생생한 대화를 원하는 분께 좋아요.',
    icon: 'flame',
    maxTokens: 110,
    ttsRate: 1.08,
    rules: [
      'Keep every reply to 2 or 3 sentences, under 50 words.',
      'Talk like a native speaker: use natural phrasal verbs and common idioms, and ask thoughtful follow-up questions.',
    ],
  },
];

export const levelById = (id: string | null | undefined) => LEVELS.find((l) => l.id === id) ?? LEVELS[1];
