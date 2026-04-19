const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
const app      = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

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
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ athletes, scores, globalScores, musicConfig, welcomeImage }, null, 2)); }
  catch(e) { console.error('Erreur écriture:', e.message); }
}

const saved      = loadData();
let athletes     = saved.athletes     || [];
let scores       = saved.scores       || {};
let globalScores = saved.globalScores || [];
let musicConfig  = saved.musicConfig  || { url: '', title: '' };
let welcomeImage = saved.welcomeImage || { url: '' };
console.log(` ${athletes.length} sportif(s) chargé(s)`);

const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function hasPlayed(pseudo, athleteId) {
  return (scores[athleteId] || []).some(e => norm(e.pseudo) === norm(pseudo));
}
function publishedAthletes() {
  return athletes.filter(a => a.published !== false);
}
function nextAthleteFor(pseudo) {
  return publishedAthletes().find(a => !hasPlayed(pseudo, a.id)) || null;
}
function hasFinishedAll(pseudo) {
  const pub = publishedAthletes();
  return pub.length > 0 && pub.every(a => hasPlayed(pseudo, a.id));
}
function rebuildGlobalScores() {
  const map = {};
  for (const [athleteId, list] of Object.entries(scores)) {
    const athlete = athletes.find(a => String(a.id) === String(athleteId));
    const coeff   = athlete?.coefficient ?? 1;
    for (const entry of list) {
      const key = norm(entry.pseudo);
      if (!map[key]) map[key] = { pseudo: entry.pseudo, totalScore: 0, count: 0, lastDate: entry.date };
      map[key].totalScore += entry.score * coeff;
      map[key].count++;
      if (entry.date > map[key].lastDate) map[key].lastDate = entry.date;
    }
  }
  globalScores = Object.values(map)
    .map(e => ({ pseudo: e.pseudo, score: Math.round(e.totalScore), count: e.count, date: e.lastDate }))
    .sort((a, b) => b.score - a.score).slice(0, 200);
}

// -- PING (keepalive pour cron-job.org) -----------------------------------
app.get('/ping', (req, res) => res.send('OK'));

// -- PREVIEW (admin only, score not saved) --------------------------------
app.get('/api/preview', (req, res) => {
  const { id, password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const athlete = athletes.find(a => String(a.id) === String(id));
  if (!athlete) return res.status(404).json({ error: 'Défi introuvable' });
  const gridSize = athlete.gridSize || 10;
  const base = { id: athlete.id, emoji: athlete.emoji, type: athlete.type || 'text', preview: true };
  // Same data as /api/athlete but no pseudo required
  if (athlete.type === 'image') {
    base.imageUrl = athlete.imageBase64 ? athlete.imageBase64 : `/api/img-proxy?url=${encodeURIComponent(athlete.imageUrl)}`;
    base.gridSize = gridSize; base.maxScore = gridSize * gridSize;
  } else if (athlete.type === 'buzz') {
    base.clues = athlete.clues; base.maxScore = 100;
    base.buzzDecrement = athlete.buzzDecrement || 2;
    base.buzzFreezeDuration = athlete.buzzFreezeDuration || 3;
  } else if (athlete.type === 'sportus') {
    const lastName = athlete.answer.trim().split(/\s+/).pop();
    const normLast = lastName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    base.lastNameLength = normLast.length; base.hint1 = athlete.sportusHint1 || '';
    base.hint2 = athlete.sportusHint2 || ''; base.freeHint = athlete.sportusHint0 || '';
    base.revealedLetters = athlete.revealedLetters || []; base.sportusTimer = athlete.sportusTimer || 45;
    base.maxScore = 100;
  } else if (athlete.type === 'prix') {
    base.question = athlete.question; base.unit = athlete.unit || '';
    base.targetValue = athlete.targetValue; base.prixTolerance = athlete.prixTolerance || 0;
    base.chaleurSeuils = Array.isArray(athlete.prixSensibilite) ? athlete.prixSensibilite : [0,10,40,70,90];
    base.maxScore = 100;
  } else if (athlete.type === 'trappe') {
    base.trappeQuestions = athlete.trappeQuestions || [];
    base.trappeTimer = athlete.trappeTimer || 30; base.maxScore = 100;
    base.themeName = athlete.answer || 'La Trappe';
  } else if (athlete.type === 'demineur') {
    base.demineurItems    = (athlete.demineurItems || []).map(it => ({ text: it.text }));
    base.demineurTimer    = athlete.demineurTimer || 60;
    base.demineurQuestion = athlete.demineurQuestion || '';
    base.maxScore = 100;
  } else if (athlete.type === 'chase') {
    base.chaseTheme         = athlete.chaseTheme || '';
    base.chaseTargetToWin   = athlete.chaseTargetToWin || 10;
    base.chasePlayerStart   = athlete.chasePlayerStart || 3;
    base.chaseGrace         = athlete.chaseGrace || 15;
    base.chaseSpeed         = athlete.chaseSpeed || 10;
    base.chaseMalus         = athlete.chaseMalus || 30;
    base.maxScore           = 100;
  } else if (athlete.type === 'scout') {
    base.scoutIndices = (athlete.scoutIndices || []).map(i => ({ cost: i.cost, text: i.text, label: i.label }));
    base.maxScore = 100;
  } else if (athlete.type === 'replique') {
    base.repliqueAmorce  = athlete.repliqueAmorce || '';
    base.repliqueChoices = athlete.repliqueChoices || [];
    base.repliqueAnswer  = athlete.repliqueAnswer || '';
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    base.answer          = athlete.repliqueAuthor || athlete.answer || '';
    base.maxScore = 100;
  } else if (athlete.type === 'grimpe') {
    base.grimpeTheme   = athlete.grimpeTheme || '';
    base.clue          = athlete.grimpeTheme || athlete.clue || '';
    base.grimpeAnswers = (athlete.grimpeAnswers || []).length;
    base.grimpeParams  = athlete.grimpeParams || {};
    base.maxScore = 100;
  } else if (athlete.type === 'blackjack') {
    base.bjTheme   = athlete.bjTheme || '';
    base.bjTarget  = athlete.bjTarget || 50;
    base.bjAnswers = athlete.bjAnswers || {};
    base.maxScore  = 100;
  } else {
    base.clue = athlete.clue || '';
    base.wordCount = (athlete.clue||'').split(/\s+/).filter(Boolean).length;
  }
  res.json(base);
});

// -- PUBLISH / UNPUBLISH --------------------------------------------------
app.post('/api/admin/publish/:id', (req, res) => {
  const { password, published } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const athlete = athletes.find(a => String(a.id) === String(req.params.id));
  if (!athlete) return res.status(404).json({ error: 'Introuvable' });
  athlete.published = !!published;
  saveData();
  res.json({ success: true, published: athlete.published });
});


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

app.get('/api/welcome-image', (req, res) => {
  res.json(welcomeImage);
});

app.post('/api/admin/welcome-image', (req, res) => {
  const { password, url } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  welcomeImage = { url: (url||'').trim() };
  saveData();
  res.json({ success: true });
});

// -- LA GRIMPÉE ------------------------------------------------------------
app.post('/api/grimpe-check', (req, res) => {
  const { athleteId, answer, found } = req.body;
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'grimpe') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const normAns = norm(answer);
  if(!normAns) return res.json({ correct: false, reason: 'empty' });
  const alreadyFound = (found||[]).map(norm);
  if(alreadyFound.includes(normAns)) return res.json({ correct: false, reason: 'already' });
  const correct = (athlete.grimpeAnswers||[]).some(a => lev(norm(a), normAns) <= 1);
  res.json({ correct, total: (athlete.grimpeAnswers||[]).length });
});

// EPO — révèle une réponse non encore trouvée
app.post('/api/grimpe-epo', (req, res) => {
  const { athleteId, found } = req.body;
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'grimpe') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const foundNorm = (found||[]).map(norm);
  const unfound = (athlete.grimpeAnswers||[]).filter(a => !foundNorm.includes(norm(a)));
  if(!unfound.length) return res.json({ answer: null });
  // Retourne une réponse aléatoire non trouvée
  const pick = unfound[Math.floor(Math.random()*unfound.length)];
  res.json({ answer: pick });
});
app.post('/api/grimpe-gel', (req, res) => {
  const { athleteId, password } = req.body;
  if(password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Interdit' });
  const athlete = athletes.find(a => a.id === athleteId);
  if(!athlete) return res.status(404).json({ error: 'Joueur introuvable' });
  athlete.grimpeGel = Date.now();
  res.json({ ok: true });
});

// Le joueur poll ce endpoint pour savoir si gel activé
app.get('/api/grimpe-gel', (req, res) => {
  const { athleteId } = req.query;
  const athlete = athletes.find(a => a.id === athleteId);
  if(!athlete) return res.status(404).json({ error: 'Introuvable' });
  const gelTime = athlete.grimpeGel || 0;
  const active = (Date.now() - gelTime) < 15000; // 15s fenêtre
  res.json({ active, gelTime });
});

app.get('/api/audio-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('URL manquante');
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' }
    });
    if (!response.ok) return res.status(response.status).send('Audio inaccessible');
    const ext = url.split('.').pop().toLowerCase().split('?')[0];
    const typeMap = {'mp3':'audio/mpeg','m4a':'audio/mp4','aac':'audio/aac','ogg':'audio/ogg','wav':'audio/wav'};
    res.set('Content-Type', typeMap[ext] || 'audio/mp4');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Accept-Ranges', 'bytes');
    response.body.pipe(res);
  } catch(e) {
    console.error('Audio proxy error:', e.message);
    res.status(500).send('Erreur proxy audio');
  }
});

app.get('/api/music', (req, res) => {
  res.json(musicConfig);
});

app.post('/api/admin/music', (req, res) => {
  const { password, url, title } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  musicConfig = { url: (url||'').trim(), title: (title||'').trim() };
  saveData();
  res.json({ success: true });
});

// -- GAME ------------------------------------------------------------------

app.get('/api/athlete', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const athlete = nextAthleteFor(pseudo);
  if (!athlete) return res.json({ done: true });

  const gridSize = athlete.gridSize || 10;
  const base = { id: athlete.id, emoji: athlete.emoji, type: athlete.type || 'text' };
  if (athlete.type === 'image') {
    // If image stored as base64 data URI, serve directly; otherwise proxy the URL
    base.imageUrl  = athlete.imageBase64
      ? athlete.imageBase64
      : `/api/img-proxy?url=${encodeURIComponent(athlete.imageUrl)}`;
    base.gridSize  = gridSize;
    base.maxScore  = gridSize * gridSize;
  } else if (athlete.type === 'buzz') {
    base.clues             = athlete.clues;
    base.maxScore          = 100;
    base.buzzDecrement     = athlete.buzzDecrement || 2;
    base.buzzFreezeDuration = athlete.buzzFreezeDuration || 3;
  } else if (athlete.type === 'sportus') {
    const lastName = athlete.answer.trim().split(/\s+/).pop();
    const normLast = lastName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    base.lastNameLength   = normLast.length;
    base.hint1            = athlete.sportusHint1 || '';
    base.hint2            = athlete.sportusHint2 || '';
    base.freeHint         = athlete.sportusHint0 || '';
    // revealedLetters: array of {index, letter} — pre-revealed positions
    base.revealedLetters  = athlete.revealedLetters || [];
    base.sportusTimer     = athlete.sportusTimer || 45;
    base.maxScore         = 100;
  } else if (athlete.type === 'prix') {
    base.question      = athlete.question;
    base.unit          = athlete.unit || '';
    base.targetValue   = athlete.targetValue;
    base.prixTolerance   = athlete.prixTolerance || 0;
    base.chaleurSeuils   = Array.isArray(athlete.prixSensibilite) ? athlete.prixSensibilite : [0,10,40,70,90];
    base.maxScore      = 100;
  } else if (athlete.type === 'trappe') {
    base.trappeQuestions = athlete.trappeQuestions && athlete.trappeQuestions.length
      ? athlete.trappeQuestions
      : [];
    base.trappeTimer    = athlete.trappeTimer || 30;
    base.maxScore       = 100;
    base.themeName      = athlete.answer || 'La Trappe';
  } else if (athlete.type === 'demineur') {
    base.demineurItems    = (athlete.demineurItems || []).map(it => ({ text: it.text }));
    base.demineurTimer    = athlete.demineurTimer || 60;
    base.demineurQuestion = athlete.demineurQuestion || '';
    base.maxScore         = 100;
  } else if (athlete.type === 'chase') {
    base.chaseTheme       = athlete.chaseTheme || '';
    base.chaseTargetToWin = athlete.chaseTargetToWin || 10;
    base.chasePlayerStart = athlete.chasePlayerStart || 3;
    base.chaseGrace       = athlete.chaseGrace || 15;
    base.chaseSpeed       = athlete.chaseSpeed || 10;
    base.chaseMalus       = athlete.chaseMalus || 30;
    base.maxScore         = 100;
  } else if (athlete.type === 'scout') {
    base.scoutIndices = (athlete.scoutIndices || []).map(i => ({ cost: i.cost, text: i.text, label: i.label }));
    base.maxScore = 100;
  } else if (athlete.type === 'replique') {
    base.repliqueAmorce  = athlete.repliqueAmorce || '';
    base.repliqueChoices = athlete.repliqueChoices || [];
    base.repliqueAnswer  = athlete.repliqueAnswer || '';
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    base.answer          = athlete.repliqueAuthor || athlete.answer || '';
    base.maxScore = 100;
  } else if (athlete.type === 'grimpe') {
    base.grimpeTheme   = athlete.grimpeTheme || '';
    base.clue          = athlete.grimpeTheme || athlete.clue || '';
    base.grimpeAnswers = (athlete.grimpeAnswers || []).length;
    base.grimpeParams  = athlete.grimpeParams || {};
    base.maxScore      = 100;
  } else if (athlete.type === 'blackjack') {
    base.bjTheme   = athlete.bjTheme || '';
    base.bjTarget  = athlete.bjTarget || 50;
    base.bjAnswers = athlete.bjAnswers || {};
    base.maxScore  = 100;
  } else {
    // legacy text type
    base.clue      = athlete.clue || '';
    base.wordCount = (athlete.clue||'').split(/\s+/).filter(Boolean).length;
  }
  res.json(base);
});

app.get('/api/athletes/list', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  res.json(athletes.map((a, i) => ({
    id: a.id, emoji: a.emoji, index: i + 1,
    type: a.type || 'blackjack',
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
    fullAnswer: athlete.answer,
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
  res.json({ success: true, rank: scores[athleteId].indexOf(entry) + 1, total: scores[athleteId].length, answer: athlete.answer });
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

// -- SPORTUS (Motus) ------------------------------------------------------
app.post('/api/sportus-check', (req, res) => {
  const { athleteId, guess } = req.body;
  if (!athleteId || !guess) return res.status(400).json({ error: 'Données manquantes' });
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete) return res.status(404).json({ error: 'Sportif introuvable' });

  // Target = last name, normalised, uppercase
  const lastName = athlete.answer.trim().split(/\s+/).pop();
  const target   = lastName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const attempt  = guess.trim().split(/\s+/).pop()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();

  const correct = norm(lastName) === norm(guess.trim().split(/\s+/).pop());

  // Motus coloring: 🟥 bien placé, 🟡 mal placé, ⬜ absent
  const result = Array(target.length).fill('absent');
  const tLeft  = target.split('');
  const aLeft  = attempt.split('').slice(0, target.length);
  // Pad/trim attempt to target length
  const atArr  = Array.from({length: target.length}, (_,i) => aLeft[i] || '');

  // Pass 1: exact matches
  for (let i = 0; i < target.length; i++) {
    if (atArr[i] === tLeft[i]) { result[i] = 'correct'; tLeft[i] = null; atArr[i] = null; }
  }
  // Pass 2: present but wrong position
  for (let i = 0; i < target.length; i++) {
    if (atArr[i] === null) continue;
    const j = tLeft.indexOf(atArr[i]);
    if (j !== -1) { result[i] = 'present'; tLeft[j] = null; }
  }

  res.json({
    correct,
    result,
    target: correct ? target : null,
    fullAnswer: athlete.answer,
  });
});

// -- THE CHASE ------------------------------------------------------------
app.post('/api/chase-check', (req, res) => {
  const { athleteId, answer, found } = req.body;
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'chase') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const normAns = norm(answer || '');
  if (!normAns) return res.json({ correct: false, reason: 'empty' });
  // Levenshtein distance
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  // Check if already found (exact)
  const alreadyFound = (found || []).map(norm);
  if (alreadyFound.includes(normAns)) return res.json({ correct: false, reason: 'already' });
  // Check against accepted answers with tolerance 1
  const correct = (athlete.chaseAnswers || []).some(a => lev(norm(a), normAns) <= 1);
  res.json({ correct, fullAnswer: athlete.answer });
});

// -- LE DÉMINEUR -----------------------------------------------------------
app.post('/api/demineur-check', (req, res) => {
  const { athleteId, index } = req.body;
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'demineur') return res.status(404).json({ error: 'Défi introuvable' });
  const item = (athlete.demineurItems || [])[index];
  if (!item) return res.status(404).json({ error: 'Item introuvable' });
  res.json({ isMine: !!item.isMine, fullAnswer: athlete.answer });
});

// -- LA TRAPPE -------------------------------------------------------------
app.post('/api/trappe-check', (req, res) => {
  const { athleteId, questionIndex } = req.body;
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'trappe') return res.status(404).json({ error: 'Défi introuvable' });
  const questions = athlete.trappeQuestions && athlete.trappeQuestions.length
    ? athlete.trappeQuestions
    : (athlete.trappeQuestion ? [{question:athlete.trappeQuestion, answers:athlete.trappeAnswers||[], correct:athlete.trappeCorrect||0}] : []);
  const q = questions[questionIndex || 0];
  if (!q) return res.status(404).json({ error: 'Question introuvable' });
  res.json({ correctIndex: q.correct, fullAnswer: athlete.answer || 'La Trappe', totalQuestions: questions.length });
});

// -- LE JUSTE PRIX ---------------------------------------------------------
// Illimité, score peut tomber à 0, bloqué là
app.post('/api/prix-check', (req, res) => {
  const { athleteId, guess } = req.body;
  if (!athleteId || guess === undefined) return res.status(400).json({ error: 'Données manquantes' });
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete || athlete.type !== 'prix') return res.status(404).json({ error: 'Défi introuvable' });

  const target    = athlete.targetValue;
  const tolerance = athlete.prixTolerance || 0;
  const seuils    = Array.isArray(athlete.prixSensibilite) ? athlete.prixSensibilite : [0,10,40,70,90];
  const g         = parseFloat(String(guess).replace(',', '.'));
  if (isNaN(g) || g < 0) return res.status(400).json({ error: 'Valeur invalide' });

  const diff  = Math.abs(g - target);
  const exact = diff <= tolerance;

  // Score ET affichage : même formule min/max symétrique
  const precision = exact ? 100 : (Math.min(g, target) / Math.max(g, target)) * 100;
  const direction = g < target - tolerance ? 'plus' : g > target + tolerance ? 'moins' : 'exact';

  res.json({ exact, precision, displayPrecision: precision, seuils, direction, target: exact ? target : null, fullAnswer: athlete.answer });
});

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
  const { password, answer, aliases, emoji, clue, clues, imageUrl, gridSize, type, editId, buzzDecrement, question, unit, targetValue, sportusHint1, sportusHint2, sportusHint0, coefficient } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!answer && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe') return res.status(400).json({ error: 'Nom obligatoire' });
  if (type === 'image' && !imageUrl && !req.body.imageBase64) return res.status(400).json({ error: 'Image obligatoire (URL ou fichier)' });
  if (type === 'buzz' && (!clues || !clues.length)) return res.status(400).json({ error: 'Indices Buzz obligatoires' });
  if (type === 'sportus' && !answer) return res.status(400).json({ error: 'Nom obligatoire' });
  if (type === 'prix' && (!question || targetValue === undefined)) return res.status(400).json({ error: 'Question et valeur cible obligatoires' });
  if (type === 'trappe' && (!req.body.trappeQuestions || !req.body.trappeQuestions.length)) return res.status(400).json({ error: 'Au moins une question obligatoire' });
  if (type === 'demineur' && (!req.body.demineurItems || req.body.demineurItems.length < 3)) return res.status(400).json({ error: 'Au moins 3 items obligatoires' });
  if (type === 'chase' && (!req.body.chaseTheme || !req.body.chaseAnswers || req.body.chaseAnswers.length < 2)) return res.status(400).json({ error: 'Thème et au moins 2 réponses obligatoires' });
  if (type === 'scout' && (!req.body.scoutIndices || !req.body.scoutIndices.some(i=>i.text))) return res.status(400).json({ error: 'Au moins un indice obligatoire' });
  if (type === 'replique' && (!req.body.repliqueCitation || !req.body.repliqueAuthor)) return res.status(400).json({ error: 'Citation et auteur obligatoires' });
  if (type === 'grimpe' && (!req.body.grimpeTheme || !req.body.grimpeAnswers || req.body.grimpeAnswers.length < 1)) return res.status(400).json({ error: 'Thème et réponses obligatoires' });
  if (type === 'blackjack' && (!req.body.bjTheme || !req.body.bjTarget || !req.body.bjAnswers || !Object.keys(req.body.bjAnswers).length)) return res.status(400).json({ error: 'Thème, cible et réponses obligatoires' });
  if (type !== 'image' && type !== 'buzz' && type !== 'sportus' && type !== 'prix' && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe' && !clue) return res.status(400).json({ error: 'Description obligatoire' });

  const safeAnswer = (answer||'').trim() || (type==='demineur'?'Le Démineur':type==='chase'?'The Chase':type==='replique'?(req.body.repliqueAuthor||'Réplique').trim():type==='blackjack'?(req.body.bjTheme||'Blackjack').trim():type==='grimpe'?(req.body.grimpeTheme||'La Grimpée').trim():'???');
  const parts         = safeAnswer.split(/\s+/);
  const autoAliases   = [safeAnswer.toLowerCase()];
  if(parts.length > 1) autoAliases.push(parts[parts.length - 1].toLowerCase());
  const manualAliases = (aliases || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const allAliases    = [...new Set([...autoAliases, ...manualAliases])];

  const gs = Math.min(20, Math.max(2, parseInt(gridSize) || 10));

  const athleteData = {
    answer:   safeAnswer,
    aliases:  allAliases,
    emoji:    emoji || '🏆',
    type:     type || 'text',
    clue:     type === 'text' ? (clue||'').trim() : '',
    clues:    type === 'buzz' ? (Array.isArray(clues) ? clues : clues.split('\n').map(s=>s.trim()).filter(Boolean)) : [],
    buzzDecrement: type === 'buzz' ? Math.min(10, Math.max(0.5, parseFloat(buzzDecrement) || 2)) : undefined,
    buzzFreezeDuration: type === 'buzz' ? Math.min(10, Math.max(1, parseInt(req.body.buzzFreezeDuration) || 3)) : undefined,
    imageUrl:    type === 'image' ? (req.body.imageBase64 ? '' : imageUrl.trim()) : '',
    imageBase64: type === 'image' ? (req.body.imageBase64 || '') : '',
    gridSize: type === 'image' ? gs : undefined,
    question: type === 'prix' ? (question||'').trim() : undefined,
    unit:     type === 'prix' ? (unit||'').trim() : undefined,
    targetValue:    type === 'prix' ? parseFloat(targetValue) : undefined,
    prixTolerance:     type === 'prix' ? (parseFloat(req.body.prixTolerance) || 0) : undefined,
    prixSensibilite:   type === 'prix' ? (req.body.prixSensibilite || [0,10,40,70,90]) : undefined,
    sportusHint1: type === 'sportus' ? (sportusHint1||'').trim() : undefined,
    sportusHint2: type === 'sportus' ? (sportusHint2||'').trim() : undefined,
    sportusHint0: type === 'sportus' ? (sportusHint0||'').trim() : undefined,
    sportusTimer: type === 'sportus' ? (parseInt(req.body.sportusTimer) || 45) : undefined,
    revealedLetters: type === 'sportus' ? (req.body.revealedLetters || []) : undefined,
    trappeQuestion: type === 'trappe' ? '' : undefined,
    trappeAnswers:  type === 'trappe' ? [] : undefined,
    trappeCorrect:  type === 'trappe' ? 0 : undefined,
    trappeTimer:    type === 'trappe' ? (parseInt(req.body.trappeTimer) || 30) : undefined,
    trappeQuestions:type === 'trappe' ? (req.body.trappeQuestions || []) : undefined,
    demineurItems:    type === 'demineur' ? (req.body.demineurItems || []) : undefined,
    demineurTimer:    type === 'demineur' ? (parseInt(req.body.demineurTimer) || 60) : undefined,
    demineurQuestion: type === 'demineur' ? (req.body.demineurQuestion||'').trim() : undefined,
    chaseTheme:       type === 'chase' ? (req.body.chaseTheme||'').trim() : undefined,
    chaseAnswers:     type === 'chase' ? (req.body.chaseAnswers||[]).map(s=>s.trim()).filter(Boolean) : undefined,
    chaseTargetToWin: type === 'chase' ? (parseInt(req.body.chaseTargetToWin)||8) : undefined,
    chasePlayerStart: type === 'chase' ? (parseInt(req.body.chasePlayerStart)||3) : undefined,
    chaseGrace:       type === 'chase' ? (parseInt(req.body.chaseGrace)||15) : undefined,
    chaseSpeed:       type === 'chase' ? (parseInt(req.body.chaseSpeed)||10) : undefined,
    chaseMalus:       type === 'chase' ? (parseInt(req.body.chaseMalus)||30) : undefined,
    // Scout
    scoutIndices:     type === 'scout' ? (req.body.scoutIndices||[]) : undefined,
    // Réplique Culte
    repliqueCitation: type === 'replique' ? (req.body.repliqueCitation||'').trim() : undefined,
    repliqueAmorce:   type === 'replique' ? (req.body.repliqueAmorce||'').trim() : undefined,
    repliqueAnswer:   type === 'replique' ? (req.body.repliqueAnswer||'').trim() : undefined,
    repliqueAuthor:   type === 'replique' ? (req.body.repliqueAuthor||'').trim() : undefined,
    repliqueChoices:  type === 'replique' ? (req.body.repliqueChoices||[]) : undefined,
    repliqueAuthorChoices: type === 'replique' ? (req.body.repliqueAuthorChoices||[]) : undefined,
    rqTolerance: type === 'replique' ? (parseInt(req.body.rqTolerance)||1) : undefined,
    rqTime:      type === 'replique' ? (parseInt(req.body.rqTime)||60) : undefined,
    bjTheme:    type === 'blackjack' ? (req.body.bjTheme||'').trim() : undefined,
    bjTarget:   type === 'blackjack' ? (parseInt(req.body.bjTarget)||50) : undefined,
    bjAnswers:  type === 'blackjack' ? (req.body.bjAnswers||{}) : undefined,
    grimpeTheme:   type === 'grimpe' ? (req.body.grimpeTheme||'').trim() : undefined,
    grimpeAnswers: type === 'grimpe' ? (req.body.grimpeAnswers||[]).map(s=>String(s).trim()).filter(Boolean) : undefined,
    grimpeParams:  type === 'grimpe' ? (req.body.grimpeParams||{}) : undefined,
    published: req.body.published !== undefined ? !!req.body.published : false,
    coefficient: parseFloat(coefficient) || 1,
  };

  if (editId) {
    const idx = athletes.findIndex(a => a.id === editId);
    if (idx < 0) return res.status(404).json({ error: 'Sportif introuvable' });
    const prevPublished = athletes[idx].published; // preserve published status on edit
    athletes[idx] = { ...athletes[idx], ...athleteData, published: prevPublished };
    saveData();
    return res.json({ success: true, edited: true, answer: athletes[idx].answer });
  }

  const newId = Date.now();
  athletes.push({ id: newId, ...athleteData, createdAt: new Date().toISOString() });
  scores[newId] = [];
  saveData();
  console.log(`✅ Ajouté (${athleteData.type}): ${safeAnswer}`);
  res.json({ success: true, edited: false, id: newId, answer: safeAnswer, total: athletes.length });
});

app.post('/api/admin/reorder', (req, res) => {
  const { password, order } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!Array.isArray(order)) return res.status(400).json({ error: 'ordre invalide' });
  const reordered = order.map(id => athletes.find(a => a.id === id)).filter(Boolean);
  // Keep any athletes not in order at the end
  const missing = athletes.filter(a => !order.includes(a.id));
  athletes = [...reordered, ...missing];
  saveData();
  res.json({ success: true });
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
