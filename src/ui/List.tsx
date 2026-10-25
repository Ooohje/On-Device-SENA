import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, font } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

// iOS 설정 앱 스타일의 inset grouped 목록
export function Section({ header, footer, children }: { header?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={s.section}>
      {header ? <Text style={s.header}>{header}</Text> : null}
      <View style={s.group}>
        {rows.map((row, i) => (
          <View key={i}>
            {row}
            {i < rows.length - 1 ? <View style={s.separator} /> : null}
          </View>
        ))}
      </View>
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  icon,
  iconColor = C.blue,
  title,
  subtitle,
  value,
  onPress,
  right,
  disabled,
  chevron = !!onPress,
}: {
  icon?: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  disabled?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled || !onPress} style={({ pressed }) => [s.row, pressed && s.pressed, disabled && s.disabled]}>
      {icon ? (
        <View style={[s.iconBox, { backgroundColor: iconColor }]}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
      ) : null}
      <View style={s.texts}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={s.value}>{value}</Text> : null}
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={C.tertiary} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 28 },
  header: { ...font.footnote, color: C.secondary, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 },
  footer: { ...font.footnote, color: C.secondary, marginHorizontal: 16, marginTop: 6 },
  group: { backgroundColor: C.cell, borderRadius: 12, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: C.separator, marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  pressed: { backgroundColor: '#E5E5EA' },
  disabled: { opacity: 0.45 },
  iconBox: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1 },
  title: { ...font.body, color: C.label },
  subtitle: { ...font.footnote, color: C.secondary, marginTop: 2 },
  value: { ...font.body, color: C.secondary },
});
