import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { dailySentence } from '../tutorial/content';

// 홈 화면 위젯 '오늘의 한 문장': 날마다 바뀌는 튜토리얼 문장 하나. 누르면 그 문장 발음 연습 화면이 열린다(sena://tutorial/daily).
// 위젯은 앱 밖(런처)에서 그려지므로 앱 화면 부품이 아니라 react-native-android-widget의 부품으로 만든다
export function DailyWidget({ date = new Date() }: { date?: Date }) {
  const s = dailySentence(date);
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'sena://tutorial/daily' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <TextWidget text="SENA · 오늘의 한 문장" style={{ fontSize: 12, color: '#007AFF', fontWeight: '700' }} />
        <TextWidget text={s.en} maxLines={2} truncate="END" style={{ fontSize: 17, color: '#000000', fontWeight: '600', marginTop: 8 }} />
        <TextWidget text={s.ko} maxLines={1} truncate="END" style={{ fontSize: 13, color: '#6E6E73', marginTop: 4 }} />
      </FlexWidget>
      <FlexWidget style={{ backgroundColor: '#007AFF', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginTop: 10 }}>
        <TextWidget text="🎤 발음해 보기" style={{ fontSize: 13, color: '#FFFFFF', fontWeight: '600' }} />
      </FlexWidget>
    </FlexWidget>
  );
}
