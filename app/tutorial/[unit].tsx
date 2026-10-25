import Ionicons from '@expo/vector-icons/Ionicons';
import * as Speech from '../../src/tts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PcmRecorder } from '../../src/audio/recorder';
import { scenarioById } from '../../src/chat/scenarios';
import { addAttempt, bestScores, BestScore, getName, practiceSentences } from '../../src/store/db';
import { dailySentence, fillName, Sentence, unitById } from '../../src/tutorial/content';
import { feedback, PracticeResult, PracticeScorer } from '../../src/tutorial/practiceScorer';
import { describeDiffs, PronunciationAnalysis } from '../../src/tutorial/pronunciation';
import { Glass } from '../../src/ui/Glass';
import { C, font } from '../../src/ui/theme';

type Phase = 'loading' | 'idle' | 'recording' | 'scoring' | 'error';
const MAX_RECORD_MS = 9000; // 평가 모델 입력은 8초. VAD로 앞뒤 무음을 자르므로 조금 여유를 둔다

export default function Practice() {
  const { unit: unitId } = useLocalSearchParams<{ unit: string }>();
  const name = getName() ?? 'Friend';

  // 'mine' = 자유 대화 보고서에서 넘어온 문장
  const { title, sentences, scenarioId } = useMemo(() => {
    if (unitId === 'mine')
      return {
        title: '내 문장',
        scenarioId: undefined,
        sentences: practiceSentences().map<Sentence>((p) => ({
          id: `mine_${p.id}`,
          en: p.text,
          ko: p.original ? `대화에서 말한 문장: ${p.original}` : '대화에서 말한 문장을 다듬었어요.',
          tip: '시범 음성을 먼저 듣고, 강세가 오는 단어를 살려 말해보세요.',
        })),
      };
    if (unitId === 'daily') {
      // 홈 화면 위젯 '오늘의 한 문장'을 누르면 여기로 온다 (sena://tutorial/daily)
      const d = dailySentence();
      return { title: '오늘의 한 문장', scenarioId: d.unit.scenarioId, sentences: [{ id: d.id, en: d.en, ko: d.ko, tip: d.tip }] };
    }
    const u = unitById(unitId)!;
    return { title: u.title, scenarioId: u.scenarioId, sentences: u.sentences.map((s) => ({ ...s, en: fillName(s.en, name), ko: fillName(s.ko, name) })) };
  }, [unitId]);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [best, setBest] = useState<Record<string, BestScore>>(bestScores());
  const scorer = useRef<PracticeScorer | null>(null);
  const recorder = useRef<PcmRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentence = sentences[index];
  const finished = index >= sentences.length;

  useEffect(() => {
    let alive = true;
    PracticeScorer.load()
      .then((s) => {
        if (!alive) return s.release();
        scorer.current = s;
        setPhase('idle');
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message ?? String(e));
        setPhase('error');
      });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      Speech.stop();
      recorder.current?.stop().catch(() => undefined);
      scorer.current?.release();
    };
  }, []);

  const listen = () => {
    Speech.stop();
    Speech.speak(sentence.en, { rate: 0.9 }); // 시범 음성은 조금 천천히
  };

  const stopAndScore = async () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase('scoring');
    try {
      const rec = await recorder.current!.stop();
      const r = await scorer.current!.evaluate(rec.samples, sentence.en);
      if (r.kind === 'scored') {
        addAttempt(sentence.id, sentence.en, r.articulation, r.prosody, r.transcript);
        setBest(bestScores());
      }
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    setPhase('idle');
  };

  const onRecord = async () => {
    if (phase === 'recording') return stopAndScore();
    if (phase !== 'idle') return;
    Speech.stop();
    setResult(null);
    setError('');
    try {
      recorder.current = new PcmRecorder();
      await recorder.current.start();
      setPhase('recording');
      timer.current = setTimeout(stopAndScore, MAX_RECORD_MS);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const go = (d: number) => {
    Speech.stop();
    setResult(null);
    setError('');
    setIndex((i) => Math.max(0, Math.min(sentences.length, i + d)));
  };

  if (!sentences.length)
    return (
      <View style={s.center}>
        <Text style={s.muted}>아직 연습할 문장이 없어요.</Text>
      </View>
    );

  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitleEnabled: false }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.content}>
        <View style={s.dots}>
          {sentences.map((x, i) => (
            <View key={x.id} style={[s.dot, best[x.id] && s.dotDone, i === index && s.dotNow]} />
          ))}
        </View>

        {finished ? (
          <Finished sentences={sentences} best={best} scenarioId={scenarioId} onRestart={() => setIndex(0)} />
        ) : (
          <>
            <Glass style={s.card}>
              <Text style={s.counter}>
                {index + 1} / {sentences.length}
              </Text>
              <Text style={s.en}>{sentence.en}</Text>
              <Text style={s.ko}>{sentence.ko}</Text>
              <View style={s.tipRow}>
                <Ionicons name="bulb-outline" size={16} color={C.orange} />
                <Text style={s.tip}>{sentence.tip}</Text>
              </View>
              <Pressable onPress={listen} style={({ pressed }) => [s.listen, pressed && { opacity: 0.6 }]}>
                <Ionicons name="volume-high" size={18} color={C.blue} />
                <Text style={s.listenText}>시범 듣기</Text>
              </Pressable>
            </Glass>

            {best[sentence.id] ? (
              <Text style={s.best}>
                최고 기록 발음 {best[sentence.id].articulation.toFixed(1)} · 운율 {best[sentence.id].prosody.toFixed(1)} ({best[sentence.id].tries}회)
              </Text>
            ) : null}

            <ResultView result={result} />
            {error ? <Text style={s.error}>{error}</Text> : null}

            {/* 남는 공간을 채워 녹음 버튼을 화면 아래쪽(엄지가 닿는 곳)에 둔다 */}
            <View style={s.spacer} />
            <View style={s.controls}>
              <NavButton icon="chevron-back" onPress={() => go(-1)} disabled={index === 0 || phase === 'recording' || phase === 'scoring'} />
              <Pressable onPress={onRecord} disabled={phase === 'loading' || phase === 'scoring' || phase === 'error'}>
                <View style={[s.mic, phase === 'recording' && s.micRec, (phase === 'loading' || phase === 'error') && { opacity: 0.4 }]}>
                  {phase === 'scoring' || phase === 'loading' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name={phase === 'recording' ? 'stop' : 'mic'} size={34} color="#fff" />
                  )}
                </View>
              </Pressable>
              <NavButton icon="chevron-forward" onPress={() => go(1)} disabled={phase === 'recording' || phase === 'scoring'} />
            </View>
            <Text style={s.micHint}>
              {phase === 'loading'
                ? '평가 모델을 준비하는 중…'
                : phase === 'recording'
                  ? '말하고 나서 다시 누르세요'
                  : phase === 'scoring'
                    ? '점수를 계산하는 중…'
                    : phase === 'error'
                      ? ''
                      : '버튼을 누르고 문장을 읽어주세요'}
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

function ResultView({ result }: { result: PracticeResult | null }) {
  if (!result) return null;
  if (result.kind === 'no_speech') return <Text style={s.notice}>목소리가 들리지 않았어요. 마이크에 조금 더 가까이 말해보세요.</Text>;
  if (result.kind === 'too_short') return <Text style={s.notice}>너무 짧게 녹음됐어요. 문장 전체를 읽어주세요.</Text>;
  if (result.kind === 'off_script')
    return (
      <Text style={s.notice}>
        제시한 문장과 다르게 들렸어요.{'\n'}들린 문장: "{result.transcript}"
      </Text>
    );
  return (
    <Glass style={s.result}>
      <View style={s.scores}>
        <ScoreBar label="발음" value={result.articulation} />
        <ScoreBar label="운율" value={result.prosody} />
      </View>
      <Text style={s.feedback}>{feedback(result.articulation, result.prosody)}</Text>
      {result.analysis ? <AnalysisView a={result.analysis} transcript={result.transcript ?? ''} /> : result.transcript ? <Text style={s.heard}>들린 문장: "{result.transcript}"</Text> : null}
    </Glass>
  );
}

// 받아쓰기 기준 발음 분석: 단어별로 맞게 들렸는지, 다르게 들렸다면 어떤 소리로 들렸는지
function AnalysisView({ a, transcript }: { a: PronunciationAnalysis; transcript: string }) {
  const issues = a.words.filter((w) => w.kind !== 'ok');
  return (
    <View style={s.analysis}>
      <Text style={s.analysisTitle}>
        음성 분석 <Text style={s.analysisSub}>· 받아쓰기 기준 추정</Text>
      </Text>
      <View style={s.wordRow}>
        {a.words.map((w, i) => (
          <Text key={i} style={[s.word, w.kind === 'ok' ? s.wordOk : w.kind === 'changed' ? s.wordChanged : s.wordMissing]}>
            {w.word}
          </Text>
        ))}
      </View>
      <Text style={s.heard}>들린 문장: "{transcript}"</Text>
      {issues.length === 0 ? (
        <Text style={s.issueTip}>모든 단어가 정확하게 들렸어요 ({a.okCount}/{a.total}).</Text>
      ) : (
        issues.slice(0, 4).map((w, i) =>
          w.kind === 'changed' ? (
            <View key={i} style={s.issue}>
              <Text style={s.issueHead}>
                {w.word} → <Text style={{ color: C.orange }}>{w.heard}</Text>
                {w.diffs.length ? <Text style={s.issueSound}>  {describeDiffs(w.diffs)}</Text> : null}
              </Text>
              <Text style={s.issueTip}>{w.tip}</Text>
            </View>
          ) : (
            <View key={i} style={s.issue}>
              <Text style={s.issueHead}>
                {w.word} <Text style={{ color: C.red }}>안 들림</Text>
              </Text>
              <Text style={s.issueTip}>이 단어가 들리지 않았어요. 약하게 넘어가지 않도록 또렷하게 말해 보세요.</Text>
            </View>
          ),
        )
      )}
      {a.extra.length ? <Text style={s.issueTip}>문장에 없는 말: {a.extra.join(' ')}</Text> : null}
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 4 ? C.green : value >= 3 ? C.blue : value >= 2 ? C.orange : C.red;
  return (
    <View style={s.scoreBox}>
      <Text style={s.scoreLabel}>{label}</Text>
      <Text style={[s.scoreValue, { color }]}>
        {value.toFixed(1)}
        <Text style={s.scoreMax}> / 5</Text>
      </Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function Finished({ sentences, best, scenarioId, onRestart }: { sentences: Sentence[]; best: Record<string, BestScore>; scenarioId?: string; onRestart: () => void }) {
  const done = sentences.filter((x) => best[x.id]);
  const avg = (k: 'articulation' | 'prosody') => (done.length ? done.reduce((a, x) => a + best[x.id][k], 0) / done.length : 0);
  const sc = scenarioId ? scenarioById(scenarioId) : undefined;
  return (
    <Glass style={s.card}>
      <Text style={s.en}>단원을 마쳤어요!</Text>
      <Text style={s.ko}>
        {done.length}/{sentences.length} 문장 연습 · 평균 발음 {avg('articulation').toFixed(1)} · 운율 {avg('prosody').toFixed(1)}
      </Text>
      {sc ? (
        <Pressable onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: sc.id } })} style={s.primary}>
          <Text style={s.primaryText}>실전 대화하기 · {sc.partnerName}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onRestart} style={s.secondary}>
        <Text style={s.secondaryText}>처음부터 다시</Text>
      </Pressable>
    </Glass>
  );
}

function NavButton({ icon, onPress, disabled }: { icon: any; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10}>
      <Glass style={[s.nav, disabled && { opacity: 0.35 }]} interactive>
        <Ionicons name={icon} size={24} color={C.blue} />
      </Glass>
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  spacer: { flex: 1, minHeight: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { ...font.subhead, color: C.secondary },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.fill },
  dotDone: { backgroundColor: C.green },
  dotNow: { width: 22, backgroundColor: C.blue },
  card: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 26 },
  counter: { ...font.footnote, color: C.secondary, marginBottom: 14 },
  en: { fontSize: 26, fontWeight: '600', color: C.label, lineHeight: 34 },
  ko: { ...font.subhead, color: C.secondary, marginTop: 12, lineHeight: 21 },
  tipRow: { flexDirection: 'row', gap: 8, marginTop: 22, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,149,0,0.08)', alignItems: 'flex-start' },
  tip: { ...font.footnote, color: C.label, flex: 1, lineHeight: 19 },
  listen: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 20, backgroundColor: C.fill, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  listenText: { ...font.subhead, color: C.blue, fontWeight: '600' },
  best: { ...font.footnote, color: C.secondary, textAlign: 'center', marginTop: 16 },
  result: { borderRadius: 20, padding: 20, marginTop: 20 },
  scores: { flexDirection: 'row', gap: 16 },
  scoreBox: { flex: 1 },
  scoreLabel: { ...font.footnote, color: C.secondary },
  scoreValue: { fontSize: 30, fontWeight: '700', marginTop: 2 },
  scoreMax: { fontSize: 15, fontWeight: '400', color: C.secondary },
  track: { height: 6, borderRadius: 3, backgroundColor: C.fill, marginTop: 6, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  feedback: { ...font.subhead, color: C.label, marginTop: 14 },
  heard: { ...font.footnote, color: C.secondary, marginTop: 6 },
  analysis: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  analysisTitle: { ...font.footnote, color: C.label, fontWeight: '600' },
  analysisSub: { fontWeight: '400', color: C.secondary },
  wordRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  word: { ...font.subhead, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  wordOk: { color: C.green, backgroundColor: 'rgba(52,199,89,0.12)' },
  wordChanged: { color: C.orange, backgroundColor: 'rgba(255,149,0,0.14)' },
  wordMissing: { color: C.red, backgroundColor: 'rgba(255,59,48,0.12)', textDecorationLine: 'line-through' },
  issue: { marginTop: 10 },
  issueHead: { ...font.subhead, color: C.label, fontWeight: '600' },
  issueSound: { ...font.footnote, color: C.secondary, fontWeight: '400' },
  issueTip: { ...font.footnote, color: C.secondary, marginTop: 4, lineHeight: 18 },
  notice: { ...font.subhead, color: C.orange, textAlign: 'center', marginTop: 16, lineHeight: 21 },
  error: { ...font.subhead, color: C.red, textAlign: 'center', marginTop: 16, lineHeight: 21 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  mic: { width: 78, height: 78, borderRadius: 39, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', shadowColor: C.blue, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  micRec: { backgroundColor: C.red, shadowColor: C.red },
  micHint: { ...font.footnote, color: C.secondary, textAlign: 'center', marginTop: 12 },
  nav: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  primary: { marginTop: 20, backgroundColor: C.blue, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryText: { ...font.headline, color: '#fff' },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { ...font.body, color: C.blue },
});
