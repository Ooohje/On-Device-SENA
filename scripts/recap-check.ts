// 대화 종료 기억(recap)이 대화에 없는 사실을 지어내는지 점검 (Ollama gemma3:4b, 온도 0 → 시드 3개)
import { buildRecapPrompt } from '../src/chat/prompts';
import { scenarioById } from '../src/chat/scenarios';
import { ChatMessage } from '../src/chat/types';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:4b';
const convs: { scenario: string; msgs: ChatMessage[] }[] = [
  {
    scenario: 'cafe',
    msgs: [
      { role: 'assistant', content: 'Hi there, welcome to Sunny Bean! What can I get started for you today?' },
      { role: 'user', content: 'Can I have a large iced Americano, please?' },
      { role: 'assistant', content: 'Okay, one large iced Americano. Would you like to add any milk or flavors?' },
      { role: 'user', content: 'No thanks. I want to pay with card.' },
      { role: 'assistant', content: 'Got it, card payment. Do you want any milk or extra options with that?' },
    ],
  },
  {
    scenario: 'free_talk',
    msgs: [
      { role: 'assistant', content: "Hey Jason! It's so good to see you. How has your day been so far?" },
      { role: 'user', content: 'I went to Busan last weekend with my sister.' },
      { role: 'assistant', content: 'Oh nice! What did you do there?' },
      { role: 'user', content: 'We ate a lot of seafood.' },
    ],
  },
];
(async () => {
  for (const c of convs)
    for (const seed of [1, 2, 3]) {
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        body: JSON.stringify({ model: MODEL, messages: buildRecapPrompt(scenarioById(c.scenario)!, 'Jason', '', c.msgs), stream: false, options: { temperature: 0, num_predict: 80, seed } }),
      });
      console.log(`[${c.scenario}] ${(await r.json() as any).message.content.trim()}`);
    }
})();
