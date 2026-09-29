---
title: "Connectivité LAN & Pare-feu"
description: "Diagnostiquez les erreurs de dépassement de délai, pages inaccessibles et blocages de pare-feu lors de l'utilisation d'EQT."
---

# Connectivité LAN & Pare-feu

Si après avoir scanné le code QR votre mobile affiche « Impossible de se connecter au serveur », `ERR_CONNECTION_TIMED_OUT` ou un chargement infini, plus de 95 % des cas résultent d'un **blocage par le pare-feu Windows Defender** ou de l'**activation de l'isolation AP (Client Isolation)** sur le routeur.

Suivez la procédure de diagnostic par étapes ci-dessous :

---

## Étape 1 : Vérifier que les Appareils Sont sur le Même Réseau

1. Assurez-vous que l'ordinateur et le smartphone sont connectés au **même nom de réseau Wi-Fi (SSID)**.
2. Attention à l'isolation des bandes 2,4 GHz et 5 GHz : bien que la majorité des routeurs modernes fassent le pont entre les deux, certains anciens modèles isolent le trafic 2,4 GHz et 5 GHz. Connectez les deux appareils sur la même fréquence en cas de doute.
3. Si votre ordinateur est relié par câble Ethernet et votre mobile en Wi-Fi sur la même box, vérifiez qu'ils partagent le même sous-réseau IP (ex. tous deux sous `192.168.1.x`).

---

## Étape 2 : Configurer le Pare-feu Windows Defender (Cause la Plus Fréquente)

Par défaut, Windows bloque les connexions réseau entrantes non sollicitées.

### 1. Définir le Profil Réseau sur « Privé »
- Ouvrez les **Paramètres Windows** ➔ **Réseau et Internet** ➔ **Propriétés**.
- Vérifiez que le profil réseau actif est bien défini sur **Réseau privé** et non « Réseau public ». Le mode public filtre la quasi-totalité des flux locaux entrants.

### 2. Autoriser EQT à Travers le Pare-feu
1. Appuyez sur `Win + R`, tapez `firewall.cpl` et validez pour ouvrir le Pare-feu Windows Defender.
2. Cliquez sur **Autoriser une application ou une fonctionnalité via le Pare-feu Windows Defender** dans le volet de gauche.
3. Cliquez sur le bouton **Modifier les paramètres** en haut à droite.
4. Repérez **EQT** (ou `eqt.exe`) dans la liste. Cochez impérativement les deux cases : **Privé** et **Public**.
5. Cliquez sur **OK** pour enregistrer et appliquer.

---

## Étape 3 : Contrôler l'Isolation AP (Wi-Fi Invité)

Dans les espaces de travail partagés, hôtels, cafés ou sur les réseaux invités, la fonction **Isolation AP (Client Isolation)** est fréquemment activée :
- **Symptôme** : L'ordinateur et le smartphone accèdent tous deux à Internet, mais ils ne peuvent ni se pinguer ni établir de connexion TCP directe.
- **Solution** :
  - Accédez à l'administration de votre routeur et désactivez l'option **Isolation AP** ou **Séparation des clients** dans les paramètres sans fil avancés ;
  - Ou dans un lieu public sans accès au routeur, activez le **Partage de connexion (Point d'accès mobile)** sur votre smartphone et connectez-y votre ordinateur. Cela crée un réseau Wi-Fi local direct et ultra-rapide.

---

## Étape 4 : Conflits d'Adaptateurs Réseau Virtuels

Si votre ordinateur héberge des machines virtuelles (VMware, VirtualBox), Docker Desktop ou un client VPN, plusieurs cartes réseau virtuelles coexistent. EQT pourrait lier son service à l'IP d'une carte virtuelle inaccessible depuis le téléphone.

**Solution** :
Exécutez l'assistant interactif pour désigner explicitement votre carte Wi-Fi physique :
```bash
eqt config
```
Sélectionnez votre adaptateur sans fil physique (généralement libellé `Wi-Fi`, `WLAN` ou associé à une adresse de type `192.168.x.x`).
