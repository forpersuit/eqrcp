---
title: "Preguntas frecuentes (FAQ)"
description: "Preguntas habituales sobre rendimiento de transferencia, compresión en flujo, licencias y privacidad en EQT."
---

# Preguntas frecuentes (FAQ)

---

### P1: ¿Qué velocidad de transferencia puede alcanzar EQT?
**R**: La velocidad de transmisión depende exclusivamente del hardware de su red local, la generación de protocolos Wi-Fi utilizados y la velocidad de escritura de su almacenamiento. **No existe limitación artificial de ancho de banda ni cuotas en la nube.**
- **Enlace físico directo**: EQT utiliza una arquitectura de socket local punto a punto (P2P). Toda la información fluye al 100 % por su red local (cable o Wi-Fi).
- **Aprovechamiento máximo del hardware**: La velocidad real la determinan el estándar de su red (p. ej., Wi-Fi 5 / Wi-Fi 6 / Wi-Fi 7), el rendimiento del router y la velocidad de su disco SSD o memoria interna. El motor de streaming de EQT está optimizado para saturar la capacidad física del enlace.

---

### P2: ¿La transferencia de archivos consume datos móviles (4G/5G)?
**R**: **No se consume ningún dato móvil en la transferencia de los archivos.**
Los archivos viajan estrictamente por la red interna entre su ordenador y el teléfono. Únicamente se realiza una insignificante señal de resolución DNS (unas pocas decenas de bytes) al escanear.

---

### P3: ¿Por qué no hay demoras al enviar carpetas completas?
**R**: EQT integra un **motor de compresión ZIP en tiempo real**.
En lugar de comprimir previamente los archivos en el disco y hacer esperar al usuario, EQT lee y comprime los datos directamente en la memoria y los envía al socket de red en tiempo real. La descarga en el móvil comienza en cuanto se establece la conexión.

---

### P4: ¿Cómo transfiero mi licencia Plus a un nuevo ordenador?
**R**:
1. Acceda al portal oficial de autoservicio de EQT.
2. Ingrese el correo electrónico utilizado en la compra para recibir un token de acceso seguro.
3. En el panel de control de dispositivos, pulse en "Desvincular" junto al equipo antiguo.
4. Abra EQT en su nuevo ordenador e introduzca su clave de licencia.

---

### P5: ¿Qué debo hacer si al escanear el código QR no se abre el navegador?
**R**:
- **iOS**: Utilice la aplicación **Cámara** preinstalada. Evite escanear dentro de aplicaciones de terceros que restrinjan la descarga de archivos.
- **Android**: Utilice la cámara del sistema, Chrome o Edge. Si se abre dentro de una aplicación de mensajería, pulse en el menú superior y elija "Abrir en navegador externo".
