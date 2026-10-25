import Ionicons from '@expo/vector-icons/Ionicons';
import * as Speech from '../../src/tts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { showAlert } from '../../src/ui/Dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { peakNormalize } from '../../src/audio/preprocess';
import { KoreanListener, KoreanSttFailed, koreanSttAvailable, requestKoreanPack } from '../../src/audio/koreanStt';
import { PcmRecorder } from '../../src/audio/recorder';
import { SileroVad } from '../../src/audio/sileroVad';
import { exists } from '../../src/bench/files';
import { AssistMeta, SHADOW_TRIES_BEFORE_SKIP } from '../../src/chat/assist';
import { ConversationEngine } from '../../src/chat/engine';
import { evaluateShadow, ShadowResult } from '../../src/chat/shadow';
import { loadChatModel, releaseChatModel } from '../../src/chat/llamaChatModel';
import { buildReport, SpeechMeta } from '../../src/chat/report';
import { levelById } from '../../src/chat/levels';
import { scenarioById } from '../../src/chat/scenarios';
import { ChatMessage } from '../../src/chat/types';
import { SR } from '../../src/config';
import { Asr } from '../../src/models/asr';
import { Scorer } from '../../src/models/scorer';
import { llmPath, PATHS } from '../../src/paths';
import {
  addMessage,
  addPracticeSentences,
  createSession,
  discardIfEmpty,
  endSession,
  getName,
  getTtsEnabled,
  recentRecaps,
  saveReport,
  sessionUserMessages,
} from '../../src/store/db';
import { normalizeWords } from '../../src/tutorial/textMatch';
import { Glass } from '../../src/ui/Glass';
import { useKeyboardHeight } from '../../src/ui/useKeyboardHeight';
import { C, font, isIOS } from '../../src/ui/theme';

type Status = 'loading' | 'ready' | 'thinking' | 'recording' | 'transcribing' | 'listening_ko' | 'translating' | 'checking' | 'ending' | 'error';
type Mode = 'voice' | 'text';
// 한국어로 도움받기 진행 상태: 한국어 → 영어 문장(en)을 보여 주고, 따라 말하기를 기다린다 (src/chat/assist.ts)
type Assist = { ko: string; en: string; tries: number; heard?: string };

// 자유 대화의 기본은 음성 통화 화면. 마이크를 누르고 말한 뒤 다시 누르면 받아써서 바로 보내고, 상대는 목소리로 답한다.
// 키보드 버튼으로 문자 채팅 화면으로 바꿀 수 있다. 마치면 문법·표현 교정과 전체 대화 내역이 담긴 리포트로 이동한다.
export default function Chat() {
  const { id, level: levelParam } = useLocalSearchParams<{ id: string; level?: string }>();
  const level = levelById(levelParam);
  const scenario = scenarioById(id)!;
  const learner = getName() ?? 'Friend';
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const [mode, setMode] = useState<Mode>('voice');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [status, setStatusState] = useState<Status>('loading');
  const [speaking, setSpeaking] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [hint, setHint] = useState('');
  const [assist, setAssist] = useState<Assist | null>(null);
  const [koTyping, setKoTyping] = useState(false);
  const [koNote, setKoNote] = useState(''); // 입력 창 위 안내 (한국어 팩이 없을 때) // 기기 안 한국어 받아쓰기를 못 쓰는 휴대폰: 한국어를 직접 입력

  const statusRef = useRef<Status>('loading'); // 비동기 흐름(받아쓰기 → 전송)에서 최신 상태를 읽기 위해
  const setStatus = (s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const modeRef = useRef<Mode>('voice');
  modeRef.current = mode;

  const engine = useRef<ConversationEngine | null>(null);
  const sessionId = useRef<number | null>(null);
  const ended = useRef(false);
  const recorder = useRef<PcmRecorder | null>(null);
  const asr = useRef<Asr | null>(null);
  const vad = useRef<SileroVad | null>(null);
  const scorer = useRef<Scorer | null>(null); // 따라 말한 문장의 발음·운율 점수 (처음 쓸 때 올린다)
  const koListener = useRef<KoreanListener | null>(null);
  const assistRef = useRef<Assist | null>(null);
  assistRef.current = assist;
  const voiceMeta = useRef<SpeechMeta | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const ttsSetting = useRef(getTtsEnabled());

  // 음성 모드에서는 항상 소리로 답한다. 문자 모드에서는 설정을 따른다.
  const voiceOn = () => modeRef.current === 'voice' || ttsSetting.current;
  // 읽을 문장 수를 세어, 마지막 문장을 다 읽으면 '말하는 중' 표시를 끈다
  const pending = useRef(0);
  const sayQueued = (sentence: string, first: boolean) => {
    pending.current += 1;
    setSpeaking(true);
    Speech.speak(sentence, {
      gender: scenario.partnerGender,
      rate: level.ttsRate,
      queue: !first,
      onDone: () => {
        pending.current = Math.max(0, pending.current - 1);
        if (!pending.current) setSpeaking(false);
      },
    });
  };
  const say = (text: string) => {
    if (!voiceOn()) return;
    pending.current = 0;
    sayQueued(text, true);
  };
  const stopSpeaking = () => {
    pending.current = 0;
    Speech.stop();
    setSpeaking(false);
  };

  const appendAssistant = (text: string, alreadySpoken = false) => {
    setMessages((m) => [...m, { role: 'assistant', content: text }]);
    if (sessionId.current) addMessage(sessionId.current, 'assistant', text);
    if (!alreadySpoken) say(text);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!exists(llmPath())) throw new Error('대화 모델 파일이 기기에 없습니다.');
        const model = await loadChatModel();
        if (!alive) return;
        sessionId.current = createSession(scenario.id);
        engine.current = new ConversationEngine(model, scenario, learner, recentRecaps(scenario.id), level);
        const first = await engine.current.open();
        if (!alive) return;
        appendAssistant(first);
        engine.current.warm(); // 첫 인사를 읽는 동안 시스템 프롬프트를 미리 계산해 첫 답을 빠르게
        setStatus('ready');
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? String(e));
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
      Speech.stop();
      recorder.current?.stop().catch(() => undefined);
      if (sessionId.current && !ended.current) {
        endSession(sessionId.current, '');
        discardIfEmpty(sessionId.current);
      }
      koListener.current?.abort();
      asr.current?.release();
      vad.current?.release();
      scorer.current?.release();
      releaseChatModel();
    };
  }, []);

  const send = async (text: string, meta?: object) => {
    const t = text.trim();
    if (!t || statusRef.current !== 'ready' || !engine.current) return;
    setInput('');
    setHint('');
    setAssist(null);
    stopSpeaking();
    setMessages((m) => [...m, { role: 'user', content: t }]);
    if (sessionId.current) addMessage(sessionId.current, 'user', t, meta ?? voiceMeta.current ?? undefined);
    voiceMeta.current = null;
    setStatus('thinking');
    try {
      // 답 전체를 기다리지 않고, 생성 중에 끝난 문장부터 바로 읽기 시작한다(첫 소리까지의 시간 단축)
      let spoken = 0;
      const speakDone = (text: string) => {
        if (!voiceOn()) return;
        const { done } = Speech.takeSentences(text);
        for (; spoken < done.length; spoken++) sayQueued(done[spoken], spoken === 0);
      };
      const reply = await engine.current.send(t, (partial) => {
        setStreaming(partial);
        speakDone(partial);
      });
      setStreaming('');
      speakDone(reply + ' '); // 마지막 문장(뒤에 공백이 없어 아직 안 읽은 것)까지
      appendAssistant(reply, true);
    } catch (e: any) {
      setStreaming('');
      showAlert('응답을 만들지 못했어요', e?.message ?? String(e));
    }
    setStatus('ready');
  };

  const askHint = async () => {
    if (statusRef.current !== 'ready' || !engine.current) return;
    setStatus('thinking');
    try {
      setHint(await engine.current.hint());
    } catch {
      setHint('');
    }
    setStatus('ready');
  };

  // ── 한국어로 도움받기 ──
  // 한국어 버튼: 누르면 한국어 듣기, 다시 누르면 영어로 바꾼다. 문자 모드에서 입력창에 한국어가 있으면 그 글을 바로 바꾼다
  const toggleKorean = async () => {
    if (statusRef.current === 'listening_ko') {
      setStatus('translating');
      let ko = '';
      try {
        ko = await koListener.current!.stop();
      } catch (e) {
        setStatus('ready');
        if (e instanceof KoreanSttFailed && e.kind === 'no-offline-korean') {
          requestKoreanPack();
          setKoNote('휴대폰에 오프라인 한국어 음성 팩을 요청했어요. 받는 동안에는 한국어를 직접 써 주세요.');
          return setKoTyping(true);
        }
        return showAlert('한국어를 듣지 못했어요', e instanceof Error ? e.message : String(e));
      } finally {
        koListener.current = null;
      }
      return translate(ko);
    }
    if (statusRef.current !== 'ready') return;
    if (/[가-힣]/.test(input)) return translate(input);
    stopSpeaking();
    setHint('');
    if (!koreanSttAvailable()) return setKoTyping(true);
    try {
      koListener.current = await KoreanListener.start();
      setStatus('listening_ko');
    } catch (e: any) {
      setKoTyping(true);
    }
  };

  const translate = async (ko: string) => {
    if (!engine.current || !ko.trim()) return setStatus('ready');
    setKoTyping(false);
    setStatus('translating');
    try {
      const en = await engine.current.assist(ko);
      setInput('');
      setAssist({ ko: ko.trim(), en, tries: 0 });
      setStatus('ready');
      sayModel(en);
    } catch (e: any) {
      setStatus('ready');
      showAlert('영어로 바꾸지 못했어요', e?.message ?? String(e));
    }
  };

  // 따라 말할 문장은 대화 상대가 아니라 시범 음성으로 조금 천천히 읽는다
  const sayModel = (en: string) => {
    stopSpeaking();
    pending.current = 1;
    setSpeaking(true);
    Speech.speak(en, { rate: level.ttsRate * 0.9, onDone: () => ((pending.current = 0), setSpeaking(false)) });
  };

  // 따라 말한 녹음: 받아쓰기가 목표 문장과 거의 같으면 통과 → 발음·운율 점수를 매기고 그 문장을 이번 차례 입력으로 보낸다(다시 말할 필요 없음)
  const checkShadow = async (samples: Float32Array) => {
    const a = assistRef.current!;
    setStatus('checking');
    let r: ShadowResult | null = null;
    try {
      if (!asr.current) asr.current = await Asr.load(PATHS.whisper);
      // 발음 점수 모델은 처음 따라 말할 때 올린다 (없으면 통과만 확인)
      if (exists(PATHS.scorer) && exists(PATHS.vad)) {
        if (!vad.current) vad.current = await SileroVad.load(PATHS.vad);
        if (!scorer.current) scorer.current = await Scorer.load(PATHS.scorer, 'cpu', 4);
      }
      r = await evaluateShadow({ asr: asr.current, vad: vad.current, scorer: scorer.current }, samples, a.en);
    } catch {
      r = null;
    }
    if (!r?.passed) {
      setAssist({ ...a, tries: a.tries + 1, heard: r?.heard || '(잘 들리지 않았어요)' });
      return setStatus('ready');
    }
    setStatus('ready');
    await sendAssist(a, r.heard, true, r.articulation !== undefined ? { articulation: r.articulation, prosody: r.prosody! } : null);
  };

  const sendAssist = async (a: Assist, heard: string | undefined, passed: boolean, scores: { articulation: number; prosody: number } | null) => {
    const meta: { assist: AssistMeta } = { assist: { ko: a.ko, en: a.en, heard, tries: a.tries + (passed ? 1 : 0), passed, ...(scores ?? {}) } };
    voiceMeta.current = null;
    await send(a.en, meta);
  };

  // 마이크: 누르면 녹음, 다시 누르면 받아쓰기. 음성 모드는 바로 보내고, 문자 모드는 입력창에 넣는다.
  // 따라 말하기 중이면 녹음을 목표 문장과 비교한다
  const toggleMic = async () => {
    if (statusRef.current === 'recording' && assistRef.current) {
      try {
        const rec = await recorder.current!.stop();
        await checkShadow(rec.samples);
      } catch (e: any) {
        setStatus('ready');
        showAlert('음성을 인식하지 못했어요', e?.message ?? String(e));
      }
      return;
    }
    if (statusRef.current === 'recording') {
      setStatus('transcribing');
      let text = '';
      try {
        const rec = await recorder.current!.stop();
        if (!asr.current) asr.current = await Asr.load(PATHS.whisper);
        text = (await asr.current.transcribe(rec.samples)).text.replace(/^\[.*\]$|^\(.*\)$/, '').trim();
        voiceMeta.current = text ? await measureSpeech(rec.samples, text) : null;
      } catch (e: any) {
        showAlert('음성을 인식하지 못했어요', e?.message ?? String(e));
      }
      setStatus('ready');
      if (!text) {
        if (modeRef.current === 'voice') setHint('');
        return showAlert('잘 들리지 않았어요', '마이크에 조금 더 가까이 대고 다시 말해 주세요.');
      }
      if (modeRef.current === 'voice') await send(text);
      else setInput((prev) => (prev ? `${prev} ${text}` : text));
      return;
    }
    if (statusRef.current !== 'ready') return;
    if (!exists(PATHS.whisper)) return showAlert('음성 인식 모델이 없어요', '모델 설치가 끝나지 않았습니다.');
    try {
      stopSpeaking();
      recorder.current = new PcmRecorder();
      await recorder.current.start();
      setStatus('recording');
    } catch (e: any) {
      showAlert('녹음을 시작하지 못했어요', e?.message ?? String(e));
    }
  };

  const finish = () => {
    if (!engine.current || statusRef.current === 'ending') return router.back();
    if (!messages.some((m) => m.role === 'user')) return router.back();
    showAlert('대화를 마칠까요?', '문법·표현 교정과 대화 내역이 담긴 리포트를 만들어요.', [
      { text: '계속하기', style: 'cancel' },
      {
        text: '마치기',
        style: 'destructive',
        onPress: async () => {
          if (statusRef.current === 'recording') await recorder.current?.stop().catch(() => undefined);
          setStatus('ending');
          stopSpeaking();
          const sid = sessionId.current!;
          let recap = '';
          try {
            recap = await engine.current!.end();
          } catch {
            // 기억 생성에 실패해도 대화 기록은 저장한다
          }
          endSession(sid, recap);
          ended.current = true;
          try {
            const report = await buildReport(await loadChatModel(), sessionUserMessages(sid));
            saveReport(sid, report);
            addPracticeSentences(
              [
                ...report.corrections.filter((c) => report.practice.includes(c.corrected)).map((c) => ({ text: c.corrected, original: c.original })),
                ...(report.assisted ?? []).filter((x) => report.practice.includes(x.en)).map((x) => ({ text: x.en, original: x.ko })),
              ],
              sid,
            );
            router.replace({ pathname: '/report/[id]', params: { id: String(sid) } });
          } catch {
            router.back();
          }
        },
      },
    ]);
  };

  // VAD로 실제 말한 시간과 0.6초 넘는 멈춤 횟수를 잰다 (리포트의 말 속도·유창성)
  const measureSpeech = async (samples: Float32Array, text: string): Promise<SpeechMeta | null> => {
    try {
      if (!exists(PATHS.vad)) return null;
      if (!vad.current) vad.current = await SileroVad.load(PATHS.vad);
      const segs = await vad.current.getSpeechTimestamps(peakNormalize(samples));
      if (!segs.length) return null;
      const speechSec = segs.reduce((a, x) => a + (x.end - x.start), 0) / SR;
      const pauses = segs.slice(1).filter((x, i) => (x.start - segs[i].end) / SR >= 0.6).length;
      return { speechSec, pauses, words: normalizeWords(text).length };
    } catch {
      return null;
    }
  };

  const lastPartner = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const lastMine = messages[messages.length - 1]?.role === 'user' ? messages[messages.length - 1].content : '';

  const header = (
    <Stack.Screen
      options={{
        title: mode === 'voice' ? '' : scenario.partnerName,
        headerTransparent: mode === 'voice',
        headerStyle: mode === 'voice' ? undefined : { backgroundColor: '#FFFFFF' },
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 14 }}>
            {mode === 'voice' ? (
              <Pressable onPress={() => setCaptions((c) => !c)} hitSlop={10} style={{ padding: 4 }}>
                <Ionicons name={captions ? 'text' : 'text-outline'} size={22} color={C.blue} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setMode(mode === 'voice' ? 'text' : 'voice')} hitSlop={10} style={{ padding: 4 }}>
              <Ionicons name={mode === 'voice' ? 'chatbubbles-outline' : 'call-outline'} size={24} color={C.blue} />
            </Pressable>
          </View>
        ),
      }}
    />
  );

  const assistCard = assist ? (
    <AssistCard
      assist={assist}
      busy={status !== 'ready'}
      onReplay={() => sayModel(assist.en)}
      onSkip={() => sendAssist(assist, assist.heard, false, null)}
      onClose={() => setAssist(null)}
    />
  ) : null;

  const koModal = (
    <KoreanTypeModal visible={koTyping} busy={status === 'translating'} note={koNote} onCancel={() => setKoTyping(false)} onSubmit={(ko) => translate(ko)} />
  );

  if (mode === 'voice')
    return (
      <>
        {header}
        <VoiceCall
          name={scenario.partnerName}
          title={scenario.title}
          status={status}
          speaking={speaking}
          error={error}
          caption={captions ? streaming || lastPartner : ''}
          myCaption={captions ? lastMine : ''}
          hint={hint}
          assistCard={assistCard}
          shadowing={!!assist}
          bottomInset={insets.bottom}
          onMic={toggleMic}
          onHint={askHint}
          onKorean={toggleKorean}
          onEnd={finish}
        />
        {koModal}
      </>
    );

  const busy = status !== 'ready';
  const canSend = !!input.trim() && status === 'ready';
  return (
    <>
      {header}
      {/* 입력창(dock)은 절대 위치라 KeyboardAvoidingView가 올려 주지 않는다 → 키보드 높이만큼 직접 올린다 */}
      <View style={s.root}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[s.list, { paddingBottom: 150 + (kb || insets.bottom) }]}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          keyboardDismissMode="interactive"
        >
          <View style={s.intro}>
            <Text style={s.introTitle}>{scenario.title}</Text>
            <Text style={s.introText}>
              대화 상대: {scenario.partnerName} · {scenario.subtitle}
            </Text>
          </View>
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} text={m.content} />
          ))}
          {streaming ? <Bubble role="assistant" text={streaming} /> : null}
          {status === 'thinking' && !streaming ? <Typing /> : null}
          {status === 'loading' ? <Centered text="대화 상대를 부르는 중…" /> : null}
          {status === 'error' ? <Text style={s.errorText}>{error}</Text> : null}
          {status === 'ending' ? <Centered text="대화를 정리하고 리포트를 만드는 중…" /> : null}
        </ScrollView>

        <View style={[s.dock, { bottom: kb, paddingBottom: kb ? 8 : Math.max(insets.bottom, 10) }]}>
          {assistCard ? (
            assistCard
          ) : status === 'listening_ko' || status === 'translating' ? (
            <Text style={s.koStatus}>{status === 'listening_ko' ? '한국어로 말해 주세요 · 다 말하면 한국어 버튼을 다시 누르세요' : '영어로 바꾸는 중…'}</Text>
          ) : hint ? (
            <Pressable onPress={() => setInput(hint)}>
              <Glass style={s.hintCard} interactive>
                <Text style={s.hintLabel}>이렇게 말해볼까요?</Text>
                <Text style={s.hintText}>{hint}</Text>
              </Glass>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
              {scenario.phrases.map((p) => (
                <Pressable key={p} onPress={() => setInput(p.replace(/\.\.\.\??$/, ' '))}>
                  <Glass style={s.chip} interactive>
                    <Text style={s.chipText}>{p}</Text>
                  </Glass>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Glass style={s.bar}>
            <IconButton name="bulb-outline" onPress={askHint} disabled={busy} />
            <IconButton
              name={status === 'listening_ko' ? 'stop-circle' : 'language-outline'}
              color={status === 'listening_ko' ? C.red : C.secondary}
              onPress={toggleKorean}
              disabled={!(status === 'ready' || status === 'listening_ko')}
            />
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={
                status === 'recording'
                  ? assist
                    ? '따라 말하는 중… 다시 누르면 끝'
                    : '듣고 있어요… 다시 누르면 끝'
                  : status === 'transcribing' || status === 'checking'
                    ? '받아쓰는 중…'
                    : assist
                      ? '마이크를 누르고 위 문장을 따라 말해요'
                      : 'Message'
              }
              placeholderTextColor={C.secondary}
              style={s.input}
              multiline
              editable={status === 'ready' || status === 'thinking'}
            />
            {canSend ? (
              <IconButton name="arrow-up-circle" size={32} color={C.blue} onPress={() => send(input)} />
            ) : (
              <IconButton
                name={status === 'recording' ? 'stop-circle' : 'mic'}
                size={status === 'recording' ? 32 : 24}
                color={status === 'recording' ? C.red : C.secondary}
                onPress={toggleMic}
                disabled={!(status === 'ready' || status === 'recording')}
              />
            )}
          </Glass>
          {kb ? null : (
            <Pressable onPress={finish} style={s.endText}>
              <Text style={s.endTextLabel}>대화 마치고 리포트 보기</Text>
            </Pressable>
          )}
        </View>
      </View>
      {koModal}
    </>
  );
}

// ── 한국어로 도움받기: 따라 말할 영어 문장 카드 ──
function AssistCard({ assist, busy, onReplay, onSkip, onClose }: { assist: Assist; busy: boolean; onReplay: () => void; onSkip: () => void; onClose: () => void }) {
  return (
    <Glass style={a.card}>
      <View style={a.top}>
        <Text style={a.ko} numberOfLines={2}>
          {assist.ko}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} disabled={busy}>
          <Ionicons name="close" size={20} color={C.secondary} />
        </Pressable>
      </View>
      <Text style={a.en}>{assist.en}</Text>
      <Text style={a.guide}>{assist.heard ? `들린 말: ${assist.heard}\n한 번 더 따라 말해 보세요.` : '마이크를 누르고 이 문장을 영어로 따라 말해 보세요.'}</Text>
      <View style={a.row}>
        <Pressable onPress={onReplay} style={a.btn} disabled={busy}>
          <Ionicons name="volume-high" size={16} color={C.blue} />
          <Text style={a.btnText}>다시 듣기</Text>
        </Pressable>
        {assist.tries >= SHADOW_TRIES_BEFORE_SKIP ? (
          <Pressable onPress={onSkip} style={a.btn} disabled={busy}>
            <Ionicons name="send" size={15} color={C.blue} />
            <Text style={a.btnText}>이 문장으로 보내기</Text>
          </Pressable>
        ) : null}
      </View>
    </Glass>
  );
}

// 기기 안 한국어 받아쓰기를 쓸 수 없을 때 한국어를 직접 입력한다
function KoreanTypeModal({ visible, busy, note, onCancel, onSubmit }: { visible: boolean; busy: boolean; note?: string; onCancel: () => void; onSubmit: (ko: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={isIOS ? 'padding' : 'height'} style={a.backdrop}>
        <View style={a.sheet}>
          <Text style={a.sheetTitle}>하고 싶은 말을 한국어로 써 주세요</Text>
          {note ? <Text style={a.sheetNote}>{note}</Text> : null}
          <TextInput value={text} onChangeText={setText} placeholder="예: 이거 좀 깎아줄 수 있어요?" placeholderTextColor={C.secondary} style={a.sheetInput} autoFocus multiline />
          <View style={a.sheetRow}>
            <Pressable onPress={onCancel} style={a.sheetBtn}>
              <Text style={[a.sheetBtnText, { fontWeight: '400' }]}>취소</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!text.trim() || busy) return;
                onSubmit(text);
                setText('');
              }}
              style={a.sheetBtn}
            >
              {busy ? <ActivityIndicator /> : <Text style={a.sheetBtnText}>영어로 바꾸기</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── 음성 통화 화면 ──
function VoiceCall(p: {
  name: string;
  title: string;
  status: Status;
  speaking: boolean;
  error: string;
  caption: string;
  myCaption: string;
  hint: string;
  assistCard: React.ReactNode;
  shadowing: boolean; // 따라 말할 영어 문장이 나와 있음
  bottomInset: number;
  onMic: () => void;
  onHint: () => void;
  onKorean: () => void;
  onEnd: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const active =
    p.speaking || ['recording', 'thinking', 'transcribing', 'listening_ko', 'translating', 'checking'].includes(p.status);
  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  const ringColor = p.status === 'recording' || p.status === 'listening_ko' ? C.red : p.speaking ? C.green : C.blue;
  const statusText: Record<Status, string> = {
    loading: '연결하는 중…',
    error: p.error,
    recording: p.shadowing ? '따라 말하는 중 · 다 말하면 버튼을 다시 누르세요' : '듣고 있어요 · 다 말하면 버튼을 다시 누르세요',
    transcribing: '받아쓰는 중…',
    listening_ko: '한국어로 말해 주세요 · 다 말하면 한국어 버튼을 다시 누르세요',
    translating: '영어로 바꾸는 중…',
    checking: '따라 말한 문장을 확인하는 중…',
    thinking: `${p.name} 생각하는 중…`,
    ending: '리포트를 만드는 중…',
    ready: p.shadowing ? '아래 문장을 영어로 따라 말해 보세요' : p.speaking ? `${p.name} 말하는 중` : '마이크를 누르고 영어로 말해 보세요',
  };

  const micDisabled = !(p.status === 'ready' || p.status === 'recording');
  const busyIcon = ['loading', 'thinking', 'transcribing', 'translating', 'checking', 'ending'].includes(p.status);

  return (
    <View style={v.root}>
      <View style={[v.blob, { backgroundColor: '#9CC9FF', top: -80, left: -90 }]} />
      <View style={[v.blob, { backgroundColor: '#C9B8FF', top: 220, right: -140 }]} />
      <View style={[v.blob, { backgroundColor: '#A9EFD9', bottom: -60, left: -60 }]} />

      <View style={v.top}>
        <View style={v.avatarWrap}>
          <Animated.View
            style={[
              v.ring,
              { borderColor: ringColor, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.6] }) },
              { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] },
            ]}
          />
          <Glass style={v.avatar}>
            <Text style={v.avatarText}>{p.name.replace(/^(Officer|Ms\.|Mr\.)\s*/, '')[0]}</Text>
          </Glass>
        </View>
        <Text style={v.name}>{p.name}</Text>
        <Text style={v.scene}>{p.title}</Text>
        <Text style={[v.status, p.status === 'error' && { color: C.red }]}>{statusText[p.status]}</Text>
        {busyIcon ? <ActivityIndicator style={{ marginTop: 10 }} /> : null}
      </View>

      <View style={v.captions}>
        {p.myCaption && !p.assistCard ? <Text style={v.mine}>나: {p.myCaption}</Text> : null}
        {p.caption ? (
          <Glass style={v.captionCard}>
            <Text style={v.captionText}>{p.caption}</Text>
          </Glass>
        ) : null}
        {p.assistCard ? <View style={{ marginTop: 10 }}>{p.assistCard}</View> : null}
        {p.hint && !p.assistCard ? (
          <Glass style={[v.captionCard, { marginTop: 10 }]}>
            <Text style={v.hintLabel}>이렇게 말해볼까요?</Text>
            <Text style={v.captionText}>{p.hint}</Text>
          </Glass>
        ) : null}
      </View>

      <View style={[v.controls, { paddingBottom: Math.max(p.bottomInset, 16) + 8 }]}>
        <View style={v.row}>
          <RoundButton icon="bulb-outline" label="힌트" onPress={p.onHint} disabled={p.status !== 'ready' || p.shadowing} />
          <Pressable onPress={p.onMic} disabled={micDisabled}>
            <View style={[v.mic, p.status === 'recording' && { backgroundColor: C.red }, micDisabled && { opacity: 0.4 }]}>
              <Ionicons name={p.status === 'recording' ? 'stop' : 'mic'} size={38} color="#fff" />
            </View>
          </Pressable>
          <RoundButton
            icon={p.status === 'listening_ko' ? 'stop' : 'language'}
            label={p.status === 'listening_ko' ? '다 말했어요' : '한국어로'}
            onPress={p.onKorean}
            disabled={!(p.status === 'ready' || p.status === 'listening_ko')}
            active={p.status === 'listening_ko'}
          />
        </View>
        <Pressable onPress={p.onEnd} style={v.end}>
          <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          <Text style={v.endText}>마치고 리포트 보기</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress, disabled, active }: { icon: any; label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ alignItems: 'center', opacity: disabled ? 0.4 : 1 }}>
      {active ? (
        // Glass는 Android에서 흰 배경을 강제하므로, 듣는 중에는 빨간 원을 직접 그린다
        <View style={[v.round, { backgroundColor: C.red }]}>
          <Ionicons name={icon} size={24} color="#fff" />
        </View>
      ) : (
        <Glass style={v.round} interactive>
          <Ionicons name={icon} size={24} color={C.label} />
        </Glass>
      )}
      <Text style={v.roundLabel}>{label}</Text>
    </Pressable>
  );
}

function Bubble({ role, text }: { role: string; text: string }) {
  const mine = role === 'user';
  return (
    <View style={[s.bubble, mine ? s.mine : s.theirs]}>
      <Text style={[s.bubbleText, mine && { color: '#fff' }]}>{text}</Text>
    </View>
  );
}

function Typing() {
  return (
    <View style={[s.bubble, s.theirs, { paddingVertical: 12 }]}>
      <ActivityIndicator size="small" color={C.secondary} />
    </View>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator />
      <Text style={s.muted}>{text}</Text>
    </View>
  );
}

function IconButton({ name, onPress, disabled, size = 24, color = C.secondary }: { name: any; onPress: () => void; disabled?: boolean; size?: number; color?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={({ pressed }) => [s.iconBtn, (pressed || disabled) && { opacity: 0.4 }]}>
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

const v = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F8FC', overflow: 'hidden' },
  blob: { position: 'absolute', width: 340, height: 340, borderRadius: 170, opacity: 0.5 },
  top: { alignItems: 'center', paddingTop: 110 },
  avatarWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 6 },
  avatar: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 48, fontWeight: '600', color: C.label },
  name: { ...font.title2, color: C.label, marginTop: 14 },
  scene: { ...font.subhead, color: C.secondary, marginTop: 2 },
  status: { ...font.subhead, color: C.secondary, marginTop: 14, textAlign: 'center', paddingHorizontal: 32 },
  captions: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 16 },
  mine: { ...font.footnote, color: C.secondary, textAlign: 'right', marginBottom: 8 },
  captionCard: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
  captionText: { ...font.body, color: C.label, lineHeight: 23 },
  hintLabel: { ...font.caption, color: C.secondary, marginBottom: 2 },
  controls: { paddingHorizontal: 28, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mic: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  roundLabel: { ...font.caption, color: C.secondary, marginTop: 6 },
  end: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.red, borderRadius: 16, paddingVertical: 14 },
  endText: { ...font.headline, color: '#fff' },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  list: { paddingHorizontal: 12, paddingTop: 12 },
  intro: { alignItems: 'center', marginVertical: 16 },
  introTitle: { ...font.headline, color: C.label },
  introText: { ...font.footnote, color: C.secondary, marginTop: 4, textAlign: 'center' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, marginVertical: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.blue, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.bubbleIn, borderBottomLeftRadius: 6 },
  bubbleText: { ...font.body, color: C.label, lineHeight: 22 },
  center: { alignItems: 'center', gap: 8, marginTop: 24 },
  muted: { ...font.footnote, color: C.secondary },
  errorText: { ...font.subhead, color: C.red, textAlign: 'center', marginTop: 24, lineHeight: 22 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, gap: 8 },
  chips: { gap: 8, paddingHorizontal: 2 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { ...font.subhead, color: C.label },
  hintCard: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  hintLabel: { ...font.caption, color: C.secondary, marginBottom: 2 },
  hintText: { ...font.body, color: C.label },
  bar: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 26, paddingHorizontal: 6, paddingVertical: 6, gap: 4 },
  input: { flex: 1, ...font.body, color: C.label, maxHeight: 120, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  endText: { alignItems: 'center', paddingVertical: 4 },
  endTextLabel: { ...font.footnote, color: C.red, fontWeight: '600' },
  koStatus: { ...font.footnote, color: C.secondary, textAlign: 'center', paddingVertical: 6 },
});

// 한국어로 도움받기 카드·입력 창
const a = StyleSheet.create({
  card: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  ko: { ...font.footnote, color: C.secondary, flex: 1 },
  en: { fontSize: 20, fontWeight: '600', color: C.label, marginTop: 6, lineHeight: 26 },
  guide: { ...font.footnote, color: C.secondary, marginTop: 8, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.fill, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  btnText: { ...font.subhead, color: C.blue, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20 },
  sheetTitle: { ...font.headline, color: C.label },
  sheetNote: { ...font.footnote, color: C.secondary, marginTop: 6, lineHeight: 18 },
  sheetInput: { ...font.body, color: C.label, backgroundColor: C.groupedBg, borderRadius: 12, padding: 12, marginTop: 14, minHeight: 70, textAlignVertical: 'top' },
  sheetRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  sheetBtn: { paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: 'center' },
  sheetBtnText: { ...font.headline, color: C.blue },
});
