// SENA Android 빌드 설정 (expo prebuild 때 적용)
// 1) onnxruntime-react-native가 매 빌드마다 최신 onnxruntime-android(latest.integration)를 받는 것을
//    JS 패키지와 같은 버전으로 고정한다 → 빌드 재현성 확보, PC 검증(onnxruntime-node)과 같은 버전.
// 2) 자동 백업(Google Drive, 앱당 25MB)에서 모델·골든 샘플·측정 결과를 뺀다.
//    한도를 넘으면 백업 전체가 실패해 사용자 학습 기록(SQLite)까지 백업되지 않기 때문.
const { withProjectBuildGradle, withAppBuildGradle, withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ORT_VERSION = require('onnxruntime-react-native/package.json').version;
const MARK = '// sena: pin onnxruntime-android';

const withOrtPin = (config) =>
  withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK)) {
      c.modResults.contents += `
${MARK}
allprojects {
  configurations.all {
    resolutionStrategy.force "com.microsoft.onnxruntime:onnxruntime-android:${ORT_VERSION}"
  }
}
`;
    }
    return c;
  });

// 백업 대상: 학습 기록(SQLite)만. 개발용 모델·골든·결과 폴더(내부 files/, 외부 저장소 모두)는 제외.
const EXCLUDES = ['models/', 'golden/', 'golden_raw/', 'results/'];
const excludeLines = (indent) =>
  EXCLUDES.flatMap((p) => ['file', 'external'].map((d) => `${indent}<exclude domain="${d}" path="${p}" />`)).join('\n');
const dataExtractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludeLines('    ')}
  </cloud-backup>
  <device-transfer>
${excludeLines('    ')}
  </device-transfer>
</data-extraction-rules>
`;
const fullBackupContent = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludeLines('  ')}
</full-backup-content>
`;

const withBackupRules = (config) => {
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'sena_data_extraction_rules.xml'), dataExtractionRules);
      fs.writeFileSync(path.join(dir, 'sena_backup_rules.xml'), fullBackupContent);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.$['android:allowBackup'] = 'true';
    app.$['android:dataExtractionRules'] = '@xml/sena_data_extraction_rules'; // Android 12+
    app.$['android:fullBackupContent'] = '@xml/sena_backup_rules'; // Android 11 이하
    return c;
  });
};

// 3) Windows: C++ 빌드 경로가 260자를 넘는다(예: react-native-safe-area-context 코드젠 오브젝트 310자).
//    AGP 기본 CMake 3.22.1의 ninja 1.10은 긴 경로를 못 쓰므로, SDK에 설치된 가장 새 CMake(ninja 1.12+)를
//    local.properties의 cmake.dir로 지정한다. Windows의 LongPathsEnabled=1도 함께 필요하다.
const withWindowsCmake = (config) =>
  withDangerousMod(config, [
    'android',
    (c) => {
      if (process.platform !== 'win32') return c;
      const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
      const cmakeRoot = path.join(sdk, 'cmake');
      if (!fs.existsSync(cmakeRoot)) return c;
      const parse = (v) => v.split('.').map(Number);
      const newer = (a, b) => {
        const [x, y] = [parse(a), parse(b)];
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
        return false;
      };
      // CMake 4.x는 일부 라이브러리의 오래된 cmake_minimum_required와 충돌할 수 있어 3.x 중 최신을 쓴다
      const versions = fs.readdirSync(cmakeRoot).filter((v) => /^3\.\d+\.\d+$/.test(v) && newer(v, '3.29.99'));
      if (!versions.length) return c;
      const best = versions.reduce((a, b) => (newer(b, a) ? b : a));
      const file = path.join(c.modRequest.platformProjectRoot, 'local.properties');
      let props = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('cmake.dir=')) : [];
      props.push(`cmake.dir=${path.join(cmakeRoot, best).replace(/\\/g, '\\\\').replace(/:/g, '\\:')}`);
      fs.writeFileSync(file, props.join('\n') + '\n');
      return c;
    },
  ]);

// 4) onnxruntime-react-native의 Expo 플러그인은 Gradle 의존성만 추가하고 패키지 등록은 RN 자동 연결에 맡기는데,
//    이 프로젝트(Expo SDK 58)에서는 자동 연결 목록에서 빠져 NativeModules.Onnxruntime이 null이 된다. 직접 등록한다.
const ORT_PACKAGE = 'add(ai.onnxruntime.reactnative.OnnxruntimePackage())';
const withOrtPackage = (config) =>
  withMainApplication(config, (c) => {
    if (!c.modResults.contents.includes(ORT_PACKAGE)) {
      c.modResults.contents = c.modResults.contents.replace(
        /(PackageList\(this\)\.packages\.apply \{\n)/,
        `$1          ${ORT_PACKAGE} // sena: onnxruntime-react-native 수동 등록\n`,
      );
      if (!c.modResults.contents.includes(ORT_PACKAGE)) throw new Error('MainApplication에 onnxruntime 패키지를 등록하지 못했습니다');
    }
    return c;
  });

// 5) 테스트 배포용 APK: 환경변수 SENA_BUNDLE_MODELS=<모델 폴더>로 prebuild하면 모델을 APK assets/models에 넣는다.
//    앱은 첫 실행 때 files/models로 복사한다(src/models/installer.ts). 압축하지 않게 해서 빌드·복사를 빠르게 한다.
//    Play 스토어 배포판은 이 변수 없이 빌드하고 Play Asset Delivery를 쓴다.
const WHISPER_FILE = 'ggml-base.en-q8_0.bin'; // v0.3.1부터 8비트 양자화(148→82MB). 300문장 평가에서 원본과 지표 차이 없음(track_b/pron_eval/quant_compare.md) // src/paths.ts의 PATHS.whisper와 같은 이름
// 대화 모델(llm.gguf, 2.5GB)은 APK에 넣지 않는다. APK에 넣으면 첫 실행 때 앱 저장소로 복사해 같은 파일이 두 번 저장된다(앱 용량 5.8GB).
// 시험 배포에서는 모델 파일을 따로 받아 앱의 '대화 모델 가져오기'로 한 번 복사한다(app/model-import.tsx). 예전처럼 넣으려면 SENA_BUNDLE_LLM=1
const BUNDLE_FILES = ['sena_scorer.onnx', 'silero_vad.onnx', WHISPER_FILE, ...(process.env.SENA_BUNDLE_LLM === '1' ? ['llm.gguf'] : [])];
const BUNDLE_DIRS = ['golden', 'golden_raw']; // 기술 검증 화면용 골든 샘플 (있으면 함께 담는다)
// 테스트 APK: SENA_BUNDLE_MODELS 폴더의 모델(+골든 샘플)을 assets/sena/에 담고 목록(manifest.json)을 쓴다.
// 앱은 처음 실행할 때 목록대로 files/로 복사한다 (src/models/installer.ts).
const withBundledModels = (config) => {
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const assets = path.join(c.modRequest.platformProjectRoot, 'app/src/main/assets');
      fs.rmSync(path.join(assets, 'models'), { recursive: true, force: true }); // 예전 위치
      const dst = path.join(assets, 'sena');
      fs.rmSync(dst, { recursive: true, force: true });
      const src = process.env.SENA_BUNDLE_MODELS;
      if (!src) return c;
      const files = [];
      const put = (from, rel) => {
        fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
        fs.copyFileSync(from, path.join(dst, rel));
        files.push(rel);
      };
      for (const f of BUNDLE_FILES) {
        const from = path.join(src, f);
        if (!fs.existsSync(from)) throw new Error(`SENA_BUNDLE_MODELS에 ${f}가 없습니다: ${from}`);
        put(from, `models/${f}`);
      }
      for (const d of BUNDLE_DIRS) {
        const dir = path.join(src, d);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) put(path.join(dir, f), `${d}/${f}`);
      }
      fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify({ version: 2, files }, null, 1));
      return c;
    },
  ]);
  return withAppBuildGradle(config, (c) => {
    const MARK = '// sena: no-compress models';
    if (!c.modResults.contents.includes(MARK))
      c.modResults.contents += `\n${MARK}\nandroid { androidResources { noCompress += ['onnx', 'gguf', 'bin', 'wav'] } }\n`;
    // 휴대폰(arm64)과 에뮬레이터(x86_64)용 APK를 따로 만든다. 휴대폰 APK에 x86_64 라이브러리(93MB)가 들어가지 않게
    const SPLIT = '// sena: abi split';
    if (!c.modResults.contents.includes(SPLIT))
      c.modResults.contents += `\n${SPLIT}\nandroid { splits { abi { enable true; reset(); include 'arm64-v8a', 'x86_64'; universalApk false } } }\n`;
    return c;
  });
};

// 6) 홈 화면 위젯(react-native-android-widget)이 쓰는 WorkManager는 Room 데이터베이스 클래스(WorkDatabase_Impl)를 이름으로 찾는다.
//    릴리스 빌드의 R8(full mode)이 이름을 바꾸거나 지우면 앱이 시작하자마자 종료된다
//    ("Failed to create an instance of class androidx.work.impl.WorkDatabase", 2026-10-24 에뮬레이터) → 유지 규칙을 넣는다
const KEEP_MARK = '# sena: keep WorkManager/Room for widgets';
const withWorkManagerKeep = (config) =>
  withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app/proguard-rules.pro');
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!cur.includes(KEEP_MARK))
        fs.writeFileSync(
          file,
          cur +
            `
${KEEP_MARK}
-keep class androidx.work.impl.WorkDatabase { *; }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.** { *; }
-keep class com.reactnativeandroidwidget.** { *; }
`,
        );
      return c;
    },
  ]);

module.exports = (config) => withWorkManagerKeep(withBundledModels(withOrtPackage(withWindowsCmake(withBackupRules(withOrtPin(config))))));
