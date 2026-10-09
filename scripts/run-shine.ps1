# scripts/run-shine.ps1
$ErrorActionPreference = "Continue"
$ProjectDir = "D:\job-automation\naukri-job-engine"

Set-Location $ProjectDir

$logDir = Join-Path $ProjectDir "storage\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("shine-" + (Get-Date -Format "yyyy-MM-dd-HHmm") + ".log")

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Log "=== Shine automation run started ==="

# ── Step 1: Search-based apply ────────────────────────────
Log "STEP 1 — Running Shine search-based automation"
try {
    npx playwright test tests/shine/shine.test.ts --headed *>&1 |
        Tee-Object -FilePath $logFile -Append
    Log "STEP 1 finished (exit=$LASTEXITCODE)"
} catch {
    Log "STEP 1 threw: $_"
}

Log "=== Shine automation run completed ==="