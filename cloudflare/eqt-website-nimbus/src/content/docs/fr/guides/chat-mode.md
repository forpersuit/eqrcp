---
title: "Collaboration LAN Chat"
description: "Synchronisez instantanément le presse-papiers, mots de passe, liens longs et pièces jointes lourdes via un salon de discussion local éphémère."
---

# Mode Collaboration LAN Chat

Au quotidien, ingénieurs et créateurs ont fréquemment besoin d'échanger des fragments de texte entre smartphone et ordinateur :
- Une adresse de livraison, un code de validation 2FA ou un lien long reçu sur PC à transférer sur mobile ;
- Un identifiant, un jeton d'API ou une clé SSH copiée sur smartphone à coller dans un terminal de développement ;
- Les messageries instantanées traditionnelles compressent souvent les médias et téléversent les données sensibles sur des serveurs distants.

Le **Mode Chat** d'EQT est conçu sur mesure pour cet usage : un espace de discussion local temporaire, sans inscription, sans application à installer et détruit immédiatement en mémoire dès la fin de session.

---

## Démarrer le Mode Chat

### 1. Lancement sur Ordinateur
Cliquez sur le bouton **LAN Chat** de l'interface graphique, ou saisissez dans votre terminal :
```bash
eqt chat --browser
```
Le serveur local démarre, ouvre le tableau de bord dans votre navigateur par défaut et affiche le code QR de connexion mobile.

### 2. Connexion depuis l'Appareil Mobile
Scannez le code QR avec votre appareil photo pour rejoindre directement l'espace web. Aucune création de compte ni authentification n'est exigée.

---

## Fonctionnalités Principales

### 1. Synchronisation Bidirectionnelle du Presse-papiers
- Copiez un texte sur mobile et collez-le dans le champ d'envoi : il s'affiche instantanément sur votre ordinateur avec un bouton **Copier dans le presse-papiers**.
- Prise en charge intégrale des blocs de code multi-lignes, du formatage Markdown et des URLs étendues.

### 2. Pièces Jointes Riches et Médias Non Compressés
- Envoyez des photos en définition d'origine, des vidéos 4K et des documents à tout moment de l'échange.
- Les fichiers transitent via des canaux sockets locaux concurrents, avec zéro compression d'image ou de vidéo.

### 3. Contrôle d'Accès de l'Hôte
- L'ordinateur fait office d'hôte autoritaire et affiche la liste en temps réel des appareils connectés sur le réseau local.
- Expulsion en un clic pour déconnecter immédiatement tout appareil inconnu ou non autorisé.

### 4. Destruction Éphémère en Mémoire Vive (RAM)
- Dès la fermeture de la fenêtre ou l'arrêt du processus, la conversation entière est immédiatement effacée de la mémoire vive. Aucun historique en clair n'est conservé sur disque.

### 5. Règles de Quotas et Liberté d'Échange
- **Messages Texte & Presse-papiers** : Entièrement gratuits et illimités à vie, sans aucune restriction de durée ni de fréquence.
- **Pièces Jointes & Médias Lourds** : L'édition gratuite inclut 5 minutes (300 secondes) quotidiennes de transfert à vitesse maximale. Au-delà, un canal de sécurité s'active (limite de 4 Mo par fichier, vitesse de 100 Ko/s), tandis que les échanges textuels continuent normalement. La mise à niveau vers l'édition Plus débloque un transfert illimité 24/7 au débit maximal de votre réseau.
