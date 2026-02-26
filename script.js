
/******************************************************

 * Puissance 4 — SCRIPT (Partie 1/3)

 * - Config & état

 * - Utilitaires & statut

 * - Barre des scores

 * - Plateau visuel (labels) + rendu pions

 * - Logique de base (recommencer / jouer un coup)

 ******************************************************/



/* ===================== CONFIG ===================== */

// Mission 3 → par défaut 9x9 (tu peux changer ici si besoin)

let config = { hauteur: 9, largeur: 9, commence: "rouge" };

function H() { return config.hauteur; }

function L() { return config.largeur; }



function chargerConfig() {

  const txt = localStorage.getItem("p4_config");

  if (!txt) return;

  try {

    const c = JSON.parse(txt);

    if (Number.isFinite(c.hauteur) && c.hauteur >= 4) config.hauteur = c.hauteur;

    if (Number.isFinite(c.largeur) && c.largeur >= 4) config.largeur = c.largeur;

    if (c.commence === "rouge" || c.commence === "jaune") config.commence = c.commence;

  } catch {}

}

function sauverConfig() {

  localStorage.setItem("p4_config", JSON.stringify(config));

}

function nouveauNumeroPartie() {

  const n = Number(localStorage.getItem("p4_idPartie") || "0") + 1;

  localStorage.setItem("p4_idPartie", String(n));

  return n;

}



/* ===================== ÉTAT GLOBAL ===================== */

let tableau;                 // matrice HxL (null | "rouge" | "jaune")

let joueurActif;             // "rouge" | "jaune"

let fin;                     // bool

let resultat = null;         // "rouge" | "jaune" | "nul" | null

let mode = 2;                // 0 robot vs robot / 1 humain vs IA / 2 humains

let autoTimer = null;

let enPause = false;

let idPartie = 0;

let historique = [];         // [{row,col,joueur}]

let casesGagnantes = [];     // [{row,col}]

let enReplay = false;

let replayIndex = 0;

let snapshotAvantReplay = null;

let historiqueSource = [];



// IA : on garde Minimax pour le fallback (Partie 2/3), et DB pour l’IA principale

let IA = { type: "db", depth: 4 };

function chargerIA(){

  try{

    const txt = localStorage.getItem("p4_ai");

    if (!txt) return;

    const o = JSON.parse(txt);

    if (o && (o.type === "aleatoire" || o.type === "minimax" || o.type === "db")) IA.type = o.type;

    if (Number.isFinite(o.depth)) IA.depth = Math.max(1, Math.min(8, o.depth));

  }catch{}

}

function sauverIA(){

  localStorage.setItem("p4_ai", JSON.stringify(IA));

}



/* ===================== DOM REFS ===================== */

const Tab    = document.getElementById("tableau");

const statut = document.getElementById("deroulement");

const elMode = document.getElementById("mode");



// Garde-fou (au cas où l’HTML change)

if (!Tab || !statut || !elMode) {

  console.error("HTML incomplet : il manque #tableau, #deroulement ou #mode");

}



/* ===================== UTILS & STATUT ===================== */

function isPlateauPlein() {

  return tableau.every(ligne => ligne.every(cell => cell !== null));

}



function MAJ() {

  const stopBtn = document.getElementById("stop");

  if (stopBtn) stopBtn.textContent = (enPause && !fin) ? "Reprendre" : "Arrêter";



  if (enReplay) {

    statut.textContent = `Replay : coup ${replayIndex}/${historiqueSource.length}`;

    return;

  }

  if (enPause && !fin) {

    statut.textContent = "Pause (clique sur Reprendre)";

    return;

  }

  if (fin) {

    statut.textContent = (resultat === "nul")

      ? "Match nul !"

      : `${(resultat === "rouge") ? "Rouge" : "Jaune"} gagne !`;

    return;

  }

  statut.textContent = `Au tour du ${(joueurActif === "rouge") ? "Rouge" : "Jaune"}`;

}



function cloneTableau(t = tableau) {

  return t.map(l => l.slice());

}



/* ===================== BARRE DES SCORES ===================== */

function initScores(){

  const S = document.getElementById("scores");

  if (!S) return;

  S.innerHTML = "";

  S.style.setProperty("--cols", L());

  for (let c = 0; c < L(); c++){

    const d = document.createElement("div");

    d.className = "scorecell invalide";

    d.textContent = "—";

    d.dataset.col = c;

    S.appendChild(d);

  }

}

function setScoreCol(col, value, valid){

  const S = document.getElementById("scores");

  if (!S) return;

  const cell = S.children[col];

  if (!cell) return;

  cell.textContent = (value === null || value === undefined) ? "—" : String(value);

  cell.classList.toggle("invalide", !valid);

}



/* ===================== PLATEAU VISUEL ===================== */

function TabVisu() {

  if (!Tab) return;

  Tab.innerHTML = "";



  // Grille avec labels (→ CSS .board utilise --cols/--rows)

  Tab.style.setProperty("--cols", L() + 1);

  Tab.style.setProperty("--rows", H() + 1);



  // Coin vide (haut-gauche)

  const corner = document.createElement("div");

  corner.className = "label";

  Tab.appendChild(corner);



  // En-têtes colonnes (1..L)

  for (let col = 0; col < L(); col++) {

    const head = document.createElement("div");

    head.className = "label";

    head.textContent = col + 1;

    Tab.appendChild(head);

  }



  // Lignes + cases

  for (let row = 0; row < H(); row++) {

    const left = document.createElement("div");

    left.className = "label";

    left.textContent = row + 1;

    Tab.appendChild(left);



    for (let col = 0; col < L(); col++) {

      const cell = document.createElement("div");

      cell.className = "Case";

      cell.dataset.row = row;

      cell.dataset.col = col;

      cell.addEventListener("click", () => jouer(col)); // jouer() défini plus bas

      Tab.appendChild(cell);

    }

  }



  // Barre des scores pour L colonnes

  initScores();

}



function viderVisuel() {

  if (!Tab) return;

  Tab.querySelectorAll(".Case").forEach(cell => { cell.className = "Case"; });

}



// Convertit (row,col) en index dans la grille DOM (avec labels)

function indexCase(row, col) {

  const colsTotal = L() + 1;   // +1 pour la colonne des labels

  const header = colsTotal;    // 1ère ligne = labels (L+1 cases)

  return header + row * colsTotal + 1 + col; // +1 pour le label à gauche

}



function pion(row, col, joueur) {

  if (!Tab) return;

  const idx = indexCase(row, col);

  Tab.children[idx]?.classList.add(joueur);

}



function surligner() {

  if (!Tab) return;

  for (const pos of casesGagnantes) {

    const idx = indexCase(pos.row, pos.col);

    Tab.children[idx]?.classList.add("win");

  }

}



/* ===================== LOGIQUE DE BASE ===================== */

function recommencer() {

  tableau = Array.from({ length: H() }, () => Array(L()).fill(null));

  joueurActif = config.commence; // "rouge" par défaut

  fin = false; resultat = null;

  historique = []; casesGagnantes = [];

  enPause = false; enReplay = false; replayIndex = 0;



  MAJ();

  initScores();

}



// Retourne la 1ère ligne dispo en partant du bas ; -1 si pleine

function caseDispo(col) {

  for (let r = H() - 1; r >= 0; r--) if (tableau[r][col] === null) return r;

  return -1;

}



// Vérifie si le coup joué en (row,col) gagne

function Gagnant(row, col) {

  const p = tableau[row][col];

  if (!p) return false;



  const dirs = [

    { dr: 0, dc: 1 },  // →

    { dr: 1, dc: 0 },  // ↓

    { dr: 1, dc: 1 },  // ↘

    { dr: 1, dc: -1 }  // ↙

  ];



  for (const { dr, dc } of dirs) {

    const ligne = [{ row, col }];



    // sens +

    let r = row + dr, c = col + dc;

    while (r >= 0 && r < H() && c >= 0 && c < L() && tableau[r][c] === p) {

      ligne.push({ row: r, col: c });

      r += dr; c += dc;

    }



    // sens -

    r = row - dr; c = col - dc;

    while (r >= 0 && r < H() && c >= 0 && c < L() && tableau[r][c] === p) {

      ligne.push({ row: r, col: c });

      r -= dr; c -= dc;

    }



    if (ligne.length >= 4) {

      casesGagnantes = ligne;

      return true;

    }

  }

  return false;

}



// Applique un coup dans la colonne col (0..L-1)

function appliquerCoup(col) {

  const row = caseDispo(col);

  if (row === -1) return false;



  tableau[row][col] = joueurActif;

  pion(row, col, joueurActif);

  historique.push({ row, col, joueur: joueurActif });



  if (Gagnant(row, col)) {

    fin = true; resultat = joueurActif;

    surligner(); MAJ();

    return true;

  }

  if (isPlateauPlein()) {

    fin = true; resultat = "nul";

    MAJ();

    return true;

  }



  joueurActif = (joueurActif === "rouge") ? "jaune" : "rouge";

  MAJ();

  return true;

}



/* ============================================================

 * Les fonctions suivantes seront fournies en Partie 2/3 et 3/3 :

 *  - IA Minimax (fallback) + robotJoue/robotAleatoire

 *  - IA DB (robotDb) + bouton "Analyse IA" (proposer DB)

 *  - undo/save/load/replay/paramètres

 *  - main() + listeners

 * ============================================================ */

/************************************************************

 * SCRIPT - Partie 2/3

 * - IA Minimax (fallback)

 * - IA aléatoire

 * - robotJoue()

 * - Replay

 * - Undo / Save / Load

 * - Paramétrage

 ************************************************************/



/* ===================== IA (Minimax) ===================== */



function caseDispoSur(t, col){

  for (let r = H() - 1; r >= 0; r--)

    if (t[r][col] === null) return r;

  return -1;

}



function coupsPossibles(t){

  const arr = [];

  for (let c = 0; c < L(); c++)

    if (caseDispoSur(t, c) !== -1) arr.push(c);

  // center bias

  const center = (L() - 1) / 2;

  arr.sort((a,b)=> Math.abs(a - center) - Math.abs(b - center));

  return arr;

}



function gagnantSur(t){

  const dirs = [

    {dr:0,dc:1},

    {dr:1,dc:0},

    {dr:1,dc:1},

    {dr:1,dc:-1}

  ];

  for (let r=0; r<H(); r++){

    for (let c=0; c<L(); c++){

      const p = t[r][c];

      if (!p) continue;

      for (const {dr,dc} of dirs){

        let count=1;

        let rr=r+dr, cc=c+dc;

        while(rr>=0&&rr<H()&&cc>=0&&cc<L() && t[rr][cc]===p){ count++; rr+=dr; cc+=dc; }

        rr=r-dr; cc=c-dc;

        while(rr>=0&&rr<H()&&cc>=0&&cc<L() && t[rr][cc]===p){ count++; rr-=dr; cc-=dc; }

        if (count>=4) return p;

      }

    }

  }

  return null;

}



function pleinSur(t){

  return t.every(ligne => ligne.every(cell => cell !== null));

}



function evalFenetre(cells, maxP, minP){

  const nbMax = cells.filter(x=>x===maxP).length;

  const nbMin = cells.filter(x=>x===minP).length;

  const nbEmpty = cells.filter(x=>x===null).length;



  if (nbMax===4) return 100000;

  if (nbMin===4) return -100000;



  let score = 0;

  if (nbMax===3&&nbEmpty===1) score+=120;

  if (nbMax===2&&nbEmpty===2) score+=15;

  if (nbMin===3&&nbEmpty===1) score-=110;

  if (nbMin===2&&nbEmpty===2) score-=12;



  return score;

}



function evaluation(t,maxP){

  const minP = (maxP==="rouge")?"jaune":"rouge";

  let score=0;



  const centerCol=Math.floor(L()/2);

  for (let r=0;r<H();r++)

    if(t[r][centerCol]===maxP) score+=6;



  for (let r=0;r<H();r++){

    for (let c=0;c<=L()-4;c++)

      score+=evalFenetre([t[r][c],t[r][c+1],t[r][c+2],t[r][c+3]],maxP,minP);

  }

  for (let r=0;r<=H()-4;r++){

    for (let c=0;c<L();c++)

      score+=evalFenetre([t[r][c],t[r+1][c],t[r+2][c],t[r+3][c]],maxP,minP);

  }

  for (let r=0;r<=H()-4;r++){

    for (let c=0;c<=L()-4;c++)

      score+=evalFenetre([t[r][c],t[r+1][c+1],t[r+2][c+2],t[r+3][c+3]],maxP,minP);

  }

  for (let r=3;r<H();r++){

    for (let c=0;c<=L()-4;c++)

      score+=evalFenetre([t[r][c],t[r-1][c+1],t[r-2][c+2],t[r-3][c+3]],maxP,minP);

  }



  return score;

}



let searchStats = { nodes:0 };



function minimax(t, depth, maximizing, maxP, alpha, beta){

  searchStats.nodes++;



  const w=gagnantSur(t);

  if (w===maxP) return 100000-(100-depth);

  if (w && w!==maxP) return -100000+(100-depth);

  if (depth===0 || pleinSur(t)) return evaluation(t,maxP);



  const minP=(maxP==="rouge")?"jaune":"rouge";

  const moves=coupsPossibles(t);



  if (maximizing){

    let best=-Infinity;

    for (const col of moves){

      const row=caseDispoSur(t,col);

      t[row][col]=maxP;

      const val=minimax(t,depth-1,false,maxP,alpha,beta);

      t[row][col]=null;

      if (val>best) best=val;

      if (best>alpha) alpha=best;

      if (beta<=alpha) break;

    }

    return best;

  } else {

    let best=Infinity;

    for (const col of moves){

      const row=caseDispoSur(t,col);

      t[row][col]=minP;

      const val=minimax(t,depth-1,true,maxP,alpha,beta);

      t[row][col]=null;

      if (val<best) best=val;

      if (best<beta) beta=best;

      if (beta<=alpha) break;

    }

    return best;

  }

}



/* ===================== IA ALÉATOIRE ===================== */



function robotAleatoire() {

  if (fin || enPause || enReplay) return;

  const jouables = [];

  for (let c=0;c<L();c++) if (caseDispo(c)!==-1) jouables.push(c);

  if (jouables.length === 0) return;

  const col = jouables[(Math.random()*jouables.length)|0];

  appliquerCoup(col);

}



/* ===================== IA fallback Minimax ===================== */



function robotMinimax(){

  if (fin || enPause || enReplay) return;

  const maxP = joueurActif;

  const depth = IA.depth;

  const t = cloneTableau(tableau);

  const moves = coupsPossibles(t);



  searchStats.nodes = 0;

  let bestCol = null, bestScore = -Infinity;



  for (let c = 0; c < L(); c++) setScoreCol(c, null, false);



  for (const col of moves){

    const row = caseDispoSur(t, col);

    t[row][col] = maxP;

    const val = minimax(t, depth-1, false, maxP, -Infinity, +Infinity);

    t[row][col] = null;



    setScoreCol(col, val, true);

    if (val > bestScore){ bestScore = val; bestCol = col; }

  }



  if (bestCol !== null){

    statut.textContent = `IA (Minimax) : colonne ${bestCol+1} (score ${bestScore})`;

    appliquerCoup(bestCol);

  } else {

    robotAleatoire();

  }

}



/* ===================== IA dispatch ===================== */



function robotJoue(){

  if (IA.type === "db") return robotDb();   // → définie en Partie 3/3

  if (IA.type === "minimax") return robotMinimax();

  return robotAleatoire();

}



/* ===================== UNDO ===================== */

function annuler() {

  if (historique.length === 0) return;



  fin = false; resultat = null; casesGagnantes = [];

  const dernier = historique.pop();

  tableau[dernier.row][dernier.col] = null;



  TabVisu(); viderVisuel();

  tableau = Array.from({ length: H() }, () => Array(L()).fill(null));



  for (const coup of historique) {

    tableau[coup.row][coup.col] = coup.joueur;

    pion(coup.row, coup.col, coup.joueur);

  }



  joueurActif = dernier.joueur;

  MAJ();

}



/* ===================== SAVE / LOAD ===================== */



function sauvegarder() {

  const save = { idPartie, config, mode, tableau, joueurActif, fin, resultat, historique };

  localStorage.setItem("p4_save", JSON.stringify(save));

  statut.textContent = "Sauvegarde faite.";

}



function reprendre() {

  const txt = localStorage.getItem("p4_save");

  if (!txt) { statut.textContent = "Aucune sauvegarde trouvée."; return; }



  const save = JSON.parse(txt);

  config = save.config; sauverConfig();



  idPartie = save.idPartie || 0;

  mode = save.mode ?? 2;

  tableau = save.tableau;

  joueurActif = save.joueurActif;

  fin = save.fin; resultat = save.resultat;

  historique = save.historique || [];



  enPause = false; enReplay = false; replayIndex = 0;



  TabVisu(); viderVisuel();

  for (const coup of historique)

    pion(coup.row, coup.col, coup.joueur);



  if (fin && resultat !== "nul" && historique.length > 0) {

    const last = historique[historique.length - 1];

    if (Gagnant(last.row, last.col)) surligner();

  }



  elMode.value = String(mode);

  clearInterval(autoTimer);

  autoTimer=null;

  if (mode === 0) lancerMode0();



  MAJ();

  statut.textContent = "Partie reprise.";

}



/* ===================== MODE 0 ===================== */



function lancerMode0() {

  clearInterval(autoTimer);

  autoTimer = setInterval(() => {

    if (!fin && !enPause && !enReplay) robotJoue();

  }, 400);

}



/* ===================== PARAMÈTRES ===================== */



function parametrage() {

  const h = Number(String(prompt("Nombre de lignes (>=4)", String(config.hauteur))).trim());

  const l = Number(String(prompt("Nombre de colonnes (>=4)", String(config.largeur))).trim());

  const c = String(prompt("Couleur qui commence ? (rouge/jaune)", config.commence)).trim().toLowerCase();



  if (!Number.isFinite(h) || h < 4) return alert("Hauteur invalide (>=4)");

  if (!Number.isFinite(l) || l < 4) return alert("Largeur invalide (>=4)");

  if (c !== "rouge" && c !== "jaune") return alert("Couleur invalide : rouge ou jaune");



  config = { hauteur: h, largeur: l, commence: c };

  sauverConfig();

  main();

}

/************************************************************

 * SCRIPT - Partie 3/3

 * - IA DB (robotDb)

 * - Analyse IA (DB) — bouton "Analyse IA" (ne joue pas)

 * - Jouer()

 * - Replay (entrer/afficher/suivant/précédent/sortir)

 * - API (import/list/miroir) + listeners

 * - main() + tous les listeners

 ************************************************************/



/* ===================== IA DB (joue) ===================== */



async function robotDb(){

  if (fin || enPause || enReplay) return;



  // 1) Séquence courante (1..L) depuis l'historique

  const seqStr = (historique || []).map(h => h.col + 1).join('');



  // 2) Colonnes jouables

  const playable = [];

  for (let c = 0; c < L(); c++) playable.push( caseDispo(c) !== -1 ? 1 : 0 );



  try{

    const url = `https://connect4-projet.onrender.com/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;

    const res = await fetch(url);

    const data = await res.json();



    // afficher la barre des scores

    if (Array.isArray(data.scores) && data.scores.length === L()){

      for (let c = 0; c < L(); c++) setScoreCol(c, data.scores[c], true);

    } else {

      for (let c = 0; c < L(); c++) setScoreCol(c, null, false);

    }



    let col = (typeof data.best === 'number') ? data.best : null;



    // Fallback si couverture faible

    if (col == null || data.fallback === 'low_coverage') {

      statut.textContent = `DB : couverture faible (${data.coverage ?? 0}). Fallback Minimax…`;

      return robotMinimax(); // ou robotAleatoire() si tu préfères

    }



    statut.textContent = `DB joue colonne ${col + 1} (coverage=${data.coverage ?? 0})`;

    appliquerCoup(col);

  } catch (e) {

    console.error('robotDb error:', e);

    statut.textContent = 'DB : erreur, fallback aléatoire.';

    robotAleatoire();

  }

}



/* ============== Analyse IA (DB) — PROPOSER sans jouer ============== */

async function analyserDBSansJouer() {

  try {

    if (fin || enReplay) return;



    // 1) Séquence courante (1..L)

    const seqStr = (historique || []).map(h => h.col + 1).join('');



    // 2) Colonnes jouables

    const playable = [];

    for (let c = 0; c < L(); c++) playable.push( caseDispo(c) !== -1 ? 1 : 0 );



    // 3) Appel API DB

    const url = `https://connect4-projet.onrender.com/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;

    const res = await fetch(url);

    const data = await res.json();



    // 4) Remplir scores

    if (Array.isArray(data.scores) && data.scores.length === L()) {

      for (let c = 0; c < L(); c++) setScoreCol(c, data.scores[c], true);

    } else {

      for (let c = 0; c < L(); c++) setScoreCol(c, null, false);

    }



    // 5) Statut

    if (typeof data.best === 'number') {

      statut.textContent = `DB : meilleur coup = colonne ${data.best + 1} (coverage=${data.coverage ?? 0})`;

    } else {

      statut.textContent = `DB : pas assez de données (coverage=${data.coverage ?? 0}).`;

    }



    // Log debug (option)

    console.log('[DB Analyse] req:', url, 'resp:', data);

  } catch (e) {

    console.error('Analyse DB error:', e);

    statut.textContent = 'DB : erreur côté front ou API.';

  }

}



/* ===================== Jouer (clic case) ===================== */

function jouer(col) {

  if (fin || enPause || enReplay) return;



  if (mode === 0) return;                       // humain interdit

  if (mode === 1 && joueurActif === "jaune") return; // tour de l'IA : on bloque le clic



  if (!appliquerCoup(col)) return;



  // mode 1 : l'IA (jaune) joue après le coup rouge

  if (mode === 1 && !fin && joueurActif === "jaune") {

    setTimeout(robotJoue, 200);

  }

}



/* ===================== REPLAY ===================== */

function entrerReplay() {

  if (historique.length === 0) { statut.textContent = "Aucun coup à rejouer."; return; }

  if (enReplay) return;



  snapshotAvantReplay = {

    tableau: cloneTableau(tableau),

    joueurActif,

    fin,

    resultat,

    historique: historique.slice(),

    casesGagnantes: casesGagnantes.slice()

  };



  historiqueSource = historique.slice();

  enReplay = true;

  replayIndex = 0;

  afficherReplay();

}



function afficherReplay() {

  tableau = Array.from({ length: H() }, () => Array(L()).fill(null));

  TabVisu();

  viderVisuel();



  for (let i = 0; i < replayIndex; i++) {

    const coup = historiqueSource[i];

    tableau[coup.row][coup.col] = coup.joueur;

    pion(coup.row, coup.col, coup.joueur);

  }



  MAJ();

}



function replaySuivant() {

  if (!enReplay) entrerReplay();

  if (!enReplay) return;

  replayIndex++;

  if (replayIndex > historiqueSource.length) replayIndex = historiqueSource.length;

  afficherReplay();

}



function replayPrecedent() {

  if (!enReplay) entrerReplay();

  if (!enReplay) return;

  replayIndex--;

  if (replayIndex < 0) replayIndex = 0;

  afficherReplay();

}



function sortirReplay() {

  if (!enReplay) return;

  enReplay = false;



  tableau = cloneTableau(snapshotAvantReplay.tableau);

  joueurActif = snapshotAvantReplay.joueurActif;

  fin = snapshotAvantReplay.fin;

  resultat = snapshotAvantReplay.resultat;

  historique = snapshotAvantReplay.historique.slice();

  casesGagnantes = snapshotAvantReplay.casesGagnantes.slice();



  TabVisu();

  viderVisuel();

  for (const coup of historique) pion(coup.row, coup.col, coup.joueur);

  if (fin && resultat !== "nul") surligner();



  snapshotAvantReplay = null;

  MAJ();

}



/* ===================== API ===================== */

const API = "https://connect4-projet.onrender.com";



async function apiImportFile(file, width, height, starts) {

  try {

    const fd = new FormData();

    fd.append("file", file);

    fd.append("width", String(width));

    fd.append("height", String(height));

    fd.append("starts_with", starts);



    const res = await fetch(`${API}/import-file`, { method: "POST", body: fd });

    const data = await res.json();

    alert(data.message ?? "Import terminé");

    await refreshGamesList();

    return data;

  } catch (err) {

    console.error("Erreur import :", err);

    alert("Erreur d’import");

    throw err;

  }

}



async function apiListGames() { const r = await fetch(`${API}/games`); return r.json(); }

async function apiGetGame(id) { const r = await fetch(`${API}/games/${id}`); return r.json(); }

async function apiGetMirror(id){ const r = await fetch(`${API}/games/${id}/mirror`); return r.json(); }



function rejouerSequence(seqStr) {

  recommencer();

  TabVisu();

  viderVisuel();



  const moves = seqStr.trim().split("").map(Number);

  for (const c of moves) {

    const col0 = c - 1; // 1..L → 0..L-1

    appliquerCoup(col0);

  }

  MAJ();

}



/* ===================== Liste des parties (front) ===================== */

async function refreshGamesList() {

  const list = document.getElementById("gamesList");

  if (!list) return;



  let games = [];

  try {

    games = await apiListGames();

  } catch (e) {

    list.innerHTML = `<div style="color:#111">API indisponible (serveur https://connect4-projet.onrender.com ?)</div>`;

    return;

  }



  list.innerHTML = "";

  games.forEach(g => {

    const div = document.createElement("div");

    div.style.padding = "10px";

    div.style.border = "1px solid #444";

    div.style.borderRadius = "10px";

    div.style.color = "white";

    div.style.marginBottom = "10px";

    div.style.background = "rgba(0,0,0,0.35)";



    div.innerHTML = `

      <div><b>Partie #${g.id}</b> (${g.move_count} coups)</div>

      <div>Séquence : ${g.seq_str}</div>

      <div>Canonique : ${g.canonical_seq}</div>

      <button class="btnShow" data-id="${g.id}">Afficher</button>

      <button class="btnMirror" data-id="${g.id}">Symétrie</button>

    `;

    list.appendChild(div);

  });



  document.querySelectorAll(".btnShow").forEach(btn => {

    btn.addEventListener("click", async () => {

      const id = btn.dataset.id;

      const g = await apiGetGame(id);

      rejouerSequence(g.seq_str);

    });

  });



  document.querySelectorAll(".btnMirror").forEach(btn => {

    btn.addEventListener("click", async () => {

      const id = btn.dataset.id;

      const m = await apiGetMirror(id);

      rejouerSequence(m.mirrored);

    });

  });

}



/* ===================== main() + Listeners ===================== */

function main() {

  chargerConfig();

  chargerIA();



  mode = Number(elMode.value || "2");



  clearInterval(autoTimer);

  autoTimer = null;



  idPartie = nouveauNumeroPartie();



  recommencer();

  TabVisu();

  MAJ();



  // synchro UI IA

  const elIaMode = document.getElementById("iaMode");

  const elDepth  = document.getElementById("depth");

  if (elIaMode) elIaMode.value = IA.type;

  if (elDepth)  elDepth.value  = IA.depth;



  if (mode === 0) lancerMode0();

}



// === Attacher les événements ===

document.getElementById("Puissance4")?.addEventListener("click", main);

document.getElementById("stop")?.addEventListener("click", () => { if (fin) return; enPause = !enPause; MAJ(); });

document.getElementById("undo")?.addEventListener("click", annuler);

document.getElementById("save")?.addEventListener("click", sauvegarder);

document.getElementById("load")?.addEventListener("click", reprendre);

document.getElementById("params")?.addEventListener("click", parametrage);



// Replay

document.getElementById("prev")?.addEventListener("click", replayPrecedent);

document.getElementById("next")?.addEventListener("click", replaySuivant);

document.getElementById("exitReplay")?.addEventListener("click", sortirReplay);



// IA select / depth

document.getElementById("iaMode")?.addEventListener("change", (e)=>{ IA.type = e.target.value; sauverIA(); });

document.getElementById("depth")?.addEventListener("change", (e)=>{ IA.depth = Math.max(1, Math.min(8, Number(e.target.value)||4)); e.target.value = IA.depth; sauverIA(); });



// Mode (0 / 1 / 2)

elMode?.addEventListener("change", main);



// Analyse IA (DB) — PROPOSER (ne joue pas)

document.getElementById("analyseNow")?.addEventListener("click", analyserDBSansJouer);



// Import + Liste

document.getElementById("importForm")?.addEventListener("submit", async (e) => {

  e.preventDefault();

  const file   = document.getElementById("fileInput").files[0];

  const width  = Number(document.getElementById("importWidth").value);

  const height = Number(document.getElementById("importHeight").value);

  const starts = document.getElementById("importStarts").value;

  if (!file) return alert("Choisis un fichier .txt (ex: 3131313.txt)");

  const res = await apiImportFile(file, width, height, starts);

  alert(res.message);

  refreshGamesList();

});

document.getElementById("refreshGames")?.addEventListener("click", refreshGamesList);



// Lancer l’app

main();





