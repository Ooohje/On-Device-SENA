// 오디오·모델 입력 상수 (PC 검증 스크립트에서도 쓰므로 React Native 의존성을 두지 않는다)
export const SR = 16000;
export const MAX_LEN = SR * 8; // 128,000 samples — 학습과 동일
export const VAD_PAD = SR * 0.25; // 250ms

export const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);
