import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { C } from '../../src/ui/theme';

// 아래 탭: 상황별 대화 / 튜토리얼 / 리포트 / 설정
const icon =
  (name: string) =>
  ({ color, focused }: { color: any; focused: boolean }) => <Ionicons name={(focused ? name : `${name}-outline`) as any} size={24} color={color} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.blue,
        tabBarInactiveTintColor: '#8E8E93',
        headerStyle: { backgroundColor: C.groupedBg },
        headerTitleStyle: { color: C.label, fontWeight: '700' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: C.groupedBg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '대화', tabBarLabel: '대화', tabBarIcon: icon('chatbubbles') }} />
      <Tabs.Screen name="learn" options={{ title: '튜토리얼', tabBarIcon: icon('mic') }} />
      <Tabs.Screen name="reports" options={{ title: '리포트', tabBarIcon: icon('document-text') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
