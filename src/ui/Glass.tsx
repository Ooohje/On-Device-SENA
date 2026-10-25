import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { isIOS } from './theme';

const liquid = isIOS && isLiquidGlassAvailable();

// iOS 26+: 네이티브 Liquid Glass / 그 이전 iOS: 블러 / Android: 반투명 흰 배경 (Android에는 Liquid Glass가 없음)
export function Glass({ style, children, interactive }: { style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean }) {
  if (liquid)
    return (
      <GlassView style={style} glassEffectStyle="regular" isInteractive={interactive}>
        {children}
      </GlassView>
    );
  if (isIOS)
    return (
      <BlurView intensity={70} tint="systemChromeMaterialLight" style={[style, s.clip]}>
        {children}
      </BlurView>
    );
  return <View style={[style, s.android]}>{children}</View>;
}

const s = StyleSheet.create({
  clip: { overflow: 'hidden' },
  android: {
    // 반투명 배경에 elevation 그림자를 주면 그림자가 비쳐 카드 가장자리가 회색 띠로 보인다 → 불투명 흰색 + 옅은 테두리
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.10)',
  },
});
