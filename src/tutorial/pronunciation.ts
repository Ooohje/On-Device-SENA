import { dictionary } from 'cmu-pronouncing-dictionary';

// 발음 분석 (받아쓰기 기준 추정)
// 평가 모델은 문장 전체의 발음·운율 점수만 낸다. 어디가 어떻게 들렸는지 알려주기 위해
// whisper 받아쓰기와 목표 문장을 단어 단위로 맞추고, 다르게 들린 단어는 CMU 발음사전의 발음기호끼리 다시 맞춰
// "think → sink: th 소리가 s처럼 들렸어요"처럼 바뀐 소리를 찾는다.
// 한계: whisper는 문맥상 그럴듯한 단어로 고쳐 받아쓰는 경향이 있어 모든 발음 오류를 잡지 못한다.
// 음소 단위 진단은 CTC 음소 헤드(개발계획서 Phase 2)로 대체할 예정이다.

export type PhonemeDiff = { expected: string | null; heard: string | null }; // ARPAbet (강세 숫자 제거)
export type WordResult =
  | { kind: 'ok'; word: string }
  | { kind: 'changed'; word: string; heard: string; diffs: PhonemeDiff[]; tip: string }
  | { kind: 'missing'; word: string };
export type PronunciationAnalysis = {
  words: WordResult[]; // 목표 문장 순서
  extra: string[]; // 목표에 없는데 들린 단어
  okCount: number;
  total: number;
};

const NUM: Record<string, string> = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten' };

// 표시용 단어(원래 철자)와 비교용 키를 함께 둔다
type Tok = { display: string; key: string };
export function tokenize(text: string): Tok[] {
  return text
    .replace(/[’‘]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''))
    .filter(Boolean)
    .map((w) => {
      const key = w.toLowerCase();
      return { display: w, key: NUM[key] ?? key };
    });
}

export function phonemes(word: string): string[] | null {
  const p = (dictionary as Record<string, string>)[word.toLowerCase()];
  return p ? p.split(' ').map((x) => x.replace(/\d/g, '')) : null;
}

// 편집 거리 정렬(역추적 포함). 같으면 match, 다르면 sub, 한쪽만 있으면 del/ins
type Op<T> = { op: 'match' | 'sub' | 'del' | 'ins'; a?: T; b?: T };
function align<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean, subCost = 1): Op<T>[] {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (eq(a[i - 1], b[j - 1]) ? 0 : subCost));
  const ops: Op<T>[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (eq(a[i - 1], b[j - 1]) ? 0 : subCost)) {
      ops.push({ op: eq(a[i - 1], b[j - 1]) ? 'match' : 'sub', a: a[i - 1], b: b[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', a: a[i - 1] });
      i--;
    } else {
      ops.push({ op: 'ins', b: b[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

export function phonemeDiffs(expected: string[], heard: string[]): PhonemeDiff[] {
  return align(expected, heard, (x, y) => x === y)
    .filter((o) => o.op !== 'match')
    .map((o) => ({ expected: o.a ?? null, heard: o.b ?? null }));
}

export function analyze(target: string, heard: string): PronunciationAnalysis {
  const a = tokenize(target);
  const b = tokenize(heard);
  // 단어 비교: 철자가 같거나 발음기호가 같으면(to/two 같은 동음이의어) 같은 단어로 본다
  const same = (x: Tok, y: Tok) => {
    if (x.key === y.key) return true;
    const px = phonemes(x.key), py = phonemes(y.key);
    return !!px && !!py && px.join(' ') === py.join(' ');
  };
  // 다른 단어끼리의 대응(sub)을 삭제+삽입보다 약간 선호해 "think → sink"처럼 짝지어지게 한다
  const ops = align(a, b, same, 1.5);
  const words: WordResult[] = [];
  const extra: string[] = [];
  for (const o of ops) {
    if (o.op === 'match') words.push({ kind: 'ok', word: o.a!.display });
    else if (o.op === 'del') words.push({ kind: 'missing', word: o.a!.display });
    else if (o.op === 'ins') extra.push(o.b!.display);
    else {
      const pe = phonemes(o.a!.key);
      const ph = phonemes(o.b!.key);
      const diffs = pe && ph ? phonemeDiffs(pe, ph) : [];
      words.push({ kind: 'changed', word: o.a!.display, heard: o.b!.display, diffs, tip: tipFor(diffs) });
    }
  }
  return { words, extra, okCount: words.filter((w) => w.kind === 'ok').length, total: words.length };
}

// ── 한국어 설명 ──
const SOUND: Record<string, string> = {
  TH: 'th(θ)', DH: 'th(ð)', S: 's', Z: 'z', F: 'f', P: 'p', V: 'v', B: 'b', R: 'r', L: 'l', SH: 'sh', ZH: 'zh(ʒ)',
  CH: 'ch', JH: 'j', NG: 'ng', N: 'n', M: 'm', T: 't', D: 'd', K: 'k', G: 'g', W: 'w', Y: 'y', HH: 'h',
  IY: '긴 "이"(ee)', IH: '짧은 "이"(i)', EH: '"에"(e)', AE: '"애"(a)', AA: '"아"(o/a)', AH: '"어"(u)', AO: '"오"(aw)',
  UH: '짧은 "우"(oo)', UW: '긴 "우"(oo)', ER: '"얼"(er)', EY: '"에이"(ay)', AY: '"아이"(i)', OW: '"오우"(o)', AW: '"아우"(ow)', OY: '"오이"(oy)',
};
export const soundName = (p: string | null) => (p ? SOUND[p] ?? p.toLowerCase() : '');

// 한국인 학습자에게 흔한 혼동에 대한 짧은 요령
const PAIR_TIPS: [string, string, string][] = [
  ['TH', 'S', '혀끝을 윗니와 아랫니 사이에 살짝 물고 바람을 내보내요.'],
  ['TH', 'T', '혀끝을 이 사이에 두고, 막았다 터뜨리지 말고 바람을 흘려보내요.'],
  ['TH', 'F', '입술이 아니라 혀끝을 이 사이에 둬요.'],
  ['DH', 'D', '혀끝을 이 사이에 두고 성대를 울리며 바람을 흘려요.'],
  ['DH', 'Z', '혀끝을 이 사이로 조금 더 내밀어요.'],
  ['F', 'P', '윗니를 아랫입술에 대고 바람을 내보내요. 입술을 붙였다 떼지 않아요.'],
  ['F', 'HH', '윗니를 아랫입술에 대야 f 소리가 나요.'],
  ['V', 'B', '윗니를 아랫입술에 대고 성대를 울려요. 입술을 붙이지 않아요.'],
  ['R', 'L', 'r은 혀끝이 입천장에 닿지 않게 뒤로 말아요.'],
  ['L', 'R', 'l은 혀끝을 윗니 뒤 잇몸에 확실히 붙여요.'],
  ['Z', 'JH', 'z는 혀를 붙이지 않고 "즈"를 길게 울려요.'],
  ['Z', 'S', 'z는 성대를 울려요. 목에 손을 대면 떨림이 느껴져야 해요.'],
  ['SH', 'S', 'sh는 입술을 둥글게 내밀고 혀를 조금 뒤로 빼요.'],
  ['S', 'SH', 's는 입술을 내밀지 말고 혀끝을 윗니 뒤에 가깝게 둬요.'],
  ['IY', 'IH', '"이-"처럼 길고 입을 양옆으로 당겨요.'],
  ['IH', 'IY', '짧고 힘을 빼서 "이"와 "에" 사이로 말해요.'],
  ['AE', 'EH', '입을 더 크게 벌려 "애"에 가깝게 말해요.'],
  ['UW', 'UH', '입술을 더 둥글게 내밀고 길게 "우-"라고 해요.'],
  ['ER', 'AA', '혀를 뒤로 말아 r을 섞어요("얼").'],
  ['NG', 'N', '혀 뒤쪽을 입천장에 붙여 콧소리로 끝내요("응").'],
];

export function tipFor(diffs: PhonemeDiff[]): string {
  for (const d of diffs) {
    if (!d.expected || !d.heard) continue;
    const t = PAIR_TIPS.find(([e, h]) => e === d.expected && h === d.heard);
    if (t) return t[2];
  }
  const first = diffs.find((d) => d.expected && d.heard);
  if (first) return `${soundName(first.expected)} 소리가 ${soundName(first.heard)}처럼 들렸어요. 시범 음성을 듣고 이 소리에 집중해 보세요.`;
  const missed = diffs.find((d) => d.expected && !d.heard);
  if (missed) return `${soundName(missed.expected)} 소리가 잘 들리지 않았어요. 끝까지 또렷하게 말해 보세요.`;
  return '다른 단어로 들렸어요. 시범 음성을 듣고 천천히 따라 해 보세요.';
}

// 화면용 한 줄 요약: "th(θ) → s"
export function describeDiffs(diffs: PhonemeDiff[]): string {
  return diffs
    .slice(0, 3)
    .map((d) => (d.expected && d.heard ? `${soundName(d.expected)} → ${soundName(d.heard)}` : d.expected ? `${soundName(d.expected)} 빠짐` : `${soundName(d.heard)} 추가`))
    .join(', ');
}
