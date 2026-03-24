# 🏆 SPORTIF ? — Jeu de devinette sport
> Hébergé sur **Koyeb** — toujours allumé, gratuit, sans mise en veille.

---

## 🚀 Déploiement sur Koyeb (5 min)

### Étape 1 — GitHub

1. **github.com** → New repository → nom `sportif-game` → Create
2. Clique **"uploading an existing file"**
3. Dépose depuis le ZIP :
   - `server.js`
   - `package.json`
   - `.gitignore`
   - dossier `public/` (avec `index.html`)
4. **Commit changes** ✅

### Étape 2 — Koyeb

1. **koyeb.com** → Sign up with GitHub
2. **Create App** → source **GitHub** → sélectionne `sportif-game`
3. Vérifie :
   - Build command : `npm install`
   - Run command : `npm start`
   - Port : `3000`
4. **Deploy** → attends ~2 min
5. URL : `https://sportif-game-xxxx.koyeb.app` 🎉

---

## 🎮 Fonctionnalités

- 10 sportifs (Messi, Bolt, Jordan, Federer, Nadal, Serena…)
- Blocs noirs à taper pour révéler les mots (−1 pt chacun)
- Classement partagé entre tous les joueurs
- 100% mobile-first

## 🔧 Local

```bash
npm install && npm start
# → http://localhost:3000
```
