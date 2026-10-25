import { Platform } from 'react-native';

// iOS 시스템 색상 (라이트 모드). Android에서도 같은 색을 써서 iOS 기본 앱 느낌을 맞춘다.
export const C = {
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
  teal: '#30B0C7',
  indigo: '#5856D6',
  pink: '#FF2D55',
  label: '#000000',
  secondary: 'rgba(60,60,67,0.6)',
  tertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.29)',
  groupedBg: '#F2F2F7',
  cell: '#FFFFFF',
  fill: 'rgba(120,120,128,0.12)',
  bubbleIn: '#E9E9EB',
};

export const font = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.4 },
  title2: { fontSize: 22, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17 },
  subhead: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
};

export const isIOS = Platform.OS === 'ios';
