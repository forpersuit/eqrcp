---
title: "Descripción general del producto"
description: "Filosofía de diseño de EQT, arquitectura de transmisión directa local, cero almacenamiento en la nube y visión general de características."
---

# Bienvenido al Centro de Documentación de EQT

EQT (Easy QR Transfer) es un sistema multiplataforma de transmisión ultrarrápida y colaboración en tiempo real dentro de redes de área local (LAN), diseñado desde cero según los **primeros principios (First Principles)**.

En una época donde los servicios centralizados en la nube y las aplicaciones de mensajería predominan en el intercambio de datos, surgen graves problemas de privacidad y rendimiento: escaneo en la nube de fotografías privadas, uso indebido de documentos para entrenar modelos de IA, cuotas de subida a Internet y compresión con pérdida de calidad. EQT resuelve estos inconvenientes permitiendo el intercambio directo, seguro y veloz entre dispositivos conectados a la misma red local.

---

## Principios fundamentales de diseño

- **Transmisión a velocidad física directa (Zero Cloud Relay)**:
  El emisor y el receptor establecen un socket de red local directo. Los datos fluyen exclusivamente a través de su router o switch Wi-Fi local, evitando cualquier servidor en la nube.
- **Sin instalación de aplicaciones móviles (Zero App Needed)**:
  Los teléfonos móviles (iOS / Android) solo necesitan escanear el código QR con la cámara nativa para transferir y recibir archivos directamente desde el navegador web.
- **Cifrado LAN-TLS auténtico (WebPKI Green Lock)**:
  Al combinar certificados de Let's Encrypt con un DNS matemático de bucle invertido sin estado, EQT ofrece una conexión HTTPS confiable con el candado verde oficial (🔒) sin generar alarmas de seguridad.
- **Compresión ZIP en flujo continuo en memoria**:
  Al transferir carpetas completas o cientos de archivos, no se crean archivos comprimidos temporales en el disco. EQT empaqueta los datos en memoria en tiempo real y los envía de inmediato al socket de red.

---

## Estructura de la documentación

1. **[Guía de inicio rápido](/es/guides/quickstart)**: Conexión de dispositivos, envío y recepción de archivos en pocos pasos.
2. **[Colaboración LAN (Modo Chat)](/es/guides/chat-mode)**: Salas de intercambio temporal y notas en tiempo real para reuniones.
3. **[Comparativa Free vs. Plus](/es/guides/free-vs-plus)**: Características de la versión gratuita y ventajas de la licencia Plus.
4. **[Resolución de problemas](/es/troubleshooting/firewall-and-lan)**: Cortafuegos, certificados HTTPS y preguntas frecuentes (FAQ).
5. **[Manual de CLI](/es/cli/commands)**: Línea de comandos y archivos de configuración para servidores y dispositivos NAS.
6. **[Libro blanco de seguridad](/es/security/whitepaper)**: Arquitectura criptográfica, aislamiento de claves privadas y garantías de privacidad.
