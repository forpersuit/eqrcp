---
title: "Configuración y variables de entorno"
description: "Persistencia de opciones y despliegues automáticos con archivos YAML y variables de entorno EQT_*."
---

# Configuración y variables de entorno

Para conservar opciones de inicio o ejecutar EQT en segundo plano en servidores y dispositivos NAS, EQT permite la configuración mediante archivos YAML estándar y variables de entorno.

---

## Ubicaciones de los archivos de configuración

EQT sigue la especificación estándar XDG para rutas de configuración. El archivo principal es `config.yml`:

- **Windows**:
  ```text
  %APPDATA%\eqt\config.yml
  # Ejemplo: C:\Users\<Usuario>\AppData\Roaming\eqt\config.yml
  ```
- **macOS**:
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX**:
  ```text
  ~/.config/eqt/config.yml
  ```
- **Ruta personalizada**: Establezca la variable de entorno `EQT_CONFIG_DIR=/ruta/al/directorio` para modificar la ubicación.

---

## Archivo de ejemplo (`config.yml`)

```yaml
# Interfaz de red a la que enlazarse (vacío para autodetección de Wi-Fi)
interface: ""

# Dirección de enlace
bind: "0.0.0.0"

# Puerto local (0 para asignar un puerto libre aleatorio)
port: 0

# Carpeta de destino de archivos recibidos
output: "~/Downloads"

# Mantener servidor activo tras finalizar transferencia
keepAlive: false

# Activar cifrado seguro LAN-TLS de Let's Encrypt
secure: true

# Prefijo de ruta URL personalizado (vacío para cadena aleatoria)
path: ""

# Nombre de dominio completo (FQDN) personalizado para códigos QR
fqdn: ""

# Invertir contraste de código QR en terminal
reversed: false

# Rutas de certificados TLS propios (para entornos sin conexión / air-gap)
tls-cert: ""
tls-key: ""
```

---

## Variables de entorno (`EQT_*`)

Las variables de entorno tienen máxima prioridad sobre el archivo `config.yml`:

| Variable | Ajuste correspondiente | Ejemplo |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | Directorio raíz de configuración | `/etc/eqt` |
| `EQT_INTERFACE` | Interfaz de red | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | Puerto de escucha | `9090` |
| `EQT_BIND` | Dirección de escucha | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | Destino de archivos recibidos | `/srv/storage/descargas` |
| `EQT_KEEPALIVE` | Mantener en ejecución | `true` / `false` |
| `EQT_SECURE` | Forzar HTTPS | `true` / `false` |
| `EQT_FQDN` | Nombre de host para el QR | `transfer.internal.lan` |

---

## Ejemplo de script para demonio en producción

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# Iniciar receptor silencioso en segundo plano
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
