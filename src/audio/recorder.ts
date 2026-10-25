import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { SR } from '../config';
import { toMono16k } from './wav';

export type Recording = { samples: Float32Array; deviceSampleRate: number; seconds: number };

// 마이크 PCM을 콜백으로 받아 모은다. 기기가 16kHz를 지원하지 않으면 다른 샘플레이트로 올 수 있어 기록 후 변환한다.
export class PcmRecorder {
  private recorder = new AudioRecorder();
  private chunks: Float32Array[] = [];
  private rate = SR;

  static async ensurePermission() {
    const s = await AudioManager.requestRecordingPermissions();
    if (s !== 'Granted') throw new Error(`마이크 권한 없음: ${s}`);
  }

  async start() {
    await PcmRecorder.ensurePermission();
    this.chunks = [];
    const r = this.recorder.onAudioReady({ sampleRate: SR, bufferLength: 1600, channelCount: 1 }, (e) => {
      this.rate = e.buffer.sampleRate;
      this.chunks.push(new Float32Array(e.buffer.getChannelData(0)));
    });
    if (r.status === 'error') throw new Error(r.message);
    const s = await this.recorder.start();
    if (s.status === 'error') throw new Error(s.message);
  }

  async stop(): Promise<Recording> {
    await this.recorder.stop();
    this.recorder.clearOnAudioReady();
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    return { samples: toMono16k({ samples: all, sampleRate: this.rate }), deviceSampleRate: this.rate, seconds: n / this.rate };
  }
}
