import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { bestScores, BestScore } from '../../src/store/db';
import { LEVEL_INFO, unitsOfLevel } from '../../src/tutorial/content';
import { Row, Section } from '../../src/ui/List';
import { C, font } from '../../src/ui/theme';

const LEVEL_COLORS = [C.green, C.blue, C.purple];

// 레벨 안의 단원 목록
export default function LevelUnits() {
  const { level } = useLocalSearchParams<{ level: string }>();
  const lv = Number(level);
  const info = LEVEL_INFO.find((x) => x.level === lv);
  const [best, setBest] = useState<Record<string, BestScore>>({});
  useFocusEffect(useCallback(() => setBest(bestScores()), []));

  return (
    <>
      <Stack.Screen options={{ title: info ? `레벨 ${lv} · ${info.name}` : '튜토리얼' }} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
        {info ? <Text style={s.desc}>{info.description}</Text> : null}
        <Section header="단원">
          {unitsOfLevel(lv).map((u) => {
            const done = u.sentences.filter((x) => best[x.id]).map((x) => best[x.id]);
            const avg = done.length ? done.reduce((a, b) => a + (b.articulation + b.prosody) / 2, 0) / done.length : null;
            return (
              <Row
                key={u.id}
                icon={u.icon as any}
                iconColor={LEVEL_COLORS[(lv - 1) % LEVEL_COLORS.length]}
                title={u.title}
                subtitle={avg !== null ? `${done.length}/${u.sentences.length} 문장 · 평균 ${avg.toFixed(1)}점` : `${u.subtitle} · ${u.sentences.length}문장`}
                value={done.length === u.sentences.length ? '완료' : undefined}
                onPress={() => router.push({ pathname: '/tutorial/[unit]', params: { unit: u.id } })}
              />
            );
          })}
        </Section>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  desc: { ...font.subhead, color: C.secondary, marginHorizontal: 32, marginBottom: 16, lineHeight: 21 },
});
