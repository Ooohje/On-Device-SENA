import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { bestScores, BestScore, practiceSentences } from '../../src/store/db';
import { LEVEL_INFO, unitsOfLevel } from '../../src/tutorial/content';
import { Row, Section } from '../../src/ui/List';
import { C } from '../../src/ui/theme';

const LEVEL_COLORS = [C.green, C.blue, C.purple];

// 튜토리얼 첫 화면: 레벨만 보여 주고, 레벨을 고르면 그 레벨의 단원 목록으로 들어간다
export default function LearnTab() {
  const [best, setBest] = useState<Record<string, BestScore>>({});
  const [mine, setMine] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setBest(bestScores());
      setMine(practiceSentences().length);
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
      <Section header="레벨 고르기" footer="한 문장씩 말하고 발음·운율 점수와 음성 분석을 받아요.">
        {LEVEL_INFO.map((lv) => {
          const units = unitsOfLevel(lv.level);
          const sentences = units.flatMap((u) => u.sentences);
          const done = sentences.filter((x) => best[x.id]).length;
          return (
            <Row
              key={lv.level}
              icon={lv.icon as any}
              iconColor={LEVEL_COLORS[(lv.level - 1) % LEVEL_COLORS.length]}
              title={`레벨 ${lv.level} · ${lv.name}`}
              subtitle={`${units.length}개 단원 · ${sentences.length}문장${done ? ` · ${done}문장 연습함` : ''}`}
              onPress={() => router.push({ pathname: '/learn/[level]', params: { level: String(lv.level) } })}
            />
          );
        })}
      </Section>

      {mine ? (
        <Section header="내 문장" footer="자유 대화에서 말한 문장을 자연스럽게 다듬은 거예요.">
          <Row icon="sparkles" iconColor={C.orange} title="대화에서 가져온 문장" value={`${mine}개`} onPress={() => router.push({ pathname: '/tutorial/[unit]', params: { unit: 'mine' } })} />
        </Section>
      ) : null}
    </ScrollView>
  );
}
