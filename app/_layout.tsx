import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { DialogHost } from '../src/ui/Dialog';
import { Splash } from '../src/ui/Splash';
import { installBundledModels, needsInstall } from '../src/models/installer';
import { C, font, isIOS } from '../src/ui/theme';

export default function RootLayout() {
  // 테스트 APK는 첫 실행 때 APK 안의 모델(약 1GB)을 앱 저장소로 한 번 복사한다
  const [install, setInstall] = useState<{
    done: number;
    total: number;
  } | null>(() => (needsInstall() ? { done: 0, total: 1 } : null));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!install) return;
    installBundledModels((done, total) => setInstall({ done, total }))
      .then(() => setInstall(null))
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  // 스플래시는 두 화면(모델 설치·앱) 바깥 같은 자리에 둔다. 설치가 금방 끝나 화면이 바뀌어도 스플래시가 끊기지 않게
  const body = install ? (
    <View style={s.install}>
      <StatusBar style="dark" />
      <Text style={s.title}>SENA 준비 중</Text>
      <Text style={s.body}>처음 한 번만 AI 모델을 설치해요.{'\n'}1분 정도 걸릴 수 있어요.</Text>
      {error ? (
        <Text style={[s.body, { color: C.red }]}>{error}</Text>
      ) : (
        <>
          <ActivityIndicator style={{ marginTop: 24 }} />
          <Text style={s.progress}>
            {Math.min(install.done + 1, install.total)} / {install.total}
          </Text>
        </>
      )}
    </View>
  ) : (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerBackTitle: '뒤로',
          headerTintColor: C.blue,
          headerTitleStyle: { color: C.label }, // Android에서 제목까지 파란색이 되지 않게
          headerShadowVisible: false,
          // iOS: 스크롤하면 접히는 큰 제목 + 반투명 블러 헤더 (iOS 26에서는 Liquid Glass로 그려짐)
          headerLargeTitleEnabled: isIOS,
          headerTransparent: isIOS,
          headerBlurEffect: isIOS ? 'systemChromeMaterial' : undefined,
          headerStyle: isIOS ? undefined : { backgroundColor: C.groupedBg },
          contentStyle: { backgroundColor: C.groupedBg },
        }}
      >
        {/* 아래 탭(대화·튜토리얼·리포트·설정). 각 탭이 자기 헤더를 그린다 */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: '홈' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerLargeTitleEnabled: false,
            contentStyle: { backgroundColor: '#FFFFFF' },
          }}
        />
        <Stack.Screen name="learn/[level]" options={{ headerLargeTitleEnabled: false }} />
        <Stack.Screen name="tutorial/[unit]" options={{ headerLargeTitleEnabled: false }} />
        <Stack.Screen name="report/[id]" options={{ title: '대화 리포트', headerLargeTitleEnabled: false }} />
        <Stack.Screen name="model-import" options={{ title: '대화 모델', headerLargeTitleEnabled: false }} />
        <Stack.Screen
          name="dev"
          options={{
            title: '기술 검증',
            headerLargeTitleEnabled: false,
            headerTransparent: false,
          }}
        />
      </Stack>
      <DialogHost />
    </>
  );

  return (
    <>
      {body}
      <Splash />
    </>
  );
}

const s = StyleSheet.create({
  install: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.groupedBg,
    padding: 32,
  },
  title: { ...font.title2, color: C.label },
  body: {
    ...font.subhead,
    color: C.secondary,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  progress: { ...font.footnote, color: C.secondary, marginTop: 8 },
});
