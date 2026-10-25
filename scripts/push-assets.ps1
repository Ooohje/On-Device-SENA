# 모델과 골든 샘플을 연결된 Android 기기의 앱 내부 저장소(files/)로 보낸다 (src/paths.ts의 DEVICE_ROOT).
# 사용: powershell -ExecutionPolicy Bypass -File scripts\push-assets.ps1
# 디버그 빌드를 한 번 설치한 뒤 실행한다. adb push로 /data/local/tmp에 올리고, `run-as`(앱 권한)로 files/에 복사한다.
# 외부 저장소(Android/data)에 adb로 먼저 폴더를 만들면 폴더 주인이 shell이 되어 앱이 읽지 못한다(system error 13).
$ErrorActionPreference = 'Stop'

$mobile = 'C:\Users\ohje\Desktop\프리씨랩\SENA 모음집\SENA\0. mobile project'
$trackA = Join-Path $mobile 'track_a\outputs\mobile'
$trackB = Join-Path $mobile 'track_b\golden_raw'
$models = 'C:\dev\sena-models'
$pkg = 'com.sena.mobile'
$tmp = '/data/local/tmp/sena'

if (-not (adb devices | Select-String "`tdevice$")) { throw 'adb에 연결된 기기가 없습니다 (adb devices 확인).' }

# 예전 방식(외부 저장소)으로 만든 shell 소유 폴더가 있으면 지운다
adb shell rm -rf "/storage/emulated/0/Android/data/$pkg/files" 2>$null
adb shell rm -rf $tmp
adb shell mkdir -p "$tmp/models" "$tmp/golden" "$tmp/golden_raw"

function Push($src, $dst) {
  if (-not (Test-Path $src)) { Write-Warning "없음(건너뜀): $src"; return }
  # adb push는 한글 경로를 못 다루는 경우가 있어 영문 임시 폴더를 거친다
  $local = Join-Path $env:TEMP ('sena_push_' + [IO.Path]::GetFileName($src))
  Copy-Item -Force $src $local
  adb push $local $dst | Select-Object -Last 1
  Remove-Item -Force $local
}

Push (Join-Path $trackA 'sena_scorer.onnx') "$tmp/models/sena_scorer.onnx"
Push (Join-Path $trackB 'silero_vad.onnx') "$tmp/models/silero_vad.onnx"
Push (Join-Path $models 'ggml-base.en-q8_0.bin') "$tmp/models/ggml-base.en-q8_0.bin"
Push (Join-Path $models 'llm.gguf') "$tmp/models/llm.gguf"
Push (Join-Path $trackA 'golden_expected.json') "$tmp/golden/golden_expected.json"
Get-ChildItem (Join-Path $trackA 'golden') -Filter *.wav -ErrorAction SilentlyContinue | ForEach-Object { Push $_.FullName "$tmp/golden/$($_.Name)" }
Push (Join-Path $trackB 'golden_raw.json') "$tmp/golden_raw/golden_raw.json"
Get-ChildItem (Join-Path $trackB 'wav') -Filter *.wav -ErrorAction SilentlyContinue | ForEach-Object { Push $_.FullName "$tmp/golden_raw/$($_.Name)" }

adb shell chmod -R a+rX $tmp
adb shell run-as $pkg sh -c "'mkdir -p files/results && cp -r $tmp/models $tmp/golden $tmp/golden_raw files/'"
adb shell rm -rf $tmp
adb shell run-as $pkg ls -la files/models files/golden files/golden_raw
