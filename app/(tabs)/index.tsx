import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { checkDevice, ramGb, ramVerdict } from '../../src/models/deviceCheck';
import { LEVELS, levelById } from '../../src/chat/levels';
import { DownloadState, hasLlm, pollLlmDownload } from '../../src/models/llmImport';
import { SCENARIOS } from '../../src/chat/scenarios';
import { getChatLevel, getName, sessionCounts, setChatLevel } from '../../src/store/db';
import { Glass } from '../../src/ui/Glass';
import { Row, Section } from '../../src/ui/List';
import { C, font } from '../../src/ui/theme';

const ICON_COLORS: Record<string, string> = {
  free_talk: C.blue,
  cafe: C.orange,
  airport: C.teal,
  hotel: C.indigo,
  directions: C.green,
  interview: C.purple,
  shopping: C.pink,
};

// 대화 모델(Gemma 3 4B) 사양: 기준은 src/models/deviceCheck.ts 한 곳에서 정한다
const ram = ramGb();
const ramMark = ramVerdict();
const lowRam = ramMark === 'warn';
const unsupported = checkDevice().verdict === 'unsupported';

export default function ChatTab() {
  const [name, setNameState] = useState(getName());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [level, setLevel] = useState(levelById(getChatLevel()));
  const [llm, setLlm] = useState(hasLlm());
  const [dl, setDl] = useState<DownloadState>(() => pollLlmDownload());

  useFocusEffect(
    useCallback(() => {
      setNameState(getName());
      setCounts(sessionCounts());
      setDl(pollLlmDownload());
      setLlm(hasLlm());
    }, []),
  );

  if (!name) return <Redirect href="/onboarding" />;

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.hello}>Hi, {name}! 오늘은 어떤 상황에서 말해볼까요?</Text>
      {llm ? null : (
        // 대화 모델이 아직 없으면(시험 APK는 모델 파일을 따로 받는다) 가져오기 안내를 맨 위에 둔다
        <Pressable onPress={() => router.push('/model-import')}>
          <Glass style={s.banner}>
            <Ionicons name="download" size={22} color={C.blue} />
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>{unsupported && dl.phase !== 'running' && dl.phase !== 'waiting' ? '이 기기는 대화 모델 사양이 부족해요' : dl.phase === 'running' || dl.phase === 'waiting' ? `대화 모델 받는 중 ${Math.floor((dl.got / dl.total) * 100)}%` : '대화 모델 받기'}</Text>
              <Text style={s.bannerBody}>{unsupported && dl.phase !== 'running' && dl.phase !== 'waiting' ? '눌러서 기기 사양을 확인해 보세요. 튜토리얼은 그대로 쓸 수 있어요.' : dl.phase === 'running' || dl.phase === 'waiting' ? '다 받으면 바로 대화할 수 있어요. 그동안 튜토리얼을 해 보세요.' : '대화를 시작하려면 AI 모델(약 2.5GB)을 한 번 받아야 해요.'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.tertiary} />
          </Glass>
        </Pressable>
      )}
      <Text style={s.sectionHeader}>대화 난이도</Text>
      <View style={s.levels}>
        {LEVELS.map((lv) => {
          const on = lv.id === level.id;
          return (
            <Pressable
              key={lv.id}
              style={{ flex: 1 }}
              onPress={() => {
                setLevel(lv);
                setChatLevel(lv.id);
              }}
            >
              <View style={[s.levelPill, on && s.levelPillOn]}>
                <Ionicons name={lv.icon as any} size={18} color={on ? '#fff' : C.blue} />
                <Text style={[s.levelName, on && { color: '#fff' }]}>{lv.name}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Glass style={s.levelCard}>
        <Text style={s.levelShort}>{level.short}</Text>
        <Text style={s.levelDesc}>{level.description}</Text>
      </Glass>

      <Section
        header="상황 고르기"
        footer={lowRam ? `이 기기의 메모리(${ram!.toFixed(1)}GB)에서는 대화 응답이 조금 느릴 수 있어요.` : '대화 상대가 이름을 부르고, 지난 대화 내용을 기억해요.'}
      >
        {SCENARIOS.map((sc) => (
          <Row
            key={sc.id}
            icon={sc.icon as any}
            iconColor={ICON_COLORS[sc.id]}
            title={sc.title}
            subtitle={`${sc.partnerName} · ${sc.subtitle}`}
            value={counts[sc.id] ? `${counts[sc.id]}회` : undefined}
            onPress={() => (llm ? router.push({ pathname: '/chat/[id]', params: { id: sc.id, level: level.id } }) : router.push('/model-import'))}
          />
        ))}
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 40 },
  hello: { ...font.subhead, color: C.secondary, marginHorizontal: 32, marginBottom: 18 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 20, borderRadius: 16, padding: 14 },
  bannerTitle: { ...font.headline, color: C.label },
  bannerBody: { ...font.footnote, color: C.secondary, marginTop: 2, lineHeight: 18 },
  sectionHeader: { ...font.footnote, color: C.secondary, marginHorizontal: 32, marginBottom: 8, textTransform: 'uppercase' },
  levels: { flexDirection: 'row', gap: 8, marginHorizontal: 16 },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  levelPillOn: { backgroundColor: C.blue },
  levelName: { ...font.subhead, fontWeight: '600', color: C.blue },
  levelCard: { marginHorizontal: 16, marginTop: 10, marginBottom: 24, borderRadius: 16, padding: 14 },
  levelShort: { ...font.subhead, fontWeight: '600', color: C.label },
  levelDesc: { ...font.footnote, color: C.secondary, marginTop: 4, lineHeight: 18 },
});
