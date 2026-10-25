import { requireOptionalNativeModule } from 'expo-modules-core';

// 대화 모델 받기와 앱 전용 외부 저장소 파일 다루기 (android/src/main/java/expo/modules/senadownload/).
// 받기는 WorkManager 작업(LlmDownloadWorker): 앱을 닫아도 계속, 상단바 진행률, 연결이 끊기면 이어 받기.
// iOS에는 없으므로 null — 그때는 expo-file-system DownloadTask로 받는다 (src/models/llmImport.ts)
export type SystemDownloadStatus = {
  status: 'running' | 'waiting' | 'done' | 'failed';
  downloaded: number;
  total: number;
  reason: string; // waiting/failed 이유: network, server, short, http
  code: number; // HTTP 코드(있으면)
  work: string; // WorkManager 작업 상태(ENQUEUED, RUNNING, ...)
};

type SenaDownloadModule = {
  externalDir(): string | null;
  start(url: string, relPath: string, bytes: number): void; // relPath: externalDir 기준 상대 경로
  status(): SystemDownloadStatus | null;
  cancel(): void;
  exists(path: string): boolean;
  size(path: string): number; // 없으면 -1
  delete(path: string): boolean;
  rename(from: string, to: string): boolean;
  head(path: string): string; // 앞 4바이트
};

export const SenaDownload = requireOptionalNativeModule<SenaDownloadModule>('SenaDownload');
