const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sportif2024';
const DATA_FILE      = path.join(__dirname, 'data.json');
const WRONG_PENALTY  = 10;

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { console.error('Erreur lecture:', e.message); }
  return { athletes: [], scores: {}, globalScores: [] };
}
function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ athletes, scores, globalScores }, null, 2)); }
  catch(e) { console.error('Erreur écriture:', e.message); }
}

const saved      = loadData();
let athletes     = saved.athletes     || [];
let scores       = saved.scores       || {};
let globalScores = saved.globalScores || [];
console.log(`📂 ${athletes.length} sportif(s) chargé(s)`);

const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function hasPlayed(pseudo, athleteId) {
  return (scores[athleteId] || []).some(e => norm(e.pseudo) === norm(pseudo));
}
function nextAthleteFor(pseudo) {
  return athletes.find(a => !hasPlayed(pseudo, a.id)) || null;
}

// Recalcule le classement global : somme de tous les scores par pseudo
function rebuildGlobalScores() {
  const map = {}; // pseudo -> { totalScore, count, lastDate }
  for (const [athleteId, list] of Object.entries(scores)) {
    for (const entry of list) {
      const key = norm(entry.pseudo);
      if (!map[key]) map[key] = { pseudo: entry.pseudo, totalScore: 0, count: 0, lastDate: entry.date };
      map[key].totalScore += entry.score;
      map[key].count++;
      if (entry.date > map[key].lastDate) map[key].lastDate = entry.date;
    }
  }
  globalScores = Object.values(map)
    .map(e => ({ pseudo: e.pseudo, score: e.totalScore, count: e.count, date: e.lastDate }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 200);
}

// ── GAME ──────────────────────────────────────────────────────────────────

app.get('/api/athlete', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const athlete = nextAthleteFor(pseudo);
  if (!athlete) return res.json({ done: true, message: 'Tu as joué tous les sportifs ! Reviens bientôt. 🏆' });
  res.json({ id: athlete.id, clue: athlete.clue, emoji: athlete.emoji, wordCount: athlete.clue.split(/\s+/).filter(Boolean).length });
});

app.get('/api/athletes/list', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  res.json(athletes.map((a, i) => ({
    id:     a.id,
    emoji:  a.emoji,
    index:  i + 1,
    played: pseudo ? hasPlayed(pseudo, a.id) : false,
  })));
});

app.post('/api/check', (req, res) => {
  const { pseudo, athleteId, answer } = req.body;
  if (!answer || !athleteId || !pseudo) return res.status(400).json({ correct: false });
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete) return res.status(404).json({ correct: false });
  const correct = athlete.aliases.some(a => norm(a) === norm(answer));
  res.json({
    correct,
    answer:  correct ? athlete.answer : null,
    penalty: correct ? 0 : WRONG_PENALTY,
    message: correct ? `Bravo ! C'est bien ${athlete.answer} ! 🎉` : `Pas encore… −${WRONG_PENALTY} points !`,
  });
});

app.post('/api/score', (req, res) => {
  const { pseudo, score, athleteId } = req.body;
  if (!pseudo || score === undefined || !athleteId) return res.status(400).json({ error: 'Données manquantes' });
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete) return res.status(404).json({ error: 'Sportif introuvable' });
  if (hasPlayed(pseudo, athleteId)) return res.status(409).json({ error: 'already_played', message: `${pseudo} a déjà joué ce sportif !` });

  const entry = {
    pseudo:      pseudo.trim().slice(0, 20),
    score:       Math.max(0, score),
    athleteId,
    athleteName: athlete.answer,
    date:        new Date().toISOString(),
  };

  if (!scores[athleteId]) scores[athleteId] = [];
  scores[athleteId].push(entry);
  scores[athleteId].sort((a, b) => b.score - a.score);

  // Recalcul global par somme
  rebuildGlobalScores();
  saveData();

  res.json({ success: true, rank: scores[athleteId].indexOf(entry) + 1, total: scores[athleteId].length });
});

// IMPORTANT : /api/scores/global AVANT /api/scores/:athleteId
app.get('/api/scores/global', (req, res) => {
  res.json(globalScores.slice(0, 10));
});

app.get('/api/scores/:athleteId', (req, res) => {
  const id = parseInt(req.params.athleteId);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
  const a = athletes.find(a => a.id === id);
  res.json({ athlete: a ? { emoji: a.emoji, answer: a.answer } : null, scores: (scores[id] || []).slice(0, 10) });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  res.json(password === ADMIN_PASSWORD ? { success: true } : { success: false, message: 'Mot de passe incorrect' });
});

app.get('/api/admin/athletes', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  res.json(athletes.map(a => ({
    ...a,
    playerCount: (scores[a.id] || []).length,
    topScore:    (scores[a.id] || [])[0]?.score ?? null,
  })));
});

app.post('/api/admin/athlete', (req, res) => {
  const { password, answer, aliases, emoji, clue, editId } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!answer || !clue) return res.status(400).json({ error: 'Nom et description obligatoires' });

  const parts         = answer.trim().split(/\s+/);
  const autoAliases   = [answer.trim().toLowerCase(), ...parts.map(p => p.toLowerCase())];
  const manualAliases = (aliases || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const allAliases    = [...new Set([...autoAliases, ...manualAliases])];

  if (editId) {
    const idx = athletes.findIndex(a => a.id === editId);
    if (idx < 0) return res.status(404).json({ error: 'Sportif introuvable' });
    athletes[idx] = { ...athletes[idx], answer: answer.trim(), aliases: allAliases, emoji: emoji || '🏆', clue: clue.trim() };
    saveData();
    return res.json({ success: true, edited: true, answer: athletes[idx].answer, wordCount: clue.split(/\s+/).filter(Boolean).length });
  }

  const newId = Date.now();
  athletes.push({ id: newId, answer: answer.trim(), aliases: allAliases, emoji: emoji || '🏆', clue: clue.trim(), createdAt: new Date().toISOString() });
  scores[newId] = [];
  saveData();
  console.log(`✅ Ajouté : ${answer.trim()}`);
  res.json({ success: true, edited: false, id: newId, answer: answer.trim(), wordCount: clue.split(/\s+/).filter(Boolean).length, aliases: allAliases, total: athletes.length });
});

app.delete('/api/admin/athlete/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const id = parseInt(req.params.id);
  athletes = athletes.filter(a => a.id !== id);
  delete scores[id];
  rebuildGlobalScores(); // recalcul après suppression
  saveData();
  res.json({ success: true });
});

app.post('/api/admin/reset-global', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  globalScores = [];
  // Vide aussi tous les scores par sportif
  for (const id of Object.keys(scores)) scores[id] = [];
  saveData();
  res.json({ success: true });
});

app.post('/api/admin/reset-athlete/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const id = parseInt(req.params.id);
  scores[id] = [];
  rebuildGlobalScores(); // recalcul global après reset
  saveData();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏆 http://localhost:${PORT}`);
  console.log(`🔐 Admin → http://localhost:${PORT}/admin.html`);
});
