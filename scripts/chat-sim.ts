// 자유 대화 엔진을 PC의 Ollama(gemma3:1b = 앱에 넣을 Gemma 3 1B와 같은 가중치)로 실행해 프롬프트를 검증한다.
// 실행: npm run sim:chat [-- 시나리오id ...]
import * as fs from 'fs';
import { ConversationEngine } from '../src/chat/engine';
import { SCENARIOS, scenarioById } from '../src/chat/scenarios';
import { ChatMessage, ChatModel, GenerateOptions } from '../src/chat/types';

const MODEL = process.env.SIM_MODEL ?? 'gemma3:1b';
const LEARNER = 'Jason';

class OllamaModel implements ChatModel {
  calls: { ms: number; kind: string }[] = [];
  retries = 0;
  raw: string[] = [];
  async generate(messages: ChatMessage[], opts: GenerateOptions): Promise<string> {
    const t0 = Date.now();
    if (messages[messages.length - 1].content.includes('[Say something new')) this.retries++;
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        options: { temperature: opts.temperature, num_predict: opts.maxTokens, num_ctx: 2048, stop: opts.stop, seed: 7 },
      }),
    });
    const j: any = await r.json();
    this.calls.push({ ms: Date.now() - t0, kind: messages[0].role === 'system' ? 'reply' : 'aux' });
    const text = j.message?.content ?? '';
    if (messages[0].role === 'system') this.raw.push(text);
    return text;
  }
}

// 학습자 역할 대사: 실수·한국어·짧은 대답을 섞어 실제 학습자처럼 만든다
const LEARNER_TURNS: Record<string, string[]> = {
  free_talk: [
    'It was good. I go to gym this morning.',
    'I like running. And I play guitar sometimes.',
    'I am learning guitar for 2 years. 근데 영어로 "독학" 어떻게 말해?',
    'Yes I learn by myself with YouTube.',
    'This weekend I will meet my friend Minji. We go to Hongdae.',
    'Maybe we eat tteokbokki and go to a cafe.',
    'I like spicy food very much. Do you like spicy food?',
    'Haha. I think Korean food is best.',
    'I have to go now. Nice talking to you!',
  ],
  cafe: [
    'Hi. I want a latte.',
    'Medium please.',
    'Iced. Can I change milk to oat milk?',
    'Yes and one croissant please.',
    'To go.',
    'Can I pay by card?',
    'Thank you!',
  ],
  airport: ['I am here for travel.', 'One week.', 'I stay in hotel in Manhattan.', 'Yes, I have return ticket.', 'I am software engineer in Seoul.', 'Thank you.'],
  hotel: ['Yes, I have a reservation. My name is Jason Kim.', 'Here is my passport.', 'What time is breakfast?', 'And the wifi password?', '체크아웃 늦게 하고 싶은데 어떻게 말해요?', 'Can I check out late?', 'Thank you so much.'],
  directions: ['Yes. Where is the British Museum?', 'Is it far?', 'Sorry, can you say again slowly?', 'Turn left and go straight?', 'Thank you very much!'],
  interview: [
    'Hello. My name is Jason. I am working as a developer for 3 years.',
    'I want to join your company because you make global products.',
    'My strength is I learn fast. My weakness is I am sometimes too careful.',
    'Last year our app was slow. I found the problem and made it two times faster.',
    'What does the team do?',
    'Thank you for your time.',
  ],
  shopping: ['I am looking a jacket.', 'Medium size. Do you have black color?', 'Can I try it?', 'It is little big. Do you have small?', 'OK I take it. Can I exchange later?', 'Thanks!'],
};

type Check = { name: string; pass: boolean; detail?: string };

function checkReplies(replies: string[], raws: string[], turns: string[]): Check[] {
  const words = replies.map((r) => r.split(/\s+/).length);
  // 작별 인사에 대한 답은 질문 비율에서 뺀다
  const asking = replies.filter((_, i) => !/\b(bye|goodbye|see you|have to go|thank you)\b/i.test(turns[i]));
  const qRatio = asking.filter((r) => r.includes('?')).length / Math.max(1, asking.length);
  const nameUse = replies.filter((r) => r.includes(LEARNER)).length / replies.length;
  const leaks = raws.filter((r) => /\b(as an ai|language model|i am an ai|i'm an ai)\b/i.test(r));
  const rawEmoji = raws.filter((r) => /[\u{1F300}-\u{1FAFF}]|\*[a-z ]+\*/iu.test(r)).length;
  const longRaw = raws.filter((r) => r.split(/\s+/).length > 45).length;
  const echoed = raws.filter((r) => /\[[A-Z][^\]]*:/.test(r)).length;
  const multiQ = replies.filter((r) => (r.match(/\?/g) ?? []).length > 1).length;
  return [
    { name: '응답 길이 ≤ 40단어 (정리 후)', pass: Math.max(...words) <= 40, detail: `최대 ${Math.max(...words)}, 평균 ${(words.reduce((a, b) => a + b, 0) / words.length).toFixed(1)}` },
    { name: '질문으로 대화 이어가기 ≥ 70%', pass: qRatio >= 0.7, detail: `${(qRatio * 100).toFixed(0)}%` },
    { name: '한 번에 질문 1개', pass: multiQ <= Math.ceil(replies.length * 0.2), detail: `질문 2개 이상 ${multiQ}/${replies.length}` },
    { name: `이름 사용 (가끔, 10~60%)`, pass: nameUse > 0 && nameUse <= 0.6, detail: `${(nameUse * 100).toFixed(0)}%` },
    { name: 'AI라고 밝히지 않음', pass: leaks.length === 0, detail: leaks[0] },
    { name: '턴 지시문을 따라 씀 (정리 전, 참고)', pass: true, detail: `${echoed}/${raws.length}` },
    { name: '원문 이모지·행동묘사 (정리 전, 참고)', pass: true, detail: `${rawEmoji}/${raws.length}` },
    { name: '원문 45단어 초과 (정리 전, 참고)', pass: true, detail: `${longRaw}/${raws.length}` },
  ];
}

async function runScenario(id: string, pastSessions: string[] = []) {
  const s = scenarioById(id)!;
  const model = new OllamaModel();
  const eng = new ConversationEngine(model, s, LEARNER, pastSessions);
  const md: string[] = [`## ${s.title} (${s.id}) — ${s.partnerName}, ${s.partnerRole}`, ''];
  md.push(`**${s.partnerName}:** ${await eng.open()}`);
  const replies: string[] = [];
  const summaries: string[] = [];
  for (const u of LEARNER_TURNS[id]) {
    const r = await eng.send(u);
    replies.push(r);
    md.push(`**${LEARNER}:** ${u}`, `**${s.partnerName}:** ${r}`);
    await new Promise((res) => setTimeout(res, 0));
    if (eng.summary && eng.summary !== summaries[summaries.length - 1]) summaries.push(eng.summary);
  }
  const hint = await eng.hint();
  const recap = await eng.end();
  if (eng.summary && eng.summary !== summaries[summaries.length - 1]) summaries.push(eng.summary);
  md.push('', `- 힌트 예시: "${hint}"`);
  summaries.forEach((x, i) => md.push(`- 대화 중 요약 ${i + 1}: ${x}`));
  md.push(`- 다음 대화용 기억: ${recap}`);
  const replyMs = model.calls.filter((c) => c.kind === 'reply').map((c) => c.ms);
  md.push(`- PC 응답 시간 중앙값: ${replyMs.sort((a, b) => a - b)[replyMs.length >> 1]}ms (참고용)`, '');
  const checks = checkReplies(replies, model.raw, LEARNER_TURNS[id]);
  checks.push({ name: '반복으로 다시 생성 (참고)', pass: true, detail: `${model.retries}/${replies.length}` });
  md.push('| 점검 | 결과 | 값 |', '|---|---|---|', ...checks.map((c) => `| ${c.name} | ${c.pass ? '✅' : '❌'} | ${c.detail ?? ''} |`), '');
  return { md, checks, recap, compressed: summaries.length > 0 };
}

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : SCENARIOS.map((s) => s.id);
  const out: string[] = [`# 자유 대화 프롬프트 시뮬레이션 (${MODEL}, ${new Date().toISOString().slice(0, 16)})`, '', `학습자 이름: ${LEARNER}`, ''];
  let freeRecap = '';
  for (const id of ids) {
    process.stdout.write(`${id} ... `);
    const r = await runScenario(id);
    if (id === 'free_talk') freeRecap = r.recap;
    out.push(...r.md);
    console.log(r.checks.filter((c) => !c.pass).map((c) => `❌ ${c.name}`).join(', ') || '✅', r.compressed ? '(요약 동작)' : '');
  }
  if (freeRecap) {
    // 다음 날 다시 접속: 기억을 이용한 첫 인사
    const model = new OllamaModel();
    const eng = new ConversationEngine(model, scenarioById('free_talk')!, LEARNER, [freeRecap]);
    const greet = await eng.open();
    const r = await eng.send("I'm good! I went to Hongdae with Minji.");
    out.push('## 다시 만났을 때 (이전 대화 기억 사용)', '', `- 기억: ${freeRecap}`, `- **Mia:** ${greet}`, `- **${LEARNER}:** I'm good! I went to Hongdae with Minji.`, `- **Mia:** ${r}`, '');
    console.log('returning greeting:', greet);
  }
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/chat-sim-report.md', out.join('\n'));
  console.log('저장: docs/chat-sim-report.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
