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
      teams        = d.teams        || [];
      accounts     = d.accounts     || {};
      console.log(` ${athletes.length} sportif(s) chargé(s) depuis fichier`);
      console.log(` ${teams.length} équipe(s), ${Object.keys(accounts).length} compte(s) chargé(s) depuis fichier`);
    }
  } catch(e) { console.error('Erreur lecture fichier:', e.message); }
}
function saveToFile() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ athletes, scores, globalScores, musicConfig, welcomeImage, teams, accounts }, null, 2)); }
  catch(e) { console.error('Erreur écriture fichier:', e.message); }
}
const norm = s => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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
      rebuildGlobalScores(); // le général doit inclure les points Formula·Grid dès le démarrage
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
      rebuildGlobalScores(); // le général doit inclure les points Formula·Grid dès le démarrage
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
  return { id: c.id, name: c.name, w: c.w, h: c.h, laps: c.laps, attempts: c.attempts, warmup: c.warmup||0, freePractice: !!c.freePractice || (c.warmup||0)>0, pointsMultiplier: Number.isFinite(c.pointsMultiplier) ? c.pointsMultiplier : 10, fuelCapacity: c.fuelCapacity||0, fuelEnabled: c.fuelEnabled !== false };
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
  // Formula·Grid : points calculés EN DIRECT (jamais figés), fusionnés dans le même total général
  const fgTotals = formulaGridPointsByPseudo();
  for (const entry of Object.values(fgTotals)) {
    const key = norm(entry.pseudo);
    if (!map[key]) map[key] = { pseudo: entry.pseudo, totalScore: 0, count: 0, lastDate: entry.date };
    map[key].totalScore += entry.score;
    map[key].count++;
    if (entry.date > map[key].lastDate) map[key].lastDate = entry.date;
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
    base.repliqueAnswer  = athlete.repliqueAnswer || '';
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    base.answer          = athlete.repliqueAuthor || athlete.answer || '';
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
  } else if (athlete.type === 'roulette') {
    base.rouletteText = athlete.rouletteText||'';
    base.rouletteAnswer = athlete.rouletteAnswer||'';
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
    base.trivQuestions = Array.from({length:6},(_,sec)=>{
      const raw = athlete.trivQuestions||[];
      const q = raw.find(x=>x&&parseInt(x.sectionIdx)===sec)||raw[sec]||{};
      return { question:q.question||'', answer:q.answer||'', tol:parseInt(q.tol)||1, sectionIdx:sec, theme:q.theme||'' };
    });
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
    base.apolQuestions = (athlete.apolQuestions||[]).slice(0,5).map(q=>({
      question:q.question||'', theme:q.theme||'', answer:q.answer||'', tol:parseInt(q.tol)||1
    }));
    base.bonusQ = athlete.bonusQ||'';
    base.bonusA = athlete.bonusA||'';
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
    base.sportifs = (athlete.sportifs||[]).map(s=>({nom:s.nom||'',correct:s.correct!==undefined?s.correct:0}));
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
  const alreadyFound = (found||[]).map(norm);
  if(alreadyFound.includes(normAns)) return res.json({ correct: false, reason: 'already' });
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
  res.json({ correct, total: (athlete.grimpeAnswers||[]).length, answer: matchedGroup?matchedGroup[0]:null });
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
    base.repliqueAnswer  = athlete.repliqueAnswer || '';
    base.rqTolerance    = athlete.rqTolerance !== undefined ? athlete.rqTolerance : 1;
    base.rqTime        = athlete.rqTime || 60;
    base.repliqueAuthorChoices = athlete.repliqueAuthorChoices || [];
    base.repliqueCitation = athlete.repliqueCitation || '';
    base.answer          = athlete.repliqueAuthor || athlete.answer || '';
    base.maxScore = 100;
  } else if (athlete.type === 'biathlon') {
    base.biatTheme         = athlete.biatTheme || '';
    base.biatAnnounceTime  = athlete.biatAnnounceTime || 45;
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
    base.escaladeTol = athlete.escaladeTol||1;
    base.maxScore = 200;
  } else if (athlete.type === 'roulette') {
    base.rouletteText = athlete.rouletteText||'';
    base.rouletteAnswer = athlete.rouletteAnswer||'';
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
    base.trivQuestions = Array.from({length:6},(_,sec)=>{
      const raw = athlete.trivQuestions||[];
      const q = raw.find(x=>x&&parseInt(x.sectionIdx)===sec)||raw[sec]||{};
      return { question:q.question||'', answer:q.answer||'', tol:parseInt(q.tol)||1, sectionIdx:sec, theme:q.theme||'' };
    });
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
    base.apolQuestions = (athlete.apolQuestions||[]).slice(0,5).map(q=>({
      question:q.question||'', theme:q.theme||'', answer:q.answer||'', tol:parseInt(q.tol)||1
    }));
    base.bonusQ = athlete.bonusQ||'';
    base.bonusA = athlete.bonusA||'';
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
    base.bjAnswers = athlete.bjAnswers || {};
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
  const { password, id, name, w, h, rows, start, laps, attempts, published } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Non autorisé' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom du circuit obligatoire' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Circuit vide' });
  if (!start || typeof start.x !== 'number' || typeof start.y !== 'number') return res.status(400).json({ error: 'Position de départ manquante' });
  if (!rows.some(r => r.includes('F'))) return res.status(400).json({ error: 'Ligne d\'arrivée manquante' });

  const circuitId = id || 'fg_' + Date.now();
  const existingIdx = circuits.findIndex(c => c.id === circuitId);
  const data = {
    id: circuitId, name: name.trim().slice(0,60), w, h, rows,
    start: { x: start.x, y: start.y, dir: start.dir||0 },
    laps: Math.max(1, Math.min(20, parseInt(laps)||1)),
    attempts: Math.max(1, Math.min(50, parseInt(attempts)||3)),
    warmup: Math.max(0, Math.min(5, parseInt(req.body.warmup)||0)),
    freePractice: !!req.body.freePractice,
    pointsMultiplier: Math.max(1, Math.min(100, parseInt(req.body.pointsMultiplier)||10)),
    fuelCapacity: Math.max(0, Math.min(9999, parseInt(req.body.fuelCapacity)||0)), // 0 = automatique
    fuelEnabled: req.body.fuelEnabled !== false, // false = essence illimitée
    published: !!published,
    // Le fantôme de référence survit à une réédition du circuit
    ghost: existingIdx>=0 ? circuits[existingIdx].ghost : undefined,
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
  // Meilleur tour : durée mini entre deux passages de ligne, sur tous les runs
  const bestLapOf = (rs) => {
    let best = null;
    for (const r of rs) {
      const lm = Array.isArray(r.lapMoves) ? r.lapMoves : [];
      for (let i = 0; i < lm.length; i++) {
        const d = lm[i] - (i ? lm[i-1] : 0);
        if (Number.isFinite(d) && d > 0 && (best === null || d < best.lap)) best = { lap: d, pseudo: r.pseudo };
      }
    }
    return best;
  };
  // Mes meilleurs splits (min case par case sur tous mes runs)
  const myBestCp = [];
  for (const r of mine) {
    (r.cpTimes || []).forEach((v, i) => {
      if (Number.isFinite(v) && (myBestCp[i] == null || v < myBestCp[i])) myBestCp[i] = v;
    });
  }
  res.json({
    top,
    attemptsUsed: mine.length,
    attemptsLeft: Math.max(0, c.attempts - mine.length),
    best: bestRun(mine),
    myBestCp,
    myBestLap: bestLapOf(mine),
    worldBestLap: bestLapOf(runs),
    // Meilleur temps TOUS JOUEURS confondus + ses splits (pour le delta en course)
    worldBest: (() => {
      const wb = bestRun(runs);
      if (!wb) return null;
      return { pseudo: wb.pseudo, moves: wb.moves, left: wb.left||0, cpTimes: wb.cpTimes || [] };
    })()
  });
});

app.post('/api/formula/run', async (req, res) => {
  const { circuitId, pseudo, moves, left, laps, cpTimes, lapMoves } = req.body;
  const c = circuits.find(x => x.id === circuitId);
  if (!c) return res.status(404).json({ error: 'Circuit introuvable' });
  const cleanPseudo = (pseudo||'').trim().slice(0,24);
  if (!cleanPseudo) return res.status(400).json({ error: 'Pseudo requis' });
  // Les points Formula·Grid rejoignent le classement général : le pseudo doit être un compte Arena
  if (!accounts[cleanPseudo.toLowerCase()]) return res.status(403).json({ error: 'Crée d\'abord ton compte Arena Sport avec ce pseudo — tes points rejoindront le classement général', noAccount: true });
  if (!Number.isFinite(moves) || moves < 1) return res.status(400).json({ error: 'Résultat invalide' });

  circuitRuns[circuitId] = circuitRuns[circuitId] || [];
  const already = circuitRuns[circuitId].filter(r => norm(r.pseudo) === norm(cleanPseudo));
  if (already.length >= c.attempts) return res.status(403).json({ error: 'Plus d\'essais disponibles', attemptsLeft: 0 });

  const run = {
    pseudo: cleanPseudo, moves, left: left||0, laps: laps||c.laps,
    cpTimes: Array.isArray(cpTimes) ? cpTimes.filter(Number.isFinite).slice(0, 50) : [],
    lapMoves: Array.isArray(lapMoves) ? lapMoves.filter(Number.isFinite).slice(0, 30) : [],
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
  if (!accounts[cleanPseudo.toLowerCase()]) return res.status(403).json({ error: 'Compte Arena requis', noAccount: true });

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
  res.json({
    mongodb: db ? 'connecté' : 'non connecté',
    mongoUri: MONGO_URI ? 'définie (' + MONGO_URI.slice(0,20) + '...)' : 'ABSENTE',
    athletes: athletes.length,
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
  if (!answer && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe' && type !== 'biathlon' && type !== 'maillonfaible' && type !== 'haltero' && type !== 'tirarlarc' && type !== 'nagesync' && type !== 'assaut' && type !== 'var' && type !== 'rvlf' && type !== 'plongee' && type !== 'escalade' && type !== 'roulette' && type !== 'bowling' && type !== 'equitation' && type !== 'badminton' && type !== 'melimelo' && type !== 'apol' && type !== 'trivpursuit') return res.status(400).json({ error: 'Nom obligatoire' });
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
  if (type !== 'image' && type !== 'buzz' && type !== 'sportus' && type !== 'prix' && type !== 'trappe' && type !== 'demineur' && type !== 'chase' && type !== 'scout' && type !== 'replique' && type !== 'blackjack' && type !== 'grimpe' && type !== 'biathlon' && type !== 'maillonfaible' && type !== 'haltero' && type !== 'tirarlarc' && type !== 'nagesync' && type !== 'assaut' && type !== 'var' && type !== 'rvlf' && type !== 'plongee' && type !== 'escalade' && type !== 'roulette' && type !== 'bowling' && type !== 'equitation' && type !== 'badminton' && type !== 'melimelo' && type !== 'apol' && type !== 'trivpursuit' && !clue) return res.status(400).json({ error: 'Description obligatoire' });

  // Vérification taille image base64
  const b64 = req.body.imageBase64 || '';
  if (b64 && b64.length > 8 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image trop lourde — max 6MB' });
  }

  // Support réponses multiples séparées par ; dans le champ réponse
  const answerParts = (answer||'').split(';').map(s=>s.trim()).filter(Boolean);
  const safeAnswer = answerParts[0] || (type==='demineur'?'Le Démineur':type==='chase'?'The Chase':type==='replique'?(req.body.repliqueAuthor||'Réplique').trim():type==='blackjack'?(req.body.bjTheme||'Blackjack').trim():type==='grimpe'?(req.body.grimpeTheme||"L'Alpe d'Huez").trim():type==='var'?'La VAR':type==='rvlf'?'Retour vers le Futur':type==='plongee'?'La Plongée':type==='escalade'?"L'Escalade":type==='roulette'?'Roulette Russe':type==='bowling'?'Bowling Quiz':type==='equitation'?'Équitation CSO':type==='badminton'?'Badminton Quiz':type==='trappe'?'La Trappe':type==='maillonfaible'?'Maillon Faible':type==='haltero'?'Haltéro-Quiz':type==='assaut'?"L'Escrime":type==='tirarlarc'?"Tir à l'Arc":type==='nagesync'?'Natation':type==='biathlon'?(req.body.biatTheme||'Biathlon').trim():type==='melimelo'?'Méli-Mélo':type==='apol'?'À prendre ou à laisser':type==='trivpursuit'?'Trivial Pursuit':'???');
  const parts         = safeAnswer.split(/\s+/);
  const autoAliases   = [safeAnswer.toLowerCase()];
  if(parts.length > 1) autoAliases.push(parts[parts.length - 1].toLowerCase());
  // Ajouter toutes les variantes séparées par ; comme aliases
  answerParts.slice(1).forEach(a => autoAliases.push(a.toLowerCase()));
  const manualAliases = (typeof aliases === 'string' ? aliases : Array.isArray(aliases) ? aliases.join(',') : '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
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
  if(!db){ saveToFile(); return; }
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
  else saveToFile();
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
  if(!db){ saveToFile(); return; }
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


const PORT = process.env.PORT || 3000;
connectMongo().then(() => {
  connectFormula();
  app.listen(PORT, () => console.log(`🏆 http://localhost:${PORT}  |  🔐 /admin.html`));
});
