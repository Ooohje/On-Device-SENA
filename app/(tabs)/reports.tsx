import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { scenarioById } from '../../src/chat/scenarios';
import { recentReports } from '../../src/store/db';
import { Row, Section } from '../../src/ui/List';
import { C, font } from '../../src/ui/theme';

// 지난 대화 리포트 목록 (누르면 리포트 화면)
export default function ReportsTab() {
  const [reports, setReports] = useState<ReturnType<typeof recentReports>>([]);
  useFocusEffect(useCallback(() => setReports(recentReports(100)), []));

  if (!reports.length)
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>아직 리포트가 없어요</Text>
        <Text style={s.emptyText}>대화 탭에서 대화를 마치면{'\n'}문법 교정과 대화 내역이 여기에 모여요.</Text>
      </View>
    );

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
      <Section header="지난 대화" footer="리포트는 이 기기에만 저장돼요.">
        {reports.map((r) => {
          const sc = scenarioById(r.scenario_id);
          const d = new Date(r.ended_at);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          return (
            <Row
              key={r.id}
              icon={(sc?.icon as any) ?? 'document-text'}
              iconColor={C.teal}
              title={sc?.title ?? r.scenario_id}
              subtitle={`${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm} · ${r.user_turns}번 말함`}
              onPress={() => router.push({ pathname: '/report/[id]', params: { id: String(r.id) } })}
            />
          );
        })}
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { ...font.headline, color: C.label },
  emptyText: { ...font.subhead, color: C.secondary, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
