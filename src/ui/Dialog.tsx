import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View, type AlertButton } from 'react-native';
import { C, font, isIOS } from './theme';

// 앱 전체 팝업. Alert.alert와 같은 모양으로 부른다: showAlert(제목, 내용, 버튼들)
// iOS는 시스템 알림이 이미 둥근 유리 모양이라 그대로 쓰고,
// Android 기본 알림은 각진 Material 상자라 iOS 알림처럼 둥근 카드로 직접 그린다
type Dialog = { title: string; message?: string; buttons: AlertButton[] };

let queue: Dialog[] = [];
let notify: (() => void) | null = null;

export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (isIOS) return Alert.alert(title, message, buttons);
  queue.push({ title, message, buttons: buttons?.length ? buttons : [{ text: '확인' }] });
  notify?.();
}

// 루트 레이아웃에 한 번만 둔다
export function DialogHost() {
  const [cur, setCur] = useState<Dialog | null>(null);

  useEffect(() => {
    notify = () => setCur((c) => c ?? queue.shift() ?? null);
    notify();
    return () => {
      notify = null;
    };
  }, []);

  const press = (b?: AlertButton) => {
    setCur(queue.shift() ?? null); // 다음 팝업이 쌓여 있으면 이어서 보여 준다
    b?.onPress?.();
  };

  if (!cur) return null;
  const cancel = cur.buttons.find((b) => b.style === 'cancel');
  const row = cur.buttons.length <= 2; // 버튼 2개까지는 가로, 3개부터는 세로

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => press(cancel)}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.textBox}>
            <Text style={s.title}>{cur.title}</Text>
            {cur.message ? <Text style={s.message}>{cur.message}</Text> : null}
          </View>
          <View style={[s.buttons, row ? s.row : null]}>
            {cur.buttons.map((b, i) => (
              <Pressable
                key={i}
                onPress={() => press(b)}
                style={({ pressed }) => [s.button, row ? s.rowButton : null, i > 0 && (row ? s.dividerLeft : s.dividerTop), pressed && s.pressed]}
              >
                <Text style={[s.buttonText, b.style === 'cancel' && s.cancelText, b.style === 'destructive' && s.destructiveText]}>{b.text}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center', padding: 40 },
  card: { width: '100%', maxWidth: 300, backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden' },
  textBox: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, alignItems: 'center' },
  title: { ...font.headline, color: C.label, textAlign: 'center' },
  message: { ...font.footnote, color: C.label, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  buttons: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  row: { flexDirection: 'row' },
  button: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  rowButton: { flex: 1 },
  dividerLeft: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.separator },
  dividerTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  pressed: { backgroundColor: C.fill },
  buttonText: { ...font.body, color: C.blue },
  cancelText: { fontWeight: '600' },
  destructiveText: { color: C.red, fontWeight: '600' },
});
