---
title: "설정 파일 및 환경 변수"
description: "표준 YAML 설정 파일과 EQT_* 환경 변수를 활용한 설정 영구 저장 및 자동화 배포."
---

# 설정 파일 및 환경 변수

사용자 지정 설정을 영구 저장하거나 NAS 및 Linux 서버에서 백그라운드 서비스로 구동할 때 EQT는 표준 YAML 파일 및 환경 변수 재정의를 지원합니다.

---

## 설정 파일 저장 위치

EQT는 운영체제 표준 XDG 사양을 준수합니다. 기본 설정 파일 이름은 `config.yml`입니다:

- **Windows**:
  ```text
  %APPDATA%\eqt\config.yml
  # 예: C:\Users\<사용자명>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**:
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**:
  ```text
  ~/.config/eqt/config.yml
  ```
- **커스텀 디렉터리 재정의**: `EQT_CONFIG_DIR=/path/to/dir` 환경 변수를 지정하여 전체 설정 경로를 변경할 수 있습니다.

---

## 설정 파일 예시 (`config.yml`)

```yaml
# 바인딩할 네트워크 인터페이스 (빈 값은 최적 Wi-Fi 자동 감지)
interface: ""

# 수신 IP 주소
bind: "0.0.0.0"

# 수신 포트 번호 (0은 임의의 빈 포트 자동 할당)
port: 0

# 수신 파일 기본 저장 경로
output: "~/Downloads"

# 전송 완료 후 프로세스 유지 여부 (CLI 모드)
keepAlive: false

# Let's Encrypt LAN-TLS 보안 암호화 활성화
secure: true

# 커스텀 URL 경로 접두사 (빈 값은 임의 문자열 생성)
path: ""

# QR 코드에 표시될 커스텀 도메인명 (FQDN)
fqdn: ""

# 터미널 QR 코드 흑백 반전
reversed: false

# 커스텀 TLS 인증서 경로 (폐쇄망 오프라인용)
tls-cert: ""
tls-key: ""
```

---

## 환경 변수 재정의 (`EQT_*`)

환경 변수는 `config.yml`의 설정보다 항상 우선 적용됩니다:

| 환경 변수 | 대응 설정 항목 | 예시 |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | 설정 루트 디렉터리 | `/etc/eqt` |
| `EQT_INTERFACE` | 바인딩 인터페이스 | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | 로컬 리스닝 포트 | `9090` |
| `EQT_BIND` | 바인딩 주소 | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | 수신 파일 저장 경로 | `/data/downloads` |
| `EQT_KEEPALIVE` | 전송 완료 후 유지 | `true` / `false` |
| `EQT_SECURE` | HTTPS 보안 강제 | `true` / `false` |
| `EQT_FQDN` | QR 코드용 호스트명 | `transfer.internal.lan` |

---

## 프로덕션 데몬 구동 예시

Linux 서버나 NAS 장치에서 백그라운드 데몬으로 실행하기 위한 간단한 셸 스크립트 예시:

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# 백그라운드에서 조용히 수신 대기 시작
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
