// 평가 모델은 음성만 보고 점수를 매기므로, 엉뚱한 문장을 유창하게 읽어도 점수가 높게 나온다(논문 6장 한계).
// whisper 받아쓰기와 목표 문장의 단어 오류율(WER)로 "제시 문장을 읽었는지"를 먼저 확인한다.

const NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUM[w] ?? w)
    .flatMap((w) => expandContraction(w));
}

function expandContraction(w: string): string[] {
  const m: Record<string, string[]> = {
    "i'm": ['i', 'am'], "can't": ['can', 'not'], "won't": ['will', 'not'], "let's": ['let', 'us'],
    "it's": ['it', 'is'], "that's": ['that', 'is'], "he's": ['he', 'is'], "she's": ['she', 'is'], "there's": ['there', 'is'], "what's": ['what', 'is'],
  };
  if (m[w]) return m[w];
  // 규칙적인 축약: we're, you've, they'll, I'd, doesn't ...
  const r = w.match(/^([a-z]+)'(re|ve|ll|d|s)$/);
  if (r) return [r[1], { re: 'are', ve: 'have', ll: 'will', d: 'would', s: 'is' }[r[2]]!];
  const n = w.match(/^([a-z]+)n't$/);
  if (n) return [n[1], 'not'];
  return [w.replace(/'/g, '')];
}

// 단어 단위 편집 거리 / 목표 문장 단어 수
export function wordErrorRate(target: string, heard: string): number {
  const a = normalizeWords(target);
  const b = normalizeWords(heard);
  if (!a.length) return b.length ? 1 : 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] / a.length;
}

// 학습자 발음 때문에 받아쓰기가 틀리는 경우가 많으므로 기준을 넉넉히 둔다 (절반 넘게 다르면 다른 문장으로 판단)
export const OFF_SCRIPT_WER = 0.6;
