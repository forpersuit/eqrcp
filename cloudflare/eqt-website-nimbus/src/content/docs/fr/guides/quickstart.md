---
title: "Guide de Démarrage Rapide"
description: "Apprenez à transférer des fichiers uniques, multiples ou des dossiers entiers entre votre ordinateur et vos appareils mobiles en quelques secondes."
---

# Guide de Démarrage Rapide

EQT propose à la fois une interface graphique intuitive (GUI) et une interface en ligne de commande ultra-performante (CLI). Pour démarrer, assurez-vous simplement que votre ordinateur et vos terminaux mobiles sont connectés au même réseau local (même Wi-Fi ou partage de connexion mobile).

---

## Mode 1 : Mode Partage (Ordinateur ➔ Appareil Mobile)

Utilisez ce mode lorsque vous souhaitez envoyer des vidéos, installateurs, feuilles de calcul ou photos haute résolution vers un smartphone ou une tablette :

### 1. Opérations sur l'Ordinateur
- **Interface Graphique (GUI)** : Glissez-déposez vos fichiers ou dossiers dans la fenêtre d'EQT, puis cliquez sur **Démarrer l'envoi**.
- **Ligne de Commande (CLI)** :
  ```bash
  # Envoyer un fichier unique
  eqt MonDocument.pdf

  # Envoyer plusieurs fichiers ou un dossier complet (archivage Zip diffusé en streaming)
  eqt Photos/ Video.mp4
  ```

### 2. Scan du Code QR sur Mobile
Un code QR dédié ainsi qu'une URL locale s'affichent sur votre écran ou terminal.
1. Ouvrez l'appareil photo natif de votre smartphone (Appareil photo iOS ou lecteur Android par défaut) et visez le code QR.
2. Touchez la bannière de notification pour ouvrir le portail de téléchargement dans le navigateur mobile.
3. Cliquez sur **Tout télécharger** ou cochez individuellement les fichiers souhaités.

---

## Mode 2 : Mode Réception (Appareil Mobile ➔ Ordinateur)

Utilisez ce mode pour sauvegarder vos photos, vidéos 4K et documents de travail depuis votre mobile vers votre ordinateur :

### 1. Activer l'Écoute de Réception sur l'Ordinateur
- **Interface Graphique (GUI)** : Cliquez sur l'onglet **Recevoir des fichiers**, ou sélectionnez **Attendre la réception** dans la zone de notification.
- **Ligne de Commande (CLI)** :
  ```bash
  eqt receive
  ```

### 2. Scanner et Sélectionner les Fichiers sur Mobile
1. Scannez le code QR affiché avec votre mobile pour accéder à la passerelle de téléversement.
2. Appuyez sur **Sélectionner des fichiers** ou **Prendre une photo / Photothèque**.
3. Choisissez les éléments à transférer et appuyez sur **Envoyer maintenant**.
4. L'ordinateur reçoit les données à la vitesse physique maximale de votre réseau local. Les fichiers reçus sont stockés dans votre dossier système `Téléchargements`.

---

## Astuces Pratiques

- **Streaming Direct de Dossiers sans Attente** : Lors de l'envoi d'un dossier complet, EQT emploie un algorithme de compression Zip en flux continu en mémoire vive. Aucun fichier temporaire lourd n'est pré-généré sur disque ; la compression et l'envoi s'exécutent simultanément dès la connexion du client.
- **Sélection des Ports et Cartes Réseau** : Si votre station de travail dispose de plusieurs adaptateurs réseau (Wi-Fi physique, cartes virtuelles), lancez l'assistant interactif pour sélectionner l'interface appropriée :
  ```bash
  eqt config
  ```
