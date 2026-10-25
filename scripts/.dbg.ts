import { ConversationEngine } from '../src/chat/engine';
import { scenarioById } from '../src/chat/scenarios';
const turns = ['I started a new job at a bank in Seoul.', 'It is hard because I have to wake up at 6.', 'I usually take the subway. It takes one hour.', 'What do you do to relax after work?', 'Can you guess what time I wake up?', 'Where do I work again?', 'Thanks. See you!'];
class M { async generate(m: any, o: any) { const r = await fetch('http://localhost:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: 'gemma3:1b', messages: m, stream: false, options: { temperature: o.temperature, num_predict: o.maxTokens, num_ctx: 2048, stop: o.stop, seed: 7 } }) }); const j: any = await r.json(); if (m[0].role === 'system') last = m; return j.message.content; } }
let last: any;
(async () => {
  const e = new ConversationEngine(new M() as any, scenarioById('free_talk')!, 'Jason', []);
  await e.open();
  for (const t of turns) { const r = await e.send(t); console.log('U:', t, '\nB:', r); }
  console.log(JSON.stringify(last, null, 1));
})();
