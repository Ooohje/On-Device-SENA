// PC 단위 테스트: 이름 검증, 튜토리얼 문장 일치(WER), 보고서 교정 필터. 실행: npm test
import { normalizeEnglishName } from '../src/store/name';
import { OFF_SCRIPT_WER, wordErrorRate } from '../src/tutorial/textMatch';
import { acceptCorrection } from '../src/chat/report';
import { cleanAssist, shadowPassed } from '../src/chat/assist';
import { levelById } from '../src/chat/levels';
import { UNITS } from '../src/tutorial/content';
import { analyze, describeDiffs } from '../src/tutorial/pronunciation';

let fail = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) fail++;
  console.log(ok ? '✅' : '❌', label);
};

// 1) 영어 이름
const names: [string, string | null][] = [
  ['jason', 'Jason'], ['  minji  kim ', 'Minji Kim'], ['mary-jane', 'Mary-Jane'], ["o'neil", "O'neil"], ['J.', 'J.'],
  ['제이슨', null], ['', null], ['1jason', null], ['a'.repeat(21), null], ['jason!', null],
];
for (const [inp, want] of names) {
  const r = normalizeEnglishName(inp);
  check((r.ok ? r.name : null) === want, `이름 ${JSON.stringify(inp)} → ${r.ok ? r.name : '거부'}`);
}

// 2) 튜토리얼: 발음이 조금 틀려도 같은 문장이면 통과, 다른 문장이면 차단
const wer: [string, string, boolean][] = [
  ["I'm from Seoul, Korea.", 'I am from Seoul Korea', true],
  ['Can I get a medium iced latte?', 'can I get a medium ice latte', true],
  ['I have three years of experience in this field.', 'I have 3 years of experience in this field', true],
  ["It's a little too big for me.", 'it is a little to big for me', true],
  ['Could I get a receipt, please?', 'good I get a recipe please', true],
  ['Can I pay by card?', 'I like pizza and pasta very much', false],
  ['Where can I pick up my baggage?', 'hello my name is Jason', false],
];
for (const [t, h, same] of wer) {
  const w = wordErrorRate(t, h);
  check(w <= OFF_SCRIPT_WER === same, `WER ${w.toFixed(2)} ${same ? '통과해야 함' : '차단해야 함'}: "${h}"`);
}

// 3) 튜토리얼 문장 길이 (평가 모델 8초 한도 → 12단어 이하)
for (const u of UNITS) for (const s of u.sentences) check(s.en.replace('{name}', 'Jason').split(/\s+/).length <= 12, `길이 ${s.id}`);

// 4) 교정 필터: 문법 교정은 채택, 말투 바꾸기·다시 쓰기는 거부
const fixes: [string, string, boolean][] = [
  ['I go to gym this morning.', 'I went to the gym this morning.', true],
  ['She don\'t like spicy food.', 'She doesn’t like spicy food.', true],
  ['I want to going to the museum.', 'I want to go to the museum.', true],
  ['My favorite season is autumn.', 'My favorite season is fall.', false],
  ['I usually go jogging before work.', 'I usually go for a run before work.', false],
  ['My weakness is I am sometimes too careful.', 'I’m sometimes too cautious.', false],
  ['We are going to eat tteokbokki.', 'We’re going to eat tteokbokki.', false],
  ['Can I pay by card?', 'OK', false],
];
for (const [o, f, want] of fixes) check(!!acceptCorrection(o, f) === want, `교정 ${want ? '채택' : '거부'}: "${o}" → "${f}"`);

// 5) 발음 분석: 받아쓰기와 목표 문장을 맞춰 바뀐 소리를 찾는다
{
  const a = analyze('I think so.', 'I sink so');
  const w = a.words[1];
  check(w.kind === 'changed' && w.diffs.some((d) => d.expected === 'TH' && d.heard === 'S'), `think→sink: th→s (${w.kind === 'changed' ? describeDiffs(w.diffs) : w.kind})`);
  const b = analyze('Can I pay by card?', 'can I pay by card');
  check(b.okCount === b.total && b.extra.length === 0, '같은 문장은 전부 정상');
  const c = analyze('I have three years of experience.', 'I have 3 years experience');
  check(c.words.find((x) => x.word === 'of')?.kind === 'missing' && c.words.find((x) => x.word === 'three')?.kind === 'ok', '숫자 3=three, of 빠짐');
  const d = analyze('I like coffee.', 'I like copy');
  const dw = d.words[2];
  check(dw.kind === 'changed' && dw.diffs.some((x) => x.expected === 'F' && x.heard === 'P'), `coffee→copy: f→p (${dw.kind === 'changed' ? dw.tip : ''})`);
  const e = analyze('It is very good.', 'it is berry good');
  check(e.words[2].kind === 'changed' && (e.words[2] as any).diffs.some((x: any) => x.expected === 'V' && x.heard === 'B'), 'very→berry: v→b');
  const f = analyze('Two coffees, please.', 'to coffees please');
  check(f.okCount === f.total, '동음이의어 two/to는 정상');
  const g = analyze('Where is the restroom?', 'where is the restroom thank you');
  check(g.extra.join(' ') === 'thank you', '추가로 말한 단어');
}

// 한국어로 도움받기: 모델 출력 정리, 따라 말하기 통과 판정
const lv = levelById('easy');
check(cleanAssist('"How much is this? Can you give me a discount?"', levelById('normal')) === 'How much is this? Can you give me a discount?', '도움 문장 따옴표 제거');
check(cleanAssist('English: I want a window seat.', lv) === 'I want a window seat.', '도움 문장 머리말 제거');
check(cleanAssist('창가 자리 주세요', lv) === '', '한국어 출력은 버림');
check(cleanAssist('I would like a window seat. It is my first flight. Also I am a bit nervous about it.', lv) === 'I would like a window seat. It is my first flight.', '쉬운 난이도: 12단어 안의 두 문장까지만');
check(cleanAssist('Can I pay by card', lv) === 'Can I pay by card.', '문장부호 보충');
check(shadowPassed('Can I pay by card?', 'can I pay by card'), '따라 말하기 통과');
check(shadowPassed('How much is this? Can you give me a discount?', 'how much is this can you give me discount'), '관사 하나 빠져도 통과');
check(!shadowPassed('How much is this? Can you give me a discount?', 'how much is this'), '절반만 말하면 실패');
check(!shadowPassed('I would like a window seat.', 'I like window'), '많이 틀리면 실패');

console.log(fail ? `\n${fail}건 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
