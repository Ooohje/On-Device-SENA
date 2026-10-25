import { File } from 'expo-file-system';
import { toUri } from '../config';
import { DEVICE_ROOT } from '../paths';

// 테스트 배포용 APK(SENA_BUNDLE_MODELS로 빌드)는 모델과 골든 샘플을 APK assets/sena/에 담고 목록을 manifest.json에 적는다.
// llama.cpp·whisper.cpp·ONNX Runtime은 파일 경로가 필요하므로, 처음 실행할 때 한 번 앱 저장소(files/)로 복사한다.
// Play 스토어 배포판은 Play Asset Delivery로 받으므로 이 과정이 없다.
const MARKER = `${DEVICE_ROOT}/models/.installed-v3`; // v3: 음성 인식 모델을 q8_0으로 교체(v0.3.1) // 모든 복사가 끝난 뒤에만 만든다 (중간에 꺼지면 다시 복사)

const asset = (rel: string) => new File(`asset:///sena/${rel}`);

export function bundledFiles(): string[] {
  try {
    const m = asset('manifest.json');
    if (!m.exists) return [];
    return (JSON.parse(m.textSync()).files as string[]) ?? [];
  } catch {
    return [];
  }
}

export function needsInstall(): boolean {
  return bundledFiles().length > 0 && !new File(toUri(MARKER)).exists;
}

export async function installBundledModels(onProgress: (done: number, total: number, name: string) => void) {
  const files = bundledFiles();
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    onProgress(i, files.length, rel);
    const dest = new File(toUri(`${DEVICE_ROOT}/${rel}`));
    if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
    if (dest.exists) dest.delete();
    await (asset(rel) as any).copy(dest); // 네이티브 비동기 복사 (UI가 멈추지 않음)
  }
  // 예전 버전이 복사해 둔 원본 음성 인식 모델(148MB)은 더는 쓰지 않으므로 지운다
  const old = new File(toUri(`${DEVICE_ROOT}/models/ggml-base.en.bin`));
  if (old.exists) old.delete();
  const marker = new File(toUri(MARKER));
  if (!marker.parentDirectory.exists) marker.parentDirectory.create({ intermediates: true });
  if (!marker.exists) marker.create();
  onProgress(files.length, files.length, '');
}
