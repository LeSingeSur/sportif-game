const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
const app      = express();

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
function hasFinishedAll(pseudo) {
  return athletes.length > 0 && athletes.every(a => hasPlayed(pseudo, a.id));
}
function rebuildGlobalScores() {
  const map = {};
  for (const list of Object.values(scores)) {
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
    .sort((a, b) => b.score - a.score).slice(0, 200);
}

// ── IMAGE PROXY ───────────────────────────────────────────────────────────
// FIX: Use GET with a range request for validation instead of HEAD (HEAD fails on many servers)
app.all('/api/img-proxy', async (req, res) => {
  if(req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const url = req.query.url;
  if (!url) return res.status(400).send('URL manquante');
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SportifGame/1.0)',
        'Referer':    'https://www.google.com/',
        'Accept':     'image/*',
      },
      timeout: 10000,
    });
    if (!response.ok) return res.status(response.status).send('Image inaccessible');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return res.status(400).send('Ce n\'est pas une image');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    if(req.method === 'HEAD') return res.end();
    response.body.pipe(res);
  } catch(e) {
    console.error('Proxy image error:', e.message);
    res.status(500).send('Impossible de charger l\'image');
  }
});

// ── GAME ──────────────────────────────────────────────────────────────────

app.get('/api/athlete', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const athlete = nextAthleteFor(pseudo);
  if (!athlete) return res.json({ done: true });

  const gridSize = athlete.gridSize || 10;
  const base = { id: athlete.id, emoji: athlete.emoji, type: athlete.type || 'text' };
  if (athlete.type === 'image') {
    base.imageUrl  = `/api/img-proxy?url=${encodeURIComponent(athlete.imageUrl)}`;
    base.gridSize  = gridSize;
    base.maxScore  = gridSize * gridSize;
  } else if (athlete.type === 'buzz') {
    base.clues        = athlete.clues;
    base.maxScore     = 100;
    base.buzzDecrement = athlete.buzzDecrement || 5;
  } else {
    base.clue      = athlete.clue;
    base.wordCount = athlete.clue.split(/\s+/).filter(Boolean).length;
  }
  res.json(base);
});

app.get('/api/athletes/list', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  res.json(athletes.map((a, i) => ({
    id: a.id, emoji: a.emoji, index: i + 1,
    type: a.type || 'text',
    played: pseudo ? hasPlayed(pseudo, a.id) : false,
  })));
});

// Check if pseudo has finished all games (for leaderboard access)
app.get('/api/finished', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  if (!pseudo) return res.json({ finished: false, total: athletes.length, played: 0 });
  const played = athletes.filter(a => hasPlayed(pseudo, a.id)).length;
  res.json({ finished: hasFinishedAll(pseudo), total: athletes.length, played });
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
  if (hasPlayed(pseudo, athleteId)) return res.status(409).json({ error: 'already_played' });

  const entry = { pseudo: pseudo.trim().slice(0, 20), score: Math.max(0, score), athleteId, athleteName: athlete.answer, date: new Date().toISOString() };
  if (!scores[athleteId]) scores[athleteId] = [];
  scores[athleteId].push(entry);
  scores[athleteId].sort((a, b) => b.score - a.score);
  rebuildGlobalScores();
  saveData();
  res.json({ success: true, rank: scores[athleteId].indexOf(entry) + 1, total: scores[athleteId].length });
});

// Scores are only visible if pseudo has finished all games
app.get('/api/scores/global', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  if (!isAdmin && pseudo && !hasFinishedAll(pseudo)) {
    return res.json({ locked: true, played: athletes.filter(a => hasPlayed(pseudo, a.id)).length, total: athletes.length });
  }
  res.json(globalScores.slice(0, 10));
});

app.get('/api/scores/:athleteId', (req, res) => {
  const id = parseInt(req.params.athleteId);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
  const pseudo = (req.query.pseudo || '').trim();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  const a = athletes.find(a => a.id === id);
  if (!isAdmin && pseudo && !hasFinishedAll(pseudo)) {
    return res.json({ locked: true, athlete: a ? { emoji: a.emoji, answer: '???', type: a.type || 'text' } : null, scores: [] });
  }
  res.json({ athlete: a ? { emoji: a.emoji, answer: a.answer, type: a.type || 'text' } : null, scores: (scores[id] || []).slice(0, 10) });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  res.json(password === ADMIN_PASSWORD ? { success: true } : { success: false, message: 'Mot de passe incorrect' });
});

app.get('/api/admin/athletes', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  res.json(athletes.map(a => ({ ...a, playerCount: (scores[a.id] || []).length, topScore: (scores[a.id] || [])[0]?.score ?? null })));
});

// Admin: get full scores for a specific athlete
app.get('/api/admin/scores/:athleteId', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const id = parseInt(req.params.athleteId);
  if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
  const a = athletes.find(a => a.id === id);
  res.json({ athlete: a || null, scores: (scores[id] || []).slice(0, 50) });
});

// Admin: get global scores
app.get('/api/admin/scores', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  res.json(globalScores.slice(0, 100));
});

app.post('/api/admin/athlete', (req, res) => {
  const { password, answer, aliases, emoji, clue, clues, imageUrl, gridSize, type, editId, buzzDecrement } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!answer) return res.status(400).json({ error: 'Nom obligatoire' });
  if (type === 'image' && !imageUrl) return res.status(400).json({ error: 'URL image obligatoire' });
  if (type === 'buzz' && (!clues || !clues.length)) return res.status(400).json({ error: 'Indices Buzz obligatoires' });
  if (type !== 'image' && type !== 'buzz' && !clue) return res.status(400).json({ error: 'Description obligatoire' });

  const parts         = answer.trim().split(/\s+/);
  const autoAliases   = [answer.trim().toLowerCase(), ...parts.map(p => p.toLowerCase())];
  const manualAliases = (aliases || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const allAliases    = [...new Set([...autoAliases, ...manualAliases])];

  const gs = Math.min(20, Math.max(2, parseInt(gridSize) || 10));

  const athleteData = {
    answer:   answer.trim(),
    aliases:  allAliases,
    emoji:    emoji || '🏆',
    type:     type || 'text',
    clue:     type === 'text' ? clue.trim() : '',
    clues:    type === 'buzz' ? (Array.isArray(clues) ? clues : clues.split('\n').map(s=>s.trim()).filter(Boolean)) : [],
    buzzDecrement: type === 'buzz' ? Math.min(20, Math.max(1, parseInt(buzzDecrement) || 5)) : undefined,
    imageUrl: type === 'image' ? imageUrl.trim() : '',
    gridSize: type === 'image' ? gs : undefined,
  };

  if (editId) {
    const idx = athletes.findIndex(a => a.id === editId);
    if (idx < 0) return res.status(404).json({ error: 'Sportif introuvable' });
    athletes[idx] = { ...athletes[idx], ...athleteData };
    saveData();
    return res.json({ success: true, edited: true, answer: athletes[idx].answer });
  }

  const newId = Date.now();
  athletes.push({ id: newId, ...athleteData, createdAt: new Date().toISOString() });
  scores[newId] = [];
  saveData();
  console.log(`✅ Ajouté (${athleteData.type}): ${answer.trim()}`);
  res.json({ success: true, edited: false, id: newId, answer: answer.trim(), total: athletes.length });
});

app.delete('/api/admin/athlete/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const id = parseInt(req.params.id);
  athletes = athletes.filter(a => a.id !== id);
  delete scores[id];
  rebuildGlobalScores(); saveData();
  res.json({ success: true });
});

app.post('/api/admin/reset-global', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  globalScores = [];
  for (const id of Object.keys(scores)) scores[id] = [];
  saveData(); res.json({ success: true });
});

app.post('/api/admin/reset-athlete/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  scores[parseInt(req.params.id)] = [];
  rebuildGlobalScores(); saveData(); res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏆 http://localhost:${PORT}  |  🔐 /admin.html`));
