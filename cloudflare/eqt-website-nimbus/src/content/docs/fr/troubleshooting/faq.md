---
title: "Foire Aux Questions (FAQ)"
description: "Questions fréquentes concernant les performances de transfert EQT, la compression à la volée, la gestion des licences et la confidentialité."
---

# Foire Aux Questions (FAQ)

---

### Q1 : Quelle vitesse de transfert EQT peut-il atteindre ?
**R** : Le débit de transfert dépend entièrement du matériel de votre réseau local, de la génération de vos protocoles sans fil et des performances d'E/S de votre stockage. **Il n'y a aucun bridage artificiel ni limitation de bande passante dans le cloud.**
- **Liaison physique directe** : EQT repose sur une architecture de flux socket local direct en pair-à-pair (P2P). L'intégralité des données transite à 100 % sur votre réseau Wi-Fi ou Ethernet local, évitant tout goulot d'étranglement lié aux serveurs distants.
- **Saturation matérielle maximale** : Les vitesses réelles sont régies par la norme Wi-Fi de vos appareils (ex. Wi-Fi 5 / Wi-Fi 6 / Wi-Fi 7), la capacité du fond de panier de votre routeur et les débits d'écriture de la mémoire flash (SSD NVMe / UFS 4.0). Le moteur de transmission par blocs d'EQT est conçu pour saturer la vitesse physique maximale de votre liaison locale.

---

### Q2 : Le transfert de fichiers consomme-t-il des données mobiles (4G/5G) ?
**R** : **Aucune donnée mobile n'est consommée pour les fichiers transférés.**
Les fichiers circulent directement sur le réseau local interne entre votre ordinateur et votre appareil mobile. Seul un signal de négociation négligeable (quelques dizaines d'octets) est émis lors de la résolution DNS initiale. Si vous le souhaitez, vous pouvez désactiver les données mobiles sur votre téléphone après avoir scanné le code QR pour le vérifier.

---

### Q3 : Pourquoi n'y a-t-il aucun délai lors de l'envoi de répertoires entiers ?
**R** : EQT intègre un **moteur de compression Zip en flux continu en temps réel**.
Les outils traditionnels imposent de pré-compresser tous les fichiers dans une archive temporaire sur le disque avant l'envoi, ce qui prend plusieurs minutes et sature l'espace disque. EQT lit les fichiers en continu, applique la compression et injecte simultanément les paquets dans le socket réseau actif. Les appareils mobiles commencent à télécharger l'archive immédiatement dès la connexion.

---

### Q4 : Comment transférer une licence Plus vers un nouvel ordinateur ?
**R** :
1. Rendez-vous sur le portail libre-service officiel EQT ;
2. Saisissez votre adresse e-mail d'achat pour recevoir un jeton de connexion dynamique sécurisé ;
3. Dans la console de gestion des appareils, cliquez sur **Dissocier** à côté de l'ancien ordinateur ;
4. Lancez EQT sur votre nouvel ordinateur et saisissez votre code d'activation de licence.

---

### Q5 : Que faire si le scan du code QR n'ouvre pas le navigateur ?
**R** :
- **Apple iOS** : Utilisez l'application native **Appareil photo**. Touchez la bannière jaune avec l'URL pour ouvrir la page dans Safari natif. Évitez de numériser dans des applications tierces restreignant les téléchargements ou isolant les fichiers dans un bac à sable.
- **Android** : Utilisez l'appareil photo du système, Chrome, Edge ou le navigateur natif. Si vous numérisez dans une application tierce, appuyez sur le menu supérieur droit et choisissez **Ouvrir dans le navigateur externe**.

---

### Q6 : Qui émet les certificats HTTPS utilisés pour les transferts LAN ?
**R** :
Les certificats dédiés de chaque appareil EQT sont automatiquement émis par **Let's Encrypt**, via un niveau de quota officiel étendu et une couche de résilience Multi-CA intelligente.
Étant donné que les clés privées sont générées strictement sur votre machine locale et ne quittent jamais l'appareil, EQT garantit à la fois la conformité WebPKI (cadenas vert) et une confidentialité cryptographique absolue.
