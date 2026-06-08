param(
  [string]$BettaFishDir = "",
  [string]$Python = "",
  [string]$Keywords = "",
  [int]$DayIntervalMinutes = 60,
  [int]$NightIntervalMinutes = 240,
  [int]$NightStartHour = 0,
  [int]$NightEndHour = 8,
  [int]$RetentionDays = 14,
  [int]$MaxItemsPerGame = 300,
  [string]$RemoteHost = "ss-monitor.qinoay.top",
  [int]$RemotePort = 29018,
  [string]$RemoteUser = "yq",
  [string]$RemoteDir = "/opt/ss-monitor/data/mindspider-douyin-imports/local-cdp",
  [switch]$InstallDependencies,
  [switch]$Force,
  [switch]$Headless
)

$ErrorActionPreference = "Stop"

function Join-Chars([int[]]$Codes) {
  return -join ($Codes | ForEach-Object { [char]$_ })
}

function Resolve-BettaFishDir {
  param([string]$Explicit)
  $candidates = @()
  if ($Explicit) { $candidates += $Explicit }
  if ($env:BETTAFISH_REPO_DIR) { $candidates += $env:BETTAFISH_REPO_DIR }
  $candidates += (Join-Path $PSScriptRoot "..\..\BettaFish")
  $candidates += (Join-Path $env:USERPROFILE "Documents\BettaFish")
  foreach ($candidate in $candidates) {
    if (!$candidate) { continue }
    $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction SilentlyContinue
    if ($resolved -and (Test-Path -LiteralPath (Join-Path $resolved.Path "MindSpider\main.py"))) {
      return $resolved.Path
    }
  }
  throw "BettaFish repo was not found. Pass -BettaFishDir or set BETTAFISH_REPO_DIR."
}

function Resolve-Python {
  param([string]$Explicit, [string]$BettaFishRoot)
  if ($Explicit) { return $Explicit }
  if ($env:BETTAFISH_PYTHON) { return $env:BETTAFISH_PYTHON }
  $venvPython = Join-Path $BettaFishRoot ".venv-mediacrawler\Scripts\python.exe"
  if (Test-Path -LiteralPath $venvPython) { return $venvPython }
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    $pyList = & $pyLauncher.Source -0p 2>$null
    foreach ($line in $pyList) {
      if ($line -match '^\s*-V:3\.(12|11|10|9)\s+\*?\s*(.+python\.exe)\s*$') {
        return $Matches[2]
      }
    }
  }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) { return $py.Source }
  throw "Python 3.9+ was not found."
}

function Default-Keywords {
  $base = Join-Chars @(0x751f, 0x6b7b, 0x72d9, 0x51fb)
  return @(
    $base,
    "${base}1",
    "4399${base}",
    "${base}2"
  ) -join ","
}

function Test-NightWindow {
  param([int]$Hour, [int]$StartHour, [int]$EndHour)
  if ($StartHour -eq $EndHour) { return $false }
  if ($StartHour -lt $EndHour) { return $Hour -ge $StartHour -and $Hour -lt $EndHour }
  return $Hour -ge $StartHour -or $Hour -lt $EndHour
}

function Install-MediaCrawlerDependencies {
  param([string]$PythonExe, [string]$RequirementsPath)

  & $PythonExe -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed with code $LASTEXITCODE" }

  $pyVersion = & $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
  if ([version]$pyVersion -ge [version]"3.12") {
    $packages = @(
      "httpx==0.28.1",
      "Pillow>=10.4.0",
      "playwright==1.45.0",
      "tenacity==8.2.2",
      "typer>=0.12.3",
      "opencv-python-headless",
      "aiomysql==0.2.0",
      "redis~=4.6.0",
      "pydantic==2.5.2",
      "aiofiles~=23.2.1",
      "fastapi==0.110.2",
      "uvicorn==0.29.0",
      "python-dotenv==1.0.1",
      "jieba==0.42.1",
      "wordcloud==1.9.3",
      "matplotlib>=3.9.0",
      "requests==2.32.3",
      "parsel==1.9.1",
      "pyexecjs==1.5.1",
      "pandas==2.2.3",
      "aiosqlite==0.21.0",
      "pyhumps==3.8.0",
      "cryptography>=45.0.7",
      "alembic>=1.16.5",
      "asyncmy>=0.2.10",
      "sqlalchemy>=2.0.43",
      "motor>=3.3.0",
      "openpyxl>=3.1.2"
    )
    & $PythonExe -m pip install @packages
  } else {
    & $PythonExe -m pip install -r $RequirementsPath
  }
  if ($LASTEXITCODE -ne 0) { throw "MediaCrawler dependency installation failed with code $LASTEXITCODE" }
}

function Test-MediaCrawlerCdpProfileMode {
  param([string]$PythonExe, [string]$MediaCrawlerDir)

  $checkScript = @'
import os
import config

config.PLATFORM = "dy"
profile_dir = os.path.abspath(
    os.path.join(
        os.getcwd(),
        "browser_data",
        f"cdp_{config.USER_DATA_DIR % config.PLATFORM}",
    )
)

failures = []
if not getattr(config, "ENABLE_CDP_MODE", False):
    failures.append("ENABLE_CDP_MODE must be True")
if not getattr(config, "SAVE_LOGIN_STATE", False):
    failures.append("SAVE_LOGIN_STATE must be True")
if getattr(config, "ENABLE_GET_MEIDAS", False):
    failures.append("ENABLE_GET_MEIDAS must be False")

if failures:
    raise SystemExit("; ".join(failures))

print(f"MediaCrawler CDP profile directory: {profile_dir}")
'@

  Push-Location $MediaCrawlerDir
  try {
    & $PythonExe -c $checkScript
    if ($LASTEXITCODE -ne 0) { throw "MediaCrawler CDP/profile preflight failed with code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Read-State {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$stateDir = Join-Path $projectRoot "data\local-douyin-cdp-sync"
$statePath = Join-Path $stateDir "state.json"
$lockPath = Join-Path $stateDir "sync.lock"
$exportDir = Join-Path $projectRoot "data\mindspider-douyin-imports\local-cdp"
$exportPath = Join-Path $exportDir "latest.json"
New-Item -ItemType Directory -Force -Path $stateDir, $exportDir | Out-Null

$now = Get-Date
$isNight = Test-NightWindow -Hour $now.Hour -StartHour $NightStartHour -EndHour $NightEndHour
$requiredMinutes = if ($isNight) { $NightIntervalMinutes } else { $DayIntervalMinutes }
$state = Read-State $statePath
if (!$Force -and $state -and ($state.PSObject.Properties.Name -contains "lastCompletedAt")) {
  $lastCompleted = [datetime]$state.lastCompletedAt
  if (($now - $lastCompleted).TotalMinutes -lt $requiredMinutes) {
    Write-Host "Skip local Douyin sync. Next interval has not elapsed."
    exit 0
  }
}

if (Test-Path -LiteralPath $lockPath) {
  $lockAgeMinutes = ($now - (Get-Item -LiteralPath $lockPath).LastWriteTime).TotalMinutes
  if ($lockAgeMinutes -lt 180) {
    Write-Host "Skip local Douyin sync. Another run is still active."
    exit 0
  }
  Remove-Item -LiteralPath $lockPath -Force
}

Set-Content -LiteralPath $lockPath -Value "$PID" -Encoding ASCII
try {
  $bettaFish = Resolve-BettaFishDir $BettaFishDir
  $pythonExe = Resolve-Python $Python $bettaFish
  $mediaCrawler = Join-Path $bettaFish "MindSpider\DeepSentimentCrawling\MediaCrawler"
  if (!(Test-Path -LiteralPath (Join-Path $mediaCrawler "main.py"))) {
    Write-Host "Initializing BettaFish MediaCrawler submodule..."
    git -C $bettaFish submodule update --init --recursive MindSpider/DeepSentimentCrawling/MediaCrawler
  }
  if (!(Test-Path -LiteralPath (Join-Path $mediaCrawler "main.py"))) {
    throw "MediaCrawler is not initialized at $mediaCrawler"
  }

  if ($InstallDependencies) {
    $venvDir = Join-Path $bettaFish ".venv-mediacrawler"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    if (!(Test-Path -LiteralPath $venvPython)) {
      & $pythonExe -m venv $venvDir
      if ($LASTEXITCODE -ne 0) { throw "venv creation failed with code $LASTEXITCODE" }
    }
    $pythonExe = $venvPython
    Install-MediaCrawlerDependencies $pythonExe (Join-Path $mediaCrawler "requirements.txt")
  }

  if (!$Keywords) { $Keywords = Default-Keywords }
  Test-MediaCrawlerCdpProfileMode $pythonExe $mediaCrawler

  $headlessValue = if ($Headless) { "true" } else { "false" }
  $crawlerArgs = @(
    "main.py",
    "--platform", "dy",
    "--lt", "qrcode",
    "--type", "search",
    "--keywords", $Keywords,
    "--save_data_option", "json",
    "--headless", $headlessValue,
    "--get_comment", "true",
    "--get_sub_comment", "false"
  )

  Write-Host "Running local BettaFish MediaCrawler Douyin CDP sync..."
  Push-Location $mediaCrawler
  try {
    & $pythonExe @crawlerArgs
    if ($LASTEXITCODE -ne 0) { throw "MediaCrawler exited with code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  npm run douyin:prepare-local-export -- --media-crawler-dir "$mediaCrawler" --out "$exportPath" --days "$RetentionDays" --max-items-per-game "$MaxItemsPerGame"
  if ($LASTEXITCODE -ne 0) { throw "Export preparation failed with code $LASTEXITCODE" }

  ssh -p $RemotePort "$RemoteUser@$RemoteHost" "mkdir -p '$RemoteDir'"
  if ($LASTEXITCODE -ne 0) { throw "Remote import directory creation failed with code $LASTEXITCODE" }
  scp -P $RemotePort "$exportPath" "$RemoteUser@$RemoteHost`:$RemoteDir/latest.json"
  if ($LASTEXITCODE -ne 0) { throw "Remote export upload failed with code $LASTEXITCODE" }

  $newState = @{
    lastCompletedAt = (Get-Date).ToString("o")
    mode = if ($isNight) { "night" } else { "day" }
    remotePath = "$RemoteDir/latest.json"
    exportPath = $exportPath
  }
  $newState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
  Write-Host "Local Douyin CDP sync finished."
} finally {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
