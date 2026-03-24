const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Leaderboard en mémoire ──────────────────────────────────────────────
let scores = [];

// ── Base de données des sportifs ────────────────────────────────────────
const ATHLETES = [
  {
    id: 1, answer: 'Lionel Messi',
    aliases: ['messi','leo messi','lionel messi'],
    emoji: '⚽',
    clue: 'Né à Rosario en Argentine, cet attaquant magique a remporté 8 Ballon d\'Or, a brillé au FC Barcelone pendant vingt ans, et a offert à son pays la Coupe du Monde 2022 au Qatar à 35 ans.'
  },
  {
    id: 2, answer: 'Serena Williams',
    aliases: ['serena','serena williams','williams'],
    emoji: '🎾',
    clue: 'Cette joueuse américaine a dominé le circuit féminin pendant deux décennies, remportant 23 titres du Grand Chelem en simple, dont six à l\'US Open, devenant une icône bien au-delà du tennis.'
  },
  {
    id: 3, answer: 'Usain Bolt',
    aliases: ['bolt','usain bolt','usain'],
    emoji: '⚡',
    clue: 'Ce sprinter jamaïcain surnommé l\'Éclair a établi les records du monde du 100m en 9,58 secondes et du 200m en 19,19 secondes lors des Mondiaux de Berlin en 2009, avec huit médailles d\'or olympiques à son palmarès.'
  },
  {
    id: 4, answer: 'Michael Jordan',
    aliases: ['jordan','michael jordan','mj','mike'],
    emoji: '🏀',
    clue: 'Surnommé Air, ce basketteur américain des Chicago Bulls a remporté six titres NBA et six MVP des Finales, inspirant la célèbre gamme de sneakers qui porte son prénom depuis 1984.'
  },
  {
    id: 5, answer: 'Cristiano Ronaldo',
    aliases: ['ronaldo','cristiano ronaldo','cr7','cristiano'],
    emoji: '⚽',
    clue: 'Ce joueur portugais né à Madère a remporté cinq Ballon d\'Or, cinq Ligues des Champions avec trois clubs différents, et détient le record de buts en sélection nationale avec plus de 120 réalisations.'
  },
  {
    id: 6, answer: 'Muhammad Ali',
    aliases: ['ali','muhammad ali','cassius clay'],
    emoji: '🥊',
    clue: 'Triple champion du monde des poids lourds, ce boxeur américain surnommé The Greatest était autant connu pour son éloquence que pour ses poings. Il refusa la conscription militaire en 1967 pour des raisons religieuses.'
  },
  {
    id: 7, answer: 'Rafael Nadal',
    aliases: ['nadal','rafael nadal','rafa'],
    emoji: '🎾',
    clue: 'Ce tennisman espagnol de Majorque surnommé le Roi de la Terre Battue a remporté quatorze fois Roland Garros et vingt-deux titres du Grand Chelem, formant avec son rival suisse la plus grande rivalité de l\'histoire du tennis.'
  },
  {
    id: 8, answer: 'Simone Biles',
    aliases: ['biles','simone biles','simone'],
    emoji: '🤸',
    clue: 'Cette gymnaste américaine considérée comme la meilleure de tous les temps a remporté sept médailles d\'or mondiales, et plusieurs éléments du Code de Pointage de la FIG portent désormais son nom.'
  },
  {
    id: 9, answer: 'Roger Federer',
    aliases: ['federer','roger federer','roger'],
    emoji: '🎾',
    clue: 'Ce tennisman suisse aux mouvements d\'une fluidité exceptionnelle a remporté vingt titres du Grand Chelem dont huit fois Wimbledon, et a été numéro un mondial pendant 310 semaines au total.'
  },
  {
    id: 10, answer: 'LeBron James',
    aliases: ['lebron','lebron james','king james'],
    emoji: '🏀',
    clue: 'Surnommé King James, ce basketteur américain est le meilleur marqueur de l\'histoire de la NBA, ayant remporté quatre titres avec trois franchises différentes tout en étant connu pour ses actions philanthropiques.'
  }
];

// ── GET /api/athlete — sportif aléatoire ─────────────────────────────────
app.get('/api/athlete', (req, res) => {
  const a = ATHLETES[Math.floor(Math.random() * ATHLETES.length)];
  res.json({
    id:        a.id,
    clue:      a.clue,
    emoji:     a.emoji,
    wordCount: a.clue.split(/\s+/).filter(Boolean).length
  });
});

// ── POST /api/check — vérifier la réponse ────────────────────────────────
app.post('/api/check', (req, res) => {
  const { athleteId, answer } = req.body;
  const athlete = ATHLETES.find(a => a.id === athleteId);
  if (!athlete) return res.status(404).json({ correct: false });

  const norm = s => s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const correct = athlete.aliases.some(a => norm(a) === norm(answer));
  res.json({
    correct,
    answer:  correct ? athlete.answer : null,
    message: correct
      ? `Bravo ! C'est bien ${athlete.answer} ! 🎉`
      : 'Pas encore… essaie encore !'
  });
});

// ── POST /api/score — enregistrer un score ───────────────────────────────
app.post('/api/score', (req, res) => {
  const { pseudo, score, athleteName } = req.body;
  if (!pseudo || score === undefined) return res.status(400).json({ error: 'Données manquantes' });

  const entry = { pseudo: pseudo.trim().slice(0, 20), score, athleteName, date: new Date().toISOString() };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 100);

  const rank = scores.indexOf(entry) + 1;
  res.json({ success: true, rank, total: scores.length });
});

// ── GET /api/scores — top 10 ─────────────────────────────────────────────
app.get('/api/scores', (req, res) => {
  res.json(scores.slice(0, 10));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏆 Sportif Game → http://localhost:${PORT}`));
