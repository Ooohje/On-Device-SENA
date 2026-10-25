import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cancelLlmDownload, DownloadState, LLM_BYTES, pollLlmDownload, startLlmDownload } from '../src/models/llmImport';
import { Glass } from '../src/ui/Glass';
import { showAlert } from '../src/ui/Dialog';
import { C, font } from '../src/ui/theme';

const gb = (n: number) => (n / 1e9).toFixed(2);

// 대화 모델 받기: 버튼 한 번이면 휴대폰 다운로드 관리자가 받는다(src/models/llmImport.ts).
// 앱을 닫거나 튜토리얼을 하는 동안에도 계속 받고, 상단바를 내리면 진행률이 보인다. 이 화면은 1초마다 상태를 읽어 보여 줄 뿐이다
export default function ModelImport() {
  const first = useLocalSearchParams<{ first?: string }>().first === '1'; // 이름 입력 직후 한 번 열리는 경우
  const goHome = () => router.replace('/');
  const [st, setSt] = useState<DownloadState>(() => pollLlmDownload());
  const announced = useRef(st.phase === 'done'); // 이 화면에서 끝난 경우에만 알림을 띄운다

  const busy = st.phase === 'running' || st.phase === 'waiting';
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      const next = pollLlmDownload();
      setSt(next);
      if (next.phase === 'done' && !announced.current) {
        announced.current = true;
        showAlert('대화 모델을 받았어요', '이제 자유 대화를 할 수 있어요.', [{ text: '확인', onPress: first ? goHome : undefined }]);
      }
      if (next.phase === 'failed') showAlert('받지 못했어요', next.error ?? '');
    }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  const start = async () => {
    try {
      await startLlmDownload();
      setSt(pollLlmDownload());
    } catch (e: any) {
      showAlert('받기를 시작하지 못했어요', e?.message ?? String(e));
    }
  };

  const cancel = () =>
    showAlert('받기를 취소할까요?', '지금까지 받은 부분도 지워져요.', [
      { text: '계속 받기', style: 'cancel' },
      {
        text: '취소하기',
        style: 'destructive',
        onPress: () => {
          cancelLlmDownload();
          setSt(pollLlmDownload());
        },
      },
    ]);

  const done = st.phase === 'done';
  const pct = Math.min(100, Math.floor((st.got / (st.total || LLM_BYTES)) * 100));

  return (
    <ScrollView contentContainerStyle={s.content}>
      {/* 처음 한 번 열릴 때는 이름 입력으로 되돌아가지 않게 뒤로 가기를 숨긴다 */}
      {first ? <Stack.Screen options={{ headerBackVisible: false, gestureEnabled: false, title: '대화 모델 준비' }} /> : null}
      <Glass style={s.card}>
        <View style={[s.icon, { backgroundColor: done ? C.green : C.blue }]}>
          <Ionicons name={done ? 'checkmark' : 'cloud-download'} size={28} color="#fff" />
        </View>
        <Text style={s.title}>{done ? '대화 모델이 준비됐어요' : busy ? '대화 모델을 받고 있어요' : '대화 모델을 받아 주세요'}</Text>
        <Text style={s.body}>
          {done
            ? '자유 대화와 상황 대화를 할 수 있어요. 모델은 이 기기 안에서만 동작해요.'
            : busy
              ? '앱을 닫거나 튜토리얼을 하는 동안에도 계속 받아요. 상단바를 내리면 진행 상황을 볼 수 있어요.'
              : `자유 대화에는 휴대폰 안에서 동작하는 AI 모델(${gb(LLM_BYTES)}GB)이 필요해요. 처음 한 번만 받으면 그다음부터는 인터넷 없이 써요. Wi-Fi에서 받는 것을 권해요.`}
        </Text>
        {busy ? (
          <View style={s.progressBox}>
            <View style={s.bar}>
              <View style={[s.fill, { width: `${pct}%` }]} />
            </View>
            <Text style={s.progressText}>
              {gb(st.got)} / {gb(st.total)}GB ({pct}%)
            </Text>
            {st.note ? <Text style={[s.progressText, st.phase === 'waiting' && { color: C.orange }]}>{st.note}</Text> : null}
          </View>
        ) : null}
      </Glass>

      {done ? (
        <Pressable onPress={() => (first || !router.canGoBack() ? goHome() : router.back())} style={s.primary}>
          <Text style={s.primaryText}>대화하러 가기</Text>
        </Pressable>
      ) : busy ? (
        <>
          {first ? (
            <Pressable onPress={goHome} style={s.primary}>
              <Text style={s.primaryText}>받는 동안 튜토리얼 하기</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={cancel} style={[s.primary, s.secondary]}>
            <Text style={[s.primaryText, { color: C.red }]}>받기 취소</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={start} style={s.primary}>
          <Ionicons name="cloud-download" size={18} color="#fff" />
          <Text style={s.primaryText}>{st.phase === 'failed' ? '다시 받기' : '대화 모델 받기'}</Text>
        </Pressable>
      )}
      {first && !busy && !done ? (
        // 지금 받기 어려우면 튜토리얼부터 쓸 수 있게 한다. 나중에 대화 탭이나 설정에서 받을 수 있다
        <Pressable onPress={goHome} style={s.later}>
          <Text style={s.laterText}>나중에 하기 (튜토리얼만 쓰기)</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  card: { borderRadius: 24, padding: 24, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { ...font.title2, color: C.label, textAlign: 'center' },
  body: { ...font.subhead, color: C.secondary, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  progressBox: { alignSelf: 'stretch', marginTop: 18 },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.fill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.blue },
  progressText: { ...font.footnote, color: C.secondary, textAlign: 'center', marginTop: 8 },
  primary: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: C.blue, borderRadius: 14, paddingVertical: 15, marginTop: 20 },
  secondary: { backgroundColor: C.fill, marginTop: 12 },
  primaryText: { ...font.headline, color: '#fff' },
  later: { alignSelf: 'center', marginTop: 14, padding: 10 },
  laterText: { ...font.subhead, color: C.blue },
});
