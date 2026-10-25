import * as Speech from 'expo-speech';

// 음성 합성(TTS). 앱에 TTS 모델을 넣지 않고, 휴대폰에 설치된 TTS 엔진(삼성 TTS, Google 음성 서비스, iOS 시스템 음성)에 읽기를 맡긴다.
// 기본 음성을 그대로 쓰면 기기 언어(한국어) 음성이 영어를 읽거나 저품질 음성이 잡혀 어색하므로, 설치된 영어 음성 중에서 고른다.
// 대화 상대마다 성별에 맞는 음성을 쓰고(Tom은 남성, Mia는 여성), 맞는 성별의 음성이 없으면 음 높이로 구분한다.
// 오프라인 원칙: 네트워크 음성(-network)은 제외한다.

export type Gender = 'f' | 'm';
export type VoiceInfo = { id: string; name: string; language: string; quality: string; local: boolean; score: number; gender: Gender | null };

const LANG_PREF: Record<string, number> = { 'en-us': 30, 'en-gb': 20, 'en-au': 15, 'en-ca': 15, 'en-in': 5 };

// Google 음성 서비스의 영어 음성 성별 (식별자 앞부분)
const GOOGLE_GENDER: Record<string, Gender> = {
  'en-us-x-iob': 'f', 'en-us-x-iog': 'f', 'en-us-x-iol': 'm', 'en-us-x-iom': 'm',
  'en-us-x-sfg': 'f', 'en-us-x-tpc': 'f', 'en-us-x-tpd': 'm', 'en-us-x-tpf': 'f',
  'en-gb-x-gba': 'f', 'en-gb-x-gbb': 'm', 'en-gb-x-gbc': 'f', 'en-gb-x-gbd': 'm', 'en-gb-x-gbg': 'f', 'en-gb-x-rjs': 'm',
  'en-au-x-afa': 'f', 'en-au-x-aub': 'm', 'en-au-x-auc': 'f', 'en-au-x-aud': 'm',
};
// iOS 시스템 영어 음성 이름
const IOS_FEMALE = /\b(samantha|allison|ava|susan|victoria|karen|moira|tessa|fiona|zoe|nicky|serena|kate|catherine|martha|veena)\b/i;
const IOS_MALE = /\b(alex|daniel|fred|tom|aaron|arthur|gordon|oliver|rishi|evan|nathan|lee|ralph|albert|reed)\b/i;

export function guessGender(v: { identifier: string; name: string }): Gender | null {
  const id = v.identifier.toLowerCase();
  const g = Object.entries(GOOGLE_GENDER).find(([k]) => id.startsWith(k));
  if (g) return g[1];
  const text = `${v.identifier} ${v.name}`;
  if (/female|woman|smtf\d|[-_]f\d{2}\b/i.test(text)) return 'f'; // 삼성 TTS 등: ...f00
  if (/\bmale\b|\bman\b|smtm\d|[-_]m\d{2}\b/i.test(text)) return 'm';
  if (IOS_FEMALE.test(v.name)) return 'f';
  if (IOS_MALE.test(v.name)) return 'm';
  return null;
}

export function rankVoice(v: Speech.Voice): VoiceInfo {
  const lang = v.language.replace('_', '-').toLowerCase();
  const id = v.identifier.toLowerCase();
  const local = !id.includes('network') && !(v as any).requiresNetwork;
  let score = LANG_PREF[lang] ?? (lang.startsWith('en') ? 3 : -1000);
  if (v.quality === Speech.VoiceQuality.Enhanced) score += 20;
  if (!local) score -= 100;
  // iOS: 기본(compact) 음성보다 Siri·premium 음성이 훨씬 자연스럽다
  if (id.includes('premium')) score += 15;
  if (id.includes('siri')) score += 10;
  if (id.includes('eloquence') || id.includes('speech.synthesis.voice')) score -= 15; // iOS의 장난감 음성들(Bad News, Bells 등)
  return { id: v.identifier, name: v.name, language: v.language, quality: String(v.quality), local, score, gender: guessGender(v) };
}

let cache: VoiceInfo[] | null = null;
export async function englishVoices(): Promise<VoiceInfo[]> {
  if (cache?.length) return cache;
  const all = await Speech.getAvailableVoicesAsync();
  cache = all.map(rankVoice).filter((v) => v.score > -500 && v.local).sort((a, b) => b.score - a.score);
  return cache;
}

// 성별에 맞는 음성. 없으면 가장 좋은 음성 + 음 높이 조절(남성은 낮게, 여성은 조금 높게)
export type VoicePick = { voice?: string; pitch: number; matched: boolean };
const picked: Partial<Record<Gender, VoicePick>> = {};
export async function voiceFor(gender: Gender): Promise<VoicePick> {
  if (picked[gender]) return picked[gender]!;
  const list = await englishVoices().catch(() => [] as VoiceInfo[]);
  const best = list[0]?.score ?? 0;
  const match = list.find((v) => v.gender === gender && v.score >= best - 15); // 같은 성별 중 품질이 크게 떨어지지 않는 것
  const pick: VoicePick = match ? { voice: match.id, pitch: 1.0, matched: true } : { voice: list[0]?.id, pitch: gender === 'm' ? 0.8 : 1.1, matched: false };
  picked[gender] = pick;
  return pick;
}

// 이모지·마크다운·괄호 지시문은 소리 내지 않는다
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\*+|_{2,}|#+|`+/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SpeakOptions = { rate?: number; gender?: Gender; queue?: boolean; onStart?: () => void; onDone?: () => void };
// queue=true면 이전 말을 끊지 않고 뒤에 이어 말한다(답을 만들면서 문장 단위로 읽을 때)
export async function speak(text: string, o: SpeakOptions = {}) {
  const t = cleanForSpeech(text);
  if (!t) return o.onDone?.();
  const { voice, pitch } = await voiceFor(o.gender ?? 'f');
  if (!o.queue) Speech.stop();
  Speech.speak(t, {
    language: 'en-US',
    voice,
    rate: o.rate ?? 1.0,
    pitch,
    onStart: o.onStart,
    onDone: o.onDone,
    onStopped: o.onDone,
    onError: o.onDone,
  });
}
export const stop = () => Speech.stop();

// 생성 중인 답에서 끝난 문장만 떼어 낸다: "Hi there! How are yo" → ["Hi there!"], 나머지 "How are yo"
export function takeSentences(text: string): { done: string[]; rest: string } {
  const done: string[] = [];
  const re = /[^.!?]*[.!?]+["”')\]]*\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim()) done.push(m[0].trim());
    last = re.lastIndex;
  }
  return { done, rest: text.slice(last) };
}
