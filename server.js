const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const fetch    = require('node-fetch');
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch(e) { console.log('mongodb non installé — mode fichier uniquement'); }
const app      = express();

app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', true); // Récupère la vraie IP derrière Koyeb

// Helper IP
function getIP(req){ return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '?'; }
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sportif2024';
const MONGO_URI      = process.env.MONGODB_URI || '';
const WRONG_PENALTY  = 10;

// ── MongoDB ────────────────────────────────────────────────────────────────
let db, colAthletes, colScores, colConfig;
let athletes     = [];
let scores       = {};
let globalScores = [];
let musicConfig  = { url: '', title: '' };
let welcomeImage = { url: '' };

async function connectMongo() {
  if (!MONGO_URI || !MongoClient) { console.log('Pas de MongoDB — mode fichier local'); loadFromFile(); return; }
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db          = client.db('arena');
    colAthletes = db.collection('athletes');
    colScores   = db.collection('scores');
    colConfig   = db.collection('config');
    console.log('MongoDB connecté');
    await loadFromMongo();
    await loadAccounts();
    await loadTeams();
    await loadSuggestions();
  } catch(e) {
    console.error('MongoDB erreur:', e.message);
    loadFromFile();
  }
}

// Charger depuis MongoDB
async function loadFromMongo() {
  athletes     = await colAthletes.find({}).toArray();
  const sc     = await colScores.find({}).toArray();
  scores       = {};
  globalScores = [];
  sc.forEach(s => { scores[s.athleteId] = s.scores || []; });
  const cfg    = await colConfig.findOne({ key: 'main' }) || {};
  musicConfig  = cfg.musicConfig  || { url: '', title: '' };
  welcomeImage = cfg.welcomeImage || { url: '' };
  popupConfig  = cfg.popupConfig   || { active: false, title: '', message: '', emoji: '🏆', color: '#d4ff00' };
  rebuildGlobalScores();
  const totalScoreEntries=Object.values(scores).reduce((s,arr)=>s+arr.length,0);
  console.log(` ${athletes.length} sportif(s) chargé(s) depuis MongoDB`);
  console.log(` ${totalScoreEntries} score(s) chargé(s) depuis MongoDB`);
}

// Sauvegarder dans MongoDB (ou fichier en fallback)
async function saveData() {
  if (!db) { saveToFile(); return; }
  try {
    const currentIds = athletes.map(a => a.id);
    // Upsert tous les athlètes en mémoire
    for (const a of athletes) {
      await colAthletes.updateOne({ id: a.id }, { $set: a }, { upsert: true });
    }
    // Supprimer de MongoDB les athlètes qui ne sont plus en mémoire
    await colAthletes.deleteMany({ id: { $nin: currentIds } });
    // Config
    await colConfig.updateOne({ key: 'main' }, { $set: { key:'main', musicConfig, welcomeImage } }, { upsert: true });
  } catch(e) { console.error('Erreur saveData MongoDB:', e.message); }
}

async function saveScore(athleteId, pseudo, score) {
  if (!db) { saveToFile(); return; }
  try {
    await colScores.updateOne(
      { athleteId },
      { $push: { scores: { pseudo, score, date: new Date() } } },
      { upsert: true }
    );
  } catch(e) { console.error('Erreur saveScore:', e.message); }
}

// Fallback fichier local
const DATA_FILE = path.join(__dirname, 'data.json');
function loadFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      athletes     = d.athletes     || [];
      scores       = d.scores       || {};
      globalScores = d.globalScores || [];
      musicConfig  = d.musicConfig  || { url: '', title: '' };
      welcomeImage = d.welcomeImage || { url: '' };
      console.log(` ${athletes.length} sportif(s) chargé(s) depuis fichier`);
    }
  } catch(e) { console.error('Erreur lecture fichier:', e.message); }
}
function saveToFile() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ athletes, scores, globalScores, musicConfig, welcomeImage }, null, 2)); }
  catch(e) { console.error('Erreur écriture fichier:', e.message); }
}
const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ── CURLING — duels asynchrones tour par tour (stockage isolé) ─────────────
let colCurling;
let curlingMatches = [];   // [{id, red, yellow, turn, state, status, createdAt, updatedAt}]
const CURLING_FILE = path.join(__dirname, 'curling.json');

async function connectCurling() {
  if (db) {
    try {
      colCurling = db.collection('curling_matches');
      curlingMatches = await colCurling.find({}).toArray();
      console.log(` ${curlingMatches.length} duel(s) Curling chargé(s) depuis MongoDB`);
      return;
    } catch(e) { console.error('Curling Mongo erreur:', e.message); }
  }
  try {
    if (fs.existsSync(CURLING_FILE)) {
      curlingMatches = JSON.parse(fs.readFileSync(CURLING_FILE, 'utf8')).matches || [];
      console.log(` ${curlingMatches.length} duel(s) Curling chargé(s) depuis fichier`);
    }
  } catch(e) { console.error('Erreur lecture curling.json:', e.message); }
}
async function saveCurling() {
  if (!db || !colCurling) {
    try { fs.writeFileSync(CURLING_FILE, JSON.stringify({ matches: curlingMatches }, null, 2)); }
    catch(e) { console.error('Erreur écriture curling.json:', e.message); }
    return;
  }
  try {
    const ids = curlingMatches.map(m => m.id);
    for (const m of curlingMatches) await colCurling.updateOne({ id: m.id }, { $set: m }, { upsert: true });
    await colCurling.deleteMany({ id: { $nin: ids } });
  } catch(e) { console.error('Erreur saveCurling:', e.message); }
}

// ── FORMULA·GRID — stockage isolé (ne touche jamais athletes/scores) ───────
let colCircuits, colCircuitRuns;
let circuits    = [];   // [{id,name,w,h,rows:[string],start:{x,y,dir},laps,attempts,published,createdAt}]
let circuitRuns = {};   // { [circuitId]: [{pseudo,moves,left,laps,date}] }
const FORMULA_FILE = path.join(__dirname, 'formula.json');

async function connectFormula() {
  if (db) {
    try {
      colCircuits    = db.collection('fg_circuits');
      colCircuitRuns = db.collection('fg_runs');
      circuits = await colCircuits.find({}).toArray();
      const runsArr = await colCircuitRuns.find({}).toArray();
      circuitRuns = {};
      runsArr.forEach(r => { circuitRuns[r.circuitId] = r.runs || []; });
      console.log(` ${circuits.length} circuit(s) Formula·Grid chargé(s) depuis MongoDB`);
      return;
    } catch(e) { console.error('Formula·Grid Mongo erreur:', e.message); }
  }
  loadFormulaFromFile();
}
function loadFormulaFromFile() {
  try {
    if (fs.existsSync(FORMULA_FILE)) {
      const d = JSON.parse(fs.readFileSync(FORMULA_FILE, 'utf8'));
      circuits    = d.circuits    || [];
      circuitRuns = d.circuitRuns || {};
      console.log(` ${circuits.length} circuit(s) Formula·Grid chargé(s) depuis fichier`);
    }
  } catch(e) { console.error('Erreur lecture formula.json:', e.message); }
}
function saveFormulaToFile() {
  try { fs.writeFileSync(FORMULA_FILE, JSON.stringify({ circuits, circuitRuns }, null, 2)); }
  catch(e) { console.error('Erreur écriture formula.json:', e.message); }
}
async function saveCircuits() {
  if (!db || !colCircuits) { saveFormulaToFile(); return; }
  try {
    const ids = circuits.map(c => c.id);
    for (const c of circuits) await colCircuits.updateOne({ id: c.id }, { $set: c }, { upsert: true });
    await colCircuits.deleteMany({ id: { $nin: ids } });
  } catch(e) { console.error('Erreur saveCircuits:', e.message); }
}
async function saveCircuitRuns(circuitId) {
  if (!db || !colCircuitRuns) { saveFormulaToFile(); return; }
  try {
    await colCircuitRuns.updateOne(
      { circuitId },
      { $set: { circuitId, runs: circuitRuns[circuitId] || [] } },
      { upsert: true }
    );
  } catch(e) { console.error('Erreur saveCircuitRuns:', e.message); }
}
function circuitPublicMeta(c) {
  return { id: c.id, name: c.name, w: c.w, h: c.h, laps: c.laps, attempts: c.attempts, warmup: c.warmup||0, pointsMultiplier: Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10, fuelCapacity: c.fuelCapacity||0, fuelEnabled: c.fuelEnabled !== false, undoEnabled: c.undoEnabled === true, handbrakeUses: Number.isFinite(parseInt(c.handbrakeUses)) ? parseInt(c.handbrakeUses) : 1, mode: c.mode === 'dakar' ? 'dakar' : 'rallye', targetMoves: c.targetMoves || 0, medals: c.medals || null, diceSeed: c.diceSeed || null };
}
function bestRun(runs) {
  const valid = (runs || []).filter(r => !r.crashed && Number.isFinite(r.moves));
  if (!valid.length) return null;
  return valid.reduce((best, r) => {
    if (!best) return r;
    if (r.moves < best.moves) return r;
    if (r.moves === best.moves && r.left > best.left) return r;
    return best;
  }, null);
}
// Points au classement général : calculés EN DIRECT, jamais figés.
// 1er = N×10, 2e = (N-1)×10 ... où N = nombre de joueurs distincts sur ce circuit.
// Se recalcule entièrement à chaque appel — donc à chaque nouveau joueur, tout le monde est réévalué.
function circuitRanking(circuitId) {
  const runs = (circuitRuns[circuitId] || []).filter(r => !r.crashed && Number.isFinite(r.moves));
  const bestPerPseudo = {};
  for (const r of runs) {
    const k = norm(r.pseudo);
    if (!bestPerPseudo[k] || r.moves < bestPerPseudo[k].moves || (r.moves === bestPerPseudo[k].moves && r.left > bestPerPseudo[k].left))
      bestPerPseudo[k] = r;
  }
  return Object.values(bestPerPseudo).sort((a,b) => a.moves - b.moves || b.left - a.left);
}
function formulaGridPointsByPseudo() {
  const totals = {};
  for (const c of circuits) {
    if (!c.published) continue; // circuits brouillon/test : classement local uniquement, aucun impact global
    const ranked = circuitRanking(c.id);
    const N = ranked.length;
    const mult = Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10;
    ranked.forEach((r, i) => {
      const points = (N - i) * mult;
      const k = norm(r.pseudo);
      if (!totals[k]) totals[k] = { pseudo: r.pseudo, score: 0, date: r.date };
      totals[k].score += points;
      if (r.date > totals[k].date) totals[k].date = r.date;
    });
  }
  return totals;
}

// Levenshtein global
function lev(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
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

    // Dédupliquer : garder uniquement le MEILLEUR score par pseudo pour ce jeu
    const bestPerPseudo = {};
    for (const entry of list) {
      const key = norm(entry.pseudo);
      if (!bestPerPseudo[key] || entry.score > bestPerPseudo[key].score) {
        bestPerPseudo[key] = entry;
      }
    }

    for (const entry of Object.values(bestPerPseudo)) {
      const key = norm(entry.pseudo);
      if (!map[key]) map[key] = { pseudo: entry.pseudo, totalScore: 0, count: 0, lastDate: entry.date };
      map[key].totalScore += entry.score * coeff;
      map[key].count++;
      if (entry.date > map[key].lastDate) map[key].lastDate = entry.date;
    }
  }
  // Formula·Grid EXCLU du classement général Arena Sport : son classement
  // propre reste consultable dans le jeu, mais ne s'ajoute plus au total tous jeux.
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
    base.imageIndication = athlete.imageIndication||'';
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
    // repliqueAnswer NON transmis (vérif via /api/replique-check)
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    // repliqueAuthor NON transmis (vérif via /api/replique-author-check) —
    // avant, l'auteur de la citation était lisible en clair dans la page.
    base.answer          = '';
    base.maxScore = 100;
  } else if (athlete.type === 'assaut') {
    base.phase1 = (athlete.phase1||[]).map(q=>({q:q.q||'',a:q.a||'',w:q.w||'',p:q.p||''}));
    base.phase2 = {q:athlete.phase2?.q||'',touche:athlete.phase2?.touche||'',neutre:athlete.phase2?.neutre||'',piege:athlete.phase2?.piege||''};
    base.maxScore=100;
  } else if (athlete.type === 'tirarlarc') {
    base.cibles = (athlete.cibles||[]).map(c=>({stat:c.stat||'',value:c.value!==undefined&&c.value!==null?Number(c.value):0,max:c.max!==undefined&&c.max!==null?Number(c.max):100,tol11:c.tol11||null,tol22:c.tol22||null,tol33:c.tol33||null}));
    base.arcTolerances = athlete.arcTolerances||{facile:20,moyen:8,difficile:3};
    base.maxScore = 100;
  } else if (athlete.type === 'nagesync') {
    base.couloirs = (athlete.couloirs||[]).map(c=>({label:c.label||''}));
    base.sportifs = (athlete.sportifs||[]).map(s=>({nom:s.nom||'',correct:s.correct!==undefined?s.correct:0}));
    base.maxScore = 100;
  } else if (athlete.type === 'var') {
    base.varText  = athlete.varText || '';
    base.varWrong = athlete.varWrong || '';
    base.varChips = athlete.varChips || [];
    base.maxScore = 100;
  } else if (athlete.type === 'rvlf') {
    // Send questions without revealing correct answer
    base.rvlfQuestions = (athlete.rvlfQuestions||[]).map(q=>({q:q.q||'',a:q.a||'',w:q.w||''}));
    base.rvlfNoTimer = !!athlete.rvlfNoTimer;
    base.maxScore = 200;
  } else if (athlete.type === 'plongee') {
    base.plongeePaliers = (athlete.plongeePaliers||[]).map(p=>({
      qDown:p.qDown||'',aDown:p.aDown||'',
      qUp:p.qUp||'',aUp:p.aUp||'',
      tresor:p.tresor||0
    }));
    base.plongeeO2Base = athlete.plongeeO2Base||8;
    base.plongeeTol = athlete.plongeeTol||1;
    base.plongeeO2Treasure = athlete.plongeeO2Treasure||2;
    base.plongeeO2Error = athlete.plongeeO2Error||2;
    base.maxScore = 200;
  } else if (athlete.type === 'escalade') {
    base.escaladeQuestions = (athlete.escaladeQuestions||[]).map(q=>({
      qFacile:q.qFacile||'',aFacile:q.aFacile||'',
      qDifficile:q.qDifficile||'',aDifficile:q.aDifficile||'',
      nbRequired:q.nbRequired||1
    }));
    base.escaladeTheme = athlete.escaladeTheme||'';
    base.escaladeTol = athlete.escaladeTol||1;
    base.maxScore = 200;
  } else if (athlete.type === 'saut') {
    // Le mot n'est PLUS transmis (vérif via /api/saut-check) — sinon n'importe qui
    // pouvait lire les 5 réponses en clair avant de jouer.
    base.sautWords = (athlete.sautWords||[]).map(w=>({
      indices:Array.isArray(w.indices)?w.indices.slice(0,3):['','','']
    }));
    base.sautTheme = athlete.sautTheme||'';
    base.sautTol = athlete.sautTol!=null?athlete.sautTol:1;
    base.sautTimer = athlete.sautTimer!=null?athlete.sautTimer:20;
    base.sautPenalty = athlete.sautPenalty!=null?athlete.sautPenalty:2;
    base.maxScore = 100;   // 5 barres × 20 pts max chacune
  } else if (athlete.type === 'roulette') {
    base.rouletteText = athlete.rouletteText||'';
    // rouletteAnswer volontairement NON transmis (vérif via /api/roulette-check)
    base.rouletteHint = athlete.rouletteHint||'';
    base.roulettePct = athlete.roulettePct||40;
    base.rouletteChambers = athlete.rouletteChambers||6;
    base.rouletteBullet = athlete.rouletteBullet||4;
    base.rouletteTol = athlete.rouletteTol||1;
    base.rouletteRevealStep = athlete.rouletteRevealStep||5;
    base.rouletteSeed = athlete.rouletteSeed||0;
    base.maxScore = 100;
  } else if (athlete.type === 'bowling') {
    base.bowlingQuestions = (athlete.bowlingQuestions||[]).map(q=>({question:q.question||'',answer:q.answer||0,multiplier:q.multiplier||1}));
    base.maxScore = 300;
  } else if (athlete.type === 'badminton') {
    base.badmintonQuestions = (athlete.badmintonQuestions||[]).map(q=>({
      question:q.question||'', theme:q.theme||'', a:q.a||'', b:q.b||'', c:q.c||'', correct:q.correct!=null?parseInt(q.correct):0
    }));
    base.badTheme = athlete.badTheme||'Badminton Quiz';
    base.maxScore = 300;
  } else if (athlete.type === 'trivpursuit') {
    base.trivThemes = (athlete.trivThemes||[]).slice(0,6).map(t=>({
      name:t.name||'Thème', color:t.color||'#888888',
      question:t.question||'', answer:t.answer||'', tol:parseInt(t.tol)||1
    }));
    base.trivQuestions = (athlete.trivQuestions||[]).slice(0,6).map(q=>({
      question:q.question||'', answer:q.answer||'', tol:parseInt(q.tol)||1, sectionIdx:parseInt(q.sectionIdx)||0, theme:q.theme||''
    }));
    base.maxScore = 300;
  } else if (athlete.type === 'melimelo') {
    base.meliWords = (athlete.meliWords||[]).slice(0,5).map(w=>({
      scrambled:(w.scrambled||'').toUpperCase().trim(),
      answer:(w.answer||'').toUpperCase().trim(),
      indice:w.indice||''
    }));
    base.meliTimer = athlete.meliTimer||60;
    base.maxScore = 100;
  } else if (athlete.type === 'apol') {
    // IMPORTANT : jamais de réponse envoyée avant que le joueur ait répondu —
    // sinon n'importe qui peut lire les bonnes réponses via /api/athlete avant de jouer.
    base.apolQuestions = (athlete.apolQuestions||[]).slice(0,5).map(q=>({
      question:q.question||'', theme:q.theme||'', tol:parseInt(q.tol)||1
    }));
    base.bonusQ = athlete.bonusQ||'';
    base.apolBoxItems = [
      {label:'+10 pts',value:10,type:'add',prob:25},
      {label:'−10 pts',value:-10,type:'add',prob:25},
      {label:'+20 pts',value:20,type:'add',prob:15},
      {label:'−20 pts',value:-20,type:'add',prob:15},
      {label:'×2',value:2,type:'mult',prob:10},
      {label:'÷2',value:0.5,type:'mult',prob:10}
    ];
    base.maxScore = 200; // 5x20 + double possible
  } else if (athlete.type === 'equitation') {
    base.equiObstacles = (athlete.equiObstacles||[]).map(o=>({...o}));
    base.equiTimeLimit = athlete.equiTimeLimit||60;
    base.maxScore = 200;
  } else if (athlete.type === 'haltero') {
    const ar = athlete.halteroArache || {};
    const ej = athlete.halteroEpaule || {};
    base.halteroArache = {
      sportif1:  ar.sportif1  || '',
      sportif2:  ar.sportif2  || '',
      questions: (ar.questions||[]).map(q=>({criterion:q.criterion||'',answer:q.answer||'s1'}))
    };
    base.halteroEpaule = {
      theme:     ej.theme     || '',
      questions: (ej.questions||[]).map(q=>({question:q.question||'',answer:q.answer||'',wrong:q.wrong||[]})),
      jete: {
        question: ej.jete?.question || '',
        answer:   ej.jete?.answer   || '',
        wrong:    ej.jete?.wrong    || []
      }
    };
    base.maxScore = 200;
  } else if (athlete.type === 'assaut') {
    base.phase1 = (athlete.phase1||[]).map(q=>({q:q.q||'',a:q.a||'',w:q.w||'',p:q.p||''}));
    base.phase2 = {q:athlete.phase2?.q||'',touche:athlete.phase2?.touche||'',neutre:athlete.phase2?.neutre||'',piege:athlete.phase2?.piege||''};
    base.maxScore=100;
  } else if (athlete.type === 'tirarlarc') {
    base.cibles = (athlete.cibles||[]).map(c=>({
      stat:c.stat||'',
      value:c.value!==undefined&&c.value!==null?Number(c.value):0,
      max:c.max!==undefined&&c.max!==null?Number(c.max):100,
      tol11:c.tol11||null, tol22:c.tol22||null, tol33:c.tol33||null
    }));
    base.arcTolerances = athlete.arcTolerances||{facile:20,moyen:8,difficile:3};
    base.maxScore = 100;
  } else if (athlete.type === 'nagesync') {
    base.couloirs = (athlete.couloirs||[]).map(c=>({label:c.label||''}));
    base.sportifs = (athlete.sportifs||[]).map(s=>({nom:s.nom||'',correct:parseInt(s.correct)||0}));
    base.maxScore = 100;
  } else if (athlete.type === 'maillonfaible') {
    base.mfQuestions = (athlete.mfQuestions||[]).map(q=>({question:q.question,answer:q.answer,wrong:q.wrong||[]}));
    base.maxScore = 100;
  } else if (athlete.type === 'biathlon') {
    base.biatTheme         = athlete.biatTheme || '';
    base.biatAnnounceTime  = athlete.biatAnnounceTime || 45;
    base.biatSprintAnswers = (athlete.biatSprintAnswers||[]).length;
    base.biatQCM           = (athlete.biatQCM||[]).map(q=>({question:q.question,answer:q.answer,wrong:q.wrong||[]}));
    base.biatOrderQuestion = athlete.biatOrderQuestion || '';
    base.biatOrder         = athlete.biatOrder || [];
    base.maxScore = 200;
    console.log(`[BIATHLON] QCM:${base.biatQCM.length} Sprint:${base.biatSprintAnswers} Order:${base.biatOrder.length}`);
  } else if (athlete.type === 'grimpe') {
    base.grimpeTheme   = athlete.grimpeTheme || '';
    base.clue          = athlete.grimpeTheme || athlete.clue || '';
    base.grimpeAnswers = (athlete.grimpeAnswers || []).length;
    base.grimpeParams  = athlete.grimpeParams || {};
    base.maxScore = 100;
  } else if (athlete.type === 'blackjack') {
    base.bjTheme   = athlete.bjTheme || '';
    base.bjTarget  = athlete.bjTarget || 50;
    // Seuls les NOMS des cartes sont transmis : les valeurs étaient lisibles
    // dans la page (masquées par opacity:0 seulement) → combinaison parfaite triviale.
    base.bjNames = Object.keys(athlete.bjAnswers || {});
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
app.get('/api/grimpe-reveal', (req, res) => {
  const { athleteId } = req.query;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'grimpe') return res.status(404).json({ error: 'Introuvable' });
  const allGroups = (athlete.grimpeAnswersFull||[]).length
    ? athlete.grimpeAnswersFull
    : (athlete.grimpeAnswers||[]).map(a=>[a]);
  // Return canonical answer (first item of each group)
  res.json({ answers: allGroups.map(g=>g[0]) });
});

// -- LA VAR -------------------------------------------------------------------
app.post('/api/var-check', (req, res) => {
  const { athleteId, phase, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'var') return res.status(404).json({ error: 'Introuvable' });
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const lev = (a,b) => {
    const m=a.length,n=b.length;
    const d=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=a[i-1]===b[j-1]?d[i-1][j-1]:1+Math.min(d[i-1][j],d[i][j-1],d[i-1][j-1]);
    return d[m][n];
  };
  const tol = athlete.varTol ?? 1;
  if (phase === 'identify') {
    const clickedNorm = norm(answer);
    const wrongNorm = norm(athlete.varWrong);
    if(!wrongNorm) return res.json({ ok: false });
    // Exact match OR clicked segment contains wrong (only if wrong is 3+ chars)
    const ok = clickedNorm === wrongNorm ||
      (wrongNorm.length >= 3 && clickedNorm.includes(wrongNorm));
    res.json({ ok });
  } else if (phase === 'correct') {
    const ansNorm = norm(answer);
    // Support multiple correct answers separated by ;
    const corrects = (athlete.varCorrect||'').split(';').map(s=>norm(s)).filter(Boolean);
    const ok = corrects.some(c => lev(ansNorm, c) <= tol);
    const canonical = ok ? athlete.varCorrect.split(';')[0].trim() : null;
    res.json({ ok, correct: canonical });
  } else {
    res.status(400).json({ error: 'Phase invalide' });
  }
});

app.post('/api/grimpe-check', (req, res) => {
  const { athleteId, answer, found } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const allGroups = (athlete.grimpeAnswersFull||[]).length
    ? athlete.grimpeAnswersFull
    : (athlete.grimpeAnswers||[]).map(a=>[a]);
  // Dynamic tolerance: 1 for short answers, 2 for longer
  const tol = normAns.length <= 5 ? 1 : 2;
  const matches = (a) => {
    const na = norm(a);
    if(lev(na, normAns) <= tol) return true;
    // Split BEFORE normalizing to get individual words
    const words = a.split(/[\s\-]+/).map(norm).filter(w=>w.length>=3);
    return words.some(w => lev(w, normAns) <= 1);
  };
  const correct = allGroups.some(group => group.some(a => matches(a)));
  const matchedGroup = correct ? allGroups.find(group => group.some(a => matches(a))) : null;
  // Le doublon se juge sur le GROUPE canonique retrouvé, pas sur la saisie brute :
  // sinon retaper un morceau ("Pantani") d'une réponse déjà validée ("Marco Pantani")
  // passerait à travers le filtre exact et compterait comme une nouvelle bonne réponse.
  const alreadyFound = (found||[]).map(norm);
  if (correct && alreadyFound.includes(norm(matchedGroup[0]))) {
    return res.json({ correct: false, reason: 'already' });
  }
  if (!correct && alreadyFound.includes(normAns)) {
    return res.json({ correct: false, reason: 'already' });
  }
  res.json({ correct, total: (athlete.grimpeAnswers||[]).length, answer: matchedGroup?matchedGroup[0]:null });
});

// APOL — vérifie une réponse SANS jamais exposer les autres réponses au client
app.post('/api/apol-check', (req, res) => {
  const { athleteId, qIdx, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'apol') return res.status(404).json({ error: 'Défi introuvable' });
  const qs = athlete.apolQuestions || [];
  const q = qs[qIdx];
  if (!q) return res.status(400).json({ error: 'Question invalide' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const tol = q.tol != null ? parseInt(q.tol) : 1;
  const correct = lev(norm(answer), norm(q.answer)) <= tol;
  res.json({ correct, answer: q.answer || '' });
});

// APOL — dilemme final (double ou rien) : même principe, jamais exposé avant réponse
app.post('/api/apol-bonus-check', (req, res) => {
  const { athleteId, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'apol') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const correct = lev(norm(answer), norm(athlete.bonusA)) <= 1;
  res.json({ correct, answer: athlete.bonusA || '' });
});

// ROULETTE — vérifie la réponse côté serveur, sans jamais l'exposer à l'avance
app.post('/api/roulette-check', (req, res) => {
  const { athleteId, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'roulette') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const tol = athlete.rouletteTol || 1;
  const target = athlete.rouletteAnswer || '';
  const ansNorm = norm(answer), targetNorm = norm(target);
  const correct = lev(ansNorm, targetNorm) <= tol ||
    String(target).split(' ').some(w => w.length >= 3 && lev(norm(w), ansNorm) <= 1);
  // La réponse n'est renvoyée QUE si elle est trouvée, ou en fin de partie (reveal)
  res.json({ correct, answer: (correct || req.body.reveal) ? target : null });
});

// RÉPLIQUE — vérification serveur (saisie libre ou QCM), réponse jamais exposée avant
app.post('/api/replique-check', (req, res) => {
  const { athleteId, answer, tol } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'replique') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const target = athlete.repliqueAnswer || '';
  const t = parseInt(tol);
  const tolerance = Number.isFinite(t) ? t : 1;
  const nv = norm(answer), na = norm(target);
  const correct = tolerance === 0
    ? (nv === na || na.split(/\s+/).some(p => nv === p))
    : (lev(nv, na) <= tolerance || na.split(/\s+/).some(p => p.length >= 3 && lev(p, nv) <= 1));
  // La bonne réponse est révélée APRÈS la tentative (le jeu l'affiche de toute façon)
  res.json({ correct, answer: target });
});

// RÉPLIQUE — propositions du QCM construites côté serveur : la bonne réponse est
// mélangée aux leurres, mais rien n'indique laquelle l'est.
app.get('/api/replique-options', (req, res) => {
  const athlete = athletes.find(a => String(a.id) === String(req.query.athleteId));
  if (!athlete || athlete.type !== 'replique') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const answer = athlete.repliqueAnswer || '';
  const count = req.query.mode === 'duo' ? 1 : 3;
  const pool = (athlete.repliqueChoices || []).filter(c => norm(c) !== norm(answer));
  const options = [answer, ...pool.slice(0, count)].sort(() => Math.random() - 0.5);
  res.json({ options });
});

// BLACKJACK — valeur d'une carte, révélée UNIQUEMENT au moment où le joueur la retourne
app.post('/api/bj-value', (req, res) => {
  const { athleteId, name } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'blackjack') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const entry = Object.entries(athlete.bjAnswers || {}).find(([k]) => norm(k) === norm(name));
  if (!entry) return res.status(404).json({ error: 'Carte inconnue' });
  res.json({ name: entry[0], value: +entry[1] });
});

// LE SAUT EN HAUTEUR — vérifie un mot sans jamais l'exposer à l'avance
app.post('/api/saut-check', (req, res) => {
  const { athleteId, level, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'saut') return res.status(404).json({ error: 'Défi introuvable' });
  const words = athlete.sautWords || [];
  const w = words[level];
  if (!w) return res.status(400).json({ error: 'Palier invalide' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  function lev(a,b){
    const m=a.length,n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
    for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }
  const tol = athlete.sautTol!=null ? parseInt(athlete.sautTol) : 1;
  const correct = lev(norm(answer), norm(w.mot)) <= tol;
  // Le mot n'est révélé QUE si trouvé, ou explicitement demandé (fin de partie / élimination)
  res.json({ correct, mot: (correct || req.body.reveal) ? w.mot : null });
});

// RÉPLIQUE — phase 2 (auteur) : vérification serveur, jamais exposée à l'avance
app.post('/api/replique-author-check', (req, res) => {
  const { athleteId, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'replique') return res.status(404).json({ error: 'Défi introuvable' });
  const norm = s => (s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,'');
  // Réplique exacte de matchesAuthor côté client : pas de tolérance, prénom OU nom accepté
  const target = athlete.repliqueAuthor || athlete.answer || '';
  const nv = norm(answer), na = norm(target);
  const correct = nv === na || na.split(' ').filter(Boolean).some(p => nv === p);
  res.json({ correct, answer: target });
});

// RÉPLIQUE — options du duo auteur : la bonne réponse mélangée à un leurre,
// sans jamais indiquer laquelle l'est (le bouton affichait le nom en clair avant).
app.get('/api/replique-author-options', (req, res) => {
  const athlete = athletes.find(a => String(a.id) === String(req.query.athleteId));
  if (!athlete || athlete.type !== 'replique') return res.status(404).json({ error: 'Défi introuvable' });
  const target = athlete.repliqueAuthor || athlete.answer || '';
  const wrong = (athlete.repliqueAuthorChoices || [])[0] || '?';
  const options = [target, wrong].sort(() => Math.random() - 0.5);
  res.json({ options });
});

// EPO — révèle une réponse non encore trouvée
app.post('/api/grimpe-epo', (req, res) => {
  const { athleteId, found } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if(!athlete) return res.status(404).json({ error: 'Joueur introuvable' });
  athlete.grimpeGel = Date.now();
  res.json({ ok: true });
});

// Le joueur poll ce endpoint pour savoir si gel activé
app.get('/api/grimpe-gel', (req, res) => {
  const { athleteId } = req.query;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
    // Manquait ici (présent seulement dans /api/preview) : l'indice saisi en admin
    // n'atteignait donc jamais le joueur en vrai jeu.
    base.imageIndication = athlete.imageIndication||'';
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
    // repliqueAnswer NON transmis (vérif via /api/replique-check)
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    // repliqueAuthor NON transmis (vérif via /api/replique-author-check) —
    // avant, l'auteur de la citation était lisible en clair dans la page.
    base.answer          = '';
    base.maxScore = 100;
  } else if (athlete.type === 'biathlon') {
    base.biatTheme         = athlete.biatTheme || '';
    base.biatSprintAnswers = (athlete.biatSprintAnswers||[]).length;
    base.biatQCM           = (athlete.biatQCM||[]).map(q=>({question:q.question,answer:q.answer,wrong:q.wrong||[]}));
    base.biatOrderQuestion = athlete.biatOrderQuestion || '';
    base.biatOrder         = athlete.biatOrder || [];
    base.maxScore = 200;
    console.log(`[BIATHLON-ATHLETE] QCM:${base.biatQCM.length} Sprint:${(athlete.biatSprintAnswers||[]).length} Order:${base.biatOrder.length}`);
  } else if (athlete.type === 'var') {
    base.varText  = athlete.varText || '';
    base.varWrong = athlete.varWrong || '';
    base.varChips = athlete.varChips || [];
    base.maxScore = 100;
  } else if (athlete.type === 'rvlf') {
    base.rvlfQuestions = (athlete.rvlfQuestions||[]).map(q=>({q:q.q||'',a:q.a||'',w:q.w||''}));
    base.rvlfNoTimer = !!athlete.rvlfNoTimer;
    base.maxScore = 200;
  } else if (athlete.type === 'plongee') {
    base.plongeePaliers = (athlete.plongeePaliers||[]).map(p=>({
      qDown:p.qDown||'',aDown:p.aDown||'',
      qUp:p.qUp||'',aUp:p.aUp||'',
      tresor:p.tresor||0
    }));
    base.plongeeO2Base = athlete.plongeeO2Base||8;
    base.plongeeTol = athlete.plongeeTol||1;
    base.plongeeO2Treasure = athlete.plongeeO2Treasure||2;
    base.plongeeO2Error = athlete.plongeeO2Error||2;
    base.maxScore = 200;
  } else if (athlete.type === 'escalade') {
    base.escaladeQuestions = (athlete.escaladeQuestions||[]).map(q=>({
      qFacile:q.qFacile||'',aFacile:q.aFacile||'',
      qDifficile:q.qDifficile||'',aDifficile:q.aDifficile||'',
      nbRequired:q.nbRequired||1
    }));
    base.escaladeTheme = athlete.escaladeTheme||'';
    base.maxScore = 200;
  } else if (athlete.type === 'saut') {
    // Le mot n'est PLUS transmis (vérif via /api/saut-check) — sinon n'importe qui
    // pouvait lire les 5 réponses en clair avant de jouer.
    base.sautWords = (athlete.sautWords||[]).map(w=>({
      indices:Array.isArray(w.indices)?w.indices.slice(0,3):['','','']
    }));
    base.sautTheme = athlete.sautTheme||'';
    base.sautTol = athlete.sautTol!=null?athlete.sautTol:1;
    base.sautTimer = athlete.sautTimer!=null?athlete.sautTimer:20;
    base.sautPenalty = athlete.sautPenalty!=null?athlete.sautPenalty:2;
    base.maxScore = 100;   // 5 barres × 20 pts max chacune
  } else if (athlete.type === 'roulette') {
    base.rouletteText = athlete.rouletteText||'';
    // rouletteAnswer volontairement NON transmis (vérif via /api/roulette-check)
    base.rouletteHint = athlete.rouletteHint||'';
    base.roulettePct = athlete.roulettePct||40;
    base.rouletteChambers = athlete.rouletteChambers||6;
    base.rouletteBullet = athlete.rouletteBullet||4;
    base.rouletteTol = athlete.rouletteTol||1;
    base.rouletteRevealStep = athlete.rouletteRevealStep||5;
    base.rouletteSeed = athlete.rouletteSeed||0;
    base.maxScore = 100;
  } else if (athlete.type === 'bowling') {
    base.bowlingQuestions = (athlete.bowlingQuestions||[]).map(q=>({question:q.question||'',answer:q.answer||0,multiplier:q.multiplier||1}));
    base.maxScore = 300;
  } else if (athlete.type === 'badminton') {
    base.badmintonQuestions = (athlete.badmintonQuestions||[]).map(q=>({
      question:q.question||'', theme:q.theme||'', a:q.a||'', b:q.b||'', c:q.c||'', correct:q.correct!=null?parseInt(q.correct):0
    }));
    base.badTheme = athlete.badTheme||'Badminton Quiz';
    base.maxScore = 300;
  } else if (athlete.type === 'trivpursuit') {
    base.trivThemes = (athlete.trivThemes||[]).slice(0,6).map(t=>({
      name:t.name||'Thème', color:t.color||'#888888',
      question:t.question||'', answer:t.answer||'', tol:parseInt(t.tol)||1
    }));
    base.trivQuestions = (athlete.trivQuestions||[]).slice(0,6).map(q=>({
      question:q.question||'', answer:q.answer||'', tol:parseInt(q.tol)||1, sectionIdx:parseInt(q.sectionIdx)||0, theme:q.theme||''
    }));
    base.maxScore = 300;
  } else if (athlete.type === 'melimelo') {
    base.meliWords = (athlete.meliWords||[]).slice(0,5).map(w=>({
      scrambled:(w.scrambled||'').toUpperCase().trim(),
      answer:(w.answer||'').toUpperCase().trim(),
      indice:w.indice||''
    }));
    base.meliTimer = athlete.meliTimer||60;
    base.maxScore = 100;
  } else if (athlete.type === 'apol') {
    // IMPORTANT : jamais de réponse envoyée avant que le joueur ait répondu —
    // sinon n'importe qui peut lire les bonnes réponses via /api/athlete avant de jouer.
    base.apolQuestions = (athlete.apolQuestions||[]).slice(0,5).map(q=>({
      question:q.question||'', theme:q.theme||'', tol:parseInt(q.tol)||1
    }));
    base.bonusQ = athlete.bonusQ||'';
    base.apolBoxItems = [
      {label:'+10 pts',value:10,type:'add',prob:25},
      {label:'−10 pts',value:-10,type:'add',prob:25},
      {label:'+20 pts',value:20,type:'add',prob:15},
      {label:'−20 pts',value:-20,type:'add',prob:15},
      {label:'×2',value:2,type:'mult',prob:10},
      {label:'÷2',value:0.5,type:'mult',prob:10}
    ];
    base.maxScore = 200; // 5x20 + double possible
  } else if (athlete.type === 'equitation') {
    base.equiObstacles = (athlete.equiObstacles||[]).map(o=>({...o}));
    base.equiTimeLimit = athlete.equiTimeLimit||60;
    base.maxScore = 200;
  } else if (athlete.type === 'haltero') {
    const ar = athlete.halteroArache || {};
    const ej = athlete.halteroEpaule || {};
    base.halteroArache = {
      sportif1:  ar.sportif1  || '',
      sportif2:  ar.sportif2  || '',
      questions: (ar.questions||[]).map(q=>({criterion:q.criterion||'',answer:q.answer||'s1'}))
    };
    base.halteroEpaule = {
      theme:     ej.theme     || '',
      questions: (ej.questions||[]).map(q=>({question:q.question||'',answer:q.answer||'',wrong:q.wrong||[]})),
      jete: {
        question: ej.jete?.question || '',
        answer:   ej.jete?.answer   || '',
        wrong:    ej.jete?.wrong    || []
      }
    };
    base.maxScore = 200;
  } else if (athlete.type === 'maillonfaible') {
    base.mfQuestions = (athlete.mfQuestions||[]).map(q=>({question:q.question,answer:q.answer,wrong:q.wrong||[]}));
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
    // Seuls les NOMS des cartes sont transmis : les valeurs étaient lisibles
    // dans la page (masquées par opacity:0 seulement) → combinaison parfaite triviale.
    base.bjNames = Object.keys(athlete.bjAnswers || {});
    base.maxScore  = 100;
  } else if (athlete.type === 'tirarlarc') {
    base.cibles = (athlete.cibles||[]).map(c=>({
      stat:c.stat||'',
      value:c.value!==undefined&&c.value!==null?Number(c.value):0,
      max:c.max!==undefined&&c.max!==null?Number(c.max):100,
      tol11:c.tol11||null, tol22:c.tol22||null, tol33:c.tol33||null
    }));
    base.arcTolerances = athlete.arcTolerances||{facile:20,moyen:8,difficile:3};
    base.maxScore = 100;
  } else if (athlete.type === 'nagesync') {
    base.couloirs = (athlete.couloirs||[]).map(c=>({label:c.label||''}));
    base.sportifs = (athlete.sportifs||[]).map(s=>({nom:s.nom||'',correct:s.correct!==undefined?s.correct:0}));
    base.maxScore = 100;
  } else if (athlete.type === 'assaut') {
    base.phase1 = (athlete.phase1||[]).map(q=>({q:q.q||'',a:q.a||'',w:q.w||'',p:q.p||''}));
    base.phase2 = {q:athlete.phase2?.q||'',touche:athlete.phase2?.touche||'',neutre:athlete.phase2?.neutre||'',piege:athlete.phase2?.piege||''};
    base.maxScore = 100;
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete) return res.status(404).json({ error: 'Sportif introuvable' });
  if (hasPlayed(pseudo, athleteId)) return res.status(409).json({ error: 'already_played' });

  const entry = { pseudo: pseudo.trim().slice(0, 20), score: Math.max(0, score), athleteId, athleteName: athlete.answer, date: new Date().toISOString() };
  console.log(`[SCORE] ${entry.pseudo} | ${entry.score}pts | ${athlete.answer} | IP: ${getIP(req)}`);
  if (!scores[athleteId]) scores[athleteId] = [];
  scores[athleteId].push(entry);
  scores[athleteId].sort((a, b) => b.score - a.score);
  rebuildGlobalScores();
  saveData();
  saveScore(athleteId, pseudo.trim().slice(0, 20), Math.max(0, score)); // MongoDB async
  res.json({ success: true, rank: scores[athleteId].indexOf(entry) + 1, total: scores[athleteId].length, answer: athlete.answer });
});

// Scores are only visible if pseudo has finished all games
app.get('/api/scores/global', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  if (!isAdmin && pseudo && !hasFinishedAll(pseudo)) {
    return res.json({ locked: true, played: athletes.filter(a => hasPlayed(pseudo, a.id)).length, total: athletes.length });
  }
  res.json(globalScores.slice(0, 50));
});

// Classement dédié Formula·Grid : agrège les points EN DIRECT de tous les circuits, même règles d'accès que les autres onglets
app.get('/api/scores/formula-grid', (req, res) => {
  const pseudo = (req.query.pseudo || '').trim();
  const isAdmin = req.query.admin === ADMIN_PASSWORD;
  if (!isAdmin && pseudo && !hasFinishedAll(pseudo)) {
    return res.json({ locked: true, athlete: { emoji: '🏁', answer: 'Formula·Grid', type: 'formula' }, scores: [] });
  }
  const totals = formulaGridPointsByPseudo();
  const list = Object.values(totals).sort((a,b) => b.score - a.score).slice(0, 50);
  res.json({ athlete: { emoji: '🏁', answer: 'Formula·Grid', type: 'formula' }, scores: list });
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
  res.json({ athlete: a ? { emoji: a.emoji, answer: a.answer, type: a.type || 'text' } : null, scores: (scores[id] || []).slice(0, 50) });
});

// -- SPORTUS (Motus) ------------------------------------------------------
app.post('/api/sportus-check', (req, res) => {
  const { athleteId, guess } = req.body;
  if (!athleteId || !guess) return res.status(400).json({ error: 'Données manquantes' });
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'demineur') return res.status(404).json({ error: 'Défi introuvable' });
  const item = (athlete.demineurItems || [])[index];
  if (!item) return res.status(404).json({ error: 'Item introuvable' });
  res.json({ isMine: !!item.isMine, fullAnswer: athlete.answer });
});

// -- LA TRAPPE -------------------------------------------------------------
app.post('/api/trappe-check', (req, res) => {
  const { athleteId, questionIndex } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
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
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'prix') return res.status(404).json({ error: 'Défi introuvable' });

  const target    = athlete.targetValue;
  const tolerance = athlete.prixTolerance || 0;
  const seuils    = Array.isArray(athlete.prixSensibilite) ? athlete.prixSensibilite : [0, Infinity, Infinity, Infinity, Infinity];
  const g         = parseFloat(String(guess).replace(',', '.'));
  if (isNaN(g) || g < 0) return res.status(400).json({ error: 'Valeur invalide' });

  const diff      = Math.abs(g - target);
  const exact     = diff <= tolerance;
  const direction = g < target - tolerance ? 'plus' : g > target + tolerance ? 'moins' : 'exact';
  // precision = % for score calc (unchanged), seuils now in raw values
  const precision = exact ? 100 : (Math.min(g, target) / Math.max(g, target)) * 100;

  res.json({ exact, precision, displayPrecision: diff, seuils, direction, target: exact ? target : null, fullAnswer: athlete.answer });
});

// ── FORMULA·GRID — routes ───────────────────────────────────────────────
app.get('/api/formula/circuits', (req, res) => {
  try { res.json(circuits.filter(c => c.published).map(circuitPublicMeta)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/formula/admin/circuits', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  try { res.json(circuits.map(c => ({ ...circuitPublicMeta(c), published: !!c.published }))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/formula/circuit/:id', (req, res) => {
  const c = circuits.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  res.json(c);
});

app.post('/api/formula/circuit', async (req, res) => {
  const { password, id, name, w, h, rows, gradeRows, surfRows, start, laps, attempts, published } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom du circuit obligatoire' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Circuit vide' });
  if (!start || typeof start.x !== 'number' || typeof start.y !== 'number') return res.status(400).json({ error: 'Position de départ manquante' });
  if (!rows.some(r => r.includes('F'))) return res.status(400).json({ error: 'Ligne d\'arrivée manquante' });

  const circuitId = id || 'fg_' + Date.now();
  const existingIdx = circuits.findIndex(c => c.id === circuitId);
  const data = {
    id: circuitId, name: name.trim().slice(0,60), w, h, rows,
    // Dénivelé : calque optionnel, indépendant des lettres de terrain (une
    // case peut être neige ET montée en même temps). Mêmes dimensions que
    // rows exigées, sinon ignoré silencieusement plutôt que de faire planter
    // l'enregistrement pour un champ qui reste secondaire.
    gradeRows: (Array.isArray(gradeRows) && gradeRows.length === rows.length &&
                gradeRows.every((r, i) => r.length === rows[i].length))
      ? gradeRows : null,
    surfRows: (Array.isArray(surfRows) && surfRows.length === rows.length &&
               surfRows.every((r, i) => r.length === rows[i].length))
      ? surfRows : null,
    start: { x: start.x, y: start.y, dir: start.dir||0 },
    laps: Math.max(1, Math.min(20, parseInt(laps)||1)),
    attempts: Math.max(1, Math.min(50, parseInt(attempts)||3)),
    warmup: Math.max(0, Math.min(5, parseInt(req.body.warmup)||0)),
    pointsMultiplier: Math.max(1, Math.min(100, parseInt(req.body.pointsMultiplier)||10)),
    fuelCapacity: Math.max(0, Math.min(9999, parseInt(req.body.fuelCapacity)||0)), // 0 = automatique
    fuelEnabled: req.body.fuelEnabled !== false, // false = essence illimitée
    undoEnabled: req.body.undoEnabled === true,  // retour arrière : 1 coup par essai
    // FREIN À MAIN : nombre d'utilisations par spéciale (0 = désactivé, 1 par défaut)
    handbrakeUses: Math.max(0, Math.min(9, Number.isFinite(parseInt(req.body.handbrakeUses)) ? parseInt(req.body.handbrakeUses) : 1)),
    mode: (req.body.mode === 'dakar') ? 'dakar' : 'rallye',   // seules valeurs valides depuis la suppression du mode F1
    targetMoves: Math.max(0, Math.min(99, parseInt(req.body.targetMoves)||0)), // chrono de référence (coups au parfait)
    medals: (() => {                       // seuils de médailles réglés par l'organisateur
      const m = req.body.medals || {};
      const v = (x, d) => Math.max(1, Math.min(99, parseInt(x) || d));
      const dia = v(m.diamant, 12);
      return { diamant: dia, or: v(m.or, dia+1), argent: v(m.argent, dia+3), bronze: v(m.bronze, dia+6) };
    })(),
    published: !!published,
    // Le fantôme de référence survit à une réédition du circuit
    ghost: existingIdx>=0 ? circuits[existingIdx].ghost : undefined,
    // Graine de la grille de dés : créée au PREMIER enregistrement, puis conservée
    // telle quelle (elle définit les tirages communs à tous les joueurs).
    // Sans elle, la course retombe en hasard pur et l'écran admin reste vide.
    diceSeed: (existingIdx>=0 && circuits[existingIdx].diceSeed)
      ? circuits[existingIdx].diceSeed
      : (req.body.diceSeed || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2,10))),
    createdAt: existingIdx>=0 ? circuits[existingIdx].createdAt : new Date()
  };
  if (existingIdx >= 0) circuits[existingIdx] = data; else circuits.push(data);
  try { await saveCircuits(); res.json({ success: true, id: circuitId }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/formula/circuit/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  circuits = circuits.filter(c => c.id !== req.params.id);
  delete circuitRuns[req.params.id];
  try { await saveCircuits(); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/formula/leaderboard/:id', (req, res) => {
  const c = circuits.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  const runs = circuitRuns[req.params.id] || [];
  const pseudo = (req.query.pseudo || '').trim();
  const mine = pseudo ? runs.filter(r => norm(r.pseudo) === norm(pseudo)) : [];
  const top = runs.filter(r => !r.crashed && Number.isFinite(r.moves))
    .sort((a,b) => a.moves - b.moves || b.left - a.left).slice(0, 10)
    .map(r => ({ pseudo: r.pseudo, moves: r.moves, left: r.left }));
  res.json({
    diceSeed: (c && c.diceSeed) || null,
    top,
    attemptsUsed: mine.length,
    attemptsLeft: Math.max(0, c.attempts - mine.length),
    best: bestRun(mine),
    // Meilleur temps TOUS JOUEURS confondus + ses splits (pour le delta en course)
    worldBest: (() => {
      const wb = bestRun(runs);
      if (!wb) return null;
      return { pseudo: wb.pseudo, moves: wb.moves, left: wb.left||0, cpTimes: wb.cpTimes || [] };
    })()
  });
});

app.post('/api/formula/run', async (req, res) => {
  const { circuitId, pseudo, moves, left, laps, cpTimes } = req.body;
  const c = circuits.find(x => x.id === circuitId);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  const cleanPseudo = (pseudo||'').trim().slice(0,24);
  if (!cleanPseudo) return res.status(400).json({ error: 'Pseudo requis' });
  if (!Number.isFinite(moves) || moves < 1) return res.status(400).json({ error: 'Résultat invalide' });

  circuitRuns[circuitId] = circuitRuns[circuitId] || [];
  const already = circuitRuns[circuitId].filter(r => norm(r.pseudo) === norm(cleanPseudo));
  if (already.length >= c.attempts) return res.status(403).json({ error: 'Plus d\'essais disponibles', attemptsLeft: 0 });

  const run = {
    pseudo: cleanPseudo, moves, left: left||0, laps: laps||c.laps,
    cpTimes: Array.isArray(cpTimes) ? cpTimes.slice(0, 50) : [],
    date: new Date().toISOString()
  };
  circuitRuns[circuitId].push(run);
  try {
    await saveCircuitRuns(circuitId);
    const mine = circuitRuns[circuitId].filter(r => norm(r.pseudo) === norm(cleanPseudo));

    // Classement en direct sur CE circuit (pas figé — se recalcule à chaque nouveau joueur)
    const ranked = circuitRanking(circuitId);
    const N = ranked.length;
    const myRank = ranked.findIndex(r => norm(r.pseudo) === norm(cleanPseudo)) + 1;
    const points = (N - myRank + 1) * (Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10);

    rebuildGlobalScores(); // recalcule aussi le classement général avec les points à jour de TOUS les joueurs
    saveData();

    // Top 10 pour affichage immédiat côté client
    const top = ranked.slice(0, 10).map(r => ({ pseudo: r.pseudo, moves: r.moves, left: r.left }));

    res.json({ success: true, attemptsLeft: Math.max(0, c.attempts - mine.length), best: bestRun(mine), rank: myRank, totalPlayers: N, points, top });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Crash = tentative abandonnée : décompte l'essai côté serveur (sinon rafraîchir = essais infinis)
app.post('/api/formula/crash', async (req, res) => {
  const { circuitId, pseudo } = req.body;
  const c = circuits.find(x => x.id === circuitId);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  const cleanPseudo = (pseudo||'').trim().slice(0,24);
  if (!cleanPseudo) return res.status(400).json({ error: 'Pseudo requis' });

  circuitRuns[circuitId] = circuitRuns[circuitId] || [];
  const already = circuitRuns[circuitId].filter(r => norm(r.pseudo) === norm(cleanPseudo));
  if (already.length >= c.attempts) return res.json({ success: true, attemptsLeft: 0 });

  // On enregistre un essai "abandonné" : compte pour la limite mais jamais classé (moves=null)
  circuitRuns[circuitId].push({ pseudo: cleanPseudo, crashed: true, moves: null, left: 0, laps: 0, date: new Date().toISOString() });
  try {
    await saveCircuitRuns(circuitId);
    const mine = circuitRuns[circuitId].filter(r => norm(r.pseudo) === norm(cleanPseudo));
    res.json({ success: true, attemptsLeft: Math.max(0, c.attempts - mine.length) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- FANTÔME DE RÉFÉRENCE (trajectoire témoin enregistrée par l'admin) ----

// L'admin enregistre son parcours comme trajectoire de référence visible par tous
app.post('/api/formula/ghost', async (req, res) => {
  const { password, circuitId, turns, moves } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const c = circuits.find(x => x.id === circuitId);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  if (!Array.isArray(turns) || !turns.length) return res.status(400).json({ error: 'Trajectoire vide' });

  // On borne pour éviter de stocker n'importe quoi
  c.ghost = {
    moves: parseInt(moves) || turns.length,
    turns: turns.slice(0, 400).map(t => ({ q: t.q | 0, r: t.r | 0, dir: t.dir | 0 })),
    date: new Date().toISOString()
  };
  try { await saveCircuits(); res.json({ success: true, points: c.ghost.turns.length }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Suppression du fantôme de référence
app.delete('/api/formula/ghost', async (req, res) => {
  const { password, circuitId } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const c = circuits.find(x => x.id === circuitId);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  delete c.ghost;
  try { await saveCircuits(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Classement interne au jeu : tous les circuits publiés + cumul général.
// Non verrouillé (le joueur est déjà dans Formula·Grid, il consulte ses adversaires).
app.get('/api/formula/rankings', (req, res) => {
  const pub = circuits.filter(c => c.published);
  const overall = {};
  const list = pub.map(c => {
    const mult = Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10;
    const ranked = circuitRanking(c.id);
    const N = ranked.length;
    const top = ranked.map((r, i) => {
      const pts = (N - i) * mult;
      const k = norm(r.pseudo);
      if (!overall[k]) overall[k] = { pseudo: r.pseudo, score: 0, circuits: 0 };
      overall[k].score += pts;
      overall[k].circuits++;
      return { rank: i + 1, pseudo: r.pseudo, moves: r.moves, left: r.left || 0, points: pts };
    });
    return { id: c.id, name: c.name, laps: c.laps, players: N, top: top.slice(0, 20) };
  });
  res.json({
    circuits: list,
    overall: Object.values(overall).sort((a, b) => b.score - a.score).slice(0, 50)
  });
});

// ---- ADMIN : gestion des scores Formula (lister / modifier / supprimer) ----

// Liste tous les essais d'un circuit
app.get('/api/formula/admin/runs/:circuitId', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const runs = circuitRuns[req.params.circuitId] || [];
  const c = circuits.find(x => x.id === req.params.circuitId);
  res.json({
    circuit: c ? { id: c.id, name: c.name, laps: c.laps, attempts: c.attempts, pointsMultiplier: Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10 } : null,
    runs: runs.map((r, i) => ({ index: i, pseudo: r.pseudo, moves: r.moves, left: r.left||0, crashed: !!r.crashed, date: r.date })),
    ranking: circuitRanking(req.params.circuitId).map((r, i) => ({ rank: i+1, pseudo: r.pseudo, moves: r.moves, left: r.left||0 }))
  });
});

// Modifie un essai (coups / bonus / pseudo)
app.post('/api/formula/admin/run', async (req, res) => {
  const { password, circuitId, index, moves, left, pseudo } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const runs = circuitRuns[circuitId];
  if (!runs || !runs[index]) return res.status(404).json({ error: 'Essai introuvable' });
  if (pseudo !== undefined) runs[index].pseudo = String(pseudo).trim().slice(0,24);
  if (moves !== undefined) {
    const m = parseInt(moves);
    if (Number.isFinite(m) && m > 0) { runs[index].moves = m; runs[index].crashed = false; }
  }
  if (left !== undefined) runs[index].left = Math.max(0, parseInt(left)||0);
  try {
    await saveCircuitRuns(circuitId);
    rebuildGlobalScores(); saveData();
    res.json({ success: true, ranking: circuitRanking(circuitId) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Supprime un essai précis
app.delete('/api/formula/admin/run', async (req, res) => {
  const { password, circuitId, index } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const runs = circuitRuns[circuitId];
  if (!runs || !runs[index]) return res.status(404).json({ error: 'Essai introuvable' });
  runs.splice(index, 1);
  try {
    await saveCircuitRuns(circuitId);
    rebuildGlobalScores(); saveData();
    res.json({ success: true, remaining: runs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Supprime TOUS les essais d'un joueur sur un circuit (lui rend ses essais)
app.delete('/api/formula/admin/player', async (req, res) => {
  const { password, circuitId, pseudo } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const runs = circuitRuns[circuitId];
  if (!runs) return res.status(404).json({ error: 'Circuit introuvable' });
  const before = runs.length;
  circuitRuns[circuitId] = runs.filter(r => norm(r.pseudo) !== norm(pseudo));
  try {
    await saveCircuitRuns(circuitId);
    rebuildGlobalScores(); saveData();
    res.json({ success: true, removed: before - circuitRuns[circuitId].length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Diagnostic connexion
app.get('/api/status', (req, res) => {
  const persistant = !!db;
  res.json({
    // ── L'INFO QUI COMPTE : les données survivront-elles au prochain déploiement ? ──
    stockage: persistant ? 'MongoDB (permanent)' : 'fichier local (ÉPHÉMÈRE)',
    donneesPerdablesAuDeploiement: !persistant,
    avertissement: persistant
      ? null
      : "MONGODB_URI n'est pas configurée : les scores, comptes et circuits sont écrits dans un fichier local, effacé à CHAQUE redéploiement (push GitHub). Ajoutez la variable d'environnement MONGODB_URI sur Koyeb pour rendre les données permanentes.",

    mongodb: db ? 'connecté' : 'non connecté',
    mongoUri: MONGO_URI ? 'définie (' + MONGO_URI.slice(0,20) + '...)' : 'ABSENTE',

    // Volumétrie actuelle, pour vérifier d'un coup d'œil ce qui est chargé
    contenu: {
      defis: athletes.length,
      circuitsFormula: circuits.length,
      duelsCurling: curlingMatches.length,
      comptesJoueurs: Object.keys(accounts||{}).length,
      scoresGlobaux: globalScores.length
    },
    uptime: Math.round(process.uptime()) + 's'
  });
});

// Admin: liste des comptes joueurs
app.get('/api/admin/accounts', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const list = Object.values(accounts).map(a => ({
      pseudo: a.pseudo,
      teamId: a.teamId || null,
      createdAt: a.createdAt || null,
      ip: a.ip || null
    }));
    res.json({ accounts: list });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: supprimer un compte
app.delete('/api/account/:pseudo', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const pseudo = req.params.pseudo.toLowerCase();
  delete accounts[pseudo];
  if (db) {
    try { await db.collection('accounts').deleteOne({ pseudo: new RegExp('^'+pseudo+'$','i') }); } catch(e) {}
  }
  saveData();
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  res.json(password === ADMIN_PASSWORD ? { success: true } : { success: false, message: 'Mot de passe incorrect' });
});

app.get('/api/admin/athletes', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  try {
    res.json(athletes.map(a => ({ ...a, playerCount: (scores[a.id] || []).length, topScore: (scores[a.id] || [])[0]?.score ?? null })));
  } catch(e) {
    console.error('/api/admin/athletes erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
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
  if (!answer && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe' && type !== 'biathlon' && type !== 'maillonfaible' && type !== 'haltero' && type !== 'tirarlarc' && type !== 'nagesync' && type !== 'assaut' && type !== 'var' && type !== 'rvlf' && type !== 'plongee' && type !== 'escalade' && type !== 'saut' && type !== 'roulette' && type !== 'bowling' && type !== 'equitation' && type !== 'badminton' && type !== 'melimelo' && type !== 'apol' && type !== 'trivpursuit') return res.status(400).json({ error: 'Nom obligatoire' });
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
  if (type === 'biathlon' && (!req.body.biatTheme || !req.body.biatSprintAnswers || req.body.biatSprintAnswers.length < 1)) return res.status(400).json({ error: 'Thème et réponses sprint obligatoires' });
  if (type === 'maillonfaible' && (!req.body.mfQuestions || req.body.mfQuestions.length < 1)) return res.status(400).json({ error: 'Questions obligatoires' });
  if (type === 'blackjack' && (!req.body.bjTheme || !req.body.bjTarget || !req.body.bjAnswers || !Object.keys(req.body.bjAnswers).length)) return res.status(400).json({ error: 'Thème, cible et réponses obligatoires' });
  if (type === 'saut' && (!req.body.sautWords || req.body.sautWords.length < 5 || !req.body.sautWords.slice(0,5).every(w=>w && w.mot && Array.isArray(w.indices) && w.indices.filter(Boolean).length>=1))) return res.status(400).json({ error: '5 mots avec au moins 1 indice chacun sont obligatoires' });
  if (type !== 'image' && type !== 'buzz' && type !== 'sportus' && type !== 'prix' && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe' && type !== 'biathlon' && type !== 'maillonfaible' && type !== 'haltero' && type !== 'tirarlarc' && type !== 'nagesync' && type !== 'assaut' && type !== 'var' && type !== 'rvlf' && type !== 'plongee' && type !== 'escalade' && type !== 'saut' && type !== 'roulette' && type !== 'bowling' && type !== 'equitation' && type !== 'badminton' && type !== 'melimelo' && type !== 'apol' && type !== 'trivpursuit' && !clue) return res.status(400).json({ error: 'Description obligatoire' });

  // Vérification taille image base64
  const b64 = req.body.imageBase64 || '';
  if (b64 && b64.length > 8 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image trop lourde — max 8 Mo une fois encodée (environ 6 Mo de fichier)' });
  }

  // Support réponses multiples séparées par ; dans le champ réponse
  const answerParts = (answer||'').split(';').map(s=>s.trim()).filter(Boolean);
  const safeAnswer = answerParts[0] || (type==='demineur'?'Le Démineur':type==='chase'?'The Chase':type==='replique'?(req.body.repliqueAuthor||'Réplique').trim():type==='blackjack'?(req.body.bjTheme||'Blackjack').trim():type==='grimpe'?(req.body.grimpeTheme||"L'Alpe d'Huez").trim():type==='var'?'La VAR':type==='rvlf'?'Retour vers le Futur':type==='plongee'?'La Plongée':type==='escalade'?"L'Escalade":type==='saut'?'Le Saut en Hauteur':type==='roulette'?'Roulette Russe':type==='bowling'?'Bowling Quiz':type==='equitation'?'Équitation CSO':type==='badminton'?'Badminton Quiz':'???');
  const parts         = safeAnswer.split(/\s+/);
  const autoAliases   = [safeAnswer.toLowerCase()];
  if(parts.length > 1) autoAliases.push(parts[parts.length - 1].toLowerCase());
  // Ajouter toutes les variantes séparées par ; comme aliases
  answerParts.slice(1).forEach(a => autoAliases.push(a.toLowerCase()));
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
    imageIndication: type === 'image' ? (req.body.imageIndication||'') : '',
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
    assaut:             type === 'assaut' ? (req.body.assaut||{}) : undefined,
    phase1:             type === 'assaut' ? (req.body.phase1||[]) : undefined,
    phase2:             type === 'assaut' ? (req.body.phase2||{}) : undefined,
    cibles:             type === 'tirarlarc' ? (req.body.cibles||[]) : undefined,
    arcTolerances:      type === 'tirarlarc' ? (req.body.arcTolerances||{facile:20,moyen:8,difficile:3}) : undefined,
    couloirs:           type === 'nagesync' ? (req.body.couloirs||[]) : undefined,
    sportifs:           type === 'nagesync' ? (req.body.sportifs||[]) : undefined,
    halteroArache:      type === 'haltero' ? (req.body.halteroArache||{}) : undefined,
    halteroEpaule:      type === 'haltero' ? (req.body.halteroEpaule||{}) : undefined,
    varText:            type === 'var' ? (req.body.varText||'').trim() : undefined,
    varWrong:           type === 'var' ? (req.body.varWrong||'').trim() : undefined,
    varCorrect:         type === 'var' ? (req.body.varCorrect||'').trim() : undefined,
    varChips:           type === 'var' ? (req.body.varChips||[]) : undefined,
    varTol:             type === 'var' ? (parseInt(req.body.varTol)||1) : undefined,
    rvlfQuestions:      type === 'rvlf' ? (req.body.rvlfQuestions||[]) : undefined,
    rvlfNoTimer:        type === 'rvlf' ? !!req.body.rvlfNoTimer : undefined,
    plongeePaliers:     type === 'plongee' ? (req.body.plongeePaliers||[]) : undefined,
    plongeeO2Base:      type === 'plongee' ? (parseInt(req.body.plongeeO2Base)||8) : undefined,
    plongeeO2Treasure:  type === 'plongee' ? (parseInt(req.body.plongeeO2Treasure)||2) : undefined,
    plongeeO2Error:     type === 'plongee' ? (parseInt(req.body.plongeeO2Error)||2) : undefined,
    escaladeQuestions:  type === 'escalade' ? (req.body.escaladeQuestions||[]) : undefined,
    escaladeTheme:      type === 'escalade' ? (req.body.escaladeTheme||'').trim() : undefined,
    escaladeTol:        type === 'escalade' ? (parseInt(req.body.escaladeTol)||1) : undefined,
    sautWords:          type === 'saut' ? (req.body.sautWords||[]) : undefined,
    sautTheme:          type === 'saut' ? (req.body.sautTheme||'').trim() : undefined,
    sautTol:            type === 'saut' ? (parseInt(req.body.sautTol)||1) : undefined,
    sautTimer:          type === 'saut' ? Math.max(0,Math.min(120,parseInt(req.body.sautTimer)??20)) : undefined,
    sautPenalty:        type === 'saut' ? Math.max(0,Math.min(30,parseInt(req.body.sautPenalty)??2)) : undefined,
    plongeeTol:         type === 'plongee' ? (parseInt(req.body.plongeeTol)||1) : undefined,
    rouletteText:       type === 'roulette' ? (req.body.rouletteText||'').trim() : undefined,
    rouletteAnswer:     type === 'roulette' ? (req.body.rouletteAnswer||'').trim() : undefined,
    rouletteHint:       type === 'roulette' ? (req.body.rouletteHint||'').trim() : undefined,
    roulettePct:        type === 'roulette' ? (parseInt(req.body.roulettePct)||40) : undefined,
    rouletteChambers:   type === 'roulette' ? (parseInt(req.body.rouletteChambers)||6) : undefined,
    rouletteBullet:     type === 'roulette' ? (parseInt(req.body.rouletteBullet)||4) : undefined,
    rouletteTol:        type === 'roulette' ? (parseInt(req.body.rouletteTol)||1) : undefined,
    rouletteRevealStep: type === 'roulette' ? (parseInt(req.body.rouletteRevealStep)||5) : undefined,
    equiObstacles:      type === 'equitation' ? (req.body.equiObstacles||[]) : undefined,
    equiTimeLimit:      type === 'equitation' ? (parseInt(req.body.equiTimeLimit)||60) : undefined,
    bowlingQuestions:   type === 'bowling' ? (req.body.bowlingQuestions||[]) : undefined,
    badmintonQuestions: type === 'badminton' ? (req.body.badmintonQuestions||[]) : undefined,
    badTheme:           type === 'badminton' ? (req.body.badTheme||'Badminton Quiz') : undefined,
    meliWords:          type === 'melimelo' ? (req.body.meliWords||[]) : undefined,
    meliTimer:          type === 'melimelo' ? (parseInt(req.body.meliTimer)||60) : undefined,
    apolQuestions:      type === 'apol' ? (req.body.apolQuestions||[]) : undefined,
    bonusQ:             type === 'apol' ? (req.body.bonusQ||'') : undefined,
    bonusA:             type === 'apol' ? (req.body.bonusA||'') : undefined,
    trivThemes:         type === 'trivpursuit' ? (req.body.trivThemes||[]).map(t=>({...t,question:t.question||'',answer:t.answer||'',tol:parseInt(t.tol)||1})) : undefined,
    trivQuestions:      type === 'trivpursuit' ? (req.body.trivQuestions||[]) : undefined,
    rouletteSeed:       type === 'roulette' ? (parseInt(req.body.rouletteSeed)||Date.now()) : undefined,
    mfQuestions:        type === 'maillonfaible' ? (req.body.mfQuestions||[]) : undefined,
    biatTheme:          type === 'biathlon' ? (req.body.biatTheme||'').trim() : undefined,
    biatAnnounceTime:   type === 'biathlon' ? (parseInt(req.body.biatAnnounceTime)||45) : undefined,
    biatSprintAnswers:  type === 'biathlon' ? (req.body.biatSprintAnswers||[]).map(s=>String(s).trim()).filter(Boolean) : undefined,
    biatQCM:            type === 'biathlon' ? (req.body.biatQCM||[]) : undefined,
    biatOrderQuestion:  type === 'biathlon' ? (req.body.biatOrderQuestion||'').trim() : undefined,
    biatOrder:          type === 'biathlon' ? (req.body.biatOrder||[]).map(s=>String(s).trim()).filter(Boolean) : undefined,
    grimpeAnswersFull: type === 'grimpe' ? (req.body.grimpeAnswersFull||[]) : undefined,
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
    return res.json({ success: true, edited: true, id: athletes[idx].id, answer: athletes[idx].answer });
  }

  const newId = Date.now();
  athletes.push({ id: newId, ...athleteData, createdAt: new Date().toISOString() });
  scores[newId] = [];
  // Log image size for debugging
  if (type === 'image' && b64) {
    console.log(`[IMAGE] base64 size: ${Math.round(b64.length/1024)}KB`);
  }

  try {
    saveData();
    console.log(`✅ Ajouté (${athleteData.type}): ${safeAnswer}`);
    res.json({ success: true, edited: false, id: newId, answer: safeAnswer, total: athletes.length });
  } catch(e) {
    console.error('Erreur saveData:', e.message);
    res.status(500).json({ error: 'Erreur sauvegarde: '+e.message });
  }
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

app.delete('/api/admin/athlete/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const id = parseInt(req.params.id);
  athletes = athletes.filter(a => a.id !== id);
  delete scores[id];
  rebuildGlobalScores(); saveData();
  // Supprimer dans MongoDB — cherche par id numérique ET string
  if (db) {
    try {
      const r1 = await colAthletes.deleteOne({ id: id });
      const r2 = r1.deletedCount === 0 ? await colAthletes.deleteOne({ id: String(id) }) : r1;
      await colScores.deleteMany({ athleteId: { $in: [id, String(id)] } });
      console.log(`[DELETE] Athlète ${id} supprimé de MongoDB (deleted: ${r1.deletedCount + (r2?.deletedCount||0)})`);
    } catch(e) { console.error('Erreur suppression MongoDB:', e.message); }
  }
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


// ── BIATHLON ──────────────────────────────────────────────────────────────
app.post('/api/biathlon-check', (req, res) => {
  const { athleteId, answer } = req.body;
  const athlete = athletes.find(a => String(a.id) === String(athleteId));
  if (!athlete || athlete.type !== 'biathlon') return res.status(404).json({ error: 'Défi introuvable' });
  const normAns = norm(answer||'');
  const allAnswers = (athlete.biatSprintAnswers||[]);
  const matched = allAnswers.find(a => {
    const variants = a.split(';').map(v=>v.trim());
    // Auto-generate name/lastname variants
    const allVariants = [];
    variants.forEach(v => {
      allVariants.push(v);
      const parts = v.trim().split(/\s+/);
      if(parts.length >= 2) {
        allVariants.push(parts[parts.length-1]); // nom de famille
        allVariants.push(parts[0]); // prénom
      }
    });
    return allVariants.some(v => lev(norm(v), normAns) <= 1);
  });
  const mainAnswer = matched ? matched.split(';')[0].trim() : null;
  res.json({ correct: !!matched, answer: mainAnswer });
});


// ── BOITE À IDÉES ──────────────────────────────────────────────────────────
let suggestions = [];

async function loadSuggestions(){
  if(!db) return;
  try{
    const col=db.collection('suggestions');
    suggestions=await col.find({}).sort({date:-1}).toArray();
    console.log(`${suggestions.length} suggestion(s) chargée(s)`);
  }catch(e){ console.error('loadSuggestions:', e.message); }
}

// Soumettre une idée (joueur)
app.post('/api/suggestion', async (req, res) => {
  const { pseudo, text } = req.body;
  if(!text||!text.trim()) return res.status(400).json({error:'Idée vide'});
  const suggestion = {
    id: Date.now().toString(),
    pseudo: (pseudo||'Anonyme').trim().slice(0,20),
    text: text.trim().slice(0,300),
    date: new Date().toISOString(),
    votes: 0,
    voters: []
  };
  suggestions.push(suggestion);
  if(db) await db.collection('suggestions').insertOne(suggestion);
  res.json({ok:true});
});

// Voter pour une idée
app.post('/api/suggestion/vote', async (req, res) => {
  const { id, pseudo } = req.body;
  const s=suggestions.find(s=>s.id===id);
  if(!s) return res.status(404).json({error:'Idée introuvable'});
  if(!s.voters)s.voters=[];
  if(s.voters.includes(pseudo)) return res.status(409).json({error:'Déjà voté'});
  s.voters.push(pseudo);
  s.votes=(s.votes||0)+1;
  if(db) await db.collection('suggestions').updateOne({id},{$set:{votes:s.votes,voters:s.voters}});
  res.json({ok:true,votes:s.votes});
});

// Lister les idées (public)
app.get('/api/suggestions', (req, res) => {
  const sorted=[...suggestions].sort((a,b)=>(b.votes||0)-(a.votes||0));
  res.json({suggestions:sorted});
});

// Supprimer une idée (admin)
app.delete('/api/suggestion/:id', async (req, res) => {
  const {password}=req.body;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  suggestions=suggestions.filter(s=>s.id!==req.params.id);
  if(db) await db.collection('suggestions').deleteOne({id:req.params.id});
  res.json({ok:true});
});

// ── POPUP BIENVENUE ────────────────────────────────────────────────────────
let popupConfig = { active: false, title: '', message: '', emoji: '🏆', color: '#d4ff00' };

app.get('/api/popup', (req, res) => { res.json(popupConfig); });

app.post('/api/admin/popup', async (req, res) => {
  const { password, title, message, emoji, color, active } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  popupConfig = { active: !!active, title: title||'', message: message||'', emoji: emoji||'🏆', color: color||'#d4ff00' };
  if (db) {
    try { await colConfig.updateOne({ key: 'main' }, { $set: { key:'main', musicConfig, welcomeImage, popupConfig } }, { upsert: true }); }
    catch(e) { console.error('savePopup:', e.message); }
  }
  res.json({ ok: true });
});


// ── ÉQUIPES ────────────────────────────────────────────────────────────────
let teams = []; // [{id, name, emoji, color}]

async function loadTeams(){
  if(!db) return;
  try{
    const col=db.collection('teams');
    teams=await col.find({}).toArray();
    console.log(`${teams.length} équipe(s) chargée(s)`);
  }catch(e){ console.error('loadTeams:', e.message); }
}

async function saveTeam(team){
  if(!db) return;
  try{ await db.collection('teams').updateOne({id:team.id},{$set:team},{upsert:true}); }
  catch(e){ console.error('saveTeam:', e.message); }
}

// Lister équipes (public)
app.get('/api/teams', (req, res) => {
  res.json({ teams: teams.map(t=>({id:t.id,name:t.name,emoji:t.emoji,color:t.color})) });
});

// Créer équipe (admin)
app.post('/api/admin/teams', async (req, res) => {
  const { password, name, emoji, color } = req.body;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  if(!name) return res.status(400).json({error:'Nom obligatoire'});
  const team={ id: Date.now().toString(), name:name.trim(), emoji:emoji||'👥', color:color||'#6366f1', createdAt:new Date().toISOString() };
  teams.push(team);
  await saveTeam(team);
  res.json({ok:true, team});
});

// Supprimer équipe (admin)
app.delete('/api/admin/teams/:id', async (req, res) => {
  const { password } = req.body;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  teams=teams.filter(t=>t.id!==req.params.id);
  if(db) await db.collection('teams').deleteOne({id:req.params.id});
  res.json({ok:true});
});

// Récupérer l'équipe d'un joueur
app.get('/api/account/team', (req, res) => {
  const pseudo=(req.query.pseudo||'').trim();
  const account=accounts[pseudo.toLowerCase()];
  if(!account) return res.json({teamId:null});
  res.json({teamId:account.teamId||null});
});

// Assigner équipe à un joueur
app.post('/api/account/set-team', async (req, res) => {
  const { pseudo, teamId } = req.body;
  if(!pseudo) return res.status(400).json({error:'Pseudo requis'});
  const account=accounts[pseudo.toLowerCase()];
  if(!account) return res.status(404).json({error:'Compte introuvable'});
  account.teamId=teamId||null;
  await saveAccount(account);
  res.json({ok:true});
});

// Lister joueurs par équipe (admin)
app.get('/api/admin/team-players', (req, res) => {
  const { password } = req.query;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  const result={};
  teams.forEach(t=>{ result[t.id]={ team:t, players:[] }; });
  result['none']={ team:{id:'none',name:'Sans équipe',emoji:'❓',color:'#666'}, players:[] };
  Object.values(accounts).forEach(a=>{
    const key=a.teamId&&result[a.teamId]?a.teamId:'none';
    result[key].players.push({pseudo:a.pseudo, teamId:a.teamId||null});
  });
  res.json({groups:Object.values(result)});
});

// Classement équipes (public)
// Endpoint de diagnostic équipes
app.get('/api/debug/tirarlarc', (req, res) => {
  const arcs = athletes.filter(a => a.type === 'tirarlarc');
  res.json(arcs.map(a => ({
    id: a.id,
    answer: a.answer,
    cibles: a.cibles,
    arcTolerances: a.arcTolerances
  })));
});

app.get('/api/debug/teams', (req, res) => {
  const {password}=req.query;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  const accountsWithTeam=Object.values(accounts).filter(a=>a.teamId);
  const gsWithTeam=globalScores.filter(gs=>{
    const acc=accounts[gs.pseudo.toLowerCase()]||accounts[norm(gs.pseudo)];
    return acc&&acc.teamId;
  });
  res.json({
    totalAccounts:Object.keys(accounts).length,
    accountsWithTeam:accountsWithTeam.map(a=>({pseudo:a.pseudo,teamId:a.teamId})),
    totalGlobalScores:globalScores.length,
    globalScoresWithTeam:gsWithTeam.map(gs=>({pseudo:gs.pseudo,score:gs.score})),
    teams:teams.map(t=>({id:t.id,name:t.name}))
  });
});

app.get('/api/scores/teams', async (req, res) => {
  const minPlayers=parseInt(req.query.min)||1;
  if(db){
    try{
      // Recharger comptes ET scores depuis MongoDB
      const [freshAccs, freshScores]=await Promise.all([
        db.collection('accounts').find({}).toArray(),
        db.collection('scores').find({}).toArray()
      ]);
      freshAccs.forEach(a=>{ accounts[a.pseudo.toLowerCase()]=a; });
      freshScores.forEach(s=>{ scores[s.athleteId]=s.scores||[]; });
    }catch(e){ console.error('teams reload error:',e.message); }
  }
  rebuildGlobalScores();
  // globalScores = [{pseudo, score}] — déjà calculé
  // accounts = {pseudo_lower: {pseudo, teamId}} — en mémoire
  const teamData={};
  for(const gs of globalScores){
    const acc=accounts[gs.pseudo.toLowerCase()];
    if(!acc||!acc.teamId) continue;
    if(!teamData[acc.teamId]) teamData[acc.teamId]=[];
    teamData[acc.teamId].push(gs.score);
  }
  const result=Object.entries(teamData).map(([teamId,scores])=>{
    const t=teams.find(t=>t.id===teamId)||{name:'Équipe',emoji:'👥',color:'#6366f1',id:teamId};
    const avg=scores.length>=minPlayers?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;
    return{id:t.id,name:t.name,emoji:t.emoji,color:t.color,playerCount:scores.length,avg,qualified:scores.length>=minPlayers};
  }).filter(t=>t.playerCount>0).sort((a,b)=>(b.avg||0)-(a.avg||0));
  res.json({teams:result,minPlayers});
});


// ── MODIFIER UN SCORE ─────────────────────────────────────────────────────
app.post('/api/admin/score/edit', async (req,res)=>{
  const {password,athleteId,pseudo,newScore}=req.body;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  const id=String(athleteId);
  if(!scores[id]) return res.status(404).json({error:'Défi introuvable'});
  const entry=scores[id].find(e=>e.pseudo===pseudo);
  if(!entry) return res.status(404).json({error:'Score introuvable'});
  entry.score=Math.max(0,parseInt(newScore)||0);
  if(db){
    await db.collection('scores').updateOne(
      {athleteId:id},
      {$set:{'scores.$[e].score':entry.score}},
      {arrayFilters:[{'e.pseudo':pseudo}]}
    );
  }
  rebuildGlobalScores();
  res.json({ok:true,score:entry.score});
});

// ── SUPPRIMER UN SCORE ────────────────────────────────────────────────────
app.post('/api/admin/score/delete', async (req,res)=>{
  const {password,athleteId,pseudo}=req.body;
  if(password!==ADMIN_PASSWORD) return res.status(401).json({error:'Non autorisé'});
  const id=String(athleteId);
  if(!scores[id]) return res.status(404).json({error:'Défi introuvable'});
  scores[id]=scores[id].filter(e=>e.pseudo!==pseudo);
  if(db){
    await db.collection('scores').updateOne({athleteId:id},{$pull:{scores:{pseudo}}});
  }
  rebuildGlobalScores();
  res.json({ok:true});
});

// ── COMPTES JOUEURS ────────────────────────────────────────────────────────
// Simple hash PIN (pas de bcrypt pour garder simple)
function hashPin(pin){ let h=0;for(const c of pin){h=(h<<5)-h+c.charCodeAt(0);h|=0;}return Math.abs(h).toString(36); }

// Stockage comptes en mémoire + MongoDB
let accounts = {}; // { pseudo_lower: { pseudo, pinHash, createdAt } }

async function loadAccounts(){
  if(!db) return;
  try{
    const col=db.collection('accounts');
    const all=await col.find({}).toArray();
    all.forEach(a=>{ accounts[a.pseudo.toLowerCase()]=a; });
    console.log(`${all.length} compte(s) chargé(s)`);
  }catch(e){ console.error('loadAccounts:', e.message); }
}

async function saveAccount(account){
  if(!db){ console.log('saveAccount: db non connecté'); return; }
  try{
    const col=db.collection('accounts');
    await col.updateOne({pseudo:account.pseudo},{$set:account},{upsert:true});
    console.log('Compte sauvegardé:', account.pseudo);
  }catch(e){ console.error('saveAccount:', e.message); }
}

// Vérifier si pseudo existe
app.get('/api/account/check', (req, res) => {
  const pseudo=(req.query.pseudo||'').trim();
  if(!pseudo) return res.status(400).json({error:'Pseudo requis'});
  const exists=!!(accounts[pseudo.toLowerCase()]);
  res.json({exists});
});

// Créer un compte
app.post('/api/account/create', async (req, res) => {
  const {pseudo, pin}=req.body;
  if(!pseudo||!pin) return res.status(400).json({error:'Données manquantes'});
  if(!/^\d{4}$/.test(pin)) return res.status(400).json({error:'PIN invalide'});
  const key=pseudo.toLowerCase();
  if(accounts[key]) return res.status(409).json({error:'Pseudo déjà pris — choisis-en un autre'});
  const account={pseudo:pseudo.trim().slice(0,20), pinHash:hashPin(pin), createdAt:new Date().toISOString(), ip:getIP(req)};
  accounts[key]=account;
  await saveAccount(account);
  console.log(`[COMPTE CRÉÉ] ${account.pseudo} | IP: ${account.ip}`);
  res.json({ok:true});
});

// Connexion
app.post('/api/account/login', async (req, res) => {
  const {pseudo, pin}=req.body;
  if(!pseudo||!pin) return res.status(400).json({error:'Données manquantes'});
  const account=accounts[pseudo.toLowerCase()];
  if(!account) return res.status(404).json({error:'Compte introuvable'});
  if(account.pinHash!==hashPin(pin)) return res.status(401).json({error:'PIN incorrect'});
  res.json({ok:true, pseudo:account.pseudo});
});

// Liste tous les comptes (admin)


// Reset compte (admin)


// ══════════════════════════════════════════════════════════════════════════
//  CURLING — duels asynchrones, une pierre par tour
// ══════════════════════════════════════════════════════════════════════════

function curlingPublic(m, pseudo) {
  const meRed = norm(m.red) === norm(pseudo||'');
  return {
    id: m.id, red: m.red, yellow: m.yellow,
    myTeam: meRed ? 'RED' : 'YELLOW',
    opponent: meRed ? m.yellow : m.red,
    myTurn: m.status === 'playing' && norm(m.turn) === norm(pseudo||''),
    turn: m.turn, status: m.status, state: m.state,
    updatedAt: m.updatedAt
  };
}

// Défier un joueur
app.post('/api/curling/challenge', async (req, res) => {
  const from = (req.body.from||'').trim().slice(0,24);
  const to   = (req.body.to||'').trim().slice(0,24);
  const ends = Math.max(1, Math.min(10, parseInt(req.body.ends)||2));
  if (!from || !to) return res.status(400).json({ error: 'Pseudos requis' });
  if (norm(from) === norm(to)) return res.status(400).json({ error: 'Impossible de se défier soi-même' });

  const already = curlingMatches.find(m => m.status === 'playing' &&
    ((norm(m.red)===norm(from) && norm(m.yellow)===norm(to)) ||
     (norm(m.red)===norm(to) && norm(m.yellow)===norm(from))));
  if (already) return res.json({ success: true, id: already.id, existing: true });

  const m = {
    id: 'cur_' + Date.now(),
    red: from, yellow: to,
    turn: from,                       // celui qui défie ouvre le jeu
    status: 'playing',
    state: {
      stones: [], stonesPlayedInEnd: 0, currentTeam: 'RED',
      currentEnd: 1, totalEnds: ends,
      scoreRed: 0, scoreYellow: 0, endScores: [], redHasHammer: false
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  curlingMatches.push(m);
  try { await saveCurling(); res.json({ success: true, id: m.id }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Mes duels (à moi de jouer en premier)
app.get('/api/curling/matches', (req, res) => {
  const pseudo = (req.query.pseudo||'').trim();
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const mine = curlingMatches
    .filter(m => norm(m.red)===norm(pseudo) || norm(m.yellow)===norm(pseudo))
    .map(m => curlingPublic(m, pseudo))
    .sort((a,b) => (b.myTurn?1:0)-(a.myTurn?1:0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(mine);
});

// Adversaires possibles : tous les comptes existants sauf soi
app.get('/api/curling/players', (req, res) => {
  const pseudo = (req.query.pseudo||'').trim();
  const names = new Set();
  Object.values(accounts||{}).forEach(a => { if (a && a.pseudo && norm(a.pseudo)!==norm(pseudo)) names.add(a.pseudo); });
  res.json([...names].sort((a,b)=>a.localeCompare(b)).slice(0,200));
});

// État complet d'un duel
app.get('/api/curling/match/:id', (req, res) => {
  const m = curlingMatches.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Duel introuvable' });
  res.json(curlingPublic(m, (req.query.pseudo||'').trim()));
});

// Jouer UNE pierre : le client simule la physique et renvoie l'état résultant
app.post('/api/curling/throw', async (req, res) => {
  const { matchId, pseudo, state } = req.body;
  const m = curlingMatches.find(x => x.id === matchId);
  if (!m) return res.status(404).json({ error: 'Duel introuvable' });
  if (m.status !== 'playing') return res.status(403).json({ error: 'Duel terminé' });
  if (norm(m.turn) !== norm(pseudo||'')) return res.status(403).json({ error: 'Ce n\'est pas ton tour' });
  if (!state || !Array.isArray(state.stones)) return res.status(400).json({ error: 'État invalide' });

  m.state = {
    stones: state.stones.slice(0,16).map(s => ({ x:+s.x||0, y:+s.y||0, team: s.team==='RED'?'RED':'YELLOW' })),
    stonesPlayedInEnd: Math.max(0, Math.min(8, parseInt(state.stonesPlayedInEnd)||0)),
    currentTeam: state.currentTeam==='RED'?'RED':'YELLOW',
    currentEnd: Math.max(1, parseInt(state.currentEnd)||1),
    totalEnds: Math.max(1, Math.min(10, parseInt(state.totalEnds)||2)),
    scoreRed: Math.max(0, parseInt(state.scoreRed)||0),
    scoreYellow: Math.max(0, parseInt(state.scoreYellow)||0),
    endScores: Array.isArray(state.endScores) ? state.endScores.slice(0,10) : [],
    redHasHammer: !!state.redHasHammer
  };
  // La main passe au joueur de l'équipe qui doit lancer ensuite
  m.turn = (m.state.currentTeam === 'RED') ? m.red : m.yellow;
  if (state.gameOver) {
    m.status = 'done';
    m.winner = m.state.scoreRed > m.state.scoreYellow ? m.red
             : (m.state.scoreYellow > m.state.scoreRed ? m.yellow : null);
  }
  m.updatedAt = new Date().toISOString();
  try { await saveCurling(); res.json({ success: true, match: curlingPublic(m, pseudo) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Abandonner
app.post('/api/curling/forfeit', async (req, res) => {
  const { matchId, pseudo } = req.body;
  const m = curlingMatches.find(x => x.id === matchId);
  if (!m) return res.status(404).json({ error: 'Duel introuvable' });
  if (norm(m.red)!==norm(pseudo||'') && norm(m.yellow)!==norm(pseudo||''))
    return res.status(403).json({ error: 'Non autorisé' });
  m.status = 'done';
  m.winner = norm(m.red)===norm(pseudo) ? m.yellow : m.red;
  m.updatedAt = new Date().toISOString();
  try { await saveCurling(); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
// 🤖 IA — NOUS PORTAL (génération de questions pour les défis)
// ══════════════════════════════════════════════════════════════════════════
const AI_DEFAULT_BASE    = 'https://inference-api.nousresearch.com/v1';
const AI_DEFAULT_MODEL   = 'google/gemini-2.5-flash';
const AI_FILE            = path.join(__dirname, 'ai-config.json');
// Modèles connus du portail Nous (le portail route plusieurs fournisseurs).
// La liste réelle est récupérée en direct via le bouton 🔄 de l'admin.
const AI_FALLBACK_MODELS = [
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
  'deepseek/deepseek-chat-v3.1',
  'qwen/qwen3-235b-a22b',
  'mistralai/mistral-large',
  'anthropic/claude-sonnet-4.5'
];

// La clé n'est jamais renvoyée au navigateur : seul un aperçu masqué l'est.
let aiConfig = { apiKey: '', model: AI_DEFAULT_MODEL, baseUrl: AI_DEFAULT_BASE, temperature: 0.8 };

const aiKey   = () => String(aiConfig.apiKey || process.env.NOUS_API_KEY || '').trim();
const aiBase  = () => String(aiConfig.baseUrl || AI_DEFAULT_BASE).trim().replace(/\/+$/, '');
const aiModel = () => String(aiConfig.model || AI_DEFAULT_MODEL).trim();
function aiMask(k){
  k = String(k || '');
  if (!k) return '';
  return k.length <= 12 ? k.slice(0,4) + '…' + k.slice(-2) : k.slice(0,7) + '…' + k.slice(-4);
}

async function loadAIConfig(){
  if (db) {
    try {
      const doc = await db.collection('config').findOne({ key: 'ai' });
      if (doc && doc.aiConfig) aiConfig = { ...aiConfig, ...doc.aiConfig };
      return;
    } catch(e){ console.error('loadAIConfig mongo:', e.message); }
  }
  try {
    if (fs.existsSync(AI_FILE)) aiConfig = { ...aiConfig, ...JSON.parse(fs.readFileSync(AI_FILE, 'utf8')) };
  } catch(e){ console.error('loadAIConfig fichier:', e.message); }
}

async function saveAIConfig(){
  try {
    if (db) await db.collection('config').updateOne({ key: 'ai' }, { $set: { key: 'ai', aiConfig } }, { upsert: true });
    else fs.writeFileSync(AI_FILE, JSON.stringify(aiConfig, null, 2));
  } catch(e){ console.error('saveAIConfig:', e.message); }
}

// fetch + délai maximum (node-fetch n'expire jamais tout seul)
function aiTimeout(promise, ms, msg){
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg || 'Délai dépassé')), ms); })
  ]).finally(() => clearTimeout(t));
}

async function aiPost(pathname, body, ms){
  const key = aiKey();
  if (!key) throw new Error("Aucune clé API Nous Portal enregistrée (onglet 🤖 IA).");
  const r = await aiTimeout(fetch(aiBase() + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(body)
  }), ms || 180000, "Le modèle n'a pas répondu à temps.");
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch(e){}
  if (!r.ok) {
    const raw = json && json.error ? (json.error.message || json.error) : (json && json.message ? json.message : txt);
    throw new Error('[' + r.status + '] ' + String(raw || 'Erreur API').slice(0, 300));
  }
  return json;
}

async function aiChat(messages, opts = {}){
  const temp = Number(aiConfig.temperature);
  const json = await aiPost('/chat/completions', {
    model: opts.model || aiModel(),
    messages,
    temperature: opts.temperature != null ? opts.temperature : (Number.isFinite(temp) ? temp : 0.8),
    max_tokens: opts.maxTokens || 3000
  }, opts.ms);
  const content = json && json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content : '';
  if (!content) throw new Error('Réponse vide du modèle.');
  return { content, model: (json && json.model) || opts.model || aiModel(), usage: (json && json.usage) || null };
}

async function aiListModels(){
  const key = aiKey();
  if (!key) throw new Error("Aucune clé API Nous Portal enregistrée.");
  const r = await aiTimeout(fetch(aiBase() + '/models', { headers: { 'Authorization': 'Bearer ' + key } }), 25000, 'Délai dépassé');
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch(e){}
  if (!r.ok) throw new Error('[' + r.status + '] ' + String((json && json.error && (json.error.message || json.error)) || txt).slice(0, 200));
  const arr = (json && (json.data || json.models)) || [];
  return arr.map(m => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean).sort();
}

// ── Modes de génération ────────────────────────────────────────────────────
const AI_SYSTEM = [
  "Tu es le rédacteur en chef des questions d'un quiz sportif télévisé français.",
  "Tu écris en français, avec des faits exacts et vérifiables : jamais d'invention, jamais de réponse approximative.",
  "Les questions sont courtes et sans ambiguïté, les réponses tiennent en quelques mots.",
  "Tu réponds UNIQUEMENT par un objet JSON valide, sans texte avant ou après, sans balise Markdown."
].join(' ');

const AI_MODES = {
  qcm3: {
    label: 'QCM 3 choix', max: 20, maxTokens: 3500,
    rule: '{"question":"la question","answer":"la bonne réponse","wrong":["mauvais choix 1","mauvais choix 2"],"theme":"sous-thème en 2-3 mots"}',
    note: 'Les deux mauvais choix doivent être plausibles (même catégorie, même époque) mais sans ambiguïté faux.'
  },
  qcm4: {
    label: 'QCM 4 choix', max: 20, maxTokens: 4000,
    rule: '{"question":"la question","answer":"la bonne réponse","wrong":["mauvais choix 1","mauvais choix 2","mauvais choix 3"],"theme":"sous-thème en 2-3 mots"}',
    note: 'Les trois mauvais choix doivent être plausibles mais sans ambiguïté faux.'
  },
  vraifaux: {
    label: 'Vrai / Faux', max: 20, maxTokens: 3000,
    rule: '{"question":"une affirmation claire","answer":"Vrai" ou "Faux","theme":"sous-thème en 2-3 mots"}',
    note: 'Alterne les affirmations vraies et fausses (environ une sur deux de chaque). N\'écris jamais "vrai" ou "faux" dans l\'affirmation.'
  },
  numero: {
    label: 'Réponse numérique', max: 12, maxTokens: 3000,
    rule: '{"question":"la question","answer":42,"unit":"unité courte (buts, cm, ans, titres…)","theme":"sous-thème en 2-3 mots"}',
    note: '"answer" doit être un NOMBRE (jamais de texte, jamais de guillemets). La valeur doit être exacte à la date la plus récente connue.'
  },
  court: {
    label: 'Réponse courte', max: 12, maxTokens: 3000,
    rule: '{"question":"la question","answer":"la réponse courte","aliases":["autre écriture acceptée"],"theme":"sous-thème en 2-3 mots"}',
    note: '"aliases" contient les variantes acceptées (nom seul, prénom seul, abréviation). 0 à 3 variantes.'
  },
  indices: {
    label: 'Indices progressifs', max: 6, maxTokens: 3500,
    rule: '{"answer":"la solution (1 à 4 mots)","clues":["indice 1 très vague","indice 2","indice 3","indice 4","indice 5 très précis"],"theme":"sous-thème en 2-3 mots"}',
    note: 'Exactement 5 indices, du plus vague au plus précis. Un indice ne doit JAMAIS contenir la solution ni sa racine.'
  },
  citation: {
    label: 'Citation culte', max: 6, maxTokens: 3000,
    rule: '{"quote":"la citation complète et exacte","amorce":"le début de la citation (5 à 8 mots)","answer":"la fin exacte de la citation","wrong":["autre fin plausible 1","autre fin plausible 2","autre fin plausible 3"],"author":"auteur de la citation","wrongAuthor":"un autre sportif connu","work":"film, match ou année","theme":"sous-thème en 2-3 mots"}',
    note: 'La citation doit être réellement attribuée à cette personne. "amorce" + "answer" doivent reconstituer "quote". Les trois "wrong" sont d\'autres fins de citation, plausibles mais fausses.'
  },
  paragraphe: {
    label: 'Paragraphe à erreur', max: 3, maxTokens: 3000,
    rule: '{"text":"un paragraphe journalistique de 5 à 7 phrases","wrong":"le segment exact du paragraphe qui contient une erreur (2 à 4 mots, copié mot pour mot)","correct":"la correction exacte de ce segment","theme":"sous-thème en 2-3 mots"}',
    note: '"wrong" doit être copié caractère pour caractère depuis "text" et ne contenir qu\'UNE seule erreur factuelle dans tout le paragraphe.'
  },
  escalade: {
    label: 'Facile / Difficile', max: 8, maxTokens: 3500,
    rule: '{"facile":{"question":"la question simple","answer":"la réponse"},"difficile":{"question":"la même question en plus dur","answer":"la réponse"},"theme":"sous-thème en 2-3 mots"}',
    note: 'La version difficile porte sur le même sujet mais demande une connaissance plus pointue.'
  },
  anagramme: {
    label: 'Anagramme', max: 5, maxTokens: 2000,
    rule: '{"answer":"UNSEULMOT","hint":"un indice court","theme":"sous-thème en 2-3 mots"}',
    note: '"answer" est un seul mot sans espace (nom propre ou terme sportif), en MAJUSCULES, de 5 à 14 lettres.'
  },
  liste: {
    label: 'Liste de réponses', max: 3, maxTokens: 3000,
    rule: '{"theme":"la consigne exacte à afficher au joueur (ex: Citez 10 joueurs français ayant joué en Ligue des Champions)","question":"un sous-titre court","answers":["réponse 1","réponse 2","réponse 3"],"theme_short":"sous-thème en 2-3 mots"}',
    note: 'Donne au moins 20 réponses valides et vérifiées, une par entrée, en orthographe officielle. La consigne doit préciser le nombre attendu.'
  },
  mines: {
    label: 'Cases + mines', max: 1, maxTokens: 2500,
    rule: '{"consigne":"la consigne affichée au joueur","items":[{"text":"un nom ou une proposition","correct":true}],"theme":"sous-thème en 2-3 mots"}',
    note: 'Exactement 12 items dont EXACTEMENT 2 avec "correct": false (les mines). Les 10 autres doivent être incontestablement valides.'
  },
  paliers: {
    label: 'Paliers (descente + remontée)', max: 6, maxTokens: 4000,
    rule: '{"descente":{"question":"la question pour descendre à ce palier","answer":"la réponse courte"},"remontee":{"question":"la question pour remonter de ce palier","answer":"la réponse courte"},"theme":"sous-thème en 2-3 mots"}',
    note: 'Les deux questions d\'un même palier portent sur le même sous-thème mais sont différentes. Difficulté croissante : le palier 1 est le plus accessible, le dernier le plus pointu.'
  },
  motIndices: {
    label: 'Mot à deviner + 3 indices', max: 8, maxTokens: 4000,
    rule: '{"mot":"LE MOT À DEVINER","indices":["indice 1 (difficile)","indice 2 (moyen)","indice 3 (facile)"],"theme":"sous-thème en 2-3 mots"}',
    note: 'Exactement 3 indices, du plus difficile au plus facile. Aucun indice ne doit contenir le mot à deviner ni sa racine. Le mot est un nom propre ou un terme sportif court (1 à 3 mots). Difficulté croissante d\'un élément à l\'autre.'
  }
};

function aiClean(v, max){
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 240);
}
function aiCleanList(v, max){
  return (Array.isArray(v) ? v : []).map(x => aiClean(x, max || 120)).filter(Boolean);
}
function aiNumber(v){
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function aiNormalize(mode, raw){
  const out = [];
  for (const it of (Array.isArray(raw) ? raw : [])) {
    if (!it || typeof it !== 'object') continue;
    if (mode === 'qcm3' || mode === 'qcm4') {
      const need = mode === 'qcm3' ? 2 : 3;
      const q = aiClean(it.question, 240), a = aiClean(it.answer, 120);
      const wrong = aiCleanList(it.wrong, 120).filter(w => w.toLowerCase() !== a.toLowerCase());
      if (!q || !a || wrong.length < need) continue;
      out.push({ question: q, answer: a, wrong: wrong.slice(0, need), theme: aiClean(it.theme, 60) });
    } else if (mode === 'vraifaux') {
      const q = aiClean(it.question, 260), a = aiClean(it.answer, 12).toLowerCase();
      if (!q || !a) continue;
      out.push({ question: q, answer: a.indexOf('vrai') === 0 ? 'Vrai' : 'Faux', theme: aiClean(it.theme, 60) });
    } else if (mode === 'numero') {
      const q = aiClean(it.question, 240), n = aiNumber(it.answer);
      if (!q || n === null) continue;
      out.push({ question: q, answer: n, unit: aiClean(it.unit, 30), theme: aiClean(it.theme, 60) });
    } else if (mode === 'court') {
      const q = aiClean(it.question, 240), a = aiClean(it.answer, 120);
      if (!q || !a) continue;
      out.push({ question: q, answer: a, aliases: aiCleanList(it.aliases, 60), theme: aiClean(it.theme, 60) });
    } else if (mode === 'indices') {
      const a = aiClean(it.answer, 80), clues = aiCleanList(it.clues, 220);
      if (!a || clues.length < 2) continue;
      out.push({ answer: a, clues: clues.slice(0, 6), theme: aiClean(it.theme, 60) });
    } else if (mode === 'citation') {
      const quote = aiClean(it.quote, 400), a = aiClean(it.answer, 240);
      if (!quote || !a) continue;
      out.push({
        quote, answer: a,
        amorce: aiClean(it.amorce, 240) || quote.slice(0, Math.max(10, Math.floor(quote.length * 0.45))),
        wrong: aiCleanList(it.wrong, 240),
        author: aiClean(it.author, 80), wrongAuthor: aiClean(it.wrongAuthor, 80),
        work: aiClean(it.work, 120), theme: aiClean(it.theme, 60)
      });
    } else if (mode === 'paragraphe') {
      const text = aiClean(it.text, 1600), wrong = aiClean(it.wrong, 120), correct = aiClean(it.correct, 160);
      if (!text || !wrong || !correct) continue;
      out.push({ text, wrong, correct, theme: aiClean(it.theme, 60) });
    } else if (mode === 'escalade') {
      const f = it.facile || {}, d = it.difficile || {};
      const fq = aiClean(f.question, 240), fa = aiClean(f.answer, 120);
      if (!fq || !fa) continue;
      out.push({
        facile: { question: fq, answer: fa },
        difficile: { question: aiClean(d.question, 240), answer: aiClean(d.answer, 120) },
        theme: aiClean(it.theme, 60)
      });
    } else if (mode === 'anagramme') {
      const a = aiClean(it.answer, 20).replace(/[^A-Za-zÀ-ÿ]/g, '').toUpperCase();
      if (a.length < 4) continue;
      out.push({ answer: a, hint: aiClean(it.hint, 120), theme: aiClean(it.theme, 60) });
    } else if (mode === 'liste') {
      const answers = aiCleanList(it.answers, 80);
      if (answers.length < 3) continue;
      out.push({
        theme: aiClean(it.theme, 240), question: aiClean(it.question, 120),
        answers, theme_short: aiClean(it.theme_short || it.subtheme, 60)
      });
    } else if (mode === 'paliers') {
      const d = it.descente || {}, u = it.remontee || it.remontée || {};
      const dq = aiClean(d.question, 240), da = aiClean(d.answer, 120);
      const uq = aiClean(u.question, 240), ua = aiClean(u.answer, 120);
      if (!dq || !da || !uq || !ua) continue;
      out.push({
        descente: { question: dq, answer: da },
        remontee: { question: uq, answer: ua },
        theme: aiClean(it.theme, 60)
      });
    } else if (mode === 'motIndices') {
      const mot = aiClean(it.mot || it.answer, 60);
      const indices = aiCleanList(it.indices || it.clues, 220);
      if (!mot || indices.length < 3) continue;
      out.push({ mot, indices: indices.slice(0, 3), theme: aiClean(it.theme, 60) });
    } else if (mode === 'mines') {
      const items = (Array.isArray(it.items) ? it.items : [])
        .map(x => ({ text: aiClean(x && (x.text || x.name), 80), correct: !(x && x.correct === false) }))
        .filter(x => x.text);
      if (items.length < 6) continue;
      out.push({ consigne: aiClean(it.consigne || it.theme, 240), items: items.slice(0, 12), theme: aiClean(it.theme, 60) });
    }
  }
  return out;
}

function aiBuildPrompt(spec, o){
  const diff = ['facile','moyenne','difficile','mixte'].indexOf(String(o.difficulty)) >= 0 ? o.difficulty : 'moyenne';
  const lines = [
    'Thème : ' + (aiClean(o.theme, 300) || 'sport en général'),
    'Difficulté : ' + diff,
    "Nombre d'éléments à générer : " + o.count,
    '',
    'Format STRICT de sortie — un objet JSON uniquement :',
    '{"questions":[ ' + spec.rule + ' ]}'
  ];
  if (spec.note) lines.push('', spec.note);
  if (o.extra) lines.push('', 'Précisions du rédacteur : ' + aiClean(o.extra, 600));
  if (Array.isArray(o.avoid) && o.avoid.length)
    lines.push('', 'Ne repose PAS ces questions déjà utilisées : ' + o.avoid.slice(0, 20).map(x => aiClean(x, 80)).join(' | '));
  lines.push('',
    'Génère exactement ' + o.count + ' élément(s). Varie les sous-thèmes, les époques, les pays et les disciplines.',
    'Vérifie une dernière fois chaque fait avant de répondre. Aucun commentaire, aucun texte hors du JSON.'
  );
  return lines.join('\n');
}

function aiExtractJson(text){
  let s = String(text || '').trim();
  const fence = s.split('```');
  if (fence.length >= 3) s = fence[1].replace(/^json/i, '').trim();
  const first = s.search(/[\[{]/);
  if (first < 0) return null;
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (last < first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch(e){ return null; }
}

// ── Endpoints admin IA ─────────────────────────────────────────────────────
app.get('/api/admin/ai-config', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const key = aiKey();
  res.json({
    configured : !!key,
    source     : aiConfig.apiKey ? 'admin' : (process.env.NOUS_API_KEY ? 'env' : 'none'),
    keyPreview : aiMask(key),
    model      : aiModel(),
    baseUrl    : aiBase(),
    temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0.8,
    defaultBase: AI_DEFAULT_BASE,
    defaultModel: AI_DEFAULT_MODEL,
    fallbackModels: AI_FALLBACK_MODELS,
    modes      : Object.keys(AI_MODES).reduce((acc, k) => { acc[k] = { label: AI_MODES[k].label, max: AI_MODES[k].max }; return acc; }, {})
  });
});

app.post('/api/admin/ai-config', async (req, res) => {
  const { password, apiKey, model, baseUrl, temperature, clearKey } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (clearKey) aiConfig.apiKey = '';
  else if (typeof apiKey === 'string' && apiKey.trim()) aiConfig.apiKey = apiKey.trim();
  if (typeof model === 'string' && model.trim()) aiConfig.model = model.trim();
  if (typeof baseUrl === 'string' && baseUrl.trim()) aiConfig.baseUrl = baseUrl.trim();
  const t = parseFloat(temperature);
  if (Number.isFinite(t)) aiConfig.temperature = Math.min(2, Math.max(0, t));
  await saveAIConfig();
  const key = aiKey();
  res.json({
    success: true, configured: !!key, source: aiConfig.apiKey ? 'admin' : (process.env.NOUS_API_KEY ? 'env' : 'none'),
    keyPreview: aiMask(key), model: aiModel(), baseUrl: aiBase()
  });
});

app.get('/api/admin/ai-models', async (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const models = await aiListModels();
    res.json({ success: true, models: models.length ? models : AI_FALLBACK_MODELS, fallback: !models.length });
  } catch(e) {
    res.json({ success: false, error: e.message, models: AI_FALLBACK_MODELS, fallback: true });
  }
});

app.post('/api/admin/ai-test', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!aiKey()) return res.json({ ok: false, error: "Aucune clé API enregistrée." });
  const t0 = Date.now();
  try {
    const { content, model } = await aiChat([
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: 'Réponds uniquement par ce JSON : {"ok":true,"sport":"..."} avec un sport de ton choix.' }
    ], { maxTokens: 60, ms: 45000, temperature: 0 });
    const parsed = aiExtractJson(content);
    res.json({ ok: true, model, latencyMs: Date.now() - t0, reply: aiClean(content, 120), parsed: parsed || null });
  } catch(e) {
    res.json({ ok: false, error: e.message, latencyMs: Date.now() - t0 });
  }
});

app.post('/api/admin/ai-generate', async (req, res) => {
  const { password, mode, theme, count, difficulty, extra, avoid } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const spec = AI_MODES[mode];
  if (!spec) return res.status(400).json({ ok: false, error: 'Mode de génération inconnu : ' + mode });
  if (!aiKey()) return res.status(400).json({ ok: false, error: "Aucune clé API Nous Portal enregistrée. Ouvre l'onglet 🤖 IA." });
  const n = Math.max(1, Math.min(spec.max, parseInt(count, 10) || spec.max));
  const t0 = Date.now();
  try {
    const { content, model } = await aiChat([
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: aiBuildPrompt(spec, { theme, count: n, difficulty, extra, avoid }) }
    ], { maxTokens: spec.maxTokens, ms: 180000 });
    const parsed = aiExtractJson(content);
    const arr = Array.isArray(parsed) ? parsed
      : (parsed && Array.isArray(parsed.questions) ? parsed.questions
      : (parsed && Array.isArray(parsed.items) ? parsed.items : null));
    if (!arr) return res.json({ ok: false, error: "Le modèle n'a pas renvoyé de JSON exploitable.", raw: String(content).slice(0, 1200) });
    const questions = aiNormalize(mode, arr).slice(0, n);
    if (!questions.length) return res.json({ ok: false, error: 'Questions incomplètes renvoyées par le modèle.', raw: String(content).slice(0, 1200) });
    res.json({ ok: true, mode, model, count: questions.length, latencyMs: Date.now() - t0, questions });
  } catch(e) {
    res.status(502).json({ ok: false, error: e.message, latencyMs: Date.now() - t0 });
  }
});

// ── 🤖 Option A — discussion pour itérer sur un lot de questions ───────────
// Le client envoie l'historique + le lot courant ; le modèle renvoie TOUJOURS
// le lot complet mis à jour, revalidé ici par aiNormalize avant de repartir.
const AI_CHAT_SYSTEM = [
  "Tu es le rédacteur en chef des questions d'un quiz sportif télévisé français.",
  "Tu discutes avec le rédacteur pour améliorer un lot de questions déjà généré.",
  "Tu réponds TOUJOURS par un objet JSON valide et rien d'autre : ni texte avant ou après, ni balise Markdown.",
  "Forme exacte attendue :",
  '{"reply":"ta réponse au rédacteur, en français, 1 à 3 phrases","questions":[ ... le lot COMPLET mis à jour ... ]}',
  "Tu renvoies toujours le lot complet, jamais un diff ni un extrait, même si tu ne modifies rien.",
  "Si le rédacteur pose une question sans demander de changement, tu renvoies le lot inchangé et tu réponds dans \"reply\".",
  "Chaque question conserve exactement la même structure JSON que celle du lot fourni.",
  "Faits exacts et vérifiables uniquement : jamais d'invention, jamais de réponse approximative."
].join(' ');

app.post('/api/admin/ai-chat', async (req, res) => {
  const { password, mode, gameLabel, brief, expectedCount, messages, batch } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  const spec = AI_MODES[mode];
  if (!spec) return res.status(400).json({ ok: false, error: 'Mode de génération inconnu : ' + mode });
  if (!aiKey()) return res.status(400).json({ ok: false, error: "Aucune clé API Nous Portal enregistrée. Ouvre l'onglet 🤖 IA." });

  const history = (Array.isArray(messages) ? messages : [])
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: aiClean(m.content, 1500) }));
  if (!history.length || history[history.length - 1].role !== 'user')
    return res.status(400).json({ ok: false, error: 'Message manquant.' });

  const current = (Array.isArray(batch) ? batch : []).slice(0, 30);
  const etat = [
    'Défi en cours : ' + aiClean(gameLabel, 60) + ' — format imposé : ' + spec.label + '.',
    spec.note ? 'Règles du format : ' + spec.note : '',
    expectedCount ? "Nombre de questions attendu par le jeu : " + aiClean(String(expectedCount), 20) + '.' : '',
    brief ? 'Brief de départ : ' + aiClean(brief, 400) : '',
    '',
    'Lot actuel (' + current.length + ' question(s), JSON) :',
    JSON.stringify({ questions: current })
  ].filter(Boolean).join('\n');

  const t0 = Date.now();
  try {
    const { content, model } = await aiChat([
      { role: 'system', content: AI_CHAT_SYSTEM + '\n\n' + etat },
      ...history
    ], { maxTokens: Math.max(3000, spec.maxTokens || 3000), ms: 180000 });

    const parsed = aiExtractJson(content);
    let raw = null, reply = '';
    if (Array.isArray(parsed)) raw = parsed;
    else if (parsed && typeof parsed === 'object') {
      raw = Array.isArray(parsed.questions) ? parsed.questions : (Array.isArray(parsed.items) ? parsed.items : null);
      reply = aiClean(parsed.reply || parsed.message || parsed.commentaire, 700);
    }
    const questions = raw ? aiNormalize(mode, raw) : [];
    const dropped = raw ? Math.max(0, raw.length - questions.length) : 0;
    res.json({
      ok: true, model, reply,
      questions: questions.length ? questions : current,   // on ne perd jamais le lot
      updated: questions.length > 0,
      dropped,
      debug: (questions.length ? undefined : String(content || '').slice(0, 900)),
      latencyMs: Date.now() - t0
    });
  } catch(e) {
    res.status(502).json({ ok: false, error: e.message, latencyMs: Date.now() - t0 });
  }
});

const PORT = process.env.PORT || 3000;
connectMongo().then(async () => {
  await loadAIConfig();
  connectFormula();
  connectCurling();
  app.listen(PORT, () => console.log(`🏆 http://localhost:${PORT}  |  🔐 /admin.html  |  🤖 IA Nous Portal`));
});
