---
title: "Resolución de problemas de red y cortafuegos"
description: "Detección de dispositivos en la red local, desactivación de aislamiento AP (Wi-Fi de invitados) y permisos de cortafuegos."
---

# Resolución de problemas: Cortafuegos y red local

Si el navegador del teléfono no puede cargar la página tras escanear el código QR o indica tiempo de espera agotado, la causa suele residir en la configuración del router o en el cortafuegos del ordenador.

---

## 1. Desactivar el aislamiento de punto de acceso (AP Isolation)

En redes Wi-Fi de hoteles, cafeterías o redes para invitados en routers domésticos, suele estar activada la función de **aislamiento de clientes (Client / AP Isolation)**.
Esta función impide deliberadamente que los dispositivos conectados al mismo punto de acceso se comuniquen entre sí.

- **Solución**: En el panel de configuración del router, desactive opciones como "Aislamiento de clientes" o conecte ambos dispositivos a la red Wi-Fi principal.

---

## 2. Permitir el acceso en el cortafuegos de Windows

La primera vez que ejecute EQT en Windows, aparecerá un aviso de seguridad. Debe permitir el acceso para "Redes privadas".

Si canceló el aviso por error:
1. Abra **Configuración de Windows** ➔ **Privacidad y seguridad** ➔ **Seguridad de Windows** ➔ **Protección de red y firewall**.
2. Haga clic en **Permitir que una aplicación se comunique a través de Firewall**.
3. Busque `EQT` en la lista y marque la casilla "Privada".

---

## 3. Conceder permisos de red local en macOS

A partir de macOS Sequoia (15.0), el sistema operativo requiere autorización explícita para que las aplicaciones detecten y se comuniquen con dispositivos en la red local.

1. Abra **Ajustes del Sistema** ➔ **Privacidad y seguridad** ➔ **Red local**.
2. Active el interruptor junto a `EQT`.
