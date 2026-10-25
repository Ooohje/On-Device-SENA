// 발음 분석(받아쓰기 기준) 정량 평가 — AI-Hub test 300문장.
// 입력: track_b/pron_eval/transcripts.json (tools/pron_eval_transcribe.py가 whisper로 생성)
// 비교 기준: ① 사람 음소 표기(tagging: C 정상, S 대치, D 삭제, I 삽입)의 음소 오류율, ② 사람 발음 점수, ③ 사람 전사(sttText)로 돌린 같은 분석
// 실행: node scripts/run-ts.mjs scripts/pron-eval.ts [이름]  (이름을 주면 transcripts_<이름>.json → metrics_<이름>.json·report_<이름>.md)
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze, PronunciationAnalysis } from '../src/tutorial/pronunciation';

const DIR = 'C:/Users/ohje/Desktop/프리씨랩/SENA 모음집/SENA/0. mobile project/track_b/pron_eval';
const TAG = process.argv[2] ? `_${process.argv[2]}` : '';
const { rows, model } = JSON.parse(readFileSync(`${DIR}/transcripts${TAG}.json`, 'utf8'));

const pearson = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) (sxy += (x[i] - mx) * (y[i] - my)), (sxx += (x[i] - mx) ** 2), (syy += (y[i] - my) ** 2);
  return sxy / Math.sqrt(sxx * syy);
};
const rank = (x: number[]) => {
  const idx = x.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(x.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
const spearman = (x: number[], y: number[]) => pearson(rank(x), rank(y));
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const acc = (a: PronunciationAnalysis) => a.okCount / Math.max(1, a.total);
const flagged = (a: PronunciationAnalysis) => a.words.map((w) => w.kind !== 'ok');

const per: number[] = [], art: number[] = [], pro: number[] = [], wAcc: number[] = [], sAcc: number[] = [];
let tp = 0, fp = 0, fn = 0, tn = 0;
const pairs = new Map<string, number>();
const examples: string[] = [];
for (const r of rows) {
  const tags = String(r.tagging).split(/\s+/).filter(Boolean);
  per.push(tags.filter((t) => t !== 'C').length / tags.length);
  art.push(r.articulation);
  pro.push(r.prosody);
  const aw = analyze(r.sentence, r.whisper);
  const as = analyze(r.sentence, r.sttText);
  wAcc.push(acc(aw));
  sAcc.push(acc(as));
  // 단어 단위 일치: 사람 전사에서 다르게 들린 단어(기준)를 whisper 분석도 찾았는가
  const fw = flagged(aw), fs = flagged(as);
  for (let i = 0; i < Math.min(fw.length, fs.length); i++) {
    if (fw[i] && fs[i]) tp++;
    else if (fw[i] && !fs[i]) fp++;
    else if (!fw[i] && fs[i]) fn++;
    else tn++;
  }
  for (const w of aw.words)
    if (w.kind === 'changed') for (const d of w.diffs) if (d.expected && d.heard) pairs.set(`${d.expected}→${d.heard}`, (pairs.get(`${d.expected}→${d.heard}`) ?? 0) + 1);
  const issues = aw.words.filter((w) => w.kind === 'changed');
  if (examples.length < 12 && issues.length && issues.some((w) => w.kind === 'changed' && w.diffs.length && w.diffs.length <= 2))
    examples.push(`| ${r.articulation} | ${r.sentence} | ${r.sttText} | ${r.whisper} | ${issues.map((w) => (w.kind === 'changed' ? `${w.word}→${w.heard}` : '')).join(', ')} |`);
}
const P = tp / (tp + fp), R = tp / (tp + fn), F1 = (2 * P * R) / (P + R);
const byScore = [1, 2, 3, 4, 5].map((s) => {
  const ix = art.map((a, i) => [a, i] as const).filter(([a]) => Math.round(a) === s).map(([, i]) => i);
  return { score: s, n: ix.length, whisperAcc: mean(ix.map((i) => wAcc[i])), sttAcc: mean(ix.map((i) => sAcc[i])), per: mean(ix.map((i) => per[i])) };
});
const res = {
  model, n: rows.length,
  corr: {
    whisperAcc_vs_humanPhonemeAcc: { pearson: pearson(wAcc, per.map((p) => 1 - p)), spearman: spearman(wAcc, per.map((p) => 1 - p)) },
    whisperAcc_vs_articulation: { pearson: pearson(wAcc, art), spearman: spearman(wAcc, art) },
    whisperAcc_vs_prosody: { pearson: pearson(wAcc, pro), spearman: spearman(wAcc, pro) },
    sttAcc_vs_humanPhonemeAcc: { pearson: pearson(sAcc, per.map((p) => 1 - p)), spearman: spearman(sAcc, per.map((p) => 1 - p)) },
    sttAcc_vs_articulation: { pearson: pearson(sAcc, art), spearman: spearman(sAcc, art) },
  },
  wordAgreement_vs_sttText: { tp, fp, fn, tn, precision: P, recall: R, f1: F1 },
  meanWordAcc: { whisper: mean(wAcc), sttText: mean(sAcc) },
  meanHumanPER: mean(per),
  byArticulationScore: byScore,
  topPhonemePairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
};
writeFileSync(`${DIR}/metrics${TAG}.json`, JSON.stringify(res, null, 1));
const f = (x: number) => x.toFixed(3);
const md = `# 발음 분석(받아쓰기 기준) PC 평가 — AI-Hub test ${res.n}문장

- 전사 모델: ${model} (앱은 ggml-base.en 사용 — 근사 평가)
- 분석 코드: 앱과 동일한 \`src/tutorial/pronunciation.ts\` (CMU 발음사전 정렬)

## 1. 상관 (문장 단위, n=${res.n})
| 비교 | Pearson | Spearman |
|---|---|---|
| whisper 단어 정확도 vs 사람 음소 정확도(1−PER) | ${f(res.corr.whisperAcc_vs_humanPhonemeAcc.pearson)} | ${f(res.corr.whisperAcc_vs_humanPhonemeAcc.spearman)} |
| whisper 단어 정확도 vs 사람 발음 점수 | ${f(res.corr.whisperAcc_vs_articulation.pearson)} | ${f(res.corr.whisperAcc_vs_articulation.spearman)} |
| whisper 단어 정확도 vs 사람 운율 점수 | ${f(res.corr.whisperAcc_vs_prosody.pearson)} | ${f(res.corr.whisperAcc_vs_prosody.spearman)} |
| (참고) 사람 전사 단어 정확도 vs 사람 음소 정확도 | ${f(res.corr.sttAcc_vs_humanPhonemeAcc.pearson)} | ${f(res.corr.sttAcc_vs_humanPhonemeAcc.spearman)} |
| (참고) 사람 전사 단어 정확도 vs 사람 발음 점수 | ${f(res.corr.sttAcc_vs_articulation.pearson)} | ${f(res.corr.sttAcc_vs_articulation.spearman)} |

## 2. 단어 단위 일치 (기준: 사람 전사 sttText로 같은 분석을 돌렸을 때 다르게 들린 단어)
정밀도 ${f(P)} · 재현율 ${f(R)} · F1 ${f(F1)} (TP ${tp}, FP ${fp}, FN ${fn}, TN ${tn})

## 3. 사람 발음 점수별 평균
| 발음 점수 | n | whisper 단어 정확도 | 사람 전사 단어 정확도 | 사람 음소 오류율 |
|---|---|---|---|---|
${byScore.map((b) => `| ${b.score} | ${b.n} | ${b.n ? f(b.whisperAcc) : '-'} | ${b.n ? f(b.sttAcc) : '-'} | ${b.n ? f(b.per) : '-'} |`).join('\n')}

## 4. 가장 많이 찾은 음소 바뀜 (whisper 기준, 기대→들림)
${res.topPhonemePairs.map(([k, v]) => `${k} ${v}회`).join(' · ')}

## 5. 사례
| 발음 점수 | 목표 문장 | 사람 전사 | whisper | 찾은 바뀜 |
|---|---|---|---|---|
${examples.join('\n')}
`;
writeFileSync(`${DIR}/report${TAG}.md`, md);
console.log(md);
