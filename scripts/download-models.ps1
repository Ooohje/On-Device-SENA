# Track B 측정용 공개 모델을 C:\dev\sena-models 에 내려받는다 (약 1GB).
# 사용: powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1 [-Llm gemma|qwen]
param([ValidateSet('gemma', 'qwen')] [string]$Llm = 'gemma')

$ErrorActionPreference = 'Stop'
$dst = 'C:\dev\sena-models'
New-Item -ItemType Directory -Force $dst | Out-Null

$files = @{
  'ggml-base.en-q8_0.bin' = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q8_0.bin'   # 약 82MB (8비트 양자화)
}
if ($Llm -eq 'gemma') {
  $files['llm.gguf'] = 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf'  # 약 0.8GB
} else {
  $files['llm.gguf'] = 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf'      # 약 1.1GB
}

foreach ($name in $files.Keys) {
  $out = Join-Path $dst $name
  if (Test-Path $out) { Write-Host "있음: $out"; continue }
  Write-Host "다운로드: $($files[$name])"
  curl.exe -L --fail -o $out $files[$name]
}
Write-Host "완료: $dst"
Get-ChildItem $dst | Format-Table Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
