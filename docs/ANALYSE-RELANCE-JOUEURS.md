# Le Grand Chelem — Analyse stratégique de relance

*Objectif : comprendre pourquoi les joueurs ne reviennent plus et définir une refonte de niveau professionnel pour les faire revenir durablement.*

---

## 1. Résumé exécutif

Le Grand Chelem est un produit riche : 28 formats de mini-jeux originaux (Blackjack, Sportus, Juste Prix, Alpe d'Huez, Biathlon, Roulette russe…), trois jeux annexes (Formula·Grid, Curling en duel, Où est Harry), un back-office avec génération de questions par IA, des comptes, des équipes, une boîte à idées. C'est un contenu de qualité « émission télé ».

**Le problème n'est pas le contenu, c'est la boucle de jeu.** Le jeu est conçu comme un *événement unique* : chaque joueur joue chaque défi **une seule fois**, dans un **ordre imposé**, puis tombe sur un écran « TERMINÉ ! Reviens bientôt ». Le classement est **verrouillé** tant que tout n'est pas joué. Il n'existe aucun mécanisme qui donne une raison de revenir demain : pas de contenu quotidien, pas de série (streak), pas de notification, pas de partage, pas de revanche, pas de progression. Le seul moteur de retour est l'admin qui publie un nouveau défi à la main.

**Diagnostic en une phrase :** un excellent catalogue de jeux, consommé en une soirée, sans aucune raison structurelle de revenir.

**La révolution proposée :** passer d'un *recueil de défis à usage unique* à une **arène sportive quotidienne**, avec un rendez-vous chaque jour, une compétition par saisons, du jeu social (duels, ligues, équipes) et un pipeline de contenu qui ne dépend plus d'une seule personne.

---

## 2. Diagnostic détaillé

### 2.1 Ce que révèle le code sur la boucle de jeu

| Mécanique actuelle (code) | Effet sur le joueur |
|---|---|
| `nextAthleteFor()` renvoie le premier défi non joué, dans l'ordre | Aucun choix, aucune curiosité : le joueur subit la séquence |
| `/api/score` refuse un 2e score (`already_played`) | Pas de revanche, pas de « je peux faire mieux » |
| `/api/scores/global` renvoie `locked` tant que `hasFinishedAll()` est faux | Le classement, principal moteur de compétition, est invisible pendant 95 % de l'expérience |
| Écran `sd` : « Tu as joué tous les défis. Reviens bientôt » | Fin de parcours explicite, sans date ni promesse concrète |
| Aucun champ `date`, `semaine`, `saison` sur un défi | Impossible de faire du contenu daté ou rotatif |
| Pas de manifest PWA, pas de push, pas de lien de partage | Le jeu ne peut pas « rappeler » le joueur ni se propager |
| Pseudo seulement en `localStorage` | Un joueur qui change d'appareil ou vide son cache est perdu |

### 2.2 Les cinq causes du décrochage

1. **Contenu fini et à usage unique.** Un joueur motivé termine les 26 défis en une ou deux sessions. Après, il n'y a littéralement rien à faire.
2. **Dépendance totale à l'admin.** Chaque nouveau défi est fabriqué à la main (même avec l'aide de l'IA). Le rythme de publication est le rythme de l'admin, donc irrégulier. Les commits le confirment : 41 en août, 7 en septembre, 2 en octobre. L'activité du jeu suit la même courbe.
3. **Aucun déclencheur de retour.** Pas de rendez-vous quotidien, pas de rappel, pas de série à ne pas casser, pas de « ton ami a battu ton score ».
4. **Compétition cachée.** Le classement arrive trop tard. Le joueur ne sait pas où il se situe pendant qu'il joue, donc l'envie de « remonter » n'existe pas.
5. **Jeu solitaire.** Les équipes existent mais ne produisent rien de visible au quotidien. Le Curling en duel est la seule mécanique sociale, et elle est isolée dans une page à part.

### 2.3 Les atouts à préserver

- **La variété des formats** est exceptionnelle pour un projet de cette taille. C'est un vrai avantage concurrentiel face aux quiz classiques.
- **L'identité « émission télé »** (Blackjack, Maillon faible, Trivial Pursuit, Juste prix) parle immédiatement au public francophone.
- **Le pipeline IA existe déjà** (génération + chat de relecture). C'est la brique qui permet de passer à l'échelle.
- **Les comptes et les équipes existent.** Pas besoin de tout reconstruire.
- **Formula·Grid a déjà un « jeu du jour »** avec des essais limités. C'est le prototype de la bonne mécanique, à généraliser.

---

## 3. La vision : « L'Arène quotidienne »

Transformer le Grand Chelem en un rendez-vous sportif quotidien, à la manière de Wordle, Sutom ou Pédantix pour les mots, mais pour le sport, avec un classement vivant et une dimension sociale.

### Les cinq piliers

#### Pilier 1 — Le Défi du Jour (rendez-vous quotidien)
- Chaque jour à une heure fixe (ex. 7h00), un **défi unique** est publié pour tout le monde. Même format, même questions, même durée pour tous.
- Le format tourne sur la semaine : lundi Sportus, mardi Juste Prix, mercredi Blackjack, jeudi Alpe d'Huez, vendredi Biathlon, week-end « Grand Chelem » (un enchaînement de 3 formats).
- Une seule tentative par jour, avec un **résultat partageable** (grille d'emojis + score + lien), comme Wordle. C'est le moteur d'acquisition gratuit le plus efficace qui existe.
- Compte à rebours vers le prochain défi sur l'écran de fin, à la place de « Reviens bientôt ».

#### Pilier 2 — Séries et progression
- **Série (streak)** : nombre de jours consécutifs joués, affichée en permanence. Un jour de « joker » par semaine pour ne pas punir trop fort.
- **Niveaux et titres** : Débutant → Espoir → Pro → Légende, basés sur les points cumulés. Titre affiché à côté du pseudo dans les classements.
- **Badges** : « 7 jours d'affilée », « 100 % au Sportus », « Top 10 hebdo », « 50 duels joués ». Peu nombreux, mais visibles.
- **Historique personnel** : courbe de score, meilleur format, pire format. Le joueur se voit progresser.

#### Pilier 3 — Classements vivants et saisons
- **Fin du verrouillage.** Le classement est toujours visible, avec la position du joueur mise en avant même s'il est 143e.
- **Trois horizons** : classement du jour, de la semaine, de la saison (un mois). Le classement du jour repart à zéro chaque matin : tout le monde a sa chance.
- **Ligues par paliers** (Bronze / Argent / Or / Diamant) avec montée et descente hebdomadaire, comme Duolingo. Les joueurs ne sont comparés qu'à 20 à 30 personnes de leur niveau, ce qui rend la compétition atteignable.
- **Podium de saison** avec un titre permanent sur le profil.

#### Pilier 4 — Social et équipes
- **Duels asynchrones** généralisés : « Je défie X sur le Juste Prix du jour ». Chacun joue le même défi de son côté, résultat comparé. Mécanique déjà prototypée avec le Curling.
- **Équipes qui comptent** : score d'équipe hebdomadaire, défi d'équipe (objectif collectif), chat ou fil d'équipe minimal.
- **Partage** : résultat du jour en image ou texte vers WhatsApp, Messenger, Instagram. Lien d'invitation avec bonus pour le parrain et le filleul.
- **Notifications** : PWA installable avec push (« Le défi du jour est en ligne », « Tu vas perdre ta série », « X t'a défié »). Sur mobile, c'est la différence entre un jeu oublié et un jeu quotidien.

#### Pilier 5 — Usine à contenu
- **Banque de questions** indépendante des défis : chaque question a un format, un thème, une difficulté, une date de dernière utilisation. Le défi du jour est **assemblé** automatiquement à partir de la banque, plutôt que fabriqué à la main.
- **Génération IA en lot, relue en lot** : l'admin génère 50 questions le dimanche, les valide en 20 minutes, et le jeu a une semaine de contenu.
- **Contenu d'actualité** : un flux « cette semaine dans le sport » généré depuis les résultats réels (match du week-end, transfert, record). C'est ce qui fait revenir les vrais passionnés.
- **Contenu communautaire** : les joueurs proposent des questions (la boîte à idées existe déjà), votées par la communauté, validées par l'admin, créditées au nom du joueur.
- **Rejouabilité** : les anciens défis passent en mode « Entraînement » (score non compté mais visible), ce qui sauve tout le catalogue existant.

---

## 4. Feuille de route priorisée

Classement par ratio impact / effort. Chaque étape est livrable seule et apporte un gain mesurable.

### Phase 1 — Quick wins (2 à 3 semaines) : arrêter l'hémorragie
| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | **Déverrouiller le classement** et afficher la position du joueur en permanence | Fort | Très faible (une condition à retirer dans `/api/scores/*`) |
| 2 | **Mode Entraînement** : rejouer n'importe quel défi, score affiché mais non compté | Fort | Faible (lever `already_played` avec un flag `practice`) |
| 3 | **Laisser choisir le défi** sur la grille d'accueil au lieu de l'ordre imposé | Moyen | Faible (`/api/athlete?id=`) |
| 4 | **Écran de fin avec compte à rebours** et date du prochain défi | Moyen | Très faible |
| 5 | **Partage du résultat** (texte + lien) via Web Share API | Fort | Faible |
| 6 | **PWA installable** (manifest + service worker minimal) | Moyen | Faible |

### Phase 2 — Le rendez-vous quotidien (4 à 6 semaines)
1. Modèle de données : `dailyChallenges` (date, format, questions, résultats), `streaks`, `seasons`.
2. Défi du jour assemblé automatiquement depuis la banque de questions, avec file d'attente planifiée par l'admin.
3. Série, classement du jour / semaine / saison, profil joueur avec historique.
4. Notifications push (Web Push, gratuit) : défi dispo, série en danger.
5. Tableau de bord admin : joueurs actifs par jour, taux de retour J+1 / J+7, taux de complétion par format.

### Phase 3 — Social et saisons (6 à 8 semaines)
1. Duels asynchrones sur le défi du jour (généralisation du Curling).
2. Ligues par paliers avec promotion / relégation hebdomadaire.
3. Équipes avec score hebdo et objectif collectif.
4. Parrainage avec bonus.
5. Première « Saison » officielle avec podium et titres.

### Phase 4 — Usine à contenu et actualité (en continu)
1. Génération IA en lot + relecture rapide (le pipeline existe, il faut l'industrialiser).
2. Flux « actu sport » hebdomadaire.
3. Questions communautaires votées.
4. Nouveaux formats uniquement s'ils servent la rotation hebdo (le catalogue est déjà largement suffisant).

---

## 5. Indicateurs à suivre

Aujourd'hui, le jeu ne mesure rien d'autre que les scores. Impossible de piloter une relance sans ces chiffres.

| Indicateur | Définition | Cible à 3 mois |
|---|---|---|
| DAU / WAU | Joueurs uniques par jour / par semaine | WAU × 3 par rapport à aujourd'hui |
| Rétention J+1 | % de nouveaux joueurs revenus le lendemain | > 35 % |
| Rétention J+7 | % revenus une semaine après | > 20 % |
| Série moyenne | Jours consécutifs joués | > 4 |
| Taux de partage | % de parties se terminant par un partage | > 10 % |
| Coefficient viral | Nouveaux joueurs par joueur partageur | > 0,3 |
| Complétion par format | % de défis commencés et terminés | Identifier les formats à < 60 % et les corriger |

Une table `events` (pseudo, événement, date) et une page admin avec ces courbes suffisent pour démarrer.

---

## 6. Prérequis techniques

Le code actuel a été écrit vite et fonctionne, mais il bloque l'évolution. Trois chantiers conditionnent le reste.

### 6.1 Structure
- `public/index.html` fait **700 Ko** et contient les 28 jeux dans un seul fichier. Chaque modification est risquée et le chargement mobile est lent. Découper en un fichier par format (`games/sportus.js`, etc.) avec un petit chargeur, sans framework lourd.
- `server.js` fait **3 000 lignes** avec tout l'état en mémoire. Découper par domaine (`routes/game.js`, `routes/admin.js`, `routes/social.js`) et introduire une couche d'accès MongoDB propre.
- Des fichiers sont **dupliqués** à la racine (`admin.html`, `formula-grid.html`) et diffèrent de ceux de `public/`. Un fichier audio de 4 Mo et une capture d'écran sont dans le dépôt. À nettoyer.
- Les commits « Add files via upload » montrent un flux sans git local. Mettre en place un vrai flux : branche, test, déploiement automatique.

### 6.2 Sécurité (à traiter avant toute campagne de recrutement)
- Le mot de passe admin circule **dans l'URL** (`?password=`) et vaut `sportif2024` par défaut. Passer à une session ou un jeton, et forcer la variable d'environnement.
- Le PIN est haché avec une fonction maison sur 32 bits : trivial à inverser. Utiliser `bcrypt` ou `scrypt`.
- Aucune limitation de débit sur la création de compte, la connexion, ou les routes `/api/*-check` : un script peut tester toutes les réponses. Ajouter `express-rate-limit`.
- Plusieurs routes `/api/athlete` renvoient encore des réponses en clair (`rvlf`, `badminton`, `bowling`, `trivpursuit`, `melimelo`, `haltero`, `escalade`, `plongee`, `nagesync`, `tirarlarc`…) : un joueur qui ouvre la console voit les solutions. Généraliser la vérification serveur, déjà faite pour `saut`, `roulette`, `apol`, `blackjack`.
- Les scores sont envoyés par le client (`POST /api/score { score }`) sans vérification : n'importe qui peut poster 300 points. Pour un classement crédible avec des ligues, le score doit être calculé côté serveur.

### 6.3 Infrastructure
- Hébergement sur Koyeb avec un `ping` de keepalive : l'instance s'endort, le premier joueur attend plusieurs secondes. Pour un rendez-vous quotidien à heure fixe, c'est rédhibitoire : passer sur une instance toujours active.
- Pas de tests automatisés. Un jeu de tests sur les routes de scoring et de vérification est indispensable avant de refondre.

---

## 7. Ce qui peut être lancé dès maintenant

Sans attendre la refonte, trois actions concrètes créent un signal immédiat auprès des anciens joueurs :

1. **Un message de relance** via la popup admin existante et les équipes : « La saison 2 arrive le [date] : nouveau défi chaque jour, classement en direct. »
2. **Déverrouiller le classement et activer le mode Entraînement** (phase 1, points 1 et 2). Deux changements de quelques lignes qui redonnent du jeu au catalogue existant.
3. **Programmer une semaine de « défis du jour » manuels** avec les outils actuels (publier un défi par jour, le dépublier le lendemain) pour tester la mécanique avant de l'automatiser et mesurer le retour J+1.

---

## 8. Conclusion

Le Grand Chelem a un problème de *rythme*, pas de *qualité*. Les joueurs sont partis parce que le jeu leur a dit qu'il n'y avait plus rien à faire. La relance passe par une promesse simple et tenue tous les jours : **« Chaque matin, un nouveau défi, un classement qui repart à zéro, et tes amis à battre. »** Tout le reste (ligues, saisons, duels, actu) vient renforcer cette promesse, et le catalogue existant devient la réserve d'entraînement qui donne de la profondeur au produit.
