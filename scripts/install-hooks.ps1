# Install git hooks for eqrcp development (PowerShell version)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$HooksDir = Join-Path $ProjectRoot ".git\hooks"

Write-Host "Installing git hooks..." -ForegroundColor Green

# Create pre-commit hook
$PreCommitContent = @'
#!/bin/bash

# Pre-commit hook: Close eqrcp processes and rebuild before commit

echo "=== Pre-commit hook: Closing eqrcp processes and rebuilding ==="

# Step 1: Close eqrcp processes
echo "Step 1: Closing eqrcp processes..."

# Windows: Use PowerShell to find and close eqrcp processes
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Close eqrcp.exe
    powershell -Command "Get-Process -Name eqrcp -ErrorAction SilentlyContinue | Stop-Process -Force" || true
    # Close eqrcp-launcher.exe
    powershell -Command "Get-Process -Name eqrcp-launcher -ErrorAction SilentlyContinue | Stop-Process -Force" || true
    # Close eqrcp-desktop.exe (Wails GUI)
    powershell -Command "Get-Process -Name eqrcp-desktop -ErrorAction SilentlyContinue | Stop-Process -Force" || true
else
    # Unix/Linux/Mac: Use pkill
    pkill -f "eqrcp$" || true
    pkill -f "eqrcp-launcher$" || true
    pkill -f "eqrcp-desktop$" || true
fi

echo "Step 1: Done - eqrcp processes closed."

# Step 2: Rebuild the project
echo "Step 2: Rebuilding project..."

# Get the root directory (parent of .git)
# BASH_SOURCE[0] is .git/hooks/pre-commit, so we need to go up two levels
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Output directory for built executables
OUTPUT_DIR="E:/developer/results"
mkdir -p "$OUTPUT_DIR"

# Verify we're in the right directory
if [ ! -f "$SCRIPT_DIR/main.go" ]; then
    echo "Error: Could not find main.go in $SCRIPT_DIR"
    exit 1
fi

echo "Building in directory: $SCRIPT_DIR"
echo "Output directory: $OUTPUT_DIR"

# Build current platform CLI
echo "Building current platform CLI..."
cd "$SCRIPT_DIR"
go build -o "$OUTPUT_DIR/eqrcp" . || { echo "Failed to build current platform CLI"; exit 1; }

# Build Windows CLI artifacts
echo "Building Windows CLI artifacts..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$OUTPUT_DIR/eqrcp.exe" . || { echo "Failed to build Windows CLI"; exit 1; }
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$OUTPUT_DIR/eqrcp-launcher.exe" ./cmd/eqrcp-launcher || { echo "Failed to build Windows launcher"; exit 1; }

# Build Wails GUI if wails is available
if command -v wails &> /dev/null || [ -f "$(go env GOPATH)/bin/wails" ]; then
    WAILS_CMD="wails"
    if [ ! -x "$(command -v wails)" ]; then
        WAILS_CMD="$(go env GOPATH)/bin/wails"
    fi
    
    if [ -x "$WAILS_CMD" ]; then
        echo "Building Wails GUI..."
        cd "$SCRIPT_DIR/desktop/gui"
        $WAILS_CMD build -clean -o "$OUTPUT_DIR/eqrcp-desktop.exe" -platform windows/amd64 || { echo "Failed to build Wails GUI"; exit 1; }
    fi
fi

echo "Step 2: Done - Project rebuilt successfully."
echo "Built executables:"
ls -la "$OUTPUT_DIR"/eqrcp* 2>/dev/null || dir "$OUTPUT_DIR"\eqrcp* 2>/dev/null

echo "=== Pre-commit hook completed ==="

# Continue with the commit
exit 0
'@

$PreCommitPath = Join-Path $HooksDir "pre-commit"
Set-Content -Path $PreCommitPath -Value $PreCommitContent -Encoding UTF8

Write-Host "✓ Pre-commit hook installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "The hook will:" -ForegroundColor Yellow
Write-Host "  1. Close all running eqrcp processes"
Write-Host "  2. Rebuild executables to E:/developer/results"
Write-Host "  3. Continue with the commit"
Write-Host ""
Write-Host "To uninstall, run: Remove-Item .git\hooks\pre-commit" -ForegroundColor Cyan
