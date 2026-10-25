import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { C, font } from './theme';

// 시스템 스플래시(가운데 SENA 로고, app.json expo-splash-screen)에 이어서 같은 자리의 로고 아래로
// 약어 풀이를 잠깐 보여 준 뒤 사라진다. 로고 크기·위치를 시스템 스플래시(imageWidth 240)와 맞춰 끊김 없이 이어진다.
SplashScreen.preventAutoHideAsync().catch(() => {});

const LOGO = 240;
const WORDS = ['Speak', 'English', 'Naturally', '&', 'Accurately'];
let played = false; // 첫 실행 모델 설치 화면 → 앱 화면으로 바뀌어도 한 번만 보여 준다

export function Splash() {
  const [gone, setGone] = useState(played);
  const line = useRef(new Animated.Value(0)).current;
  const all = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (played) return;
    played = true;
    Animated.sequence([
      Animated.timing(line, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.delay(900),
      Animated.timing(all, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start(() => setGone(true));
  }, []);

  if (gone) return null;
  return (
    <Animated.View style={[s.wrap, { opacity: all }]} onLayout={() => SplashScreen.hideAsync().catch(() => {})}>
      <Image source={require('../../assets/splash-logo.png')} style={s.logo} />
      <Animated.View
        style={[
          s.lineBox,
          {
            opacity: line,
            transform: [
              {
                translateY: line.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={s.line}>
          {WORDS.map((w, i) => (
            <Text key={i}>
              {i ? ' ' : ''}
              {w === '&' ? w : <Text style={s.initial}>{w[0]}</Text>}
              {w === '&' ? '' : w.slice(1)}
            </Text>
          ))}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 100,
  },
  logo: { width: LOGO, height: LOGO },
  // 로고는 화면 정중앙에 두고, 풀이는 로고 글자(높이의 약 16%) 바로 아래에 겹치지 않게 놓는다
  lineBox: {
    position: 'absolute',
    top: '50%',
    marginTop: LOGO * 0.13,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  line: { ...font.subhead, color: C.secondary, letterSpacing: 0.3 },
  initial: { color: C.blue, fontWeight: '700' },
});
