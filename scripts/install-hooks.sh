#!/bin/bash

# Install git hooks for eqrcp development

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "Installing git hooks..."

# Create pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Pre-commit hook: Close eqrcp processes, run tests, and rebuild before commit

echo "=== Pre-commit hook: Closing eqrcp processes, running tests, and rebuilding ==="

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

# Step 2: Run tests
echo "Step 2: Running tests..."

# Get the root directory (parent of .git)
# BASH_SOURCE[0] is .git/hooks/pre-commit, so we need to go up two levels
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Verify we're in the right directory
if [ ! -f "$SCRIPT_DIR/main.go" ]; then
    echo "Error: Could not find main.go in $SCRIPT_DIR"
    exit 1
fi

cd "$SCRIPT_DIR"

# Run Go tests
echo "Running Go tests..."
go test ./... || { echo "Go tests failed"; exit 1; }

# Run GUI frontend tests if npm is available
if command -v npm &> /dev/null; then
    if [ -f "$SCRIPT_DIR/desktop/gui/frontend/package.json" ]; then
        echo "Building GUI frontend..."
        cd "$SCRIPT_DIR/desktop/gui/frontend"
        npm run build || { echo "GUI frontend build failed"; exit 1; }
    fi
    
    # Run GUI Go tests
    if [ -d "$SCRIPT_DIR/desktop/gui" ]; then
        echo "Running GUI Go tests..."
        cd "$SCRIPT_DIR/desktop/gui"
        go test ./... || { echo "GUI Go tests failed"; exit 1; }
    fi
fi

echo "Step 2: Done - All tests passed."

# Step 3: Rebuild the project
echo "Step 3: Rebuilding project..."

cd "$SCRIPT_DIR"

# Output directory for built executables
OUTPUT_DIR="E:/developer/results"
mkdir -p "$OUTPUT_DIR"

echo "Building in directory: $SCRIPT_DIR"
echo "Output directory: $OUTPUT_DIR"

# Build current platform CLI
echo "Building current platform CLI..."
go build -o "$OUTPUT_DIR/eqrcp" . || { echo "Failed to build current platform CLI"; exit 1; }

# Build Windows CLI artifacts
echo "Building Windows CLI artifacts..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$OUTPUT_DIR/eqrcp.exe" . || { echo "Failed to build Windows CLI"; exit 1; }
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags -H=windowsgui -o "$OUTPUT_DIR/eqrcp-launcher.exe" ./cmd/eqrcp-launcher || { echo "Failed to build Windows launcher"; exit 1; }

# Build Wails GUI if wails is available (optional, can be slow)
# Set SKIP_WAILS_BUILD=1 to skip Wails GUI build
if [ -z "$SKIP_WAILS_BUILD" ]; then
    if command -v wails &> /dev/null || [ -f "$(go env GOPATH)/bin/wails" ]; then
        WAILS_CMD="wails"
        if [ ! -x "$(command -v wails)" ]; then
            WAILS_CMD="$(go env GOPATH)/bin/wails"
        fi
        
        if [ -x "$WAILS_CMD" ]; then
            echo "Building Wails GUI..."
            cd "$SCRIPT_DIR/desktop/gui"
            $WAILS_CMD build -clean -o "$OUTPUT_DIR/eqrcp-desktop.exe" -platform windows/amd64 || { echo "Failed to build Wails GUI"; exit 1; }
        else
            echo "Skipping Wails GUI build: wails command not found"
        fi
    else
        echo "Skipping Wails GUI build: wails not installed"
    fi
else
    echo "Skipping Wails GUI build: SKIP_WAILS_BUILD is set"
fi

echo "Step 3: Done - Project rebuilt successfully."
echo "Built executables:"
ls -la "$OUTPUT_DIR"/eqrcp* 2>/dev/null || dir "$OUTPUT_DIR"\eqrcp* 2>/dev/null

echo "=== Pre-commit hook completed ==="

# Continue with the commit
exit 0
EOF

# Make the hook executable
chmod +x "$HOOKS_DIR/pre-commit" 2>/dev/null || true

echo "✓ Pre-commit hook installed successfully!"
echo ""
echo "The hook will:"
echo "  1. Close all running eqrcp processes"
echo "  2. Run Go tests (go test ./...)"
echo "  3. Build GUI frontend (npm run build)"
echo "  4. Run GUI Go tests"
echo "  5. Rebuild executables to E:/developer/results"
echo "  6. Continue with the commit"
echo ""
echo "To uninstall, run: rm .git/hooks/pre-commit"
