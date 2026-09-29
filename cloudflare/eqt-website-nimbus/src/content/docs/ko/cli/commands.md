---
title: "CLI 명령어 레퍼런스"
description: "EQT 커맨드라인 인터페이스(CLI)의 모든 하위 명령어, 매개변수 및 글로벌 플래그 상세 안내."
---

# CLI 명령어 레퍼런스

EQT의 핵심 엔진은 Go 언어로 개발되어 가볍고 빠른 커맨드라인 인터페이스(CLI)를 제공합니다. GUI가 없는 헤드리스 서버, 로컬 개발자 터미널 및 자동화 배포 스크립트에서 완벽하게 작동합니다.

---

## 핵심 하위 명령어

### 1. 파일 또는 폴더 전송 (Send)
하위 명령어를 지정하지 않고 경로만 전달하면 EQT는 기본적으로 전송 모드로 작동합니다:
```bash
# 단일 파일 전송
eqt MyDocument.pdf

# 여러 파일 전송 및 특정 포트 지정
eqt --port 8080 Video.mp4 Presentation.pptx

# 디렉터리 전체 전송 (실시간 스트리밍 압축)
eqt /home/user/Projects/
```

### 2. 파일 수신 (Receive)
```bash
# 수신 리스너를 실행하고 모바일 업로드 대기
eqt receive

# 파일 저장 경로 지정 (단축 플래그 -o)
eqt receive -o ~/Desktop/Downloads
```

### 3. 로컬 네트워크 협업 (Chat)
```bash
# 헤드리스 LAN 협업 서비스 실행
eqt chat

# 채팅 서비스 실행과 동시에 기본 웹 브라우저에서 콘솔 열기
eqt chat --browser
```

### 4. 대화형 설정 마법사 (Config)
```bash
# 터미널에서 네트워크 인터페이스, 포트, 경로 설정
eqt config
```

### 5. 셸 자동 완성 스크립트 생성 (Completion)
```bash
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## 글로벌 CLI 옵션 목록

| 플래그 | 단축 | 기본값 | 설명 |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | 자동 감지 | 특정 네트워크 인터페이스에 강제 바인딩 (예: `eth0`, `wlan0`, `Wi-Fi`) |
| `--port` | `-p` | `0` (임의) | 서버 바인딩 포트 번호 (`0`은 빈 포트 임의 할당) |
| `--bind` | | `0.0.0.0` | 서버 수신 IP 주소 (단축 플래그 없음) |
| `--browser` | `-b` | `false` | 실행 시 기본 브라우저에서 웹 콘솔 자동 열기 |
| `--secure` | `-s` | `true` | Let's Encrypt 기반의 WebPKI HTTPS 암호화 활성화 |
| `--output` | `-o` | 다운로드 폴더 | (수신 모드 전용) 수신된 파일이 저장될 디렉터리 경로 |
| `--keep-alive` | `-k` | `false` | 전송 완료 후 프로세스를 종료하지 않고 계속 실행 유지 |
| `--quiet` | `-q` | `false` | 진행률 표시줄을 숨기고 에러 로그만 출력 |
| `--zip` | `-z` | `false` | 여러 파일을 강제로 하나의 ZIP 압축으로 묶어 전송 |
| `--fqdn` | `-d` | 자동 | 생성되는 QR 코드의 호스트명 또는 FQDN 재정의 |
| `--path` | | 임의 문자열 | HTTP 라우트 URL 경로 접두사 지정 (예: `/my-share`) |
| `--config` | `-c` | 기본 경로 | 외부 YAML 설정 파일 경로 지정 |
| `--list-all-interfaces` | `-l` | `false` | 가상 어댑터를 포함한 모든 네트워크 인터페이스 나열 |
| `--reversed` | `-r` | `false` | 어두운 터미널 배경에 맞춰 QR 코드 흑백 반전 |
| `--tls-cert` | | 비어 있음 | 커스텀 TLS 인증서 경로 (완전 폐쇄망 오프라인용) |
| `--tls-key` | | 비어 있음 | 커스텀 TLS 개인키 경로 (완전 폐쇄망 오프라인용) |
