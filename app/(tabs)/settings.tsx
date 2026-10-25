import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text } from 'react-native';
import { showAlert } from '../../src/ui/Dialog';
import { deleteLlm, DownloadState, hasLlm, pollLlmDownload } from '../../src/models/llmImport';
import { clearHistory, getName, getTtsEnabled, resetAll, setTtsEnabled } from '../../src/store/db';
import { Row, Section } from '../../src/ui/List';
import { C, font } from '../../src/ui/theme';

export default function SettingsTab() {
  const [name, setNameState] = useState(getName());
  const [tts, setTts] = useState(getTtsEnabled());
  const [llm, setLlm] = useState(hasLlm());
  const [dl, setDl] = useState<DownloadState>(() => pollLlmDownload());

  useFocusEffect(
    useCallback(() => {
      setNameState(getName());
      setDl(pollLlmDownload()); // 앱을 닫은 사이 다 받았으면 여기서 마무리된다
      setLlm(hasLlm());
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
      <Section header="프로필" footer="로그인 없이 사용합니다. 모든 기록은 이 기기에만 저장돼요.">
        <Row icon="person" title="영어 이름" value={name ?? ''} onPress={() => router.push('/onboarding')} />
      </Section>

      <Section header="대화" footer="음성 대화에서는 항상 소리로 답해요. 대화 상대마다 어울리는 목소리를 자동으로 골라요.">
        <Row
          icon="volume-high"
          iconColor={C.orange}
          title="문자 대화에서도 목소리로 듣기"
          right={
            <Switch
              value={tts}
              onValueChange={(v) => {
                setTts(v);
                setTtsEnabled(v);
              }}
            />
          }
        />
        <Row
          icon="hardware-chip"
          iconColor={C.indigo}
          title="대화 모델"
          value={llm ? '준비됨 · 2.5GB' : dl.phase === 'running' || dl.phase === 'waiting' ? `받는 중 ${Math.floor((dl.got / dl.total) * 100)}%` : '받기'}
          onPress={() => router.push('/model-import')}
        />
        {llm ? (
          <Row
            icon="trash-bin"
            iconColor={C.secondary}
            title="대화 모델 지우기"
            subtitle="휴대폰 공간 2.5GB 확보 · 튜토리얼은 계속 쓸 수 있어요"
            onPress={() =>
              showAlert('대화 모델을 지울까요?', '휴대폰 공간이 2.5GB 늘어나요. 자유 대화를 다시 하려면 모델을 다시 받아야 해요. 대화 기록과 리포트는 그대로 남아요.', [
                { text: '취소', style: 'cancel' },
                {
                  text: '지우기',
                  style: 'destructive',
                  onPress: () => {
                    deleteLlm();
                    setLlm(hasLlm());
                    setDl(pollLlmDownload());
                  },
                },
              ])
            }
          />
        ) : null}
      </Section>

      <Section>
        <Row
          icon="trash"
          iconColor={C.red}
          title="대화 기록 모두 지우기"
          onPress={() =>
            showAlert('대화 기록을 지울까요?', '대화 상대가 기억하던 내용도 함께 지워집니다.', [
              { text: '취소', style: 'cancel' },
              { text: '지우기', style: 'destructive', onPress: () => clearHistory() },
            ])
          }
        />
      </Section>

      {/* 로그아웃: 로그인이 없으므로 이 기기의 이름·기록을 모두 지우고 새 이름으로 처음부터 시작한다 */}
      <Pressable
        onPress={() =>
          showAlert('로그아웃할까요?', '이름과 모든 대화·연습 기록이 이 기기에서 지워지고, 새 이름으로 처음부터 시작해요. 되돌릴 수 없어요.', [
            { text: '취소', style: 'cancel' },
            {
              text: '로그아웃',
              style: 'destructive',
              onPress: () => {
                resetAll();
                router.replace('/onboarding');
              },
            },
          ])
        }
        style={({ pressed }) => [s.logout, pressed && { opacity: 0.5 }]}
      >
        <Text style={s.logoutText}>로그아웃</Text>
      </Pressable>

      {/* 버전 표시를 길게(1.5초) 누르면 연구용 기술 검증 화면이 열린다. 일반 사용자에게는 보이지 않는다 */}
      <Pressable onLongPress={() => router.push('/dev')} delayLongPress={1500}>
        <Text style={s.version}>SENA {Constants.expoConfig?.version ?? ''}</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  logout: { alignSelf: 'center', marginTop: 24, paddingVertical: 10, paddingHorizontal: 24 },
  logoutText: { ...font.body, color: C.red, fontWeight: '600' },
  version: { ...font.footnote, color: C.tertiary, textAlign: 'center', paddingVertical: 8 },
});
