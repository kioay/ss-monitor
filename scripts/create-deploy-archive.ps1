param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$commit = (git -C $repoRoot rev-parse --short HEAD).Trim()
if (-not $OutputPath) {
  $OutputPath = Join-Path $env:LOCALAPPDATA "Temp\ss-monitor-$commit.tar.gz"
}

npm --prefix $repoRoot run build

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ss-monitor-deploy-$commit-$([System.Guid]::NewGuid().ToString('N'))"
$sourceTar = Join-Path $tempRoot "source.tar"
$stageDir = Join-Path $tempRoot "stage"

New-Item -ItemType Directory -Path $stageDir | Out-Null
try {
  git -C $repoRoot archive --format=tar -o $sourceTar HEAD
  tar -xf $sourceTar -C $stageDir
  Copy-Item -Path (Join-Path $repoRoot "dist") -Destination (Join-Path $stageDir "dist") -Recurse -Force
  tar -czf $OutputPath -C $stageDir .
  Get-Item $OutputPath
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
