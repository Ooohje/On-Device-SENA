import { peakNormalize, preprocess, padOrTrim } from '../audio/preprocess';
import { PcmRecorder } from '../audio/recorder';
import { SileroVad } from '../audio/sileroVad';
import { llmPath, PATHS } from '../paths';
import { Asr } from '../models/asr';
import { Llm } from '../models/llm';
import { Backend, displayScore, Scorer } from '../models/scorer';
import * as Device from 'expo-device';
import { analyze, describeDiffs } from '../tutorial/pronunciation';
import * as Tts from '../tts';
import { exists, readJson as readJsonRaw, readWav16k, saveResult } from './files';

// 골든 파일이 없으면 알아보기 쉬운 오류를 낸다 (v0.1.0 테스트 APK에는 골든 샘플이 빠져 있었음)
async function readJson(path: string) {
  if (!exists(path)) throw new Error(`골든 파일이 기기에 없습니다: ${path}
테스트 APK v0.1.1부터 함께 들어 있어요. 개발 중에는 scripts/push-assets.ps1로 넣어주세요.`);
  return readJsonRaw(path);
}

const dbfs = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export type Log = (line: string) => void;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];

export async function checkFiles(log: Log) {
  const items = {
    '채점 모델': PATHS.scorer,
    'VAD 모델': PATHS.vad,
    'Whisper 모델': PATHS.whisper,
    'LLM 모델': llmPath(),
    '골든(채점)': `${PATHS.goldenDir}/golden_expected.json`,
    '골든(전처리)': `${PATHS.goldenRawDir}/golden_raw.json`,
  };
  for (const [k, p] of Object.entries(items)) log(`${exists(p) ? '✅' : '❌'} ${k}  ${p}`);
  const gb = Device.totalMemory ? (Device.totalMemory / 1024 ** 3).toFixed(1) : '?';
  log(`📱 ${Device.manufacturer ?? ''} ${Device.modelName ?? ''} | ${Device.osName ?? ''} ${Device.osVersion ?? ''} (API ${Device.platformApiLevel ?? '-'}) | RAM ${gb}GB | ${(Device.supportedCpuArchitectures ?? []).join(',')}`);
  saveResult('device', { manufacturer: Device.manufacturer, model: Device.modelName, os: Device.osVersion, api: Device.platformApiLevel, totalMemory: Device.totalMemory, abis: Device.supportedCpuArchitectures });
}

// B-1. 채점 모델: Track A 골든과 같은 점수가 나오는지 + 지연 시간 (8초 입력, batch 1)
export async function scorerGolden(log: Log, backend: Backend, threads = 4) {
  const t0 = Date.now();
  const scorer = await Scorer.load(PATHS.scorer, backend, threads);
  const loadMs = Date.now() - t0;
  const golden = await readJson(`${PATHS.goldenDir}/golden_expected.json`);
  let maxDiff = 0;
  for (const s of golden.samples) {
    const y = await scorer.scoreRaw(padOrTrim(await readWav16k(`${PATHS.goldenDir}/${s.file}`)));
    maxDiff = Math.max(maxDiff, Math.abs(y.articulation - s.expected_raw.articulation), Math.abs(y.prosody - s.expected_raw.prosody));
  }
  const x = padOrTrim(await readWav16k(`${PATHS.goldenDir}/${golden.samples[0].file}`));
  await scorer.scoreRaw(x); // 워밍업
  const ts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await scorer.scoreRaw(x);
    ts.push(Date.now() - t);
  }
  await scorer.release();
  const pass = maxDiff <= golden.tolerance;
  const r = { backend, threads, loadMs, maxDiff, tolerance: golden.tolerance, pass, medianMs: median(ts), p90Ms: p90(ts), runs: ts };
  log(`[채점/${backend}] ${pass ? '✅' : '❌'} 최대 오차 ${maxDiff.toExponential(2)} | 로드 ${loadMs}ms | 추론 중앙값 ${r.medianMs}ms, p90 ${r.p90Ms}ms`);
  saveResult(`scorer-${backend}`, r);
}

// B-2. 전처리 포팅: 원본 음성 → TS 전처리 → Python과 같은 구간을 자르는지
export async function preprocessGolden(log: Log) {
  const vad = await SileroVad.load(PATHS.vad);
  const g = await readJson(`${PATHS.goldenRawDir}/golden_raw.json`);
  const rows = [];
  for (const s of g.samples) {
    const raw = await readWav16k(`${PATHS.goldenRawDir}/${s.file}`);
    const pre = await preprocess(raw, vad);
    const ok = pre.start === s.onnx_start && pre.end === s.onnx_end;
    rows.push({ file: s.file, ok, start: pre.start, end: pre.end, expected: [s.onnx_start, s.onnx_end], vadMs: pre.vadMs, sec: raw.length / 16000 });
    log(`${ok ? '✅' : '❌'} ${(raw.length / 16000).toFixed(1)}s  VAD ${pre.vadMs}ms  ${pre.start}-${pre.end}`);
  }
  await vad.release();
  const pass = rows.every((r) => r.ok);
  log(`[전처리] ${pass ? '✅ 전부 일치' : '❌ 불일치 있음'} (${rows.filter((r) => r.ok).length}/${rows.length})`);
  saveResult('preprocess', { pass, rows });
}

// B-3. 실제 녹음 → 전처리 → 채점 (끝까지 걸린 시간). 목소리가 감지되지 않으면 채점하지 않는다.
export async function recordAndScore(log: Log, seconds = 5) {
  const rec = new PcmRecorder();
  log(`🎙 ${seconds}초 녹음 시작 — 영어 문장을 읽어주세요`);
  await rec.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const audio = await rec.stop();
  log(`녹음 완료: ${audio.seconds.toFixed(2)}s, 기기 샘플레이트 ${audio.deviceSampleRate}Hz${audio.deviceSampleRate !== 16000 ? ' (16kHz로 변환함)' : ''}`);
  // 입력 크기: 마이크가 소리를 제대로 받았는지 (말소리는 보통 피크 -20~-3 dBFS)
  let peak = 0, sq = 0;
  for (const v of audio.samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sq += v * v;
  }
  const rms = Math.sqrt(sq / Math.max(1, audio.samples.length));
  const t0 = Date.now();
  const vad = await SileroVad.load(PATHS.vad);
  const probs = await vad.speechProbs(peakNormalize(audio.samples)); // 채점 전처리와 같은 기준(Peak 정규화 후)
  const maxProb = probs.reduce((m, p) => Math.max(m, p), 0);
  const speechRatio = probs.filter((p) => p >= 0.5).length / Math.max(1, probs.length);
  log(`입력 크기: 피크 ${dbfs(peak).toFixed(1)} dBFS, RMS ${dbfs(rms).toFixed(1)} dBFS | VAD 최대 확률 ${maxProb.toFixed(2)}, 말소리 구간 ${(speechRatio * 100).toFixed(0)}%`);
  const pre = await preprocess(audio.samples, vad);
  await vad.release();
  if (!pre.speechFound) {
    log(peak < 0.01 ? '⚠ 음성 감지 아니오 — 마이크 입력이 거의 없습니다 (권한·마이크 막힘·다른 앱 사용 확인). 채점하지 않습니다.' : '⚠ 음성 감지 아니오 — 소리는 있지만 말소리로 판단되지 않았습니다. 마이크에 더 가까이 말해 주세요. 채점하지 않습니다.');
    saveResult('record', { deviceSampleRate: audio.deviceSampleRate, seconds: audio.seconds, peakDbfs: dbfs(peak), rmsDbfs: dbfs(rms), vadMaxProb: maxProb, speechFound: false });
    return;
  }
  const scorer = await Scorer.load(PATHS.scorer, 'cpu', 4);
  const loadMs = Date.now() - t0;
  const t2 = Date.now();
  const y = await scorer.scoreRaw(pre.input);
  const t3 = Date.now();
  await scorer.release();
  log(`발음 ${displayScore(y.articulation)} (${y.articulation.toFixed(2)}) / 운율 ${displayScore(y.prosody)} (${y.prosody.toFixed(2)})`);
  log(`모델 로드 ${loadMs}ms | VAD ${pre.vadMs}ms | 채점 ${t3 - t2}ms | 음성 구간 ${((pre.end - pre.start) / 16000).toFixed(2)}s`);
  saveResult('record', { deviceSampleRate: audio.deviceSampleRate, seconds: audio.seconds, peakDbfs: dbfs(peak), rmsDbfs: dbfs(rms), vadMaxProb: maxProb, speechFound: true, loadMs, vadMs: pre.vadMs, scoreMs: t3 - t2, raw: y });
}

// B-4. ASR: 원본 골든 음성을 whisper로 변환
export async function asrBench(log: Log, threads = 4) {
  const t0 = Date.now();
  const asr = await Asr.load(PATHS.whisper);
  const loadMs = Date.now() - t0;
  const g = await readJson(`${PATHS.goldenRawDir}/golden_raw.json`);
  const rows = [];
  for (const s of g.samples) {
    const raw = await readWav16k(`${PATHS.goldenRawDir}/${s.file}`);
    const r = await asr.transcribe(raw, threads);
    const sec = raw.length / 16000;
    rows.push({ file: s.file, sec, ms: r.ms, rtf: r.ms / 1000 / sec, text: r.text });
    log(`${sec.toFixed(1)}s → ${r.ms}ms  "${r.text}"`);
  }
  await asr.release();
  const rtf = median(rows.map((r) => r.rtf));
  log(`[ASR] 로드 ${loadMs}ms | 실시간 대비 처리 비율(RTF) 중앙값 ${rtf.toFixed(2)} (1보다 작을수록 빠름)`);
  saveResult('asr', { loadMs, threads, rtfMedian: rtf, rows });
}

// B-5. LLM: 첫 토큰 지연과 생성 속도
export async function llmBench(log: Log, threads = 4) {
  log('LLM 로드 중...');
  const llm = await Llm.load(llmPath(), threads);
  log(`로드 ${llm.loadMs}ms`);
  const system = 'You are a friendly English conversation partner for a Korean learner. Reply in 1-2 short sentences and ask one follow-up question.';
  const turns = ['Hi! I went to a cafe yesterday.', 'I ordered a latte but it was too sweet.', 'Do you like coffee?'];
  const rows = [];
  for (const u of turns) {
    const r = await llm.chat(system, u, 96);
    rows.push({ user: u, ...r });
    log(`👤 ${u}\n🤖 ${r.text.trim()}\n   첫 토큰 ${r.firstTokenMs}ms | 생성 ${r.genPerSec.toFixed(1)} tok/s | 프롬프트 ${r.promptPerSec.toFixed(0)} tok/s`);
  }
  await llm.release();
  saveResult('llm', { loadMs: llm.loadMs, threads, rows });
}

// B-6. 발열: 채점을 N분 동안 반복하며 1분마다 지연 시간 기록
export async function thermalBench(log: Log, minutes = 5) {
  const scorer = await Scorer.load(PATHS.scorer, 'cpu', 4);
  const golden = await readJson(`${PATHS.goldenDir}/golden_expected.json`);
  const x = padOrTrim(await readWav16k(`${PATHS.goldenDir}/${golden.samples[0].file}`));
  const perMinute: { minute: number; medianMs: number; runs: number }[] = [];
  for (let m = 1; m <= minutes; m++) {
    const end = Date.now() + 60_000;
    const ts: number[] = [];
    while (Date.now() < end) {
      const t = Date.now();
      await scorer.scoreRaw(x);
      ts.push(Date.now() - t);
    }
    perMinute.push({ minute: m, medianMs: median(ts), runs: ts.length });
    log(`${m}분: 중앙값 ${median(ts)}ms (${ts.length}회)`);
  }
  await scorer.release();
  const slowdown = perMinute[perMinute.length - 1].medianMs / perMinute[0].medianMs;
  log(`[발열] 마지막/처음 지연 비율 ${slowdown.toFixed(2)}x`);
  saveResult('thermal', { perMinute, slowdown });
}

// B-7. 발음 분석: whisper 받아쓰기 → 단어·음소 정렬. AI-Hub 사람 표기(실제 발음 IPA)와 나란히 본다
export async function pronunciationBench(log: Log) {
  const asr = await Asr.load(PATHS.whisper);
  const g = await readJson(`${PATHS.goldenRawDir}/golden_raw.json`);
  const rows = [];
  for (const s of g.samples) {
    if (!s.sentence) continue;
    const raw = await readWav16k(`${PATHS.goldenRawDir}/${s.file}`);
    const heard = (await asr.transcribe(raw)).text;
    const a = analyze(s.sentence, heard);
    const issues = a.words
      .filter((w) => w.kind !== 'ok')
      .map((w) => (w.kind === 'changed' ? `${w.word}→${w.heard}${w.diffs.length ? ` [${describeDiffs(w.diffs)}]` : ''}` : `${w.word} 안 들림`));
    const humanErr = String(s.tagging ?? '').split(/\s+/).filter((t) => t && t !== 'C').length;
    rows.push({ file: s.file, sentence: s.sentence, heard, ok: a.okCount, total: a.total, issues, humanTagging: s.tagging, humanPhonemeErrors: humanErr });
    log(`🎯 ${s.sentence}
👂 ${heard}
   단어 ${a.okCount}/${a.total} 정상${issues.length ? ` | ${issues.join(', ')}` : ''}
   사람 표기: ${s.phonemeText ?? '-'} (음소 오류 ${humanErr}개)`);
  }
  await asr.release();
  saveResult('pronunciation', { rows });
}

// B-8. TTS: 기기에 설치된 영어 음성과 자동 선택 결과, 시범 발화
export async function ttsBench(log: Log) {
  const voices = await Tts.englishVoices();
  log(`설치된 오프라인 영어 음성 ${voices.length}개`);
  for (const v of voices.slice(0, 10)) log(`  ${v.score >= 40 ? '★' : ' '} ${v.language}  ${v.quality}  ${v.id}`);
  if (!voices.length) log('⚠ 영어 음성이 없습니다. 기기 설정 > 텍스트 음성 변환에서 영어 음성을 설치하세요.');
  else log(`자동 선택: ${voices[0].id}`);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10_000); // 콜백이 오지 않는 기기 대비
    Tts.speak("Hi! I'm Emma. What would you like to order today?", { onDone: resolve });
  });
  saveResult('tts', { voices });
}

// B-9. 대화 응답 속도(앱과 같은 엔진·설정): 학습자가 말한 뒤 첫 글자·첫 문장(음성 대화에서 소리가 나기 시작하는 시점)·답 끝까지 걸린 시간.
// 첫 인사 동안 미리 계산(warm)한 경우와 하지 않은 경우를 비교한다.
export async function chatLatencyBench(log: Log) {
  const { loadChatModel, releaseChatModel } = await import('../chat/llamaChatModel');
  const { ConversationEngine } = await import('../chat/engine');
  const { scenarioById } = await import('../chat/scenarios');
  const { takeSentences } = await import('../tts');
  const turns = ['I went to the gym this morning.', 'I like running. And I play guitar sometimes.', 'This weekend I will meet my friend in Hongdae.'];
  const rows: any[] = [];
  for (const warm of [false, true]) {
    await releaseChatModel(); // 캐시를 비우고 같은 조건에서 시작
    const t0 = Date.now();
    const model = await loadChatModel();
    log(`[${warm ? '미리 계산함' : '미리 계산 안 함'}] 모델 로드 ${Date.now() - t0}ms`);
    const e = new ConversationEngine(model, scenarioById('free_talk')!, 'Jason', []);
    await e.open();
    if (warm) {
      const w0 = Date.now();
      await e.warm();
      log(`  첫 인사 동안 미리 계산 ${Date.now() - w0}ms (학습자가 듣고 말하는 동안 처리됨)`);
    }
    for (const [i, t] of turns.entries()) {
      const s0 = Date.now();
      let first = 0;
      let firstSentence = 0;
      const reply = await e.send(t, (p) => {
        if (!first && p) first = Date.now() - s0;
        if (!firstSentence && takeSentences(p).done.length) firstSentence = Date.now() - s0;
      });
      const total = Date.now() - s0;
      if (!firstSentence) firstSentence = total;
      rows.push({ warm, turn: i + 1, firstTokenMs: first, firstSentenceMs: firstSentence, totalMs: total, words: reply.split(/\s+/).length });
      log(`  ${i + 1}턴: 첫 글자 ${first}ms · 첫 문장 ${firstSentence}ms · 답 끝 ${total}ms (${reply.split(/\s+/).length}단어)`);
    }
  }
  await releaseChatModel();
  saveResult('chat-latency', { rows });
}

// B-10. 한국어로 도움받기: ① 한국어 → 영어 따라 말하기 문장 만들기 시간(앱과 같은 엔진) ② 따라 말하기 판정을 골든 음성으로 확인 —
// 실제 문장을 목표로 주면 통과하고 점수가 나와야 하며, 다른 골든 문장을 목표로 주면 통과하지 않아야 한다(에뮬레이터는 마이크를 쓸 수 없어 녹음 대신 골든 음성을 넣는다)
export async function assistBench(log: Log) {
  const { loadChatModel, releaseChatModel } = await import('../chat/llamaChatModel');
  const { ConversationEngine } = await import('../chat/engine');
  const { scenarioById } = await import('../chat/scenarios');
  const { evaluateShadow } = await import('../chat/shadow');
  const rows: any[] = [];
  const model = await loadChatModel();
  const cases: [string, string][] = [
    ['cafe', '아이스 아메리카노 큰 사이즈로 한 잔 주세요'],
    ['hotel', '체크아웃은 몇 시까지예요?'],
    ['shopping', '좀 끼어요. 한 치수 큰 거 있어요?'],
    ['directions', '걸어서 얼마나 걸려요?'],
    ['free_talk', '친구랑 한강에서 치맥 했어'],
  ];
  for (const [id, ko] of cases) {
    const e = new ConversationEngine(model, scenarioById(id)!, 'Jason', []);
    await e.open();
    const t0 = Date.now();
    const en = await e.assist(ko);
    const ms = Date.now() - t0;
    rows.push({ kind: 'translate', scenario: id, ko, en, ms });
    log(`🇰🇷 ${ko}
🇺🇸 ${en}  (${ms}ms)`);
  }
  await releaseChatModel();

  const g = await readJson(`${PATHS.goldenRawDir}/golden_raw.json`);
  const samples = g.samples.filter((s: any) => s.sentence);
  const m = { asr: await Asr.load(PATHS.whisper), vad: await SileroVad.load(PATHS.vad), scorer: await Scorer.load(PATHS.scorer, 'cpu', 4) };
  for (const [i, s] of samples.entries()) {
    const raw = await readWav16k(`${PATHS.goldenRawDir}/${s.file}`);
    const same = await evaluateShadow(m, raw, s.sentence);
    const other = samples[(i + 1) % samples.length].sentence;
    const diff = await evaluateShadow(m, raw, other);
    rows.push({ kind: 'shadow', file: s.file, target: s.sentence, heard: same.heard, wer: same.wer, passed: same.passed, articulation: same.articulation, prosody: same.prosody, ms: same.ms, otherTarget: other, otherPassed: diff.passed });
    log(`🎯 ${s.sentence}
👂 ${same.heard}
   같은 문장 ${same.passed ? '통과' : '실패'} (WER ${same.wer.toFixed(2)})${same.articulation !== undefined ? ` 발음 ${same.articulation} 운율 ${same.prosody}` : ''} ${same.ms}ms · 다른 문장 목표 ${diff.passed ? '⚠ 통과' : '실패(정상)'}`);
  }
  await Promise.all([m.asr.release(), m.vad.release(), m.scorer.release()]);
  const sh = rows.filter((r) => r.kind === 'shadow');
  log(`
따라 말하기: 같은 문장 통과 ${sh.filter((r) => r.passed).length}/${sh.length}, 다른 문장 차단 ${sh.filter((r) => !r.otherPassed).length}/${sh.length}`);
  saveResult('assist', { rows });
}
