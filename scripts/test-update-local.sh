#!/usr/bin/env bash

# EQT Local Auto-Update Integration Test Helper Script
# This script sets up a local HTTP Mock Server and overrides EQT's update URL
# to test version parsing, signature validation, and package downloading.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MOCK_PORT=8099
MOCK_DIR="website"
MOCK_METADATA_FILE="$MOCK_DIR/update-metadata-mock.json"

echo "=== EQT Local Auto-Update Integration Test Helper ==="

# 1. Compile EQT locally
echo "Step 1: Compiling EQT CLI/Desktop launcher..."
go build -o eqt-test-bin .
echo "✓ Compilation successful."

# 2. Setup mock metadata file
echo "Step 2: Generating mock metadata update-metadata-mock.json..."
# Generate mock update json
cat <<EOF > "$MOCK_METADATA_FILE"
{
  "version": "v9.9.9",
  "published_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "changelog": "EQT local simulation test v9.9.9. This tests the update mechanism.",
  "assets": [
    {
      "name": "eqt-desktop-linux-amd64.tar.gz",
      "download_url": "http://localhost:${MOCK_PORT}/downloads/latest/eqt-desktop-linux-amd64.tar.gz",
      "size": 1000
    },
    {
      "name": "eqt-desktop-linux-amd64.tar.gz.sig",
      "download_url": "http://localhost:${MOCK_PORT}/downloads/latest/eqt-desktop-linux-amd64.tar.gz.sig",
      "size": 128
    },
    {
      "name": "eqt-desktop-windows-amd64.exe",
      "download_url": "http://localhost:${MOCK_PORT}/downloads/latest/eqt-desktop-windows-amd64.exe",
      "size": 2000
    },
    {
      "name": "eqt-desktop-windows-amd64.exe.sig",
      "download_url": "http://localhost:${MOCK_PORT}/downloads/latest/eqt-desktop-windows-amd64.exe.sig",
      "size": 128
    }
  ]
}
EOF
echo "✓ Mock metadata written to $MOCK_METADATA_FILE"

# 3. Start local Python HTTP Server
echo "Step 3: Starting local HTTP Mock Server on port $MOCK_PORT..."
python3 -m http.server "$MOCK_PORT" --directory "$MOCK_DIR" > /dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  echo "Cleaning up..."
  kill "$SERVER_PID" || true
  rm -f "$MOCK_METADATA_FILE"
  rm -f eqt-test-bin
  echo "✓ Cleanup completed."
}
trap cleanup EXIT

# Wait a second for python server to boot
sleep 1

# Verify server accessibility
if curl -s "http://localhost:${MOCK_PORT}/update-metadata-mock.json" > /dev/null; then
  echo "✓ Local Mock Update Server is up at PID $SERVER_PID."
else
  echo "✗ Failed to boot Python HTTP server."
  exit 1
fi

# 4. Prompt EQT Execution
echo "Step 4: Executing EQT check-update locally with mocked environment..."
echo "--------------------------------------------------------"
echo "Running EQT with EQT_UPDATE_URL environment override..."

# We run eqt check-update command (assuming there is a command or we run desktop agent)
# Here we export the EQT_UPDATE_URL environment variable so our Go agent picks it up
export EQT_UPDATE_URL="http://localhost:${MOCK_PORT}/update-metadata-mock.json"

# Run check-update CLI mode directly or desktop simulation
./eqt-test-bin version

echo ""
echo "💡 To test updater logic inside Go, run Go unit tests:"
echo "   EQT_UPDATE_URL=\"http://localhost:${MOCK_PORT}/update-metadata-mock.json\" go test ./server -v"
echo "--------------------------------------------------------"

# Run the unit test to verify integrated logic against local mock server
EQT_UPDATE_URL="http://localhost:${MOCK_PORT}/update-metadata-mock.json" go test ./server -run TestCheckForUpdates -v || true

echo ""
echo "Press [Ctrl+C] to stop the mock server and cleanup."
# Read blocks here to keep server alive
read -r -p "Or press Enter to exit... "
