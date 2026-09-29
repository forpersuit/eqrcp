---
title: "Livre blanc sur la sécurité et la confidentialité"
description: "Architecture cryptographique détaillée du flux direct pair-à-pair local d'EQT, sans stockage cloud et avec protocole LAN-TLS à zéro fuite."
---

# Livre blanc sur la sécurité et la confidentialité

À une époque où les services cloud centralisés et les plateformes de messagerie instantanée dominent les échanges de données, la confidentialité des utilisateurs est exposée à des risques systémiques : analyse cloud des photos personnelles, ingestion non autorisée de documents confidentiels dans des modèles d'intelligence artificielle et écoutes clandestines sur les réseaux Wi-Fi non chiffrés.

Dès sa conception, EQT a adopté une philosophie d'ingénierie stricte : **"La confidentialité par les premiers principes et la réalité physique avant tout"**. Ce document expose publiquement l'architecture de sécurité et la conception cryptographique d'EQT.

---

## Invariants fondamentaux de sécurité

1. **Zéro stockage cloud strict (Zéro relais cloud)** :
   Qu'il s'agisse de diffuser un extrait de code de 1 Mo ou une archive vidéo brute de 100 Go, le flux de données transite exclusivement par un socket réseau physique direct établi entre l'émetteur et le récepteur. EQT n'utilise aucun serveur de stockage de fichiers, aucun relais externe et aucun cache cloud.
2. **Clé privée d'appareil sans aucune fuite** :
   La clé privée ECDSA P-256 requise pour le chiffrement TLS local est générée physiquement sur votre ordinateur à partir d'une source d'entropie système élevée et stockée avec des permissions de fichier atomiques POSIX `0600`. **La clé privée n'est jamais transmise sur le réseau.**
3. **Bac à sable mobile sans friction avec purge éphémère** :
   Les appareils mobiles interagissent strictement dans l'environnement cloisonné des navigateurs mobiles natifs (iOS Safari, Android Chrome). La fermeture de l'onglet du navigateur met fin au contexte d'exécution, ne laissant aucun démon persistant en arrière-plan sur les appareils mobiles.

---

## Architecture du protocole LAN-TLS

### 1. Faiblesses techniques des solutions traditionnelles du secteur
Dans le transfert de fichiers local en pair-à-pair, "l'expérience utilisateur mobile sans friction" et "la sécurité cryptographique rigoureuse" ont longtemps été contradictoires :

| Approche | Mécanisme de fonctionnement | Vulnérabilités et évaluation de sécurité |
| :--- | :--- | :--- |
| **HTTP en texte clair** | Transmission directe via `http://192.168.x.x` | ❌ **Facilement interceptable sur Wi-Fi ouvert** ; provoque des plantages mémoire sur iOS Safari pour les fichiers volumineux (>1,5 Go). |
| **Certificats auto-signés** | Certificat d'autorité locale éphémère | ❌ **Déclenche des avertissements de sécurité alarmants dans le navigateur**, habituant dangereusement les utilisateurs à ignorer les alertes de sécurité. |
| **Relais Cloud** | Fichier téléversé sur des serveurs mandataires distants | ❌ **Perte totale de confidentialité** ; tributaire de la vitesse montante de la connexion Internet et des restrictions de débit imposées par le cloud. |
| **Clés génériques partagées** | Certificat générique et clé privée statiques intégrés | ❌ **Pseudo-sécurité désastreuse**. La clé privée devenant un secret symétrique partagé, elle permet des attaques Man-in-the-Middle (MITM) actives sur le réseau local. |
| **LAN-TLS EQT (Notre système)** | **Wildcard dédié Let's Encrypt + Bouclage DNS sans état** | ✅ **Zéro fuite de clé privée + Cadenas vert WebPKI public 🔒 + Vitesse physique maximale du réseau local**. |

---

### 2. Séquence d'architecture du protocole LAN-TLS d'EQT

EQT associe la **génération locale de paires de clés ECDSA**, **l'orchestration ACME DNS-01 sans serveur via Cloudflare Workers** et le **bouclage DNS mathématique sans état faisant autorité (`eqt-dns`)** :

```
+---------------------------------------------------------------------------------------------------+
| 1. Génération locale de la clé client (Poste de travail)                                          |
|    - Le bureau génère une clé privée dédiée ECDSA P-256 avec permissions POSIX 0600.              |
|    - La clé privée ne quitte jamais l'ordinateur ; seul le CSR est exporté (*.<NodeID>.direct...) |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (1) POST du CSR avec horodatage anti-rejeu
                                                   v
+---------------------------------------------------------------------------------------------------+
| 2. Orchestration de la passerelle ACME Cloudflare (Serverless)                                    |
|    - Le Worker valide la signature du CSR et le débit, puis soumet l'ordre à l'autorité (Let's    |
|      Encrypt).                                                                                    |
|    - Obtient le jeton de défi TXT DNS-01 et enregistre temporairement _acme-challenge dans eqt-dns|
|    - Let's Encrypt valide l'enregistrement TXT et émet le certificat X.509 ; le Worker efface le  |
|      TXT.                                                                                         |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (2) Retour de la chaîne de certificats (fullchain.pem)
                                                   v
+---------------------------------------------------------------------------------------------------+
| 3. Initialisation du service local et connexion mobile                                            |
|    - Le poste charge privkey.pem et cert.pem, puis lie le socket TLS 1.3.                         |
|    - Le mobile scanne le code QR pointant vers : https://192-168-1-50.<NodeID>.direct...:8080/    |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (3) Le mobile effectue la requête DNS
                                                   v
+---------------------------------------------------------------------------------------------------+
| 4. Bouclage DNS mathématique sans état (eqt-dns)                                                  |
|    - Le serveur DNS faisant autorité décompose mathématiquement `192-168-1-50` en mémoire vive.   |
|    - Réponse en <1 ms avec l'enregistrement A 192.168.1.50 (TTL=300s) ; zéro base de données.     |
+--------------------------------------------------+------------------------------------------------+
                                                   |
                                                   | (4) Poignée de main directe sur socket local (LAN)
                                                   v
+---------------------------------------------------------------------------------------------------+
| 5. Transfert chiffré TLS 1.3 à la vitesse physique du câble ou du Wi-Fi                           |
|    - Le navigateur valide la racine de confiance Let's Encrypt : affiche le cadenas vert 🔒.      |
|    - Chiffrement AEAD à haut débit (AES-GCM / ChaCha20-Poly1305) ; 100 % des flux en local.       |
+---------------------------------------------------------------------------------------------------+
```

---

### 3. Quatre atouts architecturaux majeurs

#### ① Zéro fuite cryptographique (Immunité contre les attaques de l'homme du milieu)
Chaque poste EQT dispose d'un identifiant de nœud unique (Node ID) et génère sa propre paire de clés cryptographiques localement. Le certificat est délivré strictement pour `*.<NodeID>.direct.eqt.net.im`. **Aucune clé privée partagée ou universelle n'existe sur le réseau.** Même en présence d'appareils tiers non approuvés sur le même réseau local, ils ne peuvent ni déchiffrer ni falsifier les flux de votre session.

#### ② Bouclage DNS mathématique purement sans état
Le cluster de résolution faisant autorité (`eqt-dns`) ne stocke aucune base de données d'adresses IP utilisateur. Il décompose de façon algorithmique les préfixes tels que `192-168-1-50` en adresse IP interne physique `192.168.1.50` en mémoire vive. Les requêtes reçoivent une réponse en une fraction de milliseconde, avec une capacité de montée en charge horizontale illimitée.

#### ③ Quota officiel étendu et résilience Multi-CA élastique
Les intégrations ACME standards sont confrontées à des quotas stricts d'autorités de certification publiques (souvent 50 certificats par domaine racine et par semaine). EQT bénéficie d'un palier officiel à quota élevé accordé par Let's Encrypt, prenant en charge plus de 20 000 émissions de certificats par semaine. De plus, la couche d'orchestration intègre des circuits de secours intelligents Multi-CA garantissant une disponibilité mondiale continue.

#### ④ Repli transparent hors ligne (Air-Gap)
Lors d'un premier démarrage sur un réseau totalement isolé ou sans connexion Internet, EQT initialise automatiquement un certificat de secours éphémère afin que les transferts locaux s'exécutent sans interruption. Dès qu'une connexion Internet est établie ultérieurement, une mise à niveau transparente vers le certificat public approuvé s'effectue automatiquement en arrière-plan.

---

## Sécurité en mémoire et sessions éphémères

- **Flux direct sans fichier temporaire** : Lors de l'envoi de répertoires volumineux, les fichiers sont compressés en blocs Zip en temps réel directement dans les mémoires tampons réseau. Aucun fichier temporaire non chiffré n'est écrit sur le disque physique.
- **Isolation éphémère du chat en mémoire vive (RAM)** : Les messages de collaboration et le contenu du presse-papiers résident exclusivement dans la mémoire vive volatile du système d'exploitation. Lorsque la session de chat prend fin ou que l'application est fermée, ces allocations mémoire sont immédiatement libérées, ne laissant aucune trace en clair sur le disque de stockage persistant.
