# Le Grand Chelem — Interface, jouabilité et conception d'un nouveau jeu

*Complément de l'analyse stratégique (`ANALYSE-RELANCE-JOUEURS.md`). Basé sur une session de test réelle du jeu sur un écran de téléphone (iPhone 13, 390 px), avec des défis de test créés via l'admin.*

---

## 1. Verdict d'ensemble

**L'interface est au-dessus de la moyenne des projets de ce type.** Identité visuelle forte (noir profond, jaune néon, typographie condensée), gros chiffres lisibles, feedback de victoire généreux (confettis, « BRAVO ! »), clavier PIN maison soigné, back-office clair. Rien à jeter.

**La jouabilité, elle, a trois défauts structurels :**

1. **Le joueur ne comprend pas ce qu'il va faire avant de le faire.** Les règles tiennent en une ligne de texte gris, le chrono démarre immédiatement, les mécaniques spéciales (boule mystère, compteur, bonus) ne sont pas expliquées.
2. **L'accueil est une vitrine, pas une porte d'entrée.** 28 tuiles décoratives et non cliquables occupent deux écrans avant le champ pseudo. Le joueur scrolle, ne peut rien choisir, puis est aspiré dans une séquence imposée.
3. **Le produit est fragmenté.** Quatre identités visuelles (Grand Chelem, Rallye·Grid, Curling Pro, Où est Harry), trois noms de marque (Le Grand Chelem, Arena Sport, Formula·Grid qui s'affiche « RALLYE·GRID »), et des jeux annexes qui redemandent de se connecter.

---

## 2. Audit écran par écran

### 2.1 Accueil
| Constat | Gravité | Correction |
|---|---|---|
| 28 tuiles de jeux affichées mais **aucune n'est cliquable**. Le joueur tape dessus, rien ne se passe. | Haute | Rendre les tuiles cliquables : soit lancer le défi (choix libre), soit ouvrir une fiche « règles + meilleur score ». |
| Champ pseudo **sous deux écrans de tuiles**. La page auto-scrolle vers le champ, ce qui donne l'impression d'un bug. | Haute | Pseudo et bouton principal au-dessus de la ligne de flottaison. Les tuiles en dessous, ou derrière un onglet « Les jeux ». |
| Formula·Grid est poussé **trois fois** (bandeau violet, tuile avec bouton JOUER, bandeau doré). | Moyenne | Un seul point d'entrée, au même niveau que les autres jeux. |
| Incohérences : la balise `<title>` dit « 22 jeux · 300 pts », l'accueil dit « 26 jeux · jusqu'à 400 pts », l'admin s'appelle « Arena Sport ». | Moyenne | Un nom, un chiffre, calculé depuis les données et non codé en dur. |
| Aucune explication de ce qu'est le jeu pour un nouveau venu (une phrase de promesse suffit). | Moyenne | Sous le titre : « Un quiz sportif par jour, 2 minutes, un classement. » |
| Zoom désactivé (`user-scalable=no`) sur les 4 pages. | Basse | Retirer : c'est un critère d'accessibilité et cela n'apporte rien. |

### 2.2 Connexion
Le flux pseudo → PIN à 4 chiffres → équipe est **rapide et bien pensé**. Le pavé numérique maison est agréable. Deux retouches :
- Après connexion, le joueur atterrit **directement dans un défi sans transition**. Un écran intermédiaire « Bonjour X · Série 4 jours · Défi du jour : Sportus » fixe le contexte.
- Un PIN oublié = compte perdu. Prévoir une récupération minimale (question secrète ou lien de réinitialisation via l'admin).

### 2.3 Écran de jeu (exemple Sportus)
| Constat | Gravité | Correction |
|---|---|---|
| Le **chrono démarre avant que le joueur ait lu la règle**. Sur la capture, 44 s restent alors que l'écran vient d'apparaître. | Haute | Un écran « Prêt ? » avec les règles en 3 lignes et un bouton GO. Le chrono part au GO. Généraliser à tous les formats. |
| La règle est une ligne de 12 px en gris : « Devine le nom de famille · 10 essais · −10 pts/essai (sauf le 1er) ». | Haute | Règles en liste à puces, grandes, sur l'écran « Prêt ? ». Rappel compact en jeu. |
| **Double saisie** : un clavier A–Z maison ET un champ texte qui ouvre le clavier natif. L'utilisateur ne sait pas lequel utiliser. | Moyenne | Un seul mode : clavier maison avec les lettres déjà testées grisées, à la Motus. |
| « Boule mystère (−20 pts) » : trois cercles « ? » sans explication de ce qu'on obtient. | Moyenne | Libellé explicite : « Révéler une lettre : −20 pts ». |
| Le score affiché en haut est statique (100) : il ne réagit pas en direct à la pénalité. | Basse | Animation du score à chaque événement (−10 qui flotte et disparaît). |

### 2.4 Écran de jeu (exemple Juste Prix)
- Un **« 19 » à côté du champ de saisie sans libellé** : le joueur ne sait pas si c'est un chrono, un nombre d'essais ou une valeur. Chaque chiffre à l'écran doit avoir un libellé.
- Les **confettis du défi précédent continuent de tomber** sur le nouveau défi. Pollution visuelle et impression de bug. Nettoyer les animations entre deux écrans.
- La bordure verte pointillée et le badge « $ » décoratif n'apportent pas d'information. Le cadre devrait plutôt afficher la fourchette (plus chaud / plus froid) en couleur.

### 2.5 Écran de victoire
Le meilleur écran du jeu : hiérarchie claire, score énorme, stats, rang. Il manque trois choses pour en faire un **moteur de retour** :
1. **Bouton Partager** (texte + lien, Web Share API). C'est l'écran que les joueurs veulent montrer.
2. **Comparaison** : « Moyenne des joueurs : 62 · Toi : 100 » ou « Tu bats 84 % des joueurs ».
3. **Contexte de série** : « Série : 5 jours 🔥 · Prochain défi dans 14 h 22 ».

Détail : les confettis passent devant le texte « BRAVO ! » et le nom du sportif et gênent la lecture. Les rendre plus fins ou les arrêter après 2 s.

### 2.6 Classement
- Les onglets par défi s'appellent **« #1, #2, #3 »** avec un emoji : illisibles. C'est volontaire pour ne pas révéler la réponse, mais le résultat est une liste anonyme. Afficher le **nom du format** (Sportus, Juste Prix) plutôt que le numéro.
- La ligne du joueur n'est **pas mise en évidence** et il n'y a pas de « Toi : 47e » si l'on est hors du top 50.
- Pas de filtre temporel (aujourd'hui, semaine, saison), pas d'onglet équipes visible ici alors que la donnée existe.

### 2.7 Jeux annexes
| Jeu | Constat |
|---|---|
| **Formula·Grid** | Titre « RALLYE·GRID » alors que tout le reste du site dit « Formula·Grid ». Demande à nouveau le pseudo. Esthétique différente (bleu nuit, police Inter). Page d'accueil vide quand aucun circuit n'est publié, sans retour vers le jeu principal. |
| **Curling** | « Connecte-toi d'abord » alors que le joueur vient de se connecter sur la page principale : la session n'est pas partagée. Titre technique « Curling Pro — Édition Définitive Réaliste ». Bonne mécanique (duel asynchrone) mais enterrée dans une page isolée. |
| **Où est Harry** | Bien réalisé techniquement (canvas, zoom, niveaux), mais hors sujet : chercher Harry Kane parmi des Ryan Gosling n'est pas un quiz sportif. Fonctionne comme une récréation, pas comme un pilier. |

**Recommandation** : une seule coque applicative (barre de navigation commune : Jouer · Duels · Classement · Profil), une seule session, une seule charte. Les jeux annexes deviennent des onglets ou des formats, pas des sites séparés.

### 2.8 Performance et technique côté client
- `index.html` pèse 700 Ko (154 Ko compressé) et embarque les 28 jeux. Sur un réseau mobile moyen, c'est 2 à 4 s avant le premier affichage. Charger chaque format à la demande.
- Une seule occurrence de son et deux de vibration dans tout le jeu : le **feedback sensoriel est quasi absent**. Un bip de bonne réponse, un buzz d'erreur et une vibration courte sur mobile changent la sensation de jeu pour un coût nul.
- Texte à 9–11 px (« ▶ JOUER », étiquettes en capitales espacées) : sous le seuil de lisibilité mobile. Minimum 12 px, 14 px pour tout ce qui est lu en jouant.

---

## 3. Jouabilité : principes à appliquer à tous les formats

Ces règles sont celles des jeux mobiles professionnels (Wordle, Duolingo, Kahoot). Elles corrigent 80 % des frictions relevées.

1. **Prêt ? → GO.** Jamais de chrono avant une action volontaire du joueur.
2. **Une règle = trois lignes max**, affichées avant, rappelées pendant en une ligne.
3. **Chaque chiffre a un libellé.** Pas de « 19 » orphelin.
4. **Feedback immédiat et triple** : visuel (le score bouge), sonore (court), haptique (vibration 30 ms).
5. **Un seul mode de saisie** par écran.
6. **Nettoyage entre les écrans** : animations, confettis, timers.
7. **La fin d'un défi pointe vers la suite** : partager, comparer, prochain défi, revanche.
8. **Tout est accessible au pouce** : actions principales dans le tiers bas de l'écran. Aujourd'hui le bouton de validation est bien placé, mais les indices et les boules mystère sont souvent tout en bas, sous le pli.

---

## 4. Créer un nouveau jeu : ce que ça coûte aujourd'hui

Ajouter un format demande actuellement de modifier **cinq endroits** :
1. `/api/athlete` dans `server.js` (données envoyées au joueur),
2. `/api/preview` (copie quasi identique de la précédente, déjà désynchronisée pour certains formats),
3. une route `/api/<jeu>-check` si l'on veut vérifier côté serveur (beaucoup de formats ne l'ont pas et envoient la réponse au navigateur),
4. le formulaire d'édition dans `admin.html`,
5. le code du jeu dans `index.html`, au milieu de 14 000 lignes.

Plus la liste des types acceptés, codée en dur à deux endroits, et les modes de génération IA. Chaque nouveau jeu fragilise les précédents.

**Cible : un jeu = un dossier.** Un module `games/<id>/` qui exporte :
- `manifest` : identifiant, nom, emoji, score max, description courte, règles en 3 lignes ;
- `adminSchema` : les champs du formulaire admin (générés automatiquement) ;
- `publicPayload(challenge)` : ce que le joueur reçoit (jamais la réponse) ;
- `check(challenge, answer, state)` : vérification et calcul de score **côté serveur** ;
- `render(container, payload, api)` : l'interface côté client, chargée à la demande ;
- `aiPrompt` : le gabarit de génération IA.

Avec cette structure, un nouveau format se développe en un à deux jours au lieu d'une semaine, et il est impossible d'oublier la vérification serveur.

---

## 5. Proposition de nouveau jeu phare : « Carrière Mystère »

### 5.1 Pourquoi celui-là
Le catalogue actuel est déjà très large. Ce qui manque n'est pas un 29e format mais **un format quotidien, identique pour tous, partageable, et dont le contenu se fabrique quasiment tout seul**. C'est le profil exact des jeux qui ont explosé ces dernières années (Wordle, Sutom, Immaculate Grid, « Who Are Ya? »). Carrière Mystère coche toutes les cases et reste 100 % dans l'ADN sportif du Grand Chelem.

### 5.2 Le concept
Chaque jour, un sportif mystère. Sa carrière est révélée **étape par étape**, de la plus ancienne à la plus récente : clubs, sélections, titres, années. À chaque indice révélé, le joueur peut proposer un nom. Plus il trouve tôt, plus il marque.

Exemple (football) :
```
2001–2004  🇫🇷  Cannes (formation)
2004–2007  🇫🇷  Le Mans
2007–2012  🇫🇷  Lyon                      ← trouvé ici : 70 pts
2012–2015  🏴  Tottenham
2015–2018  🇪🇸  Real Madrid
2018–      🇩🇪  Bayern Munich
```
Le format fonctionne pour tous les sports : équipes et clubs (basket, rugby, hand), ou écuries et palmarès (F1, cyclisme, tennis avec les finales marquantes).

### 5.3 Règles et barème
- 6 étapes, révélées une à une. Le joueur révèle quand il veut.
- Score : 100 pts si trouvé à l'étape 1, puis 85, 70, 55, 40, 25. Zéro si non trouvé après la 6e.
- Mauvaise proposition : −5 pts, et un **indice gratuit** apparaît (nationalité, puis poste, puis décennie de naissance). Les erreurs font progresser au lieu de punir seulement.
- Saisie avec **autocomplétion** sur une base de sportifs : plus de problème d'orthographe, plus de tolérance Levenshtein à régler.
- Une seule partie par jour sur le sportif du jour. Les sportifs des jours précédents restent jouables en **mode Entraînement** (score non compté).

### 5.4 Écran type
```
┌──────────────────────────────┐
│ CARRIÈRE MYSTÈRE  · 7 nov.   │
│ Série 🔥 4   Score possible 70│
├──────────────────────────────┤
│ ✅ 2001–04  Cannes           │
│ ✅ 2004–07  Le Mans          │
│ ✅ 2007–12  Lyon             │
│ 🔒 ────────────────          │
│ 🔒 ────────────────          │
│ 🔒 ────────────────          │
├──────────────────────────────┤
│ 💡 Indice : 🇫🇷 Français       │
│ [ Qui est-ce ?           ] ✓ │
│ [ Révéler l'étape suivante ] │
└──────────────────────────────┘
```

### 5.5 Résultat partageable
C'est la pièce maîtresse de l'acquisition. Un texte prêt à coller dans WhatsApp :
```
Carrière Mystère #142 · 70 pts
🟩🟩🟩⬛⬛⬛  trouvé à l'étape 3
🔥 Série : 4 jours
legrandchelem.fr/carriere
```

### 5.6 Contenu : zéro saisie manuelle
- Une **base de sportifs** (nom, sport, nationalité, poste, carrière structurée) alimentée par import depuis Wikidata, qui expose les carrières de dizaines de milliers de sportifs en données ouvertes. Un script d'import suffit.
- Le **sportif du jour** est tiré automatiquement selon la difficulté voulue (notoriété = nombre de liens Wikipédia), avec une rotation hebdomadaire des sports (lundi foot, mardi tennis, mercredi rugby…).
- L'admin garde la main : il voit la file des 14 prochains jours et peut remplacer un sportif en un clic. Le pipeline IA existant sert à rédiger un fait marquant affiché à la fin (« Le saviez-vous ? »).
- Résultat : **un an de contenu quotidien sans écrire une seule question.**

### 5.7 Intégration technique
- Collections : `athletesDb` (base de sportifs), `dailyCareer` (date, athleteId, sport, difficulté), `careerPlays` (pseudo, date, étape, erreurs, score).
- Routes : `GET /api/career/today` (étapes masquées sauf celles révélées, jamais le nom), `POST /api/career/reveal`, `POST /api/career/guess` (vérification et score **côté serveur**), `GET /api/career/suggest?q=` (autocomplétion), `GET /api/career/leaderboard?range=day|week`.
- Client : un module `games/career/` autonome, chargé à la demande, premier à utiliser la structure décrite au § 4.
- Effort estimé : **deux à trois semaines** pour une version complète (import de données, jeu, partage, classements du jour), en incluant l'écran « Prêt ? » et le feedback sonore qui serviront ensuite à tous les formats.

### 5.8 Variante et déclinaisons
- **Grille Immaculée sportive** (3×3 : clubs en colonnes, nationalités ou titres en lignes, trouver un sportif pour chaque case) : second format quotidien très viral, même base de données, même pipeline.
- **Duel Carrière** : deux joueurs sur le même sportif, celui qui trouve le plus tôt gagne. Réutilise l'infrastructure de duel asynchrone du Curling.
- **Carrière Équipe** : score cumulé de l'équipe sur la semaine. Donne enfin un rôle aux équipes.

---

## 6. Ordre de mise en œuvre conseillé

1. **Semaine 1** : écran « Prêt ? → GO » généralisé, nettoyage des animations entre écrans, libellés manquants, bouton Partager sur la victoire, tuiles d'accueil cliquables, pseudo au-dessus du pli. Gains immédiats, aucune refonte.
2. **Semaines 2 à 4** : structure « un jeu = un dossier » et premier jeu dessus : Carrière Mystère, avec import Wikidata et classement du jour.
3. **Semaines 5 à 6** : coque commune (navigation, session unique, charte) qui absorbe Formula·Grid, Curling et Harry. Son et vibrations partout.
4. **Ensuite** : migration progressive des 28 formats existants vers la structure modulaire, en commençant par ceux qui envoient encore les réponses au navigateur.

---

## Addendum — précisions après relecture du Game Master

### A. « Lettres exclues », c'est du Motus
Exact. L'écran C de la maquette montre Sportus, qui est déjà un Motus : le clavier avec lettres exclues grisées ne concerne que lui. Le principe général à retenir pour les 28 formats est plus simple : **un seul mode de saisie par écran**. Aujourd'hui Sportus en a deux (clavier maison + champ texte qui ouvre le clavier natif) ; c'est ce doublon qu'il faut supprimer.

### B. Modèle « Game Master » : un jeu commun par jour, pas de duels
C'est le bon modèle et il change la proposition : **pas de duels, pas de « défier un ami »**. Tout le social passe par le jeu commun du jour et son classement. Le Game Master est l'animateur ; l'outil doit le servir.

Ce que ça implique concrètement :
- **Programmation** : une file des 14 prochains jours (jeu, heure de publication, heure de clôture), publication et dépublication **automatiques** à heure fixe. Aujourd'hui tout se fait à la main.
- **Le mot du Game Master** : un message du jour visible sur l'accueil (programme de la semaine, thème, clin d'œil). La personnalité de l'animateur est un atout que l'interface actuelle n'exploite pas.
- **Semaines thématiques et événements** : « semaine tennis », « spéciale JO », finale du dimanche à coefficient double. Le calendrier devient un objet du jeu.
- **Rapport du jour** pour le Game Master : participants, score moyen, question la plus ratée, abandons. C'est ce qui permet d'ajuster la difficulté.
- **Les jours passés** restent jouables en entraînement (score non compté), ce qui remplace l'onglet Duels dans la navigation.
- Le classement, la série, le partage et le compte à rebours restent tels que proposés.

### C. Carrière Mystère ressemble au Scout et à ses tiroirs
Oui. Le Scout révèle déjà Identité, Carrière, Palmarès et Mystère tiroir par tiroir, contre des points. Carrière Mystère n'en diffère que par le détail (ordre chronologique, autocomplétion, barème dégressif). **Ce n'est pas un nouveau jeu, c'est un Scout à contenu automatique.** La bonne décision est donc de garder Le Scout et de lui brancher le pipeline de contenu (carrières importées depuis Wikidata, file de 14 jours, « Le saviez-vous ? » rédigé par l'IA), plutôt que d'ajouter un 29e format qui fait doublon.

### D. Des formats quotidiens réellement différents de l'existant
Le catalogue couvre déjà très largement « deviner un nom », « estimer un chiffre », les QCM, les anagrammes et les listes à énumérer. Les mécaniques absentes, et qui se prêtent au jeu commun quotidien :

| Format | Mécanique | Pourquoi ça fait revenir | Contenu |
|---|---|---|---|
| **Le Dernier Debout** (méta-jeu) | Chaque jour, une question éliminatoire commune. Une erreur et tu es éliminé jusqu'au lundi suivant. Le dernier debout de la semaine gagne. | « Suis-je encore en vie ? » est la raison de revenir la plus puissante qui existe. Se superpose à n'importe quel format existant, donc zéro nouveau jeu à coder côté mécanique. | Une question par jour, choisie par le Game Master. |
| **Le Pronostic** | Le Game Master choisit un vrai match du soir ; les joueurs pronostiquent le score ou le vainqueur avant le coup d'envoi. Points le lendemain selon la précision. | Ancre le jeu dans l'actualité réelle et crée **deux visites** : parier, puis venir voir le résultat. | Un match par jour, aucun contenu à écrire. |
| **Le Podium** (classement à remettre en ordre) | 6 éléments à classer par glisser-déposer (sportifs par nombre de titres, stades par capacité, records par année). Score selon le nombre d'éléments à la bonne place, avec 3 corrections possibles. | Mécanique d'ordonnancement quasi absente du catalogue. Résultat partageable en emojis (🟩🟩⬛🟩⬛🟩). | Générable automatiquement depuis des données (palmarès, dates). |
| **Le Slalom** (déjà maquetté) | Action et réflexes : éviter tout ce qui arrive sur trois couloirs. | Seul format d'adresse du jeu. Pause de 60 s entre deux quiz, piste du jour commune grâce à une graine. | Aucun contenu éditorial. |
| **Le Vestiaire** | Composer une équipe de 5 sous contrainte (budget de points, un seul joueur par club, une nationalité imposée). La « valeur » d'un sportif est fixée par le Game Master. | Puzzle de contraintes, plusieurs bonnes réponses possibles, discussions garanties entre joueurs. | Une grille de 15 sportifs avec valeurs par jour. |

**Recommandation** : Le Dernier Debout en premier. C'est une couche au-dessus de l'existant, elle colle parfaitement au rôle de Game Master, et elle donne au jeu commun quotidien un enjeu hebdomadaire sans écrire une ligne de contenu supplémentaire. Le Pronostic ensuite, pour l'ancrage dans l'actualité et la double visite. Le Slalom en récréation.
