const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sportif2024';
const DATA_FILE      = path.join(__dirname, 'data.json');

// ── Persistence : lecture/écriture fichier ────────────────────────────────
const DEFAULT_ATHLETE = {
  id:        1,
  answer:    'Corentin Moutet',
  aliases:   ['moutet', 'corentin moutet', 'corentin'],
  emoji:     '🎾',
  clue:      'Ce tennisman français né à New York est connu pour son style offensif et créatif, son jeu de gaucher et sa personnalité volcanique sur le court. Il a grandi entre les États-Unis et la France avant de choisir de représenter les Bleus sur le circuit ATP.',
  createdAt: new Date().toISOString(),
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Erreur lecture data.json:', e.message);
  }
  return { athlete: DEFAULT_ATHLETE, scores: [] };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ athlete: currentAthlete, scores }, null, 2));
  } catch (e) {
    console.error('Erreur écriture data.json:', e.message);
  }
}

// ── Chargement initial ────────────────────────────────────────────────────
const saved        = loadData();
let currentAthlete = saved.athlete || DEFAULT_ATHLETE;
let scores         = saved.scores  || [];
console.log(`📂 Sportif chargé : ${currentAthlete.answer}`);

// ── GAME API ──────────────────────────────────────────────────────────────

app.get('/api/athlete', (req, res) => {
  res.json({
    id:        currentAthlete.id,
    clue:      currentAthlete.clue,
    emoji:     currentAthlete.emoji,
    wordCount: currentAthlete.clue.split(/\s+/).filter(Boolean).length,
  });
});

app.post('/api/check', (req, res) => {
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ correct: false });
  const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const correct = currentAthlete.aliases.some(a => norm(a) === norm(answer));
  res.json({
    correct,
    answer:  correct ? currentAthlete.answer : null,
    message: correct ? `Bravo ! C'est bien ${currentAthlete.answer} ! 🎉` : 'Pas encore… essaie encore !',
  });
});

app.post('/api/score', (req, res) => {
  const { pseudo, score } = req.body;
  if (!pseudo || score === undefined) return res.status(400).json({ error: 'Données manquantes' });
  const entry = { pseudo: pseudo.trim().slice(0, 20), score, athleteName: currentAthlete.answer, date: new Date().toISOString() };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 100);
  saveData();
  res.json({ success: true, rank: scores.indexOf(entry) + 1, total: scores.length });
});

app.get('/api/scores', (req, res) => {
  res.json(scores.slice(0, 10));
});

// ── ADMIN API ─────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  res.json(password === ADMIN_PASSWORD ? { success: true } : { success: false, message: 'Mot de passe incorrect' });
});

app.post('/api/admin/athlete', (req, res) => {
  const { password, answer, aliases, emoji, clue } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!answer || !clue) return res.status(400).json({ error: 'Nom et description obligatoires' });

  const parts        = answer.trim().split(/\s+/);
  const autoAliases  = [answer.trim().toLowerCase(), ...parts.map(p => p.toLowerCase())];
  const manualAliases = (aliases || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const allAliases   = [...new Set([...autoAliases, ...manualAliases])];

  currentAthlete = {
    id:        currentAthlete.id + 1,
    answer:    answer.trim(),
    aliases:   allAliases,
    emoji:     emoji || '🏆',
    clue:      clue.trim(),
    createdAt: new Date().toISOString(),
  };
  scores = [];
  saveData(); // ← sauvegarde immédiate sur disque

  console.log(`✅ Nouveau sportif : ${currentAthlete.answer}`);
  res.json({ success: true, answer: currentAthlete.answer, wordCount: currentAthlete.clue.split(/\s+/).filter(Boolean).length, aliases: allAliases });
});

app.get('/api/admin/current', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  res.json(currentAthlete);
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏆 Sportif Game → http://localhost:${PORT}`);
  console.log(`🔐 Admin        → http://localhost:${PORT}/admin.html  |  password: ${ADMIN_PASSWORD}`);
});
