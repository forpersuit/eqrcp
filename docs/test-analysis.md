# Test Analysis

This document records the current validation baseline for `eqrcp`. Keep it updated when desktop integration changes the way commands are launched.

## Baseline

The project currently builds and tests with Go 1.26.

```sh
GOCACHE=/tmp/eqrcp-go-build go test ./...
GOCACHE=/tmp/eqrcp-go-build go build ./...
```

Expected result:

- All package tests pass.
- The root package builds without producing a checked-in binary.

## CLI Checks

```sh
GOCACHE=/tmp/eqrcp-go-build go run . --help
GOCACHE=/tmp/eqrcp-go-build go run . receive --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive --help
GOCACHE=/tmp/eqrcp-go-build go run . version
```

Expected result:

- The command name is `eqrcp`.
- The default config path in help is `$XDG_CONFIG_HOME/eqrcp/config.yml`.
- Desktop helper commands are present.
- The version command prints `eqrcp dev [date: n/a]` for local development builds.

## Receive Flow

The receive flow was validated with a local loopback server and a multipart upload.

Server:

```sh
mkdir -p /tmp/eqrcp-recv-test
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp receive \
  -i any \
  --bind 127.0.0.1 \
  -p 19080 \
  --path recvtest \
  -o /tmp/eqrcp-recv-test
```

Client:

```sh
printf 'hello from upload test\n' > /tmp/eqrcp-upload.txt
curl -s -F 'files=@/tmp/eqrcp-upload.txt' \
  http://127.0.0.1:19080/receive/recvtest
```

Expected result:

- `/tmp/eqrcp-recv-test/eqrcp-upload.txt` exists.
- Its content matches the uploaded file.
- The server exits after the upload unless `--keep-alive` is set.

Observation:

- In non-TTY environments the keyboard listener may print `keyboard not detected`. This does not block transfer.
- Desktop launchers should avoid depending on interactive keyboard input.

## Send Flow

The send flow was validated with a local loopback server and a browser-like user agent.

Server:

```sh
printf 'hello from send test\n' > /tmp/eqrcp-send.txt
XDG_CONFIG_HOME=/tmp/eqrcp-config /tmp/eqrcp \
  -i any \
  --bind 127.0.0.1 \
  -p 19081 \
  --path sendtest \
  /tmp/eqrcp-send.txt
```

Client:

```sh
curl -s -A 'Mozilla/5.0' \
  -D /tmp/eqrcp-send.headers \
  -o /tmp/eqrcp-downloaded.txt \
  http://127.0.0.1:19081/send/sendtest
```

Expected result:

- `/tmp/eqrcp-downloaded.txt` matches `/tmp/eqrcp-send.txt`.
- Response headers include a `Content-Disposition` attachment filename.
- The server exits after transfer unless `--keep-alive` is set.

Observation:

- Send completion currently depends on a browser-style user agent path. Plain `curl` without a `Mozilla` user agent does not exercise the same shutdown path.

## Desktop Integration Test Requirements

Desktop integration should preserve the baseline above and add platform-specific checks:

- Context menu can share a selected file.
- Context menu can share a selected directory.
- Context menu can share multiple selected paths where the platform supports it.
- Context menu can receive into the selected directory.
- Launcher failures are visible to the user without requiring a terminal.
- Generated QR code is visible through a browser or dedicated window.
- Server exits after successful transfer by default.

## Desktop Command Checks

The desktop command surface was validated with:

```sh
GOCACHE=/tmp/eqrcp-go-build go run . desktop --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive --help
GOCACHE=/tmp/eqrcp-go-build go run . desktop share
GOCACHE=/tmp/eqrcp-go-build go run . desktop receive
GOCACHE=/tmp/eqrcp-go-build go run . desktop install
GOCACHE=/tmp/eqrcp-go-build go run . desktop uninstall
```

Expected result:

- `desktop`, `desktop share`, and `desktop receive` help text is available.
- `desktop share` without paths fails with an argument validation error.
- `desktop receive` without a directory fails with an argument validation error.
- On non-Windows systems, `desktop install` and `desktop uninstall` fail with a platform not implemented error.
- On Windows, `desktop install` should create Explorer context menu entries under `HKCU\Software\Classes`.
- On Windows, `desktop uninstall` should remove those entries.

## Windows Desktop Install Manual Test

Build a Windows binary:

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o /mnt/e/developer/results/eqrcp.exe .
```

From Windows, run:

```powershell
E:\developer\results\eqrcp.exe desktop install
```

Expected result:

- File right click includes `Share with eqrcp`.
- Folder right click includes `Share with eqrcp`.
- Folder right click includes `Receive here with eqrcp`.
- Folder background right click includes `Receive here with eqrcp`.
- Clicking a context menu entry does not show the Windows console-program prompt.
- Clicking a context menu entry opens the QR code page in the default browser.

Then run:

```powershell
E:\developer\results\eqrcp.exe desktop uninstall
```

Expected result:

- The entries created by `desktop install` are removed.

## Desktop Share Flow

The desktop share flow was validated by intercepting `xdg-open` with a temporary test script and downloading the shared file over loopback.

Test setup:

```sh
mkdir -p /tmp/eqrcp-fake-bin
cat >/tmp/eqrcp-fake-bin/xdg-open <<'SH'
#!/bin/sh
printf "%s\n" "$1" >> /tmp/eqrcp-opened-urls
exit 0
SH
chmod +x /tmp/eqrcp-fake-bin/xdg-open
```

Server:

```sh
printf 'desktop share download\n' > /tmp/eqrcp-desktop-share.txt
PATH=/tmp/eqrcp-fake-bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin \
XDG_CONFIG_HOME=/tmp/eqrcp-desktop-config \
/tmp/eqrcp-desktop-test desktop share \
  -i any \
  --bind 127.0.0.1 \
  -p 19181 \
  --path desktopshare \
  /tmp/eqrcp-desktop-share.txt
```

Client:

```sh
curl -s -A 'Mozilla/5.0' \
  -D /tmp/eqrcp-desktop-share.headers \
  -o /tmp/eqrcp-desktop-downloaded.txt \
  http://127.0.0.1:19181/send/desktopshare
```

Expected result:

- `/tmp/eqrcp-opened-urls` contains `http://127.0.0.1:19181/qr`.
- Downloaded content matches the source file.
- Response headers include an attachment filename.
- The server exits after the download.

## Desktop Receive Flow

The desktop receive flow was validated by intercepting `xdg-open` with the same fake browser script and uploading a file over loopback.

Server:

```sh
mkdir -p /tmp/eqrcp-desktop-recv2
PATH=/tmp/eqrcp-fake-bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin \
XDG_CONFIG_HOME=/tmp/eqrcp-desktop-config \
/tmp/eqrcp-desktop-test desktop receive \
  -i any \
  --bind 127.0.0.1 \
  -p 19182 \
  --path desktoprecv2 \
  /tmp/eqrcp-desktop-recv2
```

Client:

```sh
printf 'desktop receive second upload\n' > /tmp/eqrcp-desktop-upload2.txt
curl -s -F 'files=@/tmp/eqrcp-desktop-upload2.txt' \
  http://127.0.0.1:19182/receive/desktoprecv2
```

Expected result:

- `/tmp/eqrcp-opened-urls` contains `http://127.0.0.1:19182/qr`.
- `/tmp/eqrcp-desktop-recv2/eqrcp-desktop-upload2.txt` exists.
- Its content matches the uploaded file.
- The server exits after the upload.
