param([string]$PythonExecutable)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
if (-not $PythonExecutable) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $PythonExecutable = $bundledPython }
    else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw 'Установите Python 3.11+ или укажите -PythonExecutable с путём к python.exe' }
        $PythonExecutable = $pythonCommand.Source
    }
}
$publicDirectory = Join-Path $projectDirectory 'web'
$logDirectory = Join-Path $projectDirectory 'tmp'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
try {
    $serviceHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
    if ($serviceHealth.service -eq 'sirius') {
        Write-Output 'Сириус уже работает: http://localhost:5173/'
        return
    }
} catch {}
$processFile = Join-Path $logDirectory 'localhost.pid'
if (Test-Path -LiteralPath $processFile) {
    $previousProcessId = [int](Get-Content -LiteralPath $processFile)
    $previousProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $previousProcessId" -ErrorAction SilentlyContinue
    if ($previousProcess -and $previousProcess.CommandLine -like '*http.server*5173*' -and $previousProcess.CommandLine.Contains($publicDirectory)) {
        Stop-Process -Id $previousProcessId
    }
}
$serverProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m', 'app.server', '--port', '5173') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'localhost.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'localhost.stderr.log') -PassThru
$serverProcess.Id | Set-Content -LiteralPath (Join-Path $logDirectory 'localhost.pid')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 150
    if ($serverProcess.HasExited) { throw ('Сервер завершился. Журнал: ' + (Join-Path $logDirectory 'localhost.stderr.log')) }
    try {
        $readyHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
        if ($readyHealth.service -eq 'sirius') { break }
    } catch {}
}
if ($readyHealth.service -ne 'sirius') { throw 'Сервер не подтвердил готовность на порту 5173' }
Write-Output ('http://localhost:5173/ — PID ' + $serverProcess.Id)
