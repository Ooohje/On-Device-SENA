# SENA mobile (React Native · Expo SDK 58)

클라우드 없이 동작하는 온디바이스 영어회화 앱. 로그인 없이 영어 이름만 입력하고 시작한다.
개발 계획서: `C:\Users\ohje\Desktop\프리씨랩\SENA 모음집\SENA\0. mobile project\개발계획서.md`

> 이 프로젝트가 `C:\dev`에 있는 이유: Android 네이티브 빌드(NDK/CMake)가 한글·공백이 들어간 경로에서 자주 실패한다.

## 화면 (Expo Router)

| 경로 | 화면 |
|---|---|
| `app/onboarding.tsx` | 첫 실행: 영어 이름 입력 (검증 규칙 `src/store/name.ts`) |
| `app/index.tsx` | 홈: 상황별 자유 대화 7종, 튜토리얼, 지난 대화 보고서, 설정 — iOS 설정 앱 스타일 그룹 목록 |
| `app/chat/[id].tsx` | 대화: iMessage 말풍선, Liquid Glass 입력창, 마이크(whisper), 답변 힌트, 표현 칩, TTS. 마치면 보고서 생성 |
| `app/report/[id].tsx` | 대화 보고서: 기억한 내용, 말하기 통계(문장 길이·말 속도·멈춤), 더 자연스러운 표현, 연습 문장 |
| `app/tutorial/index.tsx` | 튜토리얼 단원 목록 (레벨 1~3, 6단원 36문장 + 대화에서 가져온 "내 문장") |
| `app/tutorial/[unit].tsx` | 한 문장씩: 시범 듣기 → 녹음 → 발음·운율 점수, 피드백, 최고 기록 → 단원 끝나면 같은 상황 자유 대화로 |
| `app/settings.tsx` | 이름 변경, 목소리 듣기, 기록 삭제, 기술 검증 화면 진입 |
| `app/dev.tsx` | Phase 0 · Track B 측정 화면 |

UI는 iOS 시스템 색·inset grouped 목록·큰 제목 헤더를 쓴다. `src/ui/Glass.tsx`: iOS 26+는 네이티브 Liquid Glass(`expo-glass-effect`), 이전 iOS는 블러, Android는 반투명 배경.

## 자유 대화 엔진 (`src/chat/`)

| 파일 | 역할 |
|---|---|
| `scenarios.ts` | 상황 7종: 상대 이름·역할·상황·진행 단계(`steps`)·첫 마디·표현 힌트 |
| `prompts.ts` | 시스템 프롬프트, 대화 요약, 다음 대화용 기억, 답변 힌트, 재방문 인사 |
| `engine.ts` | 대화 진행. 최근 6~10개 메시지는 그대로, 오래된 턴은 요약으로 압축(n_ctx 2048). 턴마다 짧은 지시(이름 부르기, 다음 단계, 작별·한국어 질문 처리)를 마지막 메시지에 붙인다 |
| `sanitize.ts` | 역할 접두어·이모지·행동 묘사·지시문 반복 제거, 3문장 제한 |
| `llamaChatModel.ts` | llama.rn 연결 (대화 화면에서만 메모리에 올림) |

1B 모델에 맞춘 설계 이유와 검증 결과는 `docs/chat-sim-report.md` (PC에서 같은 Gemma 3 1B로 실행한 대화 기록) 참고.

## 튜토리얼 (`src/tutorial/`)

| 파일 | 역할 |
|---|---|
| `content.ts` | 단원·문장(영문, 한국어 뜻, 한국인 학습자용 발음 팁). 문장은 8초 안에 읽도록 12단어 이하 |
| `practiceScorer.ts` | 녹음 → 전처리(VAD) → whisper 받아쓰기로 제시 문장을 읽었는지 확인 → 평가 모델 점수 |
| `textMatch.ts` | WER로 "다른 문장을 읽음" 판정 (WER > 0.6이면 점수를 주지 않음). 평가 모델이 텍스트를 보지 않아 엉뚱한 문장을 유창하게 읽어도 점수가 높게 나오는 한계를 앱 단계에서 막는다 |

## 대화 보고서 (`src/chat/report.ts`)

- 말하기 통계: 평균 문장 길이, 음성 턴의 말 속도(단어/분, VAD 발화 시간 기준), 0.6초 넘는 멈춤 횟수
- 더 자연스러운 표현: 1B 모델이 항상 고쳐 쓰게 한 뒤, **기능어·같은 단어 변화형만 바뀐 경우**에만 교정으로 채택
  (Gemma 3 1B 기준 틀린 문장 80% 검출, 맞는 문장 오교정 13% — `docs/report-sim.md`)
- 교정된 문장 중 12단어 이하 최대 3개를 튜토리얼 "내 문장"으로 보낸다

## 데이터 (`src/store/db.ts`, expo-sqlite)

`profile`(영어 이름, 설정) · `sessions`(상황, 다음 대화용 기억 recap, 보고서 report) · `messages`(음성 지표 meta) · `attempts`(튜토리얼 점수) · `practice_sentences`(내 문장). 서버·로그인 없음.
기기 변경 시 Android 자동 백업(`allowBackup`, 25MB 한도)으로 복원된다.

## Android 빌드 설정 (`plugins/withSenaAndroid.js`)

- onnxruntime-android를 JS 패키지와 같은 버전(1.24.3)으로 고정. 원래는 빌드마다 최신 버전(latest.integration)을 받아 재현성이 없었다.
- 자동 백업에서 `models/`, `golden/`, `golden_raw/`, `results/` 제외 (약 1GB 모델 때문에 25MB 한도를 넘어 학습 기록까지 백업이 실패하는 것을 막음).

## PC 검증 스크립트

```powershell
npm test                 # 단위 테스트: 이름 검증, 문장 일치(WER), 문장 길이, 교정 필터
npm run sim:chat         # 자유 대화 7개 상황 시뮬레이션 (Ollama gemma3:1b)
npm run sim:report       # 보고서 문법 교정 정확도 (틀린 15 / 맞는 15문장)
npm run verify:pc -- "C:/Users/ohje/Desktop/프리씨랩/SENA 모음집/SENA"   # 전처리·채점 동등성 (Python 기준)
```

## 기술 검증 모듈

| 경로 | 내용 |
|---|---|
| `src/audio/wav.ts` | WAV 디코딩, 16kHz 모노 변환 |
| `src/audio/sileroVad.ts` | Silero VAD v6.0.0 ONNX + `get_speech_timestamps` 포팅 (학습 전처리와 같은 버전) |
| `src/audio/preprocess.ts` | Peak 정규화 → VAD → ±250ms 자르기 → 8초 0 패딩 (`model_utils.py`와 동일) |
| `src/audio/recorder.ts` | 마이크 PCM 녹음 (`react-native-audio-api`) |
| `src/models/scorer.ts` | 발음·운율 평가 모델 (`onnxruntime-react-native`, CPU/XNNPACK/NNAPI) |
| `src/models/asr.ts` | whisper.cpp (`whisper.rn`) |
| `src/models/llm.ts` | llama.cpp (`llama.rn`) |
| `src/bench/tests.ts` | 측정 항목 (결과는 기기 `files/results/*.json`에 저장) |
| `scripts/verify-on-pc.*` | 같은 TS 코드를 PC(onnxruntime-node 1.24.3)에서 Python 기준과 비교 |

## 처음 한 번

1. JDK 17, Android Studio(SDK 36, NDK, CMake, Platform-Tools), 환경변수 `JAVA_HOME`·`ANDROID_HOME` 설정
2. 휴대폰 USB 디버깅을 켜고 연결 → `adb devices`에 기기가 보이는지 확인

## 실행

```powershell
cd C:\dev\sena-mobile
npm run verify:pc -- "C:/Users/ohje/Desktop/프리씨랩/SENA 모음집/SENA"   # (선택) PC에서 전처리·채점 동등성 확인
npx expo run:android                                                      # 개발 빌드 설치 + Metro 실행 (첫 빌드는 오래 걸림)
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1      # whisper + LLM 내려받기 (약 1GB)
powershell -ExecutionPolicy Bypass -File scripts\push-assets.ps1          # 모델·골든 샘플을 기기로 전송
```

앱에서 `0. 파일 확인` → `1a~6` 순서로 실행한 뒤:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pull-results.ps1         # 결과 JSON을 bench-results/로 가져오기
```

## 통과 기준 (개발계획서 Track B)

| 항목 | 기준 |
|---|---|
| 1. 채점 골든 | Python 대비 오차 ≤ 0.02, 8초 입력 ≤ 500ms |
| 2. 전처리 골든 | Python과 VAD 구간 완전 일치 |
| 3. 녹음 → 채점 | 16kHz 녹음 확인, 전체 지연 기록 |
| 4. ASR | 5초 발화 ≤ 1초 (RTF ≤ 0.2) |
| 5. LLM | 첫 토큰 ≤ 1초, 생성 ≥ 10 tok/s |
| 6. 발열 | 5분 후 지연 증가 비율 기록 |

## 참고

- `android/`는 `expo prebuild`로 생성되는 폴더라 git에 넣지 않는다 (`app.json`의 플러그인 설정이 원본).
- whisper.rn은 패키지 `exports`에 `.` 항목이 없어 `whisper.rn/index`로 import하고, `tsconfig.json`의 `paths`로 타입을 연결했다. 내부에서 `buffer` 패키지를 쓴다.
