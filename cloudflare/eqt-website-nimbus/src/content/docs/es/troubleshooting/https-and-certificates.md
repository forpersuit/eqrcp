---
title: "Guía de HTTPS y certificados"
description: "Cifrado HTTPS local de EQT, por qué los certificados son obligatorios, emisión de Let's Encrypt y modo sin conexión."
---

# Candado verde HTTPS y guía de certificados

Al escanear el código QR de EQT con un navegador móvil, los usuarios aprecian el candado verde de seguridad (🔒) en la barra de direcciones. Esta guía detalla los principios criptográficos y diagnósticos del protocolo LAN-TLS de EQT.

---

## Por qué las transferencias en red local requieren HTTPS obligatorio

Las herramientas LAN tradicionales transmitían datos mediante `http://` en texto claro. En los sistemas operativos y navegadores móviles actuales, el protocolo HTTP sin cifrar sufre severas restricciones:

### 1. La trampa de memoria de 1,5 GB en iOS Safari (Cuelgue OOM)
En conexiones `http://` sin cifrar, la seguridad del sandbox de WebKit en iOS impide la escritura directa en el almacenamiento y acumula todos los bloques de datos en la memoria RAM del navegador. Si se descargan archivos superiores a 1,5 GB o 2 GB por HTTP simple, Safari agota su memoria asignada (Heap) y la pestaña se cierra de inmediato por Out-Of-Memory. **Solo en un entorno HTTPS autenticado permite WebKit la escritura directa y continua en el disco.**

### 2. Restricciones en las API modernas de la plataforma web
Las especificaciones del W3C exigen un **contexto seguro (HTTPS)** para funciones fundamentales como la sincronización del portapapeles, el menú nativo de compartir en móviles (Web Share API) y las API criptográficas aceleradas por hardware. En HTTP simple, los navegadores bloquean estas capacidades.

### 3. Protección frente a escuchas en redes Wi-Fi abiertas
En cafeterías, hoteles o espacios de trabajo compartido, cualquiera con una herramienta básica de análisis de paquetes puede interceptar transferencias HTTP sin cifrar, dejando al descubierto fotos y documentos confidenciales.

---

## Cómo logra EQT el candado verde WebPKI en la red local

1. **Certificados comodín dedicados de Let's Encrypt**:
   En su primer inicio, el cliente de escritorio genera localmente una clave privada ECDSA P-256. Mediante orquestación serverless en Cloudflare, completa una validación ACME DNS-01 ante **Let's Encrypt**, obteniendo un certificado comodín exclusivo (`*.<NodeID>.direct.eqt.net.im`).
2. **DNS matemático de bucle invertido sin estado (`eqt-dns`)**:
   Cuando un móvil consulta `https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/`, el servidor DNS autoritativo traduce matemáticamente el prefijo a la IP local `192.168.1.50` en memoria en menos de un milisegundo.
3. **Confianza pública de CA raíz + Comunicación Wi-Fi directa**:
   El navegador móvil valida el certificado frente a la raíz oficial de Let's Encrypt y muestra el candado verde. Mientras tanto, **el 100 % de los paquetes de datos TCP se transmiten únicamente por su router o switch local**, sin tocar servidores en la nube.
