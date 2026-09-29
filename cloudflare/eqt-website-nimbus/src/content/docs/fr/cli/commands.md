---
title: "Référence des commandes CLI"
description: "Référence complète de toutes les sous-commandes, paramètres et options de l'interface en ligne de commande (CLI) d'EQT."
---

# Référence des commandes CLI

Le moteur principal d'EQT est développé nativement en Go, offrant une interface en ligne de commande (CLI) légère et à très haut débit. Il fonctionne de manière transparente sur les serveurs sans interface graphique (headless), les terminaux de développement locaux et les scripts d'intégration continue.

---

## Sous-commandes principales

### 1. Envoyer / Partager des fichiers ou des répertoires
Lorsqu'aucune sous-commande n'est fournie et que les arguments positionnels sont des chemins de fichiers ou de répertoires, EQT active par défaut le mode d'envoi :
```bash
# Envoyer un fichier unique
eqt MonDocument.pdf

# Envoyer plusieurs fichiers et spécifier un port dédié
eqt --port 8080 Video.mp4 Presentation.pptx

# Envoyer un répertoire complet (compressé et diffusé à la volée)
eqt /home/user/Projets/
```

### 2. Recevoir des fichiers
```bash
# Démarrer le récepteur et attendre le téléversement mobile
eqt receive

# Spécifier le répertoire de destination (option courte -o)
eqt receive -o ~/Desktop/Downloads
```

### 3. Collaboration sur réseau local (Chat)
```bash
# Démarrer le service de collaboration LAN sans interface graphique
eqt chat

# Démarrer le service de chat et ouvrir automatiquement la console dans le navigateur par défaut
eqt chat --browser
```

### 4. Assistant de configuration interactif (Config)
```bash
# Lancer l'assistant interactif pour configurer l'interface, le port et les chemins
eqt config
```

### 5. Auto-complétion pour le shell (Completion)
```bash
# Générer le script d'auto-complétion pour Bash ou Zsh
eqt completion bash > /etc/bash_completion.d/eqt
eqt completion zsh > "${fpath[1]}/_eqt"
```

---

## Options globales de la CLI

Les options suivantes ont été vérifiées avec le moteur central et sont prises en charge sur toutes les sous-commandes pertinentes :

| Option | Raccourci | Valeur par défaut | Description |
| :--- | :---: | :---: | :--- |
| `--interface` | `-i` | Détection auto | Forcer la liaison à une interface réseau spécifique (ex. `eth0`, `wlan0`, `Wi-Fi`) |
| `--port` | `-p` | `0` (Aléatoire) | Port d'écoute du serveur (`0` attribue un port libre aléatoire) |
| `--bind` | | `0.0.0.0` | Adresse IP d'écoute du serveur (pas de raccourci ; ne pas confondre avec `-b`) |
| `--browser` | `-b` | `false` | Ouvrir automatiquement la console web dans le navigateur par défaut |
| `--secure` | `-s` | `true` | Activer le chiffrement WebPKI HTTPS approuvé |
| `--output` | `-o` | Dossier Téléchargements | (Mode réception uniquement) Répertoire où enregistrer les fichiers reçus |
| `--keep-alive` | `-k` | `false` | Maintenir le serveur actif après la fin du transfert au lieu de quitter |
| `--quiet` | `-q` | `false` | Désactiver la barre de progression interactive ; afficher uniquement les journaux d'erreurs |
| `--zip` | `-z` | `false` | Forcer la compression dans une seule archive zip |
| `--fqdn` | `-d` | Auto | Remplacer le nom d'hôte ou le nom de domaine complet généré |
| `--path` | | Chaîne aléatoire | Définir un préfixe de chemin d'URL personnalisé (ex. `/mon-partage`) |
| `--config` | `-c` | Chemin par défaut | Spécifier le chemin d'un fichier de configuration YAML externe |
| `--list-all-interfaces` | `-l` | `false` | Lister toutes les interfaces réseau (y compris virtuelles) dans l'assistant |
| `--reversed` | `-r` | `false` | Inverser le contraste du code QR dans le terminal (pour fonds sombres) |
| `--tls-cert` | | Vide | Chemin vers un certificat TLS personnalisé (pour environnement isolé hors ligne) |
| `--tls-key` | | Vide | Chemin vers une clé privée TLS personnalisée (pour environnement isolé hors ligne) |
