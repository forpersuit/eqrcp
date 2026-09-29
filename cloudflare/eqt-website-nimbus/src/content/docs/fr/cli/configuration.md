---
title: "Configuration et variables d'environnement"
description: "Persister vos paramètres et automatiser vos déploiements à l'aide de fichiers YAML standard et de variables d'environnement."
---

# Configuration et variables d'environnement

Pour conserver vos paramètres personnalisés ou déployer EQT sur des serveurs autonomes et des NAS, EQT prend en charge la configuration via des fichiers YAML standards et la surcharge par variables d'environnement.

---

## Emplacements des fichiers de configuration

EQT respecte les spécifications XDG standard des systèmes d'exploitation. Le fichier de configuration principal est nommé `config.yml` :

- **Windows** :
  ```text
  %APPDATA%\eqt\config.yml
  # Exemple : C:\Users\<NomUtilisateur>\AppData\Roaming\eqt\config.yml
  ```
- **macOS** :
  ```text
  ~/Library/Application Support/eqt/config.yml
  ```
- **Linux / POSIX** :
  ```text
  ~/.config/eqt/config.yml
  # (EQT migre automatiquement et en toute transparence les anciens fichiers ~/.local/eqt/config.yml)
  ```
- **Remplacement de répertoire personnalisé** : Définissez la variable d'environnement `EQT_CONFIG_DIR=/chemin/vers/dossier` pour utiliser un emplacement spécifique.

---

## Exemple de configuration (`config.yml`)

```yaml
# Interface réseau à utiliser (laisser vide pour la détection automatique du meilleur Wi-Fi)
interface: ""

# Adresse d'écoute réseau
bind: "0.0.0.0"

# Port d'écoute local (0 attribue un port aléatoire disponible)
port: 0

# Répertoire d'enregistrement par défaut des fichiers reçus
output: "~/Downloads"

# Maintenir le serveur actif après la fin du transfert (mode CLI)
keepAlive: false

# Activer le chiffrement LAN-TLS sécurisé Let's Encrypt
secure: true

# Préfixe de chemin d'URL personnalisé (laisser vide pour une chaîne aléatoire)
path: ""

# Nom de domaine complet (FQDN) personnalisé pour les codes QR
fqdn: ""

# Inverser le contraste du code QR pour terminaux à fond sombre
reversed: false

# Chemins des certificats TLS personnalisés (usage hors ligne / air-gap)
tls-cert: ""
tls-key: ""
```

---

## Variables d'environnement (`EQT_*`)

Les variables d'environnement sont prioritaires sur les paramètres de `config.yml` :

| Variable | Paramètre équivalent | Exemple |
| :--- | :--- | :--- |
| `EQT_CONFIG_DIR` | Répertoire racine de configuration | `/etc/eqt` |
| `EQT_INTERFACE` | Interface réseau d'écoute | `wlan0` / `Wi-Fi` |
| `EQT_PORT` | Port d'écoute local | `9090` |
| `EQT_BIND` | Adresse IP d'écoute locale | `127.0.0.1` / `0.0.0.0` |
| `EQT_OUTPUT` | Répertoire de réception des fichiers | `/srv/storage/downloads` |
| `EQT_KEEPALIVE` | Maintenir actif après transfert | `true` / `false` |
| `EQT_SECURE` | Imposer le chiffrement HTTPS | `true` / `false` |
| `EQT_FQDN` | Remplacement d'hôte pour le code QR | `transfer.internal.lan` |

---

## Exemple de démon en production

Sur les serveurs Linux ou les serveurs NAS, lancez EQT en tant que démon d'arrière-plan à l'aide d'un script shell simple :

```bash
#!/bin/bash
export EQT_PORT=9527
export EQT_OUTPUT="/data/nas-incoming"
export EQT_KEEPALIVE="true"

# Démarrer le récepteur silencieux en arrière-plan
nohup eqt receive --quiet > /var/log/eqt.log 2>&1 &
```
