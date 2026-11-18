// Intègre une nouvelle version du Puissance 4 (fichier brut exporté) dans le site.
// Usage : node tools/integrer-puissance4.js "C:\Users\...\puissance4-dimensionnel.html"
// Réapplique : flèche retour, bouton Partager, méta d'aperçu, écran d'accueil
// (Jouer / Tutoriel), choix d'adversaire en un geste, réglages repliés,
// écran de partie allégé sur mobile. Écrit public/puissance4.html.
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('Usage : node tools/integrer-puissance4.js <fichier.html>'); process.exit(1); }
let t = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
const missing = [];
function rep(a, b, optional) {
  if (typeof a === 'string' ? !t.includes(a) : !a.test(t)) { if (!optional) missing.push(String(a).slice(0, 90)); return; }
  t = t.replace(a, b);
}

// 1) Titre + aperçu de partage
rep(/<title>[^<]*<\/title>/, `<title>Puissance 4 dimensionnel</title>
<meta name="description" content="Un Puissance 4 où l'on peut tourner le plateau, voyager dans le temps et créer des réalités parallèles.">
<meta property="og:title" content="Puissance 4 dimensionnel">
<meta property="og:description" content="Un Puissance 4 où l'on peut tourner le plateau, voyager dans le temps et créer des réalités parallèles.">
<meta property="og:type" content="website">`);

// 2) Flèche retour vers l'accueil du site
rep(/<header>\s*<h1>/, `<header>
  <a href="index.html" title="Retour" style="color:var(--muted);text-decoration:none;font-size:22px;font-weight:900;padding:0 6px">‹</a>
  <h1>`);

// 3) Boutons Menu du jeu + Partager dans l'en-tête
rep(/(<button class="j" data-a="setup">▶ Nouvelle partie<\/button>)/, `$1
  <button class="j" id="p4home">🏠 Menu du jeu</button>
  <button class="j" id="p4link" title="Partager le lien du jeu">🔗 Partager le jeu</button>`);
rep(/<\/header>/, `</header>
<script>
document.getElementById('p4link').addEventListener('click',async e=>{
  const b=e.currentTarget,url=location.origin+'/puissance4',txt='Viens jouer au Puissance 4 dimensionnel : on peut tourner le plateau et voyager dans le temps !';
  if(navigator.share){try{await navigator.share({title:'Puissance 4 dimensionnel',text:txt,url});return}catch(err){if(err&&err.name==='AbortError')return}}
  try{await navigator.clipboard.writeText(url);b.textContent='✓ Lien copié'}catch(_){prompt('Copie ce lien :',url)}
  setTimeout(()=>b.textContent='🔗 Partager le jeu',2000);
});
</script>`);

// 4) Styles
rep(/<\/style>\s*<\/head>/, `/* ── Écran d'accueil du jeu ── */
#home{position:fixed;inset:0;z-index:55;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px 20px calc(24px + env(safe-area-inset-bottom));background:radial-gradient(ellipse 90% 60% at 50% 25%,rgba(127,183,189,.14),transparent 70%),radial-gradient(ellipse 70% 50% at 50% 100%,rgba(154,134,255,.12),transparent 70%),#0a0c0b;text-align:center;overflow:auto}
#home.on{display:flex}
#home .hback{position:absolute;top:14px;left:16px;color:var(--muted);text-decoration:none;font-size:14px}
#home .ht{font:400 clamp(30px,9vw,46px) var(--serif);letter-spacing:.22em;text-transform:uppercase;margin:0;line-height:1.05}
#home .hs{font:12px var(--mono);letter-spacing:.4em;color:var(--acc);text-transform:uppercase;margin-top:6px}
#home .hdots{display:flex;gap:8px;justify-content:center;margin:4px 0 2px}#home .hdots i{width:26px;height:26px;border-radius:50%;box-shadow:inset 0 -3px 0 rgba(0,0,0,.25)}
#home .hdots i:nth-child(odd){background:var(--red)}#home .hdots i:nth-child(even){background:var(--yel)}#home .hdots i:nth-child(3){transform:translateY(-8px)}
#home .hp{color:var(--muted);max-width:330px;margin:0;font-size:15px;line-height:1.45}
#home .hbtns{display:flex;flex-direction:column;gap:12px;width:min(320px,100%);margin-top:6px}
#home .hb{font:600 18px system-ui,sans-serif;padding:16px 18px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
#home .hb small{font-size:12px;font-weight:400;color:var(--muted)}
#home .hb.main{background:linear-gradient(135deg,#7fb7bd,#9a86ff);color:#0a0c0b;border:0;font-size:20px;box-shadow:0 10px 34px rgba(127,183,189,.25)}#home .hb.main small{color:rgba(10,12,11,.7)}
#home .hl2{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:4px}
#home .hl2 button{background:none;border:0;color:var(--muted);font:14px system-ui,sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:4px}
/* ── Nouvelle partie simplifiée ── */
#smodal .adv{margin-top:14px;border:1px solid var(--line);border-radius:10px;padding:4px 12px 10px}
#smodal .adv>summary{cursor:pointer;padding:8px 0;color:var(--muted);font-size:14px;list-style:none}#smodal .adv>summary::before{content:'⚙ '}#smodal .adv[open]>summary{color:var(--ink)}
@media (max-width:719px){
 .mod .box{max-height:none;height:100%;width:100%;border-radius:0;padding:16px 16px 18px}.mod{padding:0}
 #smodal .oppgrid{grid-template-columns:1fr;gap:6px}
 #smodal .oc{flex-direction:row;justify-content:flex-start;text-align:left;padding:10px 12px;gap:10px}#smodal .oc .i{font-size:24px}#smodal .oc small{margin-left:auto}
 #smodal h2{font-size:19px}
 #oppcard .bio,#oppcard .rec{display:none}#oppcard .opp{margin:0}
 #log{max-height:120px;overflow:auto}
}
</style>
</head>`);

// 5) Écran d'accueil
rep('<div id="banner">', `<div id="home" class="on">
  <a class="hback" href="index.html">‹ Grand Chelem</a>
  <div>
    <div class="hdots"><i></i><i></i><i></i><i></i></div>
    <h1 class="ht">Puissance 4</h1>
    <div class="hs">dimensionnel</div>
  </div>
  <p class="hp">Aligne 4 jetons… en tournant le plateau et en voyageant dans le temps.</p>
  <div class="hbtns">
    <button class="hb main" id="h-play">▶ Jouer<small>contre l'ordinateur ou à deux</small></button>
    <button class="hb" id="h-tut">🎓 Tutoriel<small>7 étapes courtes pour apprendre</small></button>
  </div>
  <div class="hl2"><button id="h-rules">📖 Règles</button><button id="h-share">🔗 Partager</button></div>
</div>
<div id="banner">`);

// 6) Nouvelle partie : toucher un adversaire lance la partie, réglages repliés
rep(/<h3>Ton adversaire<\/h3>/, `<h3>Touche ton adversaire pour commencer</h3>`);
rep(/<h3>Ta couleur<\/h3>/, `<details class="adv"><summary>Réglages : couleur, pouvoirs, options</summary>
<h3>Ta couleur (contre l'ordinateur)</h3>`);
rep(/<p[^>]*>\s*<button class="j on big" data-a="sgo">[\s\S]*?<\/p>/, `</details>`);
rep("if(a==='sopp'){SEL.ai=+t.dataset.k;setupRender();return}", "if(a==='sopp'){SEL.ai=+t.dataset.k;setupGo();return}");
rep("document.getElementById('scol').innerHTML=SEL.ai?[", "document.getElementById('scol').innerHTML=1?[", true);
rep('<button class="j" data-a="setup">▶ Jouer directement</button>', '<button class="j" data-a="setup">▶ Jouer</button>', true);

// 7) Démarrage : écran d'accueil au lieu des règles / réglages
rep(/try\{if\(!localStorage\.getItem\('p4d_rules'\)\)[^\n]*/, `const HOME=document.getElementById('home');
function homeShow(){document.querySelector('header').classList.remove('open');HOME.classList.add('on')}
function homeHide(){HOME.classList.remove('on')}
{const _go=setupGo,_tut=tutStart;setupGo=function(){homeHide();return _go.apply(this,arguments)};tutStart=function(){homeHide();return _tut.apply(this,arguments)}}
document.getElementById('h-play').onclick=()=>setupOpen();
document.getElementById('h-tut').onclick=()=>tutStart(0);
document.getElementById('h-rules').onclick=()=>document.getElementById('rmodal').classList.add('on');
document.getElementById('h-share').onclick=()=>document.getElementById('p4link').click();
document.getElementById('p4home').onclick=homeShow;
if(window.innerWidth<720){const d=document.querySelector('aside details[open]');if(d)d.removeAttribute('open')}`);

const out = path.join(__dirname, '..', 'public', 'puissance4.html');
fs.writeFileSync(out, t, 'utf8');
if (missing.length) { console.error('⚠ Ancres introuvables (à adapter) :\n - ' + missing.join('\n - ')); process.exit(2); }
console.log('OK → ' + out);
