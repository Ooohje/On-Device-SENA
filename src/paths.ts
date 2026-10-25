import { File, Paths } from 'expo-file-system';
import { SenaDownload } from '../modules/sena-download';

// 모델·골든 샘플 위치: 앱 내부 저장소(files/).
// 개발 중에는 scripts/push-assets.ps1이 adb `run-as`로 복사한다. 외부 저장소(Android/data)에 adb로 먼저 폴더를 만들면
// 폴더 주인이 shell이 되어 앱이 읽지 못한다(EACCES, system error 13) — 그래서 내부 저장소를 쓴다.
// 출시 빌드에서는 Play Asset Delivery 경로로 바뀐다.
export const DEVICE_ROOT = Paths.document.uri.replace(/^file:\/\//, '').replace(/\/$/, '');

export const PATHS = {
  scorer: `${DEVICE_ROOT}/models/sena_scorer.onnx`,
  vad: `${DEVICE_ROOT}/models/silero_vad.onnx`,
  whisper: `${DEVICE_ROOT}/models/ggml-base.en-q8_0.bin`, // 8비트 양자화 (원본 ggml-base.en.bin 148MB → 82MB)
  llm: `${DEVICE_ROOT}/models/llm.gguf`, // 예전 위치(개발 중 push-assets, v0.3.1 1차). 새로 받는 모델은 llmDownloadPath()
  goldenDir: `${DEVICE_ROOT}/golden`, // Track A: 전처리 완료 음성 + golden_expected.json
  goldenRawDir: `${DEVICE_ROOT}/golden_raw`, // 원본 음성 + golden_raw.json (전처리 포팅 검증)
  resultsDir: `${DEVICE_ROOT}/results`,
};

// 대화 모델: Android 다운로드 관리자는 앱 전용 외부 저장소(Android/data/<앱>/files)에만 받을 수 있어, 새로 받는 모델은 그곳에 둔다.
// 내부 저장소에 예전에 받은 모델이 있으면 그것을 계속 쓴다. iOS(다운로드 관리자 없음)는 내부 저장소
const EXTERNAL_ROOT = (() => {
  try {
    return SenaDownload?.externalDir() ?? null;
  } catch {
    return null;
  }
})();
export const llmDownloadPath = () => (EXTERNAL_ROOT ? `${EXTERNAL_ROOT}/models/llm.gguf` : PATHS.llm);
export const llmPath = () => (new File(`file://${PATHS.llm}`).exists ? PATHS.llm : llmDownloadPath()); // 내부 저장소 확인은 expo-file-system으로 충분
