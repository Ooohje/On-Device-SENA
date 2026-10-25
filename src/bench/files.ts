import { SenaDownload } from '../../modules/sena-download';
import { Directory, File } from 'expo-file-system';
import { decodeWav, toMono16k } from '../audio/wav';
import { toUri } from '../config';
import { PATHS } from '../paths';

// 앱 전용 외부 저장소(다운로드 관리자가 받은 대화 모델)는 expo-file-system이 접근을 막으므로 Android에서는 네이티브 모듈로 확인한다
export const exists = (path: string) => (SenaDownload ? SenaDownload.exists(path) : new File(toUri(path)).exists);

export async function readJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await new File(toUri(path)).text());
}

export async function readWav16k(path: string): Promise<Float32Array> {
  return toMono16k(decodeWav(await new File(toUri(path)).arrayBuffer()));
}

// 측정 결과를 기기에 저장 → `adb pull`로 PC에 가져와 비교한다 (scripts/pull-results.ps1)
export function saveResult(name: string, data: unknown) {
  const dir = new Directory(toUri(PATHS.resultsDir));
  if (!dir.exists) dir.create({ intermediates: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const f = new File(dir, `${name}-${stamp}.json`);
  f.create();
  f.write(JSON.stringify(data, null, 2));
  return f.uri;
}
