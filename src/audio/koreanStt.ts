import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// 한국어로 도움받기의 한국어 받아쓰기. 앱의 whisper(base.en)는 영어 전용이라, 휴대폰 기본 음성 인식을 쓰되
// requiresOnDeviceRecognition으로 기기 안에서만 처리한다(음성이 서버로 가지 않음, 앱 용량 증가 없음).
// 오프라인 한국어 팩이 없는 기기는 받아쓰기 대신 한국어를 직접 입력한다 (대화 화면의 입력 창).

export type KoreanSttError = 'unavailable' | 'no-offline-korean' | 'no-speech' | 'permission' | 'other';

export class KoreanSttFailed extends Error {
  constructor(readonly kind: KoreanSttError, message: string) {
    super(message);
  }
}

const LOCALE = 'ko-KR';

export function koreanSttAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable() && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

// 오프라인 한국어 팩 받기를 휴대폰에 요청한다 (Android 13+. 휴대폰이 알아서 받거나 받기 창을 띄운다)
export async function requestKoreanPack(): Promise<void> {
  try {
    await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: LOCALE });
  } catch {
    // 지원하지 않는 기기는 직접 입력으로 넘어간다
  }
}

// 한 번 듣기: start() 후 stop()을 부르면 그때까지 들은 한국어 문장을 돌려준다
export class KoreanListener {
  private finals: string[] = [];
  private interim = '';
  private error: KoreanSttFailed | null = null;
  private ended: Promise<void>;
  private subs: { remove(): void }[] = [];

  private constructor() {
    let done = () => {};
    this.ended = new Promise((r) => (done = r));
    this.subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => {
        const t = e.results[0]?.transcript?.trim() ?? '';
        if (e.isFinal) {
          if (t) this.finals.push(t);
          this.interim = '';
        } else this.interim = t;
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        const kind: KoreanSttError =
          e.error === 'language-not-supported' || e.error === 'service-not-allowed'
            ? 'no-offline-korean'
            : e.error === 'no-speech' || e.error === 'speech-timeout'
              ? 'no-speech'
              : e.error === 'not-allowed'
                ? 'permission'
                : 'other';
        this.error = new KoreanSttFailed(kind, e.message);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => done()),
    ];
  }

  static async start(): Promise<KoreanListener> {
    if (!koreanSttAvailable()) throw new KoreanSttFailed('unavailable', '이 휴대폰은 기기 안 음성 인식을 지원하지 않아요.');
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) throw new KoreanSttFailed('permission', '마이크 권한이 필요해요.');
    const l = new KoreanListener();
    ExpoSpeechRecognitionModule.start({ lang: LOCALE, interimResults: true, continuous: true, requiresOnDeviceRecognition: true, addsPunctuation: true });
    return l;
  }

  async stop(): Promise<string> {
    ExpoSpeechRecognitionModule.stop();
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 3000))]);
    this.subs.forEach((s) => s.remove());
    const text = [...this.finals, this.interim].join(' ').replace(/\s+/g, ' ').trim();
    if (!text && this.error) throw this.error;
    if (!text) throw new KoreanSttFailed('no-speech', '한국어가 들리지 않았어요.');
    return text;
  }

  abort() {
    ExpoSpeechRecognitionModule.abort();
    this.subs.forEach((s) => s.remove());
  }
}
