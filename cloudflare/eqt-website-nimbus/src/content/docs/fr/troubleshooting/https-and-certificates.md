---
title: "Guide HTTPS et certificats"
description: "Comprendre le chiffrement HTTPS local d'EQT, pourquoi les certificats sont indispensables, l'émission Let's Encrypt et le repli hors ligne."
---

# Guide du cadenas vert HTTPS et des certificats

Lors de la numérisation d'un code QR EQT avec un navigateur mobile, les utilisateurs constatent la présence d'un cadenas de sécurité vert approuvé (🔒) dans la barre d'adresse, ou rencontrent parfois un avertissement de certificat sur des réseaux totalement isolés. Ce guide explique les principes cryptographiques et les diagnostics opérationnels du système LAN-TLS d'EQT.

---

## Pourquoi les transferts en réseau local requièrent HTTPS

Les outils LAN traditionnels transmettent généralement le contenu en clair via `http://`. Dans les systèmes d'exploitation et navigateurs modernes, le protocole HTTP non chiffré impose des contraintes techniques sévères :

### 1. Le piège de mémoire iOS Safari à 1,5 Go (plantage OOM)
Dans un contexte `http://` non chiffré, le bac à sable Apple iOS WebKit applique des politiques de sécurité strictes : il interrompt les flux d'écriture directe sur le stockage et accumule tous les paquets entrants dans la mémoire vive du navigateur. Lors du transfert de fichiers dépassant 1,5 Go à 2 Go en HTTP clair, l'onglet mobile de Safari sature son allocation de mémoire de tas et plante immédiatement (Out-Of-Memory). **Ce n'est qu'au sein d'un contexte HTTPS authentifié que WebKit accorde les privilèges complets d'écriture directe sur disque en continu.**

### 2. Restrictions des API du Web moderne
Les spécifications du W3C imposent un **contexte sécurisé (HTTPS)** pour les fonctionnalités essentielles. La synchronisation automatique du presse-papiers, le menu de partage mobile natif (Web Share API) et les API d'accélération matérielle Web Crypto sont strictement désactivés par les navigateurs lorsqu'ils sont chargés via HTTP simple.

### 3. Protection contre les écoutes clandestines sur les réseaux Wi-Fi locaux
Sur les réseaux Wi-Fi partagés ou ouverts (cafés, hôtels, espaces de coworking), toute personne exécutant un outil d'analyse de paquets basique peut facilement intercepter les flux HTTP non chiffrés, exposant ainsi photos personnelles, documents professionnels et historiques de messagerie.

---

## Comment EQT obtient un cadenas vert WebPKI public sur un réseau local

Les utilisateurs se demandent souvent : *"Si les données transitent exclusivement sur un réseau local, comment le navigateur peut-il afficher un cadenas de sécurité légitime et publiquement approuvé ?"*

1. **Certificats génériques dédiés Let's Encrypt** :
   Lors de son premier démarrage, le client de bureau génère localement une clé privée ECDSA P-256. Grâce à une orchestration sans serveur coordonnée par Cloudflare, il accomplit un défi ACME DNS-01 avec **Let's Encrypt**, délivrant un certificat générique wildcard dédié (`*.<NodeID>.direct.eqt.net.im`) pour cet appareil spécifique. Ce canal bénéficie d'un quota officiel élevé (plus de 20 000 certificats/semaine) avec basculement Multi-CA résilient.
2. **Bouclage DNS mathématique sans état (`eqt-dns`)** :
   Lorsqu'un appareil mobile scanne une URL telle que `https://192-168-1-50.<NodeID>.direct.eqt.net.im:8080/`, le cluster DNS faisant autorité décompose mathématiquement le préfixe en IP LAN `192.168.1.50` entièrement en mémoire vive.
3. **Confiance de l'autorité racine publique + commutation Wi-Fi directe** :
   Le navigateur mobile valide le certificat par rapport à son magasin de confiance racine Let's Encrypt intégré et affiche le cadenas vert. Simultanément, **100 % des paquets de données TCP transitent exclusivement par le routeur ou le commutateur Wi-Fi local**, contournant totalement les serveurs externes.

---

## Symptômes et diagnostics

### Symptôme 1 : La barre d'adresse affiche le cadenas de confiance 🔒
Il s'agit de l'état de fonctionnement standard. Les certificats sont valides pendant 90 jours et le client de bureau les renouvelle automatiquement et silencieusement en arrière-plan avant leur expiration. Aucune intervention manuelle n'est requise.

### Symptôme 2 : Le navigateur affiche "Connexion non privée / Certificat non valide"
Cette situation survient généralement dans l'un des deux cas suivants :
- **Scénario A : EQT a été lancé initialement sans accès à Internet**
  Si EQT a démarré sur une station de travail dans un environnement entièrement isolé d'Internet (air-gap), il n'a pas pu communiquer avec Let's Encrypt et a généré un certificat auto-signé éphémère pour garantir la disponibilité locale.
  *Solution* : Connectez l'ordinateur à Internet une fois, redémarrez EQT et attendez quelques secondes que l'approvisionnement initial du certificat s'achève.
- **Scénario B : Détournement de DNS interne ou DNS à horizon partagé (Split-Horizon)**
  Dans certains réseaux d'entreprise où la résolution DNS publique est bloquée ou redirigée vers un résolveur interne, le navigateur peut échouer à résoudre le domaine de bouclage.
  *Solution* : Sur la page d'avertissement du navigateur, appuyez sur **Avancé** ➔ **Continuer vers le site (non sécurisé)**. Le transfert local en point à point fonctionnera normalement.
