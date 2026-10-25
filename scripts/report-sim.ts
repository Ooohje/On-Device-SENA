// 대화 보고서의 문법 교정을 PC의 Ollama(gemma3:1b)로 검증한다.
// 틀린 문장은 잡아내고(재현율), 맞는 문장은 건드리지 않는지(오교정률) 측정한다.
// 실행: npm run sim:report
import * as fs from 'fs';
import { acceptCorrection, buildCorrectionPrompt } from '../src/chat/report';
import { ChatMessage, ChatModel, GenerateOptions } from '../src/chat/types';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:1b';

class OllamaModel implements ChatModel {
  async generate(messages: ChatMessage[], opts: GenerateOptions): Promise<string> {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages, stream: false, options: { temperature: opts.temperature, num_predict: opts.maxTokens, num_ctx: 2048, seed: 7 } }),
    });
    return ((await r.json()) as any).message?.content ?? '';
  }
}

// 한국인 학습자가 실제로 자주 하는 실수 (시뮬레이션 대화에서 나온 문장 포함)
const WRONG: [string, string][] = [
  ['I go to gym this morning.', 'I went to the gym this morning.'],
  ['I am learning guitar for 2 years.', "I have been learning guitar for 2 years."],
  ['I am looking a jacket.', 'I am looking for a jacket.'],
  ['It is little big.', 'It is a little big.'],
  ['I stay in hotel in Manhattan.', 'I am staying at a hotel in Manhattan.'],
  ['I am software engineer in Seoul.', 'I am a software engineer in Seoul.'],
  ['Yesterday I eat pizza with my friend.', 'Yesterday I ate pizza with my friend.'],
  ['She don\'t like spicy food.', "She doesn't like spicy food."],
  ['I have return ticket.', 'I have a return ticket.'],
  ['I very like Korean food.', 'I really like Korean food.'],
  ['My weakness is I am sometimes too careful.', 'My weakness is that I am sometimes too careful.'],
  ['Can you recommend me a good restaurant?', 'Can you recommend a good restaurant?'],
  ['I was born in 1998 and I live in Busan since then.', 'I have lived in Busan since then.'],
  ['He is more taller than me.', 'He is taller than me.'],
  ['I want to going to the museum.', 'I want to go to the museum.'],
];
const RIGHT = [
  'I like running and playing the guitar.',
  'Can I pay by card?',
  "I'd like a medium iced latte, please.",
  'This weekend I will meet my friend Minji.',
  'We are going to eat tteokbokki in Hongdae.',
  'I have been working as a developer for three years.',
  'Could you tell me more about the team?',
  'I think Korean food is the best.',
  "I'm staying at a hotel near Times Square.",
  'Do you have this jacket in black?',
  'I usually go jogging before work.',
  'My favorite season is autumn.',
  'I found the problem and made the app two times faster.',
  'How long does it take to walk there?',
  'I want to join your company because you make global products.',
];

async function main() {
  const m = new OllamaModel();
  const md = [`# 보고서 문법 교정 검증 (${MODEL})`, '', '| 구분 | 학습자 문장 | 모델 출력 | 채택된 교정 | 판정 |', '|---|---|---|---|---|'];
  let caught = 0, fp = 0;
  for (const [s, ref] of WRONG) {
    const out = await m.generate(buildCorrectionPrompt(s), { maxTokens: 40, temperature: 0 });
    const fixed = acceptCorrection(s, out);
    if (fixed) caught++;
    md.push(`| 틀린 문장 | ${s} | ${out.replace(/\n/g, ' ').trim()} | ${fixed ?? '—'} | ${fixed ? '✅ 잡음' : '❌ 놓침'} (참고: ${ref}) |`);
  }
  for (const s of RIGHT) {
    const out = await m.generate(buildCorrectionPrompt(s), { maxTokens: 40, temperature: 0 });
    const fixed = acceptCorrection(s, out);
    if (fixed) fp++;
    md.push(`| 맞는 문장 | ${s} | ${out.replace(/\n/g, ' ').trim()} | ${fixed ?? '—'} | ${fixed ? '❌ 오교정' : '✅ 그대로'} |`);
  }
  const summary = `틀린 문장 ${caught}/${WRONG.length} 잡음 (재현율 ${((caught / WRONG.length) * 100).toFixed(0)}%) · 맞는 문장 오교정 ${fp}/${RIGHT.length} (${((fp / RIGHT.length) * 100).toFixed(0)}%)`;
  md.splice(1, 0, '', `**${summary}**`);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/report-sim.md', md.join('\n') + '\n');
  console.log(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
