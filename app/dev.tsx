import Constants from 'expo-constants';
import { Directory } from 'expo-file-system';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import * as T from '../src/bench/tests';
import { showAlert } from '../src/ui/Dialog';

// Phase 0 · Track B 기술 검증 화면. 각 버튼이 하나의 측정을 실행하고 결과를 기기에 JSON으로 저장한다.
const TESTS: { label: string; run: (log: T.Log) => Promise<void> }[] = [
  { label: '0. 파일 확인', run: T.checkFiles },
  { label: '1a. 채점 골든 · CPU', run: (l) => T.scorerGolden(l, 'cpu') },
  { label: '1b. 채점 골든 · XNNPACK', run: (l) => T.scorerGolden(l, 'xnnpack') },
  { label: '1c. 채점 골든 · NNAPI', run: (l) => T.scorerGolden(l, 'nnapi') },
  { label: '2. 전처리 골든 (VAD 포팅)', run: T.preprocessGolden },
  { label: '3. 녹음 5초 → 채점', run: (l) => T.recordAndScore(l, 5) },
  { label: '4. ASR (whisper)', run: T.asrBench },
  { label: '5. LLM 대화', run: T.llmBench },
  { label: '5b. 대화 응답 속도', run: T.chatLatencyBench },
  { label: '6. 발열 5분', run: (l) => T.thermalBench(l, 5) },
  { label: '7. 발음 분석', run: T.pronunciationBench },
  { label: '8. 음성(TTS)', run: T.ttsBench },
  { label: '9. 한국어로 도움받기', run: T.assistBench },
];

export default function Dev() {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  const all = useRef<string[]>([]); // 저장용 전체 로그 (화면 상태와 별도로 바로 쌓는다)
  const log = useCallback((line: string) => {
    all.current.push(line);
    setLines((ls) => [...ls, line]);
  }, []);

  const runOne = async (t: (typeof TESTS)[number]) => {
    log(`\n▶ ${t.label}`);
    const t0 = Date.now();
    try {
      await t.run(log);
      log(`■ 완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e: any) {
      log(`⚠ 오류: ${e?.message ?? String(e)}`);
    }
  };

  const run = async (t: (typeof TESTS)[number]) => {
    if (busy) return;
    setBusy(t.label);
    await runOne(t);
    setBusy(null);
  };

  // 전체 실행: 위 목록을 차례로 모두 실행한다. '3. 녹음'은 5초 동안 영어 문장을 읽어야 하고, '6. 발열'은 5분 걸린다(합계 약 10분)
  const runAll = async () => {
    if (busy) return;
    setBusy('전체 실행');
    const t0 = Date.now();
    log(`\n===== 전체 실행 시작 (SENA ${Constants.expoConfig?.version ?? ''}, ${new Date().toLocaleString()}) =====`);
    for (const t of TESTS) await runOne(t);
    log(`===== 전체 실행 끝 (${((Date.now() - t0) / 60000).toFixed(1)}분) =====`);
    setBusy(null);
  };

  // 로그를 TXT로 저장: 저장할 폴더(예: 다운로드)를 고르면 그 안에 sena-log-날짜.txt를 만든다
  const saveTxt = async () => {
    if (!all.current.length) return showAlert('저장할 로그가 없어요', '먼저 측정을 실행해 주세요.');
    try {
      const dir = await Directory.pickDirectoryAsync();
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const name = `sena-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
      const f = dir.createFile(name, 'text/plain');
      f.write(`SENA ${Constants.expoConfig?.version ?? ''} 기술 검증 로그\n${all.current.join('\n')}\n`);
      showAlert('로그를 저장했어요', `${name}\n고른 폴더에 저장했어요.`);
    } catch (e: any) {
      if (!/cancel/i.test(String(e?.message ?? e))) showAlert('저장하지 못했어요', e?.message ?? String(e));
    }
  };

  return (
    <View style={s.root}>
      <View style={s.buttons}>
        {TESTS.map((t) => (
          <Pressable key={t.label} onPress={() => run(t)} disabled={!!busy} style={[s.btn, busy === t.label && s.btnActive, !!busy && busy !== t.label && s.btnDim]}>
            <Text style={s.btnText}>{t.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={runAll} disabled={!!busy} style={[s.btn, s.btnAll, busy === '전체 실행' && s.btnActive, !!busy && busy !== '전체 실행' && s.btnDim]}>
          <Text style={s.btnText}>▶ 전체 실행 (약 10분)</Text>
        </Pressable>
        <Pressable onPress={saveTxt} disabled={!!busy} style={[s.btn, s.btnSave, !!busy && s.btnDim]}>
          <Text style={s.btnText}>⬇ 로그 TXT로 저장</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            all.current = [];
            setLines([]);
          }}
          disabled={!!busy}
          style={[s.btn, s.btnClear]}
        >
          <Text style={s.btnText}>로그 지우기</Text>
        </Pressable>
      </View>
      <ScrollView ref={scroll} style={s.log} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Text style={s.logText} selectable>
          {lines.join('\n') || '버튼을 눌러 측정을 시작하세요. 먼저 "0. 파일 확인"으로 모델이 기기에 있는지 확인합니다.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', paddingTop: 12, paddingHorizontal: 16 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  btn: { backgroundColor: '#1f6feb', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  btnActive: { backgroundColor: '#d97706' },
  btnDim: { opacity: 0.4 },
  btnClear: { backgroundColor: '#6b7280' },
  btnAll: { backgroundColor: '#16a34a' },
  btnSave: { backgroundColor: '#7c3aed' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  log: { flex: 1, backgroundColor: '#0d1117', borderRadius: 8, padding: 12, marginBottom: 24 },
  logText: { color: '#e6edf3', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
