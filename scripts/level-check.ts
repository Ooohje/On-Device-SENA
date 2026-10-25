// 난이도별 대화 상대 말투 점검: 같은 학습자 대사에 대한 답의 길이·문장 길이·질문 비율 (Ollama, 기본 gemma3:4b)
// 실행: node scripts/run-ts.mjs scripts/level-check.ts
import { ConversationEngine } from '../src/chat/engine';
import { LEVELS } from '../src/chat/levels';
import { scenarioById } from '../src/chat/scenarios';
import { ChatMessage, ChatModel, GenerateOptions } from '../src/chat/types';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:4b';
class M implements ChatModel {
  async generate(messages: ChatMessage[], o: GenerateOptions) {
    const r = await fetch('http://localhost:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: MODEL, messages, stream: false, options: { temperature: o.temperature, num_predict: o.maxTokens, num_ctx: 2048, stop: o.stop, seed: 7 } }) });
    return ((await r.json()) as any).message?.content ?? '';
  }
}
const TURNS = ['I went to the gym this morning.', 'I like running. And I play guitar sometimes.', 'This weekend I will meet my friend in Hongdae.', 'Maybe we eat tteokbokki and go to a cafe.', 'Do you like spicy food?'];
(async () => {
  for (const lv of LEVELS) {
    const e = new ConversationEngine(new M(), scenarioById('free_talk')!, 'Jason', [], lv);
    await e.open();
    const replies: string[] = [];
    for (const t of TURNS) replies.push(await e.send(t));
    const words = replies.map((r) => r.split(/\s+/).length);
    const sents = replies.flatMap((r) => r.match(/[^.!?]+[.!?]+/g) ?? [r]);
    const wps = sents.map((x) => x.trim().split(/\s+/).length);
    const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    console.log(`\n[${lv.id} ${lv.name}] 답 평균 ${avg(words)}단어, 문장 평균 ${avg(wps)}단어, 질문으로 끝남 ${replies.filter((r) => r.trim().endsWith('?')).length}/${replies.length}`);
    replies.forEach((r, i) => console.log(`  👤 ${TURNS[i]}\n  🤖 ${r}`));
  }
})();
