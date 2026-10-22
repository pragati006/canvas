param(
    [Parameter(Position = 0)]
    [ValidateSet("help", "install", "frontend", "backend", "dev", "run", "test")]
    [string]$Target = "run"
)

$Root = $PSScriptRoot
$Frontend = Join-Path $Root "frontend"
$Backend = Join-Path $Root "backend"

function Start-Window([string]$Title, [string]$Directory, [string]$Command) {
    Start-Process powershell -WorkingDirectory $Directory -ArgumentList @(
        "-NoExit",
        "-Command",
        "`$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
    )
}

switch ($Target) {
    "help" {
        @"
.\run.ps1              Start the UI and the API
.\run.ps1 install      Install frontend and backend dependencies
.\run.ps1 frontend     Start the interview UI at http://localhost:5173
.\run.ps1 backend      Start the API at http://127.0.0.1:8000
.\run.ps1 test         Run frontend and backend tests
"@
    }
    "install" {
        Push-Location $Frontend
        npm install
        Pop-Location
        Push-Location $Backend
        python -m uv sync
        Pop-Location
    }
    "frontend" {
        Push-Location $Frontend
        npm run dev
        Pop-Location
    }
    "backend" {
        Push-Location $Backend
        python -m uv run python -m uvicorn app.main:app --reload
        Pop-Location
    }
    { $_ -in "dev", "run" } {
        Start-Window "Lattice API" $Backend "python -m uv run python -m uvicorn app.main:app --reload"
        Start-Window "Lattice UI" $Frontend "npm run dev"
        Write-Host "UI:  http://localhost:5173"
        Write-Host "API: http://127.0.0.1:8000"
    }
    "test" {
        Push-Location $Frontend
        npm test
        if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
        Pop-Location
        Push-Location $Backend
        python -m uv run python -m pytest
        $code = $LASTEXITCODE
        Pop-Location
        exit $code
    }
}
