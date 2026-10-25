// 앱의 TS 전처리·채점 코드를 PC(onnxruntime-node 1.24.3 = 앱과 같은 ORT 코어)에서 Python 기준과 비교한다.
// 실행: npm run verify:pc -- "<SENA 루트 경로>"
// scripts/run-ts.mjs가 onnxruntime-react-native를 onnxruntime-node로 바꿔 번들한다.
import * as fs from 'fs';
import * as path from 'path';
import { decodeWav, toMono16k } from '../src/audio/wav';
import { SileroVad } from '../src/audio/sileroVad';
import { preprocess, padOrTrim } from '../src/audio/preprocess';
import { Scorer } from '../src/models/scorer';

const SENA = process.argv[2];
const MOBILE = path.join(SENA, '0. mobile project');
const readWav = (p: string) => {
  const b = fs.readFileSync(p);
  return toMono16k(decodeWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
};

function parseCsv(p: string) {
  const [head, ...lines] = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

async function main() {
  const vad = await SileroVad.load(path.join(MOBILE, 'track_b/golden_raw/silero_vad.onnx'));

  // 1) VAD + 전처리: Python 기준(vad_check.csv, 300건)과 구간 비교
  const rows = parseCsv(path.join(MOBILE, 'track_b/golden_raw/vad_check.csv'));
  let same = 0, trainSame = 0;
  const bad: string[] = [];
  const t0 = Date.now();
  for (const r of rows) {
    const raw = readWav(path.join(SENA, '음성 데이터/data', r.file));
    const pre = await preprocess(raw, vad);
    const ok = pre.start === Number(r.onnx_start) && pre.end === Number(r.onnx_end);
    if (ok) same++; else bad.push(`${r.file} ts=${pre.start}-${pre.end} py=${r.onnx_start}-${r.onnx_end}`);
    // 학습 데이터(preprocessed/*.wav, PCM16)와 값 비교
    const stored = readWav(path.join(SENA, '음성 데이터/preprocessed', r.file));
    if (stored.length === pre.trimmed.length) {
      let m = 0;
      for (let i = 0; i < stored.length; i++) m = Math.max(m, Math.abs(stored[i] - pre.trimmed[i]));
      if (m < 1e-3) trainSame++;
    }
  }
  console.log(`[VAD/전처리] ${rows.length}건 | Python ONNX 구간 일치 ${same}/${rows.length} | 학습 데이터 재현 ${trainSame}/${rows.length} | 평균 ${((Date.now() - t0) / rows.length).toFixed(0)}ms/건`);
  bad.slice(0, 5).forEach((b) => console.log('  불일치', b));

  // 2) 채점 모델: Track A 골든 샘플과 비교
  const goldenDir = path.join(MOBILE, 'track_a/outputs/mobile');
  const gPath = path.join(goldenDir, 'golden_expected.json');
  if (!fs.existsSync(gPath)) return console.log('[채점] Track A 산출물 없음 — 건너뜀');
  const golden = JSON.parse(fs.readFileSync(gPath, 'utf8'));
  const scorer = await Scorer.load(path.join(goldenDir, golden.model), 'cpu', 4);
  let maxDiff = 0;
  const times: number[] = [];
  for (const s of golden.samples) {
    const x = padOrTrim(readWav(path.join(goldenDir, 'golden', s.file)));
    const t = Date.now();
    const y = await scorer.scoreRaw(x);
    times.push(Date.now() - t);
    maxDiff = Math.max(maxDiff, Math.abs(y.articulation - s.expected_raw.articulation), Math.abs(y.prosody - s.expected_raw.prosody));
  }
  console.log(`[채점] 골든 ${golden.samples.length}건 | Python 대비 최대 오차 ${maxDiff.toExponential(2)} (허용 ${golden.tolerance}) | ${maxDiff <= golden.tolerance ? '통과' : '실패'} | 중앙값 ${times.sort((a, b) => a - b)[times.length >> 1]}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
