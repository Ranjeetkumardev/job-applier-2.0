# scripts/run-naukri.ps1
$ErrorActionPreference = "Continue"
$ProjectDir = "D:\job-automation\naukri-job-engine"

Set-Location $ProjectDir

$logDir = Join-Path $ProjectDir "storage\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("naukri-" + (Get-Date -Format "yyyy-MM-dd-HHmm") + ".log")

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Log "=== Naukri automation run started ==="

# ── Step 1: Recommended Jobs ──────────────────────────────
Log "STEP 1 — Applying to Recommended Jobs"
try {
    npx playwright test tests/naukri/naukri-apply-recommended.spec.ts *>&1 |
        Tee-Object -FilePath $logFile -Append
    Log "STEP 1 finished (exit=$LASTEXITCODE)"
} catch {
    Log "STEP 1 threw: $_"
}

# ── Step 2: Search-based apply ────────────────────────────
Log "STEP 2 — Running search-based automation (npm run test:headed)"
try {
    npm run test:headed *>&1 |
        Tee-Object -FilePath $logFile -Append
    Log "STEP 2 finished (exit=$LASTEXITCODE)"
} catch {
    Log "STEP 2 threw: $_"
}

Log "=== Naukri automation run completed ==="
 
