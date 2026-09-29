---
title: "Referencia de comandos CLI"
description: "Referencia completa de todos los subcomandos, parámetros y opciones de la interfaz de línea de comandos de EQT."
---

# Referencia de comandos CLI

El núcleo de EQT está desarrollado nativamente en Go y proporciona una interfaz de línea de comandos (CLI) ligera y de alto rendimiento, ideal para servidores sin interfaz gráfica (headless), terminales de desarrollo y scripts de automatización.

---

## Subcomandos principales

### 1. Enviar o compartir archivos y carpetas (Send)
Cuando no se proporciona un subcomando explícito y los argumentos son rutas, EQT actúa por defecto en modo envío:
```bash
# Enviar un archivo individual
eqt Documento.pdf

# Enviar múltiples archivos en un puerto concreto
eqt --port 8080 Video.mp4 Presentacion.pptx

# Enviar una carpeta completa (comprimida al vuelo)
eqt /home/usuario/Proyectos/
```

### 2. Recibir archivos (Receive)
```bash
# Iniciar modo receptor a la espera de subidas desde el móvil
eqt receive

# Especificar la carpeta de destino (opción corta -o)
eqt receive -o ~/Descargas
```

### 3. Colaboración en red local (Chat)
```bash
# Iniciar el servicio de chat en la LAN
eqt chat

# Iniciar el chat y abrirlo automáticamente en el navegador predeterminado
eqt chat --browser
```

### 4. Asistente interactivo de configuración (Config)
```bash
# Configurar interfaces de red, puertos y rutas desde la terminal
eqt config
```

### 5. Autocompletado para la shell (Completion)
```bash
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## Opciones globales

| Opción | Corta | Por defecto | Descripción |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | Detección auto | Forzar enlace a una interfaz de red específica (p. ej., `eth0`, `wlan0`, `Wi-Fi`) |
| `--port` | `-p` | `0` (Aleatorio) | Puerto del servidor (`0` asigna un puerto libre aleatorio) |
| `--bind` | | `0.0.0.0` | Dirección IP de enlace del servidor (sin opción corta) |
| `--browser` | `-b` | `false` | Abrir automáticamente la consola en el navegador predeterminado |
| `--secure` | `-s` | `true` | Habilitar cifrado WebPKI HTTPS mediante Let's Encrypt |
| `--output` | `-o` | Carpeta Descargas | (Solo modo recibir) Directorio donde se guardan los archivos recibidos |
| `--keep-alive` | `-k` | `false` | Mantener el servidor en ejecución tras completar la transferencia |
| `--quiet` | `-q` | `false` | Ocultar barra de progreso interactiva; registrar solo errores |
| `--zip` | `-z` | `false` | Forzar el empaquetado en un único archivo ZIP al enviar |
| `--fqdn` | `-d` | Auto | Reemplazar el nombre de host o dominio generado en el QR |
| `--path` | | Cadena aleatoria | Prefijo personalizado en la ruta URL HTTP (p. ej., `/mi-compartido`) |
| `--config` | `-c` | Ruta estándar | Ruta a un archivo de configuración YAML externo |
| `--list-all-interfaces` | `-l` | `false` | Listar todas las interfaces de red (incluyendo adaptadores virtuales) |
| `--reversed` | `-r` | `false` | Invertir el contraste del código QR en terminales oscuras |
| `--tls-cert` | | Vacío | Ruta a certificado TLS personalizado (entornos aislados offline) |
| `--tls-key` | | Vacío | Ruta a clave privada TLS personalizada (entornos aislados offline) |
