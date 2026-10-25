# 기기에 저장된 측정 결과(JSON)를 PC로 가져온다 (앱 내부 저장소 files/results).
$ErrorActionPreference = 'Stop'
$pkg = 'com.sena.mobile'
$dst = 'C:\dev\sena-mobile\bench-results'
New-Item -ItemType Directory -Force $dst | Out-Null
$files = adb shell run-as $pkg ls files/results 2>$null
foreach ($f in $files) {
  $f = $f.Trim()
  if (-not $f) { continue }
  $out = Join-Path $dst $f
  # exec-out은 바이너리 그대로 보낸다 (shell은 줄바꿈을 바꿀 수 있음)
  cmd /c "adb exec-out run-as $pkg cat files/results/$f > `"$out`""
}
Get-ChildItem $dst | Sort-Object LastWriteTime | Format-Table Name, LastWriteTime
