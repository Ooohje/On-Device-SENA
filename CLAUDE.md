# sena-mobile — SENA 온디바이스 영어회화 앱 (React Native · Expo SDK 58 · RN 0.88)

사용자는 한국어로 대화한다. **답변·작업 중 진행 메시지·질문 모두 반드시 한국어로만 쓴다(강제).** 초보자도 이해할 수 있게 쓴다.
**프로젝트 전체 맥락(연구, 모델 규격, 경량화 결론, 논문)은 `C:\Users\ohje\Desktop\프리씨랩\SENA 모음집\SENA\CLAUDE.md`와 같은 폴더의 `0. mobile project\개발계획서.md`를 먼저 읽는다.** 이 파일은 앱 코드만 다룬다. 구조와 실행법은 README.md에 있다.

## 원칙
- 서버·클라우드·로그인 없음. 모든 추론은 기기에서, 사용자 데이터는 기기 SQLite에만 (`src/store/db.ts`)
- 평가 모델의 전처리·입력 규격은 학습과 **샘플 단위로** 같아야 한다. `src/audio/preprocess.ts`, `src/audio/sileroVad.ts`를 바꾸면 반드시 `npm run verify:pc -- "<SENA 루트>"`로 300/300 일치를 다시 확인한다
- 배포 평가 모델은 `wo_int8`(결정적). 활성값을 int8로 계산하는 모델(accuracy_level 4, int8 동적)은 기기마다 점수가 달라질 수 있어 쓰지 않는다

## 주요 코드
- `app/` 화면(Expo Router): onboarding(영어 이름) → model-import(첫 실행 한 번, 대화 모델 받기) → (tabs) 대화(index)·튜토리얼(learn)·리포트(reports)·설정(settings). chat/[id](자유 대화), report/[id](대화 보고서, 이미지로 저장), learn/[level]·tutorial/[unit](3레벨 12단원 72문장), dev(기술 검증)
- `app/model-import.tsx` + `src/models/llmImport.ts`: **대화 모델(llm.gguf 2.5GB)은 APK에 넣지 않고 앱이 처음 한 번 인터넷에서 앱 저장소로 바로 받는다**(v0.3.1, DownloadTask: 진행률·일시정지·이어받기, `.part`로 받아 크기 2,499,012,288바이트·앞 4바이트 'GGUF' 확인 후 이름 변경). 주소는 Drive `영어 발화 피드백 모델/APK/SENA-model-gemma3-4b.gguf`(id `1ev1iEDBOXXr_1Trw5HOsBH9JRFL3njXt`, 링크 공개)의 `drive.usercontent.google.com/download?...&confirm=t`. **이 Drive 파일을 지우거나 바꾸면 앱이 모델을 못 받는다.** 모델을 바꾸면 LLM_BYTES와 파일 id를 함께 고친다. Play 스토어판은 Play Asset Delivery로 바꿀 계획
  - 모델이 없으면 대화 탭 배너·상황 선택·설정 '대화 모델' 행이 이 화면으로 보낸다(`hasLlm()`)
- **한국어로 도움받기**(v0.3.1, 연구자 아이디어): 대화 중 말문이 막히면 한국어로 말함 → Gemma 4B가 맥락·난이도에 맞는 영어 1–2문장(`src/chat/assist.ts`, 예시 3개 넣은 프롬프트, 난이도별 최대 12/18/20단어) → 따라 말하기 → whisper WER ≤ 0.35면 통과, 그 문장이 그대로 이번 차례 입력(다시 말할 필요 없음), 2번 실패하면 '이 문장으로 보내기'. 통과하면 WavLM 발음·운율 점수(`src/chat/shadow.ts`, 정답 문장이 있어 자유 대화에서도 채점 가능). 한국어 받아쓰기는 OS 음성 인식 기기 안 처리 모드(`src/audio/koreanStt.ts`, expo-speech-recognition, requiresOnDeviceRecognition). 오프라인 한국어 팩이 없으면 팩 요청 + 직접 입력 창. 문자 모드는 입력창의 한국어를 바로 바꿈. 리포트: 도움받은 표현은 문법 교정·말 속도에서 빼고 '한국어로 도움받은 표현'으로 따로 표시, 튜토리얼 '내 문장'으로 보냄
  - PC 평가 `node scripts/run-ts.mjs scripts/assist-eval.ts <이름>` (42문장×3난이도, 심사 qwen3:8b) → `docs/assist-eval/`. 규칙만 83.3% → 예시 3개 87.3%(세 항목 모두 4점 이상). 기기 검증: 기술 검증 '9. 한국어로 도움받기'(에뮬레이터: 변환 첫 38.2s·이후 8–10s, 골든 따라 말하기 통과 7/8·다른 문장 차단 8/8)
  - 에뮬레이터에서 한국어 입력: adb input text는 한글 불가 → PC에서 `Set-Clipboard`로 복사 후 입력창에서 `adb shell input keyevent 279`(붙여넣기)
- `scripts/recap-check.ts`: 대화 종료 기억이 사실을 지어내는지 점검(개인 정보 없는 카페 대화에서 4B가 '캐나다에서 왔다'를 지어냄 → 프롬프트에 그럴 때 할 일 명시해 해결)
- **v0.3.5**(2026-10-28): 대화 모델 받기 전 기기 사양 확인(`src/models/deviceCheck.ts`, 받기 화면 카드). RAM 기준은 휴대폰이 알려 주는 값이 표기보다 작아 5.0GB 미만=미지원(받기 막고 튜토리얼 안내), 7.0GB 미만=가능(느릴 수 있음), 이상=권장. 저장 공간 2.8GB 미만이면 받기 버튼 꺼짐 + 다시 확인. 홈 배너·대화 모델 로드 오류도 같은 기준. Drive APK는 v0.3.4 파일 내용을 덮어쓰고 이름만 바꿔 README 링크(id 1Y92tkqzd2Bvbn27Cs-WWmfHy80HUrEj1) 유지
- **v0.3.4**(2026-10-25): 기술 검증 화면(`app/dev.tsx`, `sena://dev`)에 '▶ 전체 실행'(0~9 차례로, 약 10분 — 3번 녹음은 5초 읽기 필요)과 '⬇ 로그 TXT로 저장'(폴더 고르기 → sena-log-날짜.txt, 휴대폰에서는 Download 고르기) 추가, 버튼 순서 0,1a~c,2,3,4,5,5b,6,7,8,9. 녹음 진단 VAD를 Peak 정규화 후 값으로. 실기기(SM-F971N, v0.3.3) 전체 측정 결과는 논문 5.16절 표 22·23
- **v0.3.2**: ① 대화 모델 받기는 `modules/sena-download`(직접 만든 Expo 로컬 모듈, Kotlin). **v0.3.3부터 WorkManager 작업 `LlmDownloadWorker`가 직접 받는다** — v0.3.2의 DownloadManager는 Drive 주소를 이어 받지 못해 연결이 잠깐 끊기면 실패했다(ERROR_CANNOT_RESUME 1008, 연구자 휴대폰 '받기가 안 됨'의 원인으로 추정). 포그라운드 작업 + 진행률 알림(채널 sena_download, 알림 권한 요청), 끊기면 Result.retry()로 인터넷 연결을 기다렸다가 .part 크기부터 Range 요청으로 이어 받기, 진행 상황은 SharedPreferences(`sena_llm_download`) → `SenaDownload.status()`. 에뮬레이터: 40초 끊김 후 222MB부터 이어 받음 확인. 받는 곳은 앱 전용 외부 저장소 `Android/data/com.sena.mobile/files/models/llm.gguf`(`llmDownloadPath()`), 예전 내부 저장소 모델이 있으면 그것 사용(`llmPath()`). **expo-file-system은 외부 저장소 쓰기를 막으므로(Missing 'WRITE') 존재·크기·삭제·이름 바꾸기·머리 읽기는 네이티브 모듈 함수로**. 받기 번호는 SQLite profile `llm_download_id`, 화면이 `pollLlmDownload()`로 1초마다 읽고 다 받았으면 크기·GGUF 확인 후 `.part` → `llm.gguf` ② 설정 '대화 모델 지우기'(`deleteLlm`) ③ 첫 실행 이름 입력은 autoFocus 끔 ④ 튜토리얼 24단원 144문장(레벨마다 8단원) ⑤ 홈 화면 위젯 '오늘의 한 문장'(react-native-android-widget 0.22.1, `src/widget/`, 시작 파일 `index.ts`에서 처리기 등록, 누르면 `sena://tutorial/daily`, `dailySentence()`는 content.ts)
  - **위젯 라이브러리의 WorkManager를 R8이 지워 앱이 시작하자마자 종료**됐다 → `plugins/withSenaAndroid.js`가 proguard 유지 규칙을 넣는다(지우지 말 것)
- `src/ui/Dialog.tsx`: 모든 팝업은 `showAlert`(Android는 둥근 카드, iOS는 기본 Alert). `Alert.alert`를 직접 쓰지 않는다. `<DialogHost/>`는 `app/_layout.tsx`
- `src/ui/Splash.tsx` + app.json `expo-splash-screen`(assets/splash-logo.png, 흰 바탕 파란 SENA): 시스템 스플래시 → 같은 자리 로고 아래 "Speak English Naturally & Accurately"(머리글자 파란 굵게) 1.7초 후 사라짐
- `src/chat/` 대화 엔진 (v0.2.0부터 Gemma 3 4B Q4_K_M, `C:\dev\sena-models\llm.gguf`; 1B는 `C:\dev\sena-models-extra`): 소형 모델이 규칙을 잊으므로 **턴마다 지시를 마지막 사용자 메시지에 붙이고**(engine.turnDirective), 상황별 진행 단계(scenarios.steps, "상대의 행동"으로 기술; scenarios.stepDone 정규식에 걸리면 이미 말한 단계로 보고 건너뜀), 반복 문장 제거, 오래된 턴 요약(n_ctx 2048)
  - 문맥 유지: 학습자가 말한 문장을 **3인칭으로 바꾼 메모**(learnerNotes/thirdPerson)를 지시문에 넣고, 학습자 질문은 지시문에 다시 인용해 먼저 답하게 함. 1인칭 그대로 넣으면 모델이 I를 자기로 읽음
  - 평가: `node scripts/run-ts.mjs scripts/context-eval.ts <이름>` (Ollama, 대화 SIM_MODEL 기본 gemma3:1b, 심사 qwen3:8b) → `docs/context-eval/`. 기준선 1B 69% → 개선 1B 81% → 4B 98%
- `src/chat/report.ts` 문법 교정: "맞으면 OK" 방식은 1B에서 재현율 0% → 항상 고쳐 쓰게 하고 **기능어·같은 단어 변화형만 바뀐 경우만 채택**
- `src/tutorial/` 36문장(12단어 이하 = 8초 이내), whisper WER > 0.6이면 "다른 문장을 읽음"으로 점수 주지 않음
  - `pronunciation.ts` 받아쓰기 기반 발음 분석: 단어 정렬 → 다르게 들린 단어는 CMU 발음사전(cmu-pronouncing-dictionary) 음소 정렬 → 한국인 혼동 쌍 요령. PC 평가 `scripts/pron-eval.ts`(AI-Hub test 300문장, 결과 `track_b/pron_eval/`)
- `src/tts.ts` 기기 TTS 음성 자동 선택(영어·오프라인·Enhanced 우선) + 설정에서 선택(`profile.tts_voice`). `expo-speech`를 직접 쓰지 말고 이 모듈을 쓴다
- `plugins/withSenaAndroid.js`: onnxruntime-android 버전 고정(1.24.3), 자동 백업에서 모델 폴더 제외, Windows용 cmake.dir 지정, `SENA_BUNDLE_MODELS` 폴더의 모델 + golden/ + golden_raw/를 `assets/sena/`에 넣고 `manifest.json` 작성 → `src/models/installer.ts`가 첫 실행 때 files/로 복사(마커 `.installed-v3`). 담는 모델: sena_scorer.onnx, silero_vad.onnx, **ggml-base.en-q8_0.bin**(whisper 8비트, v0.3.1부터. 300문장 평가에서 원본과 지표 차이 없음 `track_b/pron_eval/quant_compare.md`). llm.gguf는 `SENA_BUNDLE_LLM=1`일 때만. **ABI split**: arm64(휴대폰, 약 358MB)와 x86_64(에뮬레이터, 약 306MB) APK를 따로 만든다
- `patches/`: patch-package (postinstall 자동 적용)
  - onnxruntime-react-native: Gradle 9에서 삭제된 `VersionNumber` 사용 블록 비활성화
  - react-native-audio-api: Gradle이 실행하는 Git bash.exe에 unzip/curl PATH 추가

## 검증 (PC)
```
npm test              # 단위 테스트 68건
npm run typecheck
npm run sim:chat      # Ollama gemma3:1b 필요
npm run sim:report
npm run verify:pc -- "C:/Users/ohje/Desktop/프리씨랩/SENA 모음집/SENA"
```

## Android 빌드 (Windows)
- JDK 17(JAVA_HOME 시스템 변수), ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk, SDK 36·NDK 30·CMake 3.31.6 설치됨
- 에뮬레이터: `Medium_Phone_API_37.0` (x86_64, RAM 8GB로 변경. 원래 설정은 `config.ini.bak-before-sena`)
- 빌드: PowerShell에서 `npx expo run:android --no-bundler --device emulator-5554`, 실행 중엔 `npx expo start --dev-client`
- C++ 빌드 경로가 260자를 넘으므로 **Windows LongPathsEnabled=1** 필요(관리자 권한, 사용자가 직접 설정)
- 모델·골든 샘플 전송: `scripts\push-assets.ps1` (앱 설치 후), 결과 회수: `scripts\pull-results.ps1`
- Git Bash의 tar 문제로 npm install은 PowerShell에서
- 시험 APK: PowerShell에서 `$env:SENA_BUNDLE_MODELS='C:\dev\sena-models'; npx expo prebuild --platform android --no-install` → `android\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a,x86_64" --max-workers=1` (`CMAKE_BUILD_PARALLEL_LEVEL=2`). 출력: `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`(휴대폰용, Drive에 올리는 것)·`app-x86_64-release.apk`(에뮬레이터). app.json 플러그인·스플래시를 바꾸면 prebuild부터 다시. 릴리스는 debuggable이 아니라 run-as가 안 되므로 앱 안 기술 검증 화면으로 확인
- 에뮬레이터 조작: adb는 `"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"`, Git Bash에서는 `MSYS_NO_PATHCONV=1`. 앱 실행 `am start -n com.sena.mobile/.MainActivity`
- **Python으로 TS 파일을 고칠 때 정규식 `\b` 주의**: 일반 문자열의 `\b`가 백스페이스(0x08)로 들어가 정규식이 조용히 깨진다(2026-10-23에 engine·chat-sim에서 발생). raw 문자열을 쓰거나 Edit 도구 사용
