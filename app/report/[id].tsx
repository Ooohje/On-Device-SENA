import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../../src/ui/Dialog';
import { captureRef } from 'react-native-view-shot';
import { ConversationReport } from '../../src/chat/report';
import { scenarioById } from '../../src/chat/scenarios';
import { getReport, sessionMessages } from '../../src/store/db';
import { Glass } from '../../src/ui/Glass';
import { Row, Section } from '../../src/ui/List';
import { C, font } from '../../src/ui/theme';

// 말 속도 해석 기준: 원어민 일상 대화는 대략 분당 120~160단어
const paceLabel = (wpm: number) => (wpm >= 120 ? '원어민 대화에 가까운 속도예요' : wpm >= 90 ? '자연스러운 속도예요' : wpm >= 60 ? '조금 천천히 말했어요' : '많이 천천히 말했어요. 짧은 문장부터 이어서 말해보세요');

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sheet = useRef<any>(null); // 이미지로 저장할 영역(버튼 제외)
  const [saving, setSaving] = useState(false);

  // 리포트를 PNG로 캡처해 갤러리(사진 앱)에 저장한다. 저장 전용 권한만 요청한다(사진 읽기 권한 없음)
  const saveImage = async () => {
    if (saving || !sheet.current) return;
    setSaving(true);
    try {
      const perm = await requestPermissionsAsync(true);
      if (!perm.granted) {
        showAlert('사진 저장 권한이 필요해요', '설정에서 SENA의 사진 저장을 허용해 주세요.');
        return;
      }
      const uri = await captureRef(sheet, { format: 'png', quality: 1, result: 'tmpfile' });
      await Asset.create(uri);
      showAlert('저장했어요', '리포트 이미지를 갤러리(사진 앱)에 저장했어요.');
    } catch (e: any) {
      showAlert('저장하지 못했어요', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };
  const data = useMemo(() => getReport<ConversationReport>(Number(id)), [id]);
  const transcript = useMemo(() => sessionMessages(Number(id)), [id]);
  if (!data) return null;
  const sc = scenarioById(data.scenarioId);
  const r = data.report;
  const date = new Date(data.startedAt);

  return (
    <>
      <Stack.Screen
        options={{
          title: '대화 리포트',
          headerRight: () => (
            <Pressable onPress={saveImage} hitSlop={10} disabled={saving} style={s.saveBtn}>
              {saving ? <ActivityIndicator /> : <Ionicons name="download-outline" size={24} color={C.blue} />}
            </Pressable>
          ),
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.content}>
        {/* collapsable={false}: 안드로이드가 이 View를 최적화로 없애면 캡처할 수 없다 */}
        <View ref={sheet} collapsable={false} style={s.sheet}>
        <Glass style={s.hero}>
          <Text style={s.heroDate}>
            {date.getMonth() + 1}월 {date.getDate()}일 · {sc?.partnerName}
          </Text>
          <Text style={s.heroTitle}>{r ? `${r.turns}번 말했어요` : '대화를 마쳤어요'}</Text>
          {data.recap ? <Text style={s.recap}>{data.recap}</Text> : null}
          <Text style={s.recapNote}>대화 상대가 다음 대화에서 기억할 내용이에요.</Text>
        </Glass>

        {r ? (
          <>
            <Section header="말하기">
              <Row icon="chatbubble-ellipses" title="평균 문장 길이" value={`${r.avgWords.toFixed(1)}단어`} />
              {r.wpm !== null ? <Row icon="speedometer" iconColor={C.green} title="말 속도" subtitle={paceLabel(r.wpm)} value={`${Math.round(r.wpm)} 단어/분`} /> : null}
              {r.voiceTurns ? <Row icon="pause" iconColor={C.orange} title="0.6초 넘게 멈춘 횟수" subtitle={`음성으로 말한 ${r.voiceTurns}번 기준`} value={`${r.longPauses}회`} /> : null}
            </Section>
            {!r.voiceTurns ? <Text style={s.tipText}>마이크로 말하면 말 속도와 멈춤 횟수도 알려드려요.</Text> : null}

            <Text style={s.sectionHeader}>문법·표현 교정</Text>
            {r.corrections.length ? (
              r.corrections.map((c, i) => (
                <Glass key={i} style={s.fix}>
                  <Text style={s.original}>{c.original}</Text>
                  <View style={s.arrowRow}>
                    <Ionicons name="arrow-down" size={14} color={C.secondary} />
                  </View>
                  <Text style={s.corrected}>{c.corrected}</Text>
                </Glass>
              ))
            ) : (
              <Text style={s.tipInline}>고칠 표현을 찾지 못했어요. 잘했어요!</Text>
            )}
            {r.corrections.length ? <Text style={s.note}>온디바이스 AI가 제안한 표현이라 가끔 틀릴 수 있어요.</Text> : null}

            {r.assisted?.length ? (
              <>
                <Text style={[s.sectionHeader, { marginTop: 16 }]}>한국어로 도움받은 표현</Text>
                {r.assisted.map((x, i) => (
                  <Glass key={i} style={s.fix}>
                    <Text style={s.koText}>{x.ko}</Text>
                    <View style={s.arrowRow}>
                      <Ionicons name="arrow-down" size={14} color={C.secondary} />
                    </View>
                    <Text style={s.corrected}>{x.en}</Text>
                    <Text style={[s.assistScore, !x.passed && { color: C.secondary }]}>
                      {x.passed
                        ? x.articulation !== undefined
                          ? `따라 말하기 성공 · 발음 ${x.articulation.toFixed(1)} · 운율 ${x.prosody!.toFixed(1)}`
                          : '따라 말하기 성공'
                        : '따라 말하기 건너뜀'}
                    </Text>
                  </Glass>
                ))}
                <Text style={[s.note, { marginBottom: 20 }]}>다음에는 한국어 없이 바로 말해 보세요. 아래 연습하기에도 넣어 두었어요.</Text>
              </>
            ) : null}

          </>
        ) : null}

        {transcript.length ? (
          <>
            <Text style={s.sectionHeader}>대화 내역</Text>
            <View style={s.transcript}>
              {transcript.map((m, i) => {
                const mine = m.role === 'user';
                const fixes = mine && r ? r.corrections.filter((c) => m.content.includes(c.original.replace(/[.!?]$/, ''))) : [];
                return (
                  <View key={i} style={[s.tRow, mine && { alignItems: 'flex-end' }]}>
                    <Text style={s.tWho}>{mine ? '나' : sc?.partnerName}</Text>
                    <View style={[s.tBubble, mine ? s.tMine : s.tTheirs]}>
                      <Text style={[s.tText, mine && { color: '#fff' }]}>{m.content}</Text>
                    </View>
                    {fixes.map((f, k) => (
                      <Text key={k} style={s.tFix}>
                        → {f.corrected}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
          <Text style={s.brand}>SENA · 온디바이스 영어 말하기 리포트</Text>
        </View>

        <Pressable onPress={saveImage} disabled={saving} style={s.secondary}>
          <Ionicons name="download-outline" size={18} color={C.blue} />
          <Text style={s.secondaryText}>{saving ? '저장하는 중…' : '리포트를 이미지로 저장'}</Text>
        </Pressable>
        {r?.practice.length ? (
          <Pressable onPress={() => router.push({ pathname: '/tutorial/[unit]', params: { unit: 'mine' } })} style={s.primary}>
            <Ionicons name="mic" size={18} color="#fff" />
            <Text style={s.primaryText}>이 문장들 발음 연습하기 ({r.practice.length})</Text>
          </Pressable>
        ) : null}

        <Section>
          {sc ? <Row icon="refresh" title="같은 상황으로 다시 대화하기" onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: sc.id } })} /> : null}
          <Row icon="home" iconColor="#8E8E93" title="홈으로" onPress={() => router.dismissAll()} />
        </Section>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  sheet: { backgroundColor: C.groupedBg, paddingBottom: 8 }, // 캡처 이미지의 배경
  brand: { ...font.caption, color: C.secondary, textAlign: 'center', marginBottom: 8 },
  saveBtn: { paddingHorizontal: 8 },
  secondary: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  secondaryText: { ...font.headline, color: C.blue },
  hero: { borderRadius: 24, padding: 20, marginBottom: 24 },
  heroDate: { ...font.footnote, color: C.secondary },
  heroTitle: { ...font.title2, color: C.label, marginTop: 4 },
  recap: { ...font.body, color: C.label, marginTop: 12, lineHeight: 23 },
  recapNote: { ...font.caption, color: C.secondary, marginTop: 8 },
  sectionHeader: { ...font.footnote, color: C.secondary, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 },
  fix: { borderRadius: 16, padding: 14, marginBottom: 8 },
  original: { ...font.subhead, color: C.secondary, textDecorationLine: 'line-through' },
  arrowRow: { marginVertical: 4 },
  corrected: { ...font.body, color: C.blue, fontWeight: '600' },
  note: { ...font.caption, color: C.secondary, marginLeft: 16, marginTop: 2 },
  tipInline: { ...font.footnote, color: C.secondary, marginHorizontal: 16, marginBottom: 24 },
  koText: { ...font.subhead, color: C.secondary },
  tipText: { ...font.footnote, color: C.secondary, marginHorizontal: 16, marginTop: -20, marginBottom: 24 },
  primary: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: C.blue, borderRadius: 14, paddingVertical: 14, marginTop: 12, marginBottom: 28 },
  primaryText: { ...font.headline, color: '#fff' },
  assistScore: { ...font.footnote, color: C.green, marginTop: 8, fontWeight: '600' },
  transcript: { backgroundColor: C.cell, borderRadius: 16, padding: 12, marginBottom: 28 },
  tRow: { marginVertical: 5, alignItems: 'flex-start' },
  tWho: { ...font.caption, color: C.secondary, marginBottom: 2, marginHorizontal: 6 },
  tBubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  tMine: { backgroundColor: C.blue, borderBottomRightRadius: 5 },
  tTheirs: { backgroundColor: C.bubbleIn, borderBottomLeftRadius: 5 },
  tText: { ...font.subhead, color: C.label, lineHeight: 21 },
  tFix: { ...font.footnote, color: C.green, fontWeight: '600', marginTop: 3, marginHorizontal: 6, maxWidth: '85%', textAlign: 'right' },
});
