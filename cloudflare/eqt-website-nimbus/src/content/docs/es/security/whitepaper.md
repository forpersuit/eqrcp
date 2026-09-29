---
title: "Libro blanco de seguridad y privacidad"
description: "Arquitectura criptográfica detallada de EQT: flujo P2P directo, cero almacenamiento en la nube y protocolo LAN-TLS sin fugas."
---

# Libro blanco de seguridad y privacidad

En un contexto donde los servicios centralizados en la nube y las plataformas de mensajería monopolizan el intercambio de archivos, la privacidad de los usuarios sufre vulnerabilidades sistémicas: escaneo automatizado de fotografías privadas en la nube, uso no consentido de documentos para entrenar modelos de IA y escuchas maliciosas en redes Wi-Fi abiertas.

Desde su primer diseño, EQT ha mantenido una filosofía inquebrantable: **"Privacidad por primeros principios y la realidad física en primer lugar (Privacy by First Principles & Physical Reality First)"**. Este documento expone con total transparencia la arquitectura de seguridad y el diseño criptográfico de EQT.

---

## 3 invariantes fundamentales de seguridad

1. **Cero almacenamiento en la nube estricto (Zero Cloud Relay)**:
   Tanto si se comparte un fragmento de código de 1 MB como un archivo de vídeo 4K de 100 GB, la carga de datos circula exclusivamente por el socket directo físico establecido entre emisor y receptor. EQT no opera servidores de archivos, ni intermediarios de retransmisión, ni almacenes en caché en Internet.
2. **Cero fugas de claves privadas del dispositivo**:
   La clave privada ECDSA P-256 necesaria para el cifrado TLS local se genera físicamente en su ordenador a partir de entropía de alta calidad del sistema y se almacena con permisos de archivo atómicos POSIX `0600`. **La clave privada nunca viaja por la red.**
3. **Sandbox móvil efímero con limpieza total**:
   Los dispositivos móviles interactúan estrictamente en el entorno protegido de sus navegadores nativos (iOS Safari, Android Chrome). Al cerrar la pestaña, el contexto de ejecución se destruye de inmediato, sin dejar ningún proceso de fondo residente en el teléfono.

---

## Arquitectura del protocolo LAN-TLS

### 1. Deficiencias de las soluciones convencionales
En la transferencia local de archivos, la comodidad móvil y la seguridad criptográfica estricta solían estar enfrentadas:

| Enfoque | Mecanismo de operación | Vulnerabilidades y evaluación de seguridad |
| :--- | :--- | :--- |
| **HTTP en texto claro** | Transmisión mediante `http://192.168.x.x` | ❌ **Vulnerable a escuchas en Wi-Fi abierta**; provoca fallos de memoria en iOS Safari con archivos >1,5 GB. |
| **Certificados autofirmados** | Autoridad de certificación local efímera | ❌ **Provoca alarmas de seguridad críticas** en el navegador, condicionando a los usuarios a ignorar advertencias graves. |
| **Retransmisión en la nube** | Subida a servidores proxy remotos | ❌ **Pérdida absoluta de privacidad**; limitada por el ancho de banda de subida a Internet y cuotas en la nube. |
| **Claves comodín compartidas** | Certificado comodín y clave privada fijos integrados | ❌ **Falsa seguridad catastrófica**. La clave privada se convierte en un secreto simétrico público, permitiendo ataques Man-in-the-Middle (MITM) en la LAN. |
| **LAN-TLS de EQT (Este sistema)** | **Wildcard dedicado Let's Encrypt + DNS sin estado** | ✅ **Cero fugas de clave privada + Candado verde WebPKI 🔒 + Velocidad física de enlace local**. |

---

### 2. Secuencia de la arquitectura LAN-TLS de EQT

EQT integra la **generación local de pares de claves ECDSA**, la **orquestación serverless ACME DNS-01 mediante Cloudflare Workers** y el **DNS matemático autoritativo de bucle invertido sin estado (`eqt-dns`)**:

```
+---------------------------------------------------------------------------------------------------+
| 1. Generación de clave local en el ordenador                                                      |
|    - Crea clave privada ECDSA P-256 dedicada; guardada con permisos POSIX 0600.                   |
|    - La clave privada nunca sale del equipo; solo se exporta el CSR (*.<NodeID>.direct.eqt.net.im)|
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (1) Envío de CSR con marca temporal antirrepetición
                                                   v
+---------------------------------------------------------------------------------------------------+
| 2. Pasarela ACME en Cloudflare (Serverless)                                                       |
|    - El Worker valida la firma del CSR y la tasa de peticiones, tramitando la orden ante CA.      |
|    - Obtiene el token de desafío DNS-01 TXT e inserta el registro temporal en eqt-dns.            |
|    - Let's Encrypt valida el TXT y emite la cadena X.509; el Worker purga el registro TXT.        |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (2) Retorno de la cadena de certificados (fullchain.pem)
                                                   v
+---------------------------------------------------------------------------------------------------+
| 3. Inicialización del servicio local y conexión móvil                                             |
|    - El equipo enlaza el socket TLS 1.3 con privkey.pem y cert.pem.                               |
|    - El móvil escanea el QR hacia: https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/          |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (3) El móvil inicia la resolución DNS
                                                   v
+---------------------------------------------------------------------------------------------------+
| 4. DNS matemático de bucle invertido sin estado (eqt-dns)                                         |
|    - El DNS autoritativo descompone el prefijo `192-168-1-50` en memoria en la IP 192.168.1.50.   |
|    - Responde en <1 ms con registro A 192.168.1.50 (TTL=300s); sin bases de datos ni registros.   |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (4) Handshake directo en la red local
                                                   v
+---------------------------------------------------------------------------------------------------+
| 5. Transferencia cifrada TLS 1.3 a velocidad física de cable o Wi-Fi                              |
|    - El navegador móvil verifica la confianza de Let's Encrypt: muestra el candado verde 🔒.     |
|    - Cifrado AEAD de alto rendimiento (AES-GCM / ChaCha20-Poly1305); 100 % de datos en red local. |
+---------------------------------------------------------------------------------------------------+
```

---

### 3. Ventajas arquitectónicas destacadas

#### ① Cero fugas de claves criptográficas (Inmune a MITM)
Cada ordenador con EQT posee un identificador de nodo único (Node ID) y genera sus propias claves localmente. El certificado se emite estrictamente para `*.<NodeID>.direct.eqt.net.im`. **No existen claves privadas universales ni compartidas en la red.**

#### ② DNS de bucle invertido matemático puramente sin estado
El clúster autoritativo (`eqt-dns`) no almacena registros de direcciones IP de usuarios. Descompone los prefijos en tiempo real en memoria de forma puramente algorítmica, con escalabilidad horizontal ilimitada.

#### ③ Cuota oficial de alta capacidad y resiliencia Multi-CA
Frente a las limitaciones semanales habituales de las CA públicas, EQT opera bajo un nivel oficial de alta capacidad concedido por Let's Encrypt (más de 20.000 certificados semanales), respaldado por conmutación por error inteligente Multi-CA.

#### ④ Modo autónomo sin conexión (Air-Gap)
Si EQT se ejecuta por primera vez en un entorno aislado sin acceso a Internet, genera un certificado temporal para mantener la disponibilidad local de inmediato, actualizándose al certificado público en cuanto se disponga de conexión.
