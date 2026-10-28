import * as Device from 'expo-device';
import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { LLM_BYTES, NEED_FREE } from './llmImport';

// 대화 모델(Gemma 3 4B, 2.5GB)을 받기 전에 이 기기가 최소 사양을 만족하는지 본다.
// 휴대폰이 알려 주는 RAM은 표기보다 작다(6GB 기기 ≈ 5.3–5.6GB, 8GB 기기 ≈ 7.2–7.6GB, 4GB 기기 ≈ 3.5GB). 그래서 기준을 표기보다 조금 낮게 둔다
export const RAM_MIN_GB = 5.0; // 이보다 작으면(4GB 이하 기기) 대화 모델을 올리지 못한다
export const RAM_REC_GB = 7.0; // 이 이상(8GB 이상 기기)이면 권장 사양
const MIN_API = 24;

export type Mark = 'ok' | 'warn' | 'fail';
export type CheckRow = { key: 'ram' | 'storage' | 'cpu' | 'os'; label: string; value: string; need: string; mark: Mark };
export type DeviceCheck = {
  rows: CheckRow[];
  verdict: 'recommended' | 'ok' | 'unsupported'; // 기기 자체(RAM·CPU·OS) 판정
  storageOk: boolean; // 저장 공간은 비우면 해결되므로 따로 본다
  canDownload: boolean;
  summary: string;
};

export const ramGb = () => (Device.totalMemory ? Device.totalMemory / 1024 ** 3 : null);

// 기기 RAM만으로 대화 가능 여부(대화 화면·홈 안내에서도 같은 기준을 쓴다). 알 수 없으면 막지 않는다
export function ramVerdict(): Mark {
  const gb = ramGb();
  if (gb === null) return 'ok';
  return gb < RAM_MIN_GB ? 'fail' : gb < RAM_REC_GB ? 'warn' : 'ok';
}

export function checkDevice(): DeviceCheck {
  const gb = ramGb();
  const ram = ramVerdict();
  const free = Paths.availableDiskSpace;
  const storageOk = free >= NEED_FREE;
  const abis = Device.supportedCpuArchitectures ?? [];
  // 앱의 네이티브 라이브러리는 64비트(arm64-v8a, 에뮬레이터는 x86_64)만 들어 있다
  const cpu: Mark = !abis.length || abis.some((a) => a === 'arm64-v8a' || a === 'x86_64' || a === 'arm64') ? 'ok' : 'fail';
  const api = Device.platformApiLevel;
  const os: Mark = Platform.OS !== 'android' || !api || api >= MIN_API ? 'ok' : 'fail';

  const rows: CheckRow[] = [
    {
      key: 'ram',
      label: '메모리(RAM)',
      value: gb === null ? '알 수 없음' : `${gb.toFixed(1)}GB`,
      need: ram === 'fail' ? '6GB 이상 필요' : ram === 'warn' ? '8GB 이상 권장 · 응답이 조금 느릴 수 있어요' : '권장 사양',
      mark: ram,
    },
    {
      key: 'storage',
      label: '남은 저장 공간',
      value: `${(free / 1e9).toFixed(1)}GB`,
      need: storageOk ? `모델 ${(LLM_BYTES / 1e9).toFixed(1)}GB를 받을 수 있어요` : `${(NEED_FREE / 1e9).toFixed(1)}GB 이상 비워 주세요`,
      mark: storageOk ? 'ok' : 'fail',
    },
    { key: 'cpu', label: '프로세서', value: abis[0] ?? '알 수 없음', need: cpu === 'ok' ? '64비트 지원' : '64비트 기기만 지원', mark: cpu },
    {
      key: 'os',
      label: Platform.OS === 'android' ? 'Android 버전' : 'OS 버전',
      value: `${Device.osVersion ?? '?'}${api ? ` (API ${api})` : ''}`,
      need: os === 'ok' ? '지원' : 'Android 7.0 이상 필요',
      mark: os,
    },
  ];

  const verdict = ram === 'fail' || cpu === 'fail' || os === 'fail' ? 'unsupported' : ram === 'warn' ? 'ok' : 'recommended';
  const summary =
    verdict === 'unsupported'
      ? '이 기기는 대화 모델의 최소 사양을 만족하지 않아요. 튜토리얼(발음·운율 채점)은 그대로 쓸 수 있어요.'
      : !storageOk
        ? '기기 사양은 충분해요. 저장 공간을 조금 비우면 대화 모델을 받을 수 있어요.'
        : verdict === 'ok'
          ? '대화 모델을 쓸 수 있어요. 메모리가 권장보다 작아 응답이 조금 느릴 수 있어요.'
          : '이 기기는 대화 모델을 쓰기에 충분해요.';
  return { rows, verdict, storageOk, canDownload: verdict !== 'unsupported' && storageOk, summary };
}
