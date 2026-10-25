import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, View } from 'react-native';
import { hasLlm } from '../src/models/llmImport';
import { getName, normalizeEnglishName, setName } from '../src/store/db';
import { Glass } from '../src/ui/Glass';
import { C, font } from '../src/ui/theme';

// 첫 실행: 영어 이름만 받는다 (로그인 없음). 이름은 기기에만 저장되고 대화 상대가 이 이름으로 부른다.
export default function Onboarding() {
  const editing = !!getName();
  const [value, setValue] = useState(getName() ?? '');
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  // 키보드가 올라오면 입력창과 버튼이 보이도록 아래로 스크롤한다
  const reveal = () => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', reveal);
    return () => sub.remove();
  }, []);

  const submit = () => {
    const r = normalizeEnglishName(value);
    if (!r.ok) return setError(r.reason);
    setName(r.name);
    if (editing) router.back();
    // 처음 시작할 때 대화 모델이 없으면(시험 APK) 바로 가져오기 화면으로 간다. 가져오면 대화 탭으로 넘어간다
    else if (!hasLlm()) router.replace({ pathname: '/model-import', params: { first: '1' } });
    else router.replace('/');
  };

  return (
    // Android도 edge-to-edge라 키보드가 창 크기를 줄여주지 않는다 → 두 플랫폼 모두 padding으로 피한다
    <KeyboardAvoidingView style={s.root} behavior="padding">
      {/* 유리 효과가 보이도록 뒤에 색 번짐을 깐다 */}
      <View style={[s.blob, { backgroundColor: '#8EC5FF', top: -60, left: -80 }]} />
      <View style={[s.blob, { backgroundColor: '#C7B8FF', top: 140, right: -110 }]} />
      <View style={[s.blob, { backgroundColor: '#A6F0D8', bottom: -40, left: -40 }]} />

      <ScrollView
        ref={scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.hello}>{editing ? '이름 바꾸기' : 'Welcome to SENA'}</Text>
        <Text style={s.lead}>{editing ? '대화 상대가 부를 영어 이름을 입력하세요.' : '영어로 대화할 때 쓸\n영어 이름을 알려주세요.'}</Text>

        <Glass style={s.card}>
          <Text style={s.label}>English name</Text>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t);
              setError(null);
            }}
            placeholder="예: Jason, Minji"
            placeholderTextColor={C.tertiary}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus={editing} // 처음 실행 때는 스플래시 직후 키보드가 튀어나오지 않게, 입력란을 눌러야 뜬다
            maxLength={20}
            returnKeyType="done"
            onSubmitEditing={submit}
            onFocus={reveal}
            style={s.input}
          />
          <Text style={[s.help, error && s.error]}>{error ?? '로그인 없이 시작해요. 이름은 이 기기에만 저장됩니다.'}</Text>
        </Glass>

        <Pressable onPress={submit} style={({ pressed }) => [s.button, pressed && { opacity: 0.85 }]}>
          <Text style={s.buttonText}>{editing ? '저장' : '시작하기'}</Text>
        </Pressable>
        {editing ? (
          <Pressable onPress={() => router.back()} style={s.cancel}>
            <Text style={s.cancelText}>취소</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FC', overflow: 'hidden' },
  blob: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.55 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  hello: { ...font.largeTitle, color: C.label },
  lead: { ...font.title2, fontWeight: '400', color: C.secondary, marginTop: 8, marginBottom: 32, lineHeight: 30 },
  card: { borderRadius: 24, padding: 20 },
  label: { ...font.footnote, color: C.secondary, marginBottom: 6, textTransform: 'uppercase' },
  input: { ...font.title2, fontWeight: '600', color: C.label, paddingVertical: 8 },
  help: { ...font.footnote, color: C.secondary, marginTop: 8 },
  error: { color: C.red },
  button: { marginTop: 24, backgroundColor: C.blue, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buttonText: { ...font.headline, color: '#fff' },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { ...font.body, color: C.blue },
});
