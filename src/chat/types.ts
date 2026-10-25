export type Role = 'system' | 'user' | 'assistant';
// plain: 모델 입력용 content에 이번 턴 지시가 붙어 있을 때, 지시를 뺀 원래 발화 (요약·기억 만들 때 사용)
export type ChatMessage = { role: Role; content: string; plain?: string };

export type GenerateOptions = {
  maxTokens: number;
  temperature: number;
  stop?: string[];
};

// 휴대폰(llama.rn)과 PC 시험(Ollama)이 같은 대화 엔진을 쓰도록 모델을 추상화한다.
export interface ChatModel {
  generate(messages: ChatMessage[], opts: GenerateOptions, onToken?: (partial: string) => void): Promise<string>;
}

export type Scenario = {
  id: string;
  title: string; // 화면 표시 (한국어)
  subtitle: string;
  icon: string; // Ionicons 이름
  partnerName: string;
  partnerGender: 'f' | 'm'; // 대화 상대 목소리(TTS) 선택
  partnerRole: string; // "a barista at Sunny Bean Cafe"
  setting: string; // 상황 설명 (영어, 시스템 프롬프트에 들어감)
  goal: string; // 이 대화에서 상대(AI)가 이끌어갈 흐름
  opening: (learner: string) => string; // 첫 마디 (LLM 없이 즉시 표시)
  steps?: string[]; // 역할극 진행 순서. 턴마다 다음 단계를 안내해 1B 모델이 같은 질문을 맴돌지 않게 한다
  // steps와 같은 순서. 학습자가 이미 그 정보를 말했으면(정규식 일치) 그 단계를 건너뛴다 — "medium iced latte"라고 했는데 "hot or iced?"라고 묻지 않게
  stepDone?: (RegExp | null)[];
  phrases: string[]; // 학습자용 표현 힌트
};

export type Memory = {
  summary: string; // 이번 대화에서 오래된 턴을 압축한 요약
  pastSessions: string[]; // 이전 대화 요약 (최근 순)
};
