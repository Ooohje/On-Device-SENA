import { DownloadTask, File, Paths } from 'expo-file-system';
import { PermissionsAndroid, Platform } from 'react-native';
import { SenaDownload } from '../../modules/sena-download';
import { toUri } from '../config';
import { llmDownloadPath, llmPath, PATHS } from '../paths';
import { setLlmDownloadId } from '../store/db';

// 대화 모델(llm.gguf, 2.5GB)은 APK에 넣지 않는다(APK 안 모델을 앱 저장소로 복사하면 같은 파일이 두 번 저장되어 앱이 5.8GB가 된다).
// 시험 배포에서는 앱이 처음 한 번 인터넷에서 앱 저장소로 바로 받는다. 다운로드 폴더를 거치지 않아 사용자가 지울 파일이 없다.
// Android는 기본 다운로드 관리자(modules/sena-download)로 받아 앱을 닫아도 계속 받고 상단바 알림에 진행률이 보인다.
// Play 스토어 배포판은 Play Asset Delivery(fast-follow)로 받는다.
// 모델 파일: Google Drive 영어 발화 피드백 모델/APK/SENA-model-gemma3-4b.gguf ("링크가 있는 모든 사용자" 보기 권한 필요)
const LLM_URL = 'https://drive.usercontent.google.com/download?id=1ev1iEDBOXXr_1Trw5HOsBH9JRFL3njXt&export=download&confirm=t';
export const LLM_BYTES = 2_499_012_288; // C:\dev\sena-models\llm.gguf와 같은 크기. 받은 파일이 이 크기가 아니면 버린다
export const NEED_FREE = LLM_BYTES + 300e6; // 받는 동안 여유 공간

// 파일 다루기: Android는 네이티브 모듈(외부 저장소에 쓸 수 있음), iOS는 expo-file-system(내부 저장소)
const fsx = {
  exists: (p: string) => (SenaDownload ? SenaDownload.exists(p) : new File(toUri(p)).exists),
  size: (p: string) => (SenaDownload ? SenaDownload.size(p) : new File(toUri(p)).exists ? new File(toUri(p)).size : -1),
  remove: (p: string) => {
    if (SenaDownload) SenaDownload.delete(p);
    else if (new File(toUri(p)).exists) new File(toUri(p)).delete();
  },
  rename: (from: string, to: string) => {
    if (SenaDownload) return SenaDownload.rename(from, to);
    const dest = new File(toUri(to));
    if (dest.exists) dest.delete();
    new File(toUri(from)).move(dest);
    return true;
  },
  head: (p: string) => {
    if (SenaDownload) return SenaDownload.head(p);
    const h = new File(toUri(p)).open();
    const b = h.readBytesSync(4);
    h.close();
    return String.fromCharCode(...b);
  },
};

export const hasLlm = () => fsx.exists(llmPath());

// waiting: 인터넷 연결을 기다리는 중(연결되면 받은 곳부터 이어 받는다). note에 이유를 담아 화면에 보여 준다
export type DownloadState = { phase: 'none' | 'running' | 'waiting' | 'done' | 'failed'; got: number; total: number; error?: string; note?: string };

const WAIT_NOTE: Record<string, string> = {
  network: '인터넷 연결을 기다리는 중이에요. 연결되면 받은 곳부터 이어 받아요.',
  server: '모델 서버가 잠시 바빠요. 조금 뒤 자동으로 다시 받아요.',
  short: '연결이 끊겨 이어 받는 중이에요.',
};

const partPath = () => `${llmDownloadPath()}.part`;
const REL_PART = 'models/llm.gguf.part'; // 네이티브 받기 작업용, 앱 전용 외부 저장소 기준 (partPath()와 같은 파일)

export async function startLlmDownload() {
  if (Paths.availableDiskSpace < NEED_FREE) throw new Error(`휴대폰 저장 공간이 부족해요. 약 ${(NEED_FREE / 1e9).toFixed(1)}GB가 비어 있어야 해요.`);
  if (SenaDownload) {
    // Android 13+: 상단바 진행률 알림을 보이려면 알림 권한이 필요하다(거절해도 받기는 계속된다)
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any).catch(() => undefined);
    }
    SenaDownload.start(LLM_URL, REL_PART, LLM_BYTES); // 받던 .part가 있으면 이어 받는다
    return;
  }
  startInApp();
}

// 화면이 1초마다 부른다. 다 받았으면 확인 후 이름을 바꿔 모델로 쓴다
export function pollLlmDownload(): DownloadState {
  if (!SenaDownload) return inApp;
  const q = SenaDownload.status();
  if (!q) return { phase: hasLlm() ? 'done' : 'none', got: 0, total: LLM_BYTES };
  const total = q.total > 0 ? q.total : LLM_BYTES;
  if (q.status === 'running') return { phase: 'running', got: q.downloaded, total, note: q.downloaded ? undefined : '받기를 준비하는 중이에요.' };
  if (q.status === 'waiting') return { phase: 'waiting', got: q.downloaded, total, note: WAIT_NOTE[q.reason] ?? WAIT_NOTE.network };
  SenaDownload.cancel(); // 끝난 작업의 상태를 정리한다
  if (q.status === 'failed') {
    fsx.remove(partPath());
    return { phase: 'failed', got: 0, total, error: `모델을 받지 못했어요${q.code ? `(서버 응답 ${q.code})` : ''}. 잠시 후 다시 받아 주세요.` };
  }
  const error = finish(partPath());
  return error ? { phase: 'failed', got: 0, total, error } : { phase: 'done', got: total, total };
}

export function cancelLlmDownload() {
  SenaDownload?.cancel();
  setLlmDownloadId(null); // v0.3.2(다운로드 관리자) 때 남은 번호 정리
  inAppTask?.cancel();
  inAppTask = null;
  inApp = { phase: 'none', got: 0, total: LLM_BYTES };
  fsx.remove(partPath());
}

// 설정 > 대화 모델 지우기: 휴대폰 공간 2.5GB 확보. 다시 쓰려면 다시 받는다
export function deleteLlm() {
  cancelLlmDownload();
  for (const p of [PATHS.llm, llmDownloadPath()]) fsx.remove(p);
}

// 받은 임시 파일(.part)의 크기·앞 4바이트('GGUF')를 확인하고 이름을 바꾼다. 받다가 끊긴 파일을 모델로 쓰지 않게
function finish(part: string, dest = llmDownloadPath()): string | null {
  if (!fsx.exists(part)) return '받은 파일을 찾지 못했어요. 다시 받아 주세요.';
  const bad = checkLlm(part);
  if (bad) {
    fsx.remove(part);
    return bad;
  }
  if (!fsx.rename(part, dest)) return '받은 파일을 정리하지 못했어요. 다시 받아 주세요.';
  return null;
}

function checkLlm(path: string): string | null {
  // Drive가 파일 대신 안내 페이지(HTML)를 주거나 중간에 끊기면 크기가 다르다
  if (fsx.size(path) !== LLM_BYTES) return '모델 파일을 끝까지 받지 못했어요. 인터넷 연결을 확인하고 다시 받아 주세요.';
  try {
    if (fsx.head(path) !== 'GGUF') return '받은 파일이 대화 모델이 아니에요. 다시 받아 주세요.';
  } catch {
    // 읽기에 실패하면 크기 확인만으로 넘어간다
  }
  return null;
}

// 다운로드 관리자 모듈이 없는 플랫폼(iOS): 앱 안에서 받는다
let inAppTask: DownloadTask | null = null;
let inApp: DownloadState = { phase: 'none', got: 0, total: LLM_BYTES };
const inAppPart = () => `${PATHS.llm}.part`;
function startInApp() {
  const dest = new File(toUri(PATHS.llm));
  if (!dest.parentDirectory.exists) dest.parentDirectory.create({ intermediates: true });
  fsx.remove(inAppPart());
  const part = new File(toUri(inAppPart()));
  const note = undefined;
  inApp = { phase: 'running', got: 0, total: LLM_BYTES, note };
  inAppTask = new DownloadTask(LLM_URL, part, {
    sessionType: 'background',
    onProgress: ({ bytesWritten, totalBytes }) => (inApp = { phase: 'running', got: bytesWritten, total: totalBytes > 0 ? totalBytes : LLM_BYTES, note }),
  });
  inAppTask
    .downloadAsync()
    .then(() => {
      const error = finish(inAppPart(), PATHS.llm);
      inApp = error ? { phase: 'failed', got: 0, total: LLM_BYTES, error } : { phase: 'done', got: LLM_BYTES, total: LLM_BYTES };
    })
    .catch((e) => (inApp = { phase: 'failed', got: 0, total: LLM_BYTES, error: `모델을 받지 못했어요. 인터넷 연결을 확인하고 다시 받아 주세요. (${e?.message ?? e})` }))
    .finally(() => (inAppTask = null));
}
