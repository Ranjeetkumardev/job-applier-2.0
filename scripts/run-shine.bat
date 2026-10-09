@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\job-automation\naukri-job-engine\scripts\run-shine.ps1"
'@ | Out-File -FilePath "D:\job-automation\naukri-job-engine\scripts\run-shine.bat" -Encoding ASCII