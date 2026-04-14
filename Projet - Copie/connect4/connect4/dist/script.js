/******************************************************
 * Puissance 4 — Sarrah Osmani
 * - Moteur (config/IA/import/etc.)
 * - Dernier coup clair
 * - Choix couleur humaine (mode 1)
 * - Boutons : IA suggère / IA jouerait
 * - Switch mode en pleine partie sans reset
 * - Mode peinture (rouge/jaune/effacer) pour entretien
 * - Input BGA (hook backend)
 * - PATCH Minimax+ : anti-boulette (win en 1 / blocage / coups dangereux)
 * - PATCH : "IA suggère" et "IA jouerait" utilisent DB même si paint.enabled
 * - PATCH Option A : recalcul automatique du joueurActif après peinture
 * - PATCH barre IA : progression visuelle robuste
 ******************************************************/
const API = "https://connect4-projet.onrender.com";
/* ===================== CONFIG ===================== */
let config = { hauteur: 9, largeur: 9, commence: "rouge" };

function H(){ return config.hauteur; }
function L(){ return config.largeur; }

function chargerConfig(){
  const txt = localStorage.getItem("p4_config");
  if (!txt) return;
  try{
    const c = JSON.parse(txt);
    if (Number.isFinite(c.hauteur) && c.hauteur >= 4) config.hauteur = c.hauteur;
    if (Number.isFinite(c.largeur) && c.largeur >= 4) config.largeur = c.largeur;
    if (c.commence === "rouge" || c.commence === "jaune") config.commence = c.commence;
  }catch{}
}

function sauverConfig(){
  localStorage.setItem("p4_config", JSON.stringify(config));
}

function nouveauNumeroPartie(){
  const n = Number(localStorage.getItem("p4_idPartie") || "0") + 1;
  localStorage.setItem("p4_idPartie", String(n));
  return n;
}

/* ===================== ÉTAT ===================== */
let tableau;
let joueurActif;
let fin;
let resultat = null;
let mode = 2; // 0/1/2
let autoTimer = null;
let enPause = false;

let idPartie = 0;
let historique = [];
let casesGagnantes = [];

let enReplay = false;
let replayIndex = 0;
let snapshotAvantReplay = null;
let historiqueSource = [];

let lastMove = null; // {row,col,joueur}

let IA = { type:"db", depth:4 };

let iaProgTimer = null;
let iaProgressValue = 0;

function chargerIA(){
  try{
    const txt = localStorage.getItem("p4_ai");
    if (!txt) return;
    const o = JSON.parse(txt);
    if (o && (o.type==="aleatoire" || o.type==="minimax" || o.type==="db")) IA.type = o.type;
    if (Number.isFinite(o.depth)) IA.depth = Math.max(1, Math.min(8, o.depth));
  }catch{}
}

function sauverIA(){
  localStorage.setItem("p4_ai", JSON.stringify(IA));
}

/* ===================== DOM ===================== */
const Tab = document.getElementById("tableau");
const statut = document.getElementById("deroulement");
const lastMini = document.getElementById("lastMoveMini");

const elMode = document.getElementById("mode");
const elHuman = document.getElementById("humanColor");
const elIaMode = document.getElementById("iaMode");
const elDepth = document.getElementById("depth");

if (!Tab || !statut || !elMode) console.error("HTML incomplet");

/* ===================== UTILS ===================== */
function isPlateauPlein(){
  return tableau.every(ligne => ligne.every(cell => cell !== null));
}

function cloneTableau(t=tableau){
  return t.map(l => l.slice());
}

function labelCouleur(c){ return c === "rouge" ? "Rouge" : "Jaune"; }

function setLastMove(move){
  lastMove = move;
  if (!lastMini) return;
  if (!move){
    lastMini.textContent = "—";
    return;
  }
  lastMini.textContent =
    `Dernier coup ${labelCouleur(move.joueur)} : colonne ${move.col+1}, ligne ${move.row+1}`;
}

function MAJ(){
  const stopBtn = document.getElementById("stop");
  if (stopBtn) stopBtn.textContent = (enPause && !fin) ? "Reprendre" : "Arrêter";

  if (enReplay){
    statut.textContent = `Replay : coup ${replayIndex}/${historiqueSource.length}`;
    return;
  }
  if (enPause && !fin){
    statut.textContent = "Pause (clique sur Reprendre)";
    return;
  }
  if (fin){
    statut.textContent = (resultat === "nul")
      ? "Match nul !"
      : `${labelCouleur(resultat)} gagne !`;
    return;
  }

  if (lastMove){
    const prochain = labelCouleur(joueurActif);
    statut.textContent = `${lastMini.textContent} — au tour de ${prochain}`;
  } else {
    statut.textContent = `Au tour du ${labelCouleur(joueurActif)}`;
  }
}

/* ===================== BARRE IA ===================== */
function iaThinkingStart() {
  const box = document.getElementById("iaThinking");
  const prog = document.getElementById("iaProgress");
  if (!box || !prog) return;

  if (iaProgTimer) clearInterval(iaProgTimer);

  iaProgressValue = 0;
  prog.textContent = "0%";
  box.style.display = "block";

  iaProgTimer = setInterval(() => {
    if (iaProgressValue < 85) {
      iaProgressValue += Math.random() * 8 + 2;
      if (iaProgressValue > 85) iaProgressValue = 85;
      prog.textContent = Math.floor(iaProgressValue) + "%";
    }
  }, 120);
}

function iaThinkingProgress(p) {
  const prog = document.getElementById("iaProgress");
  if (!prog) return;

  iaProgressValue = Math.max(0, Math.min(100, Math.floor(p)));
  prog.textContent = iaProgressValue + "%";
}

async function iaThinkingStop() {
  const box = document.getElementById("iaThinking");
  const prog = document.getElementById("iaProgress");

  if (iaProgTimer) {
    clearInterval(iaProgTimer);
    iaProgTimer = null;
  }

  if (prog) prog.textContent = "100%";

  await new Promise(r => setTimeout(r, 220));

  if (box) box.style.display = "none";
}

/* ===================== SCORES ===================== */
function initScores(){
  const S = document.getElementById("scores");
  if (!S) return;

  S.innerHTML = "";
  S.style.setProperty("--colsTotal", L() + 1);

  const spacer = document.createElement("div");
  spacer.className = "scorecell spacer";
  spacer.textContent = "";
  S.appendChild(spacer);

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

  const cell = S.children[col + 1];
  if (!cell) return;

  cell.textContent = (value === null || value === undefined) ? "—" : String(value);
  cell.classList.toggle("invalide", !valid);
}

function clearBestScores(){
  const S = document.getElementById("scores");
  if (!S) return;
  [...S.children].forEach(c => c.classList.remove("best"));
}

function markBestScore(col){
  const S = document.getElementById("scores");
  if (!S) return;

  const cell = S.children[col + 1];
  if (cell) cell.classList.add("best");
}
/* ===================== POIDS DB (toujours visibles) ===================== */
async function afficherPoidsDB() {
if (fin || enReplay) return;

try {
const seqStr = historique.map(h => h.col + 1).join("");
const playable = [];
for (let c = 0; c < L(); c++) {
playable.push(caseDispo(c) !== -1 ? 1 : 0);
}

const url =
`${API}/ai/db?seq=${encodeURIComponent(seqStr)}` +
`&width=${L()}&height=${H()}` +
`&playable=${playable.join(",")}`;

const res = await fetch(url);
const data = await res.json();

// ✅ uniquement les POIDS
if (Array.isArray(data.scores) && data.scores.length === L()) {
for (let c = 0; c < L(); c++) {
setScoreCol(c, data.scores[c], true);
}
}



} catch (e) {
console.error("Erreur affichage poids DB", e);
}
}

async function afficherPoidsMinimax() {
if (fin || enReplay) return;

const t0 = cloneTableau(tableau);
const maxP = joueurActif;
const depth = IA.depth;

for (let c = 0; c < L(); c++) {
const r = caseDispoSur(t0, c);
if (r === -1) {
setScoreCol(c, "—", false);
continue;
}

t0[r][c] = maxP;
const val = await minimaxAsync(
t0,
depth - 1,
false,
maxP,
-Infinity,
Infinity
);
t0[r][c] = null;

setScoreCol(c, Math.round(val), true);
}
}
async function afficherPoids() {
// ✅ on enlève seulement le CONSEIL précédent
clearBestScores();

if (IA.type === "db") {
await afficherPoidsDB();
} else if (IA.type === "minimax") {
await afficherPoidsMinimax();
}
}

async function conseillerCoupDB() {
if (fin || enReplay) return;

try {
const seqStr = historique.map(h => h.col + 1).join("");
const playable = [];
for (let c = 0; c < L(); c++) {
playable.push(caseDispo(c) !== -1 ? 1 : 0);
}

const url =
`${API}/ai/db?seq=${encodeURIComponent(seqStr)}` +
`&width=${L()}&height=${H()}` +
`&playable=${playable.join(",")}`;

const res = await fetch(url);
const data = await res.json();

clearBestScores();

if (typeof data.best === "number") {
markBestScore(data.best);
statut.textContent = `Conseil IA : jouer colonne ${data.best + 1}`;
} else {
statut.textContent = "Pas assez de données pour conseiller un coup";
}

} catch (e) {
console.error("Erreur conseil DB", e);
}
}

async function conseillerCoup() {
  if (fin || enPause || enReplay) return;

  clearBestScores();
  iaThinkingStart();

  try {
    const choix = await choisirCoupIA();

    if (!choix || choix.col == null) {
      statut.textContent = "Aucun coup conseillé";
      return;
    }

    markBestScore(choix.col);
    statut.textContent = `Conseil IA : colonne ${choix.col + 1} — ${choix.reason}`;
  } catch (e) {
    console.error("Erreur conseillerCoup:", e);
    statut.textContent = "Erreur pendant le conseil";
  } finally {
    iaThinkingProgress(100);
    await iaThinkingStop();
  }
}

async function conseillerCoupMinimax() {
const t0 = cloneTableau(tableau);
const maxP = joueurActif;
const depth = IA.depth;

let bestCol = null;
let bestScore = -Infinity;

for (let c = 0; c < L(); c++) {
const r = caseDispoSur(t0, c);
if (r === -1) continue;

t0[r][c] = maxP;
const val = await minimaxAsync(
t0,
depth - 1,
false,
maxP,
-Infinity,
Infinity
);
t0[r][c] = null;

if (val > bestScore) {
bestScore = val;
bestCol = c;
}
}

if (bestCol !== null) {
markBestScore(bestCol);
statut.textContent =
`Conseil Minimax (profondeur ${depth}) : colonne ${bestCol + 1}`;
}
}
/* ===================== PLATEAU VISU ===================== */
function TabVisu(){
  if (!Tab) return;
  Tab.innerHTML = "";

  Tab.style.setProperty("--cols", L()+1);
  Tab.style.setProperty("--rows", H()+1);

  const corner = document.createElement("div");
  corner.className = "label";
  Tab.appendChild(corner);

  for (let col=0; col<L(); col++){
    const head = document.createElement("div");
    head.className = "label";
    head.textContent = col+1;
    Tab.appendChild(head);
  }

  for (let row=0; row<H(); row++){
    const left = document.createElement("div");
    left.className = "label";
    left.textContent = row+1;
    Tab.appendChild(left);

    for (let col=0; col<L(); col++){
      const cell = document.createElement("div");
      cell.className = "Case";
      cell.dataset.row = row;
      cell.dataset.col = col;

      cell.addEventListener("click", () => onCellClick(row, col));
      cell.addEventListener("mouseenter", () => paintHover(cell, true));
      cell.addEventListener("mouseleave", () => paintHover(cell, false));
      Tab.appendChild(cell);
    }
  }

  initScores();
}

function viderVisuel(){
  if (!Tab) return;
  Tab.querySelectorAll(".Case").forEach(cell => { cell.className = "Case"; });
}

function indexCase(row, col){
  const colsTotal = L() + 1;
  const header = colsTotal;
  return header + row * colsTotal + 1 + col;
}

function pion(row, col, joueur){
  if (!Tab) return;
  const idx = indexCase(row, col);
  Tab.children[idx]?.classList.add(joueur);
}

function surligner(){
  if (!Tab) return;
  for (const pos of casesGagnantes){
    const idx = indexCase(pos.row, pos.col);
    Tab.children[idx]?.classList.add("win");
  }
}

/* ===================== LOGIQUE DE BASE ===================== */
function recommencer(){
  tableau = Array.from({ length:H() }, () => Array(L()).fill(null));
  joueurActif = config.commence;
  fin = false; resultat = null;
  historique = []; casesGagnantes = [];
  enPause = false; enReplay = false; replayIndex = 0;
  lastMove = null;
  setLastMove(null);

  MAJ();
  initScores();
}

function caseDispo(col){
  for (let r=H()-1; r>=0; r--) if (tableau[r][col] === null) return r;
  return -1;
}

function Gagnant(row, col){
  const p = tableau[row][col];
  if (!p) return false;

  const dirs = [
    {dr:0,dc:1},{dr:1,dc:0},{dr:1,dc:1},{dr:1,dc:-1}
  ];

  for (const {dr,dc} of dirs){
    const ligne = [{row,col}];

    let r=row+dr, c=col+dc;
    while (r>=0 && r<H() && c>=0 && c<L() && tableau[r][c]===p){
      ligne.push({row:r,col:c});
      r+=dr; c+=dc;
    }

    r=row-dr; c=col-dc;
    while (r>=0 && r<H() && c>=0 && c<L() && tableau[r][c]===p){
      ligne.push({row:r,col:c});
      r-=dr; c-=dc;
    }

    if (ligne.length >= 4){
      casesGagnantes = ligne;
      return true;
    }
  }
  return false;
}

function appliquerCoup(col){
  const row = caseDispo(col);
  if (row === -1) return false;

  tableau[row][col] = joueurActif;
  pion(row, col, joueurActif);
  historique.push({ row, col, joueur: joueurActif });

  setLastMove({ row, col, joueur: joueurActif });

  //clearBestScores();

  if (Gagnant(row,col)){
    fin = true; resultat = joueurActif;
    surligner(); MAJ();
    return true;
  }
  if (isPlateauPlein()){
    fin = true; resultat = "nul";
    MAJ();
    return true;
  }

 
joueurActif = (joueurActif === "rouge") ? "jaune" : "rouge";

// ✅ au JEU suivant, le conseil disparaît
clearBestScores();

MAJ();

// ✅ poids DB ou Minimax selon le paramètre IA
afficherPoids();
runPrediction();
return true;
}

/* ===================== MODE HUMAIN / IA (couleur) ===================== */
function getHumanColor(){
  return (elHuman?.value === "jaune") ? "jaune" : "rouge";
}

function getIAColor(){
  const h = getHumanColor();
  return h === "rouge" ? "jaune" : "rouge";
}

function jouer(col){
  if (fin || enPause || enReplay) return;
  if (mode === 0) return;

  if (mode === 1 && joueurActif === getIAColor()) return;

  if (!appliquerCoup(col)) return;

  if (mode === 1 && !fin && joueurActif === getIAColor()){
    setTimeout(robotJoue, 200);
  }
}

/* ===================== IA (Minimax + Random) ===================== */
function caseDispoSur(t, col){
  for (let r=H()-1; r>=0; r--) if (t[r][col]===null) return r;
  return -1;
}

function coupsPossibles(t){
  const arr=[];
  for (let c=0;c<L();c++) if (caseDispoSur(t,c)!==-1) arr.push(c);
  const center=(L()-1)/2;
  arr.sort((a,b)=>Math.abs(a-center)-Math.abs(b-center));
  return arr;
}

function gagnantSur(t){
  const dirs=[{dr:0,dc:1},{dr:1,dc:0},{dr:1,dc:1},{dr:1,dc:-1}];
  for (let r=0;r<H();r++){
    for (let c=0;c<L();c++){
      const p=t[r][c]; if(!p) continue;
      for(const {dr,dc} of dirs){
        let count=1;
        let rr=r+dr, cc=c+dc;
        while(rr>=0&&rr<H()&&cc>=0&&cc<L()&&t[rr][cc]===p){count++; rr+=dr; cc+=dc;}
        rr=r-dr; cc=c-dc;
        while(rr>=0&&rr<H()&&cc>=0&&cc<L()&&t[rr][cc]===p){count++; rr-=dr; cc-=dc;}
        if(count>=4) return p;
      }
    }
  }
  return null;
}

function pleinSur(t){ return t.every(l=>l.every(x=>x!==null)); }

function evalFenetre(cells, maxP, minP){
  const nbMax=cells.filter(x=>x===maxP).length;
  const nbMin=cells.filter(x=>x===minP).length;
  const nbEmpty=cells.filter(x=>x===null).length;

  if (nbMax===4) return 100000;
  if (nbMin===4) return -100000;

  let score=0;
  if(nbMax===3 && nbEmpty===1) score+=120;
  if(nbMax===2 && nbEmpty===2) score+=15;
  if(nbMin===3 && nbEmpty===1) score-=110;
  if(nbMin===2 && nbEmpty===2) score-=12;
  return score;
}

function evaluation(t,maxP){
  const minP=(maxP==="rouge")?"jaune":"rouge";
  let score=0;

  const centerCol=Math.floor(L()/2);
  for (let r=0;r<H();r++){
    if(t[r][centerCol]===maxP) score+=10;
    if(t[r][centerCol]===minP) score-=6;
  }

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

/* ===== Helpers tactiques ===== */
function findImmediateWin(t, player){
  for (let c=0; c<L(); c++){
    const r = caseDispoSur(t, c);
    if (r === -1) continue;
    t[r][c] = player;
    const w = gagnantSur(t);
    t[r][c] = null;
    if (w === player) return c;
  }
  return null;
}

function opponentHasImmediateWin(t, player){
  const opp = (player === "rouge") ? "jaune" : "rouge";
  return findImmediateWin(t, opp) != null;
}

function moveAllowsOppImmediateWin(t, col, player){
  const r = caseDispoSur(t, col);
  if (r === -1) return true;
  t[r][col] = player;
  const bad = opponentHasImmediateWin(t, player);
  t[r][col] = null;
  return bad;
}

function countThreat3Open(t, player){
  let bonus = 0;
  const dirs = [{dr:0,dc:1},{dr:1,dc:0},{dr:1,dc:1},{dr:1,dc:-1}];
  for (let r=0; r<H(); r++){
    for (let c=0; c<L(); c++){
      for (const {dr,dc} of dirs){
        const cells = [];
        for (let k=0; k<4; k++){
          const rr = r + dr*k, cc = c + dc*k;
          if (rr<0||rr>=H()||cc<0||cc>=L()){ cells.length=0; break; }
          cells.push(t[rr][cc]);
        }
        if (cells.length===4){
          const nbP = cells.filter(x=>x===player).length;
          const nb0 = cells.filter(x=>x===null).length;
          if (nbP===3 && nb0===1) bonus += 8;
        }
      }
    }
  }
  return bonus;
}

async function minimaxAsync(t, depth, maximizing, maxP, alpha, beta) {
  const w = gagnantSur(t);
  if (w === maxP) return 100000 - (100 - depth);
  if (w && w !== maxP) return -100000 + (100 - depth);
  if (depth === 0 || pleinSur(t)) {
    return evaluation(t, maxP) + countThreat3Open(t, maxP);
  }

  const moves = coupsPossibles(t);
  const minP = (maxP === "rouge") ? "jaune" : "rouge";

  await new Promise(r => setTimeout(r, 0));

  if (maximizing) {
    let best = -Infinity;

    for (const col of moves) {
      const row = caseDispoSur(t, col);
      t[row][col] = maxP;

      const val = await minimaxAsync(t, depth-1, false, maxP, alpha, beta);

      t[row][col] = null;

      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }

    return best;
  } else {
    let best = Infinity;

    for (const col of moves) {
      const row = caseDispoSur(t, col);
      t[row][col] = minP;

      const val = await minimaxAsync(t, depth-1, true, maxP, alpha, beta);

      t[row][col] = null;

      if (val < best) best = val;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }

    return best;
  }
}

  /* ===== GARDE-FOUS TACTIQUES ABSOLUS ===== */

function peutGagnerEnUn(t, joueur) {
for (let c = 0; c < L(); c++) {
const r = caseDispoSur(t, c);
if (r === -1) continue;
t[r][c] = joueur;
const gagne = gagnantSur(t) === joueur;
t[r][c] = null;
if (gagne) return c;
}
return null;
}

function gardeFouTactique() {
const t0 = cloneTableau(tableau);
const moi = joueurActif;
const adv = moi === "rouge" ? "jaune" : "rouge";

const winNow = peutGagnerEnUn(t0, moi);
if (winNow !== null) {
return { type: "WIN", col: winNow };
}

const blockNow = peutGagnerEnUn(t0, adv);
if (blockNow !== null) {
return { type: "BLOCK", col: blockNow };
}

return null;
}

function coupsSurs(t, joueur) {
const adv = joueur === "rouge" ? "jaune" : "rouge";
const res = [];

for (let c = 0; c < L(); c++) {
const r = caseDispoSur(t, c);
if (r === -1) continue;

t[r][c] = joueur;
const danger = peutGagnerEnUn(t, adv);
t[r][c] = null;

if (danger === null) res.push(c);
}

return res;
}


async function jouerCoupIAGaranti() {
  if (fin || enPause || enReplay) return;

  iaThinkingStart();

  try {
    const choix = await choisirCoupIA();

    if (!choix || choix.col == null) {
      statut.textContent = "Aucun coup possible";
      return;
    }

    clearBestScores();
    markBestScore(choix.col);
    statut.textContent = choix.reason;

    appliquerCoup(choix.col);
  } catch (e) {
    console.error("Erreur jouerCoupIAGaranti:", e);
    statut.textContent = "Erreur IA";
  } finally {
    iaThinkingProgress(100);
    await iaThinkingStop();
  }
}

/* ===================== IA ALÉATOIRE ===================== */
function robotAleatoire(jouerVraiment = true){
  if (fin || enPause || enReplay) return null;

  const jouables = [];
  for (let c=0; c<L(); c++){
    if (caseDispo(c) !== -1) jouables.push(c);
  }

  if (!jouables.length) return null;

  const col = jouables[(Math.random() * jouables.length) | 0];

  clearBestScores();
  markBestScore(col);

  if (jouerVraiment) {
    appliquerCoup(col);
    afficherPoids(); // ✅ À AJOUTER
  } else {
    statut.textContent = `Aléatoire (suggéré) : colonne ${col+1}`;
  }

  return col;
}
async function detectWinningLine(board, player, maxDepth = 6) {
const opponent = player === "rouge" ? "jaune" : "rouge";

for (let depth = 1; depth <= maxDepth; depth++) {
const score = await minimaxAsync(
cloneTableau(board),
depth,
true,
player,
-Infinity,
Infinity
);

if (score > 90000) {
return {
result: "WIN",
winner: player,
in: depth
};
}

if (score < -90000) {
return {
result: "LOSS",
winner: opponent,
in: depth
};
}
}

return {
result: "UNKNOWN"
};
}

/* ===================== IA MINIMAX ===================== */
let iaBusy = false;



async function robotMinimax(jouerVraiment = true) {

  if (iaBusy || fin || enPause || enReplay) return;

  iaBusy = true;



  try {

    iaThinkingStart();

    await new Promise(r => setTimeout(r, 50));



    const maxP = joueurActif;

    const t0 = cloneTableau(tableau);



    // WIN EN 1

    const winningNow = findImmediateWin(t0, maxP);

    if (winningNow != null) {

      iaThinkingProgress(100);

      if (jouerVraiment) appliquerCoup(winningNow);
      afficherPoids(); // ✅ À AJOUTER

      return;

    }



    // BLOCAGE

    const opp = (maxP === "rouge") ? "jaune" : "rouge";

    const oppWinCol = findImmediateWin(t0, opp);

    if (oppWinCol != null) {

      iaThinkingProgress(100);

      if (jouerVraiment) appliquerCoup(oppWinCol);

      return;

    }



    // COUPS SÛRS

    const safeMoves = [];

    for (let c = 0; c < L(); c++) {

      const r = caseDispoSur(t0, c);

      if (r !== -1 && !moveAllowsOppImmediateWin(t0, c, maxP)) {

        safeMoves.push(c);

      }

    }



    const candidateMoves = safeMoves.length ? safeMoves : coupsPossibles(t0);



    const totalEmpty = t0.flat().filter(x => x === null).length;

    const depth = Math.min(8, IA.depth + (totalEmpty <= 16 ? 1 : 0));



    let bestCol = null;

    let bestScore = -Infinity;



    for (let i = 0; i < candidateMoves.length; i++) {

      const col = candidateMoves[i];

      const r = caseDispoSur(t0, col);

      if (r === -1) continue;



      t0[r][col] = maxP;

      const val = await minimaxAsync(

        t0,

        depth - 1,

        false,

        maxP,

        -Infinity,

        Infinity

      );

      t0[r][col] = null;



      if (val > bestScore) {

        bestScore = val;

        bestCol = col;

      }



      iaThinkingProgress(20 + ((i + 1) / candidateMoves.length) * 70);

      await new Promise(r => setTimeout(r, 20));

    }



    iaThinkingProgress(100);



   if (bestCol != null) {

clearBestScores();
markBestScore(bestCol);

if (jouerVraiment) {
appliquerCoup(bestCol);
afficherPoidsDB();
} else {
afficherPoidsDB();
statut.textContent = `Minimax suggère : colonne ${bestCol + 1}`;
}

}



  } finally {

    await iaThinkingStop();

    iaBusy = false;

  }

}



/* ===== DB / Backend ===== */


async function robotDb(){
if (fin || enPause || enReplay) return;

iaThinkingStart();

try {

// ✅ FILTRE TACTIQUE AVANT DB
const urgence = coupBDFiltré();
if (urgence !== null) {
clearBestScores();
markBestScore(urgence);
statut.textContent = "⚠️ Blocage tactique nécessaire (menace immédiate)";
appliquerCoup(urgence);
  afficherPoids(); // ✅ À AJOUTER
return;
}

iaThinkingProgress(10);

const seqStr = (historique || []).map(h => h.col+1).join('');
const playable = [];
for (let c=0;c<L();c++) playable.push(caseDispo(c)!==-1 ? 1 : 0);

iaThinkingProgress(30);
const url = `${API}/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;
const res = await fetch(url);

iaThinkingProgress(70);
const data = await res.json();

clearBestScores();
if (Array.isArray(data.scores) && data.scores.length === L()){
for (let c=0;c<L();c++) setScoreCol(c, data.scores[c], true);
}

const col = (typeof data.best === "number") ? data.best : null;
if (col == null || data.fallback === "low_coverage"){
statut.textContent = "DB : couverture faible → Minimax";
await robotMinimax(true);
return;
}

markBestScore(col);
statut.textContent = `DB joue colonne ${col+1}`;
appliquerCoup(col);
  afficherPoids(); // ✅ À AJOUTER

} catch(e){
console.error("robotDb error:", e);
statut.textContent = "DB : erreur → aléatoire";
robotAleatoire(true);
} finally {
iaThinkingProgress(100);
await iaThinkingStop();
}
}
function robotJoue(){
  if (IA.type === "db") return robotDbSafe();
  if (IA.type === "minimax") return robotMinimax(true);
  return robotAleatoire(true);
}
function otherPlayer(p){
  return p === "rouge" ? "jaune" : "rouge";
}

function colToText(col){
  return `colonne ${col + 1}`;
}

function sequenceToText(seq){
  return seq.map(c => c + 1).join(" → ");
}
function depthToHumanMoves(depth) {
  return Math.ceil(depth / 2);
}


function getPredictionDepth() {
  const nbVides = tableau.flat().filter(x => x === null).length;

  if (nbVides > 50) return 3;   // début
  if (nbVides > 25) return 5;   // milieu
  return 7;                     // fin
}
async function robotDbSafe() {

  if (fin || enPause || enReplay) return;

  // 🔴 1. Garde-fou ABSOLU
  const urgence = gardeFouTactique();

  if (urgence) {
    clearBestScores();
    markBestScore(urgence.col);

    statut.textContent =
      urgence.type === "WIN"
        ? "✅ Coup gagnant immédiat"
        : "⚠️ Blocage obligatoire";

    appliquerCoup(urgence.col);
    afficherPoids();
    return;
  }

  // 🟡 2. On appelle la DB normalement
  const seqStr = historique.map(h => h.col + 1).join('');
  const playable = [];

  for (let c = 0; c < L(); c++) {
    playable.push(caseDispo(c) !== -1 ? 1 : 0);
  }

  try {
    const url = `${API}/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;
    const res = await fetch(url);
    const data = await res.json();

    let col = (typeof data.best === "number") ? data.best : null;

    // 🟠 3. Filtrer les coups dangereux
    const t0 = cloneTableau(tableau);
    const safe = coupsSurs(t0, joueurActif);

    if (safe.length && !safe.includes(col)) {
      col = safe[Math.floor(Math.random() * safe.length)];
      statut.textContent = "⚠️ DB corrigée (coup dangereux évité)";
    }

    // 🔵 4. fallback si DB faible
    if (col == null) {
      statut.textContent = "DB faible → Minimax";
      return robotMinimax(true);
    }
    if ((data.coverage ?? 0) < 2) {
  statut.textContent = "DB utilisée malgré faible couverture";
}

    clearBestScores();
    markBestScore(col);

    statut.textContent = `DB joue colonne ${col + 1}`;

    appliquerCoup(col);
    afficherPoids();

  } catch (e) {
    console.error(e);
    statut.textContent = "Erreur DB → Minimax";
    return robotMinimax(true);
  }
}
/**
 * Cherche une séquence forcée de gain pour `player`
 * depth = nombre maximal de demi-coups explorés
 * Retourne un tableau de colonnes [c1, c2, ...] ou null
 */
function findForcedWinSequence(board, player, currentPlayer, depth){
  const winner = gagnantSur(board);

  if (winner === player) return [];
  if (winner && winner !== player) return null;
  if (depth === 0) return null;

  const moves = coupsPossibles(board);

  // Si c'est au joueur qu'on veut faire gagner de jouer :
  // il suffit qu'UN coup mène à une suite gagnante
  if (currentPlayer === player){
    for (const col of moves){
      const row = caseDispoSur(board, col);
      if (row === -1) continue;

      board[row][col] = currentPlayer;
      const sub = findForcedWinSequence(board, player, otherPlayer(currentPlayer), depth - 1);
      board[row][col] = null;

      if (sub !== null){
        return [col, ...sub];
      }
    }
    return null;
  }

  // Si c'est l'adversaire :
  // il faut que TOUS ses coups laissent encore une suite gagnante
  let chosenLine = null;

  for (const col of moves){
    const row = caseDispoSur(board, col);
    if (row === -1) continue;

    board[row][col] = currentPlayer;
    const sub = findForcedWinSequence(board, player, otherPlayer(currentPlayer), depth - 1);
    board[row][col] = null;

    if (sub === null){
      return null;
    }

    if (chosenLine === null || sub.length < chosenLine.length){
      chosenLine = sub;
    }
  }

  return chosenLine;
}

/**
 * Cherche un gain forcé pour un joueur jusqu'à maxDepth
 * Retourne { depth, sequence } ou null
 */
function getWinPrediction(player, maxDepth = 3){
  const board = cloneTableau(tableau);

  for (let d = 1; d <= maxDepth; d++){
    const seq = findForcedWinSequence(board, player, joueurActif, d);
    if (seq !== null){
      return { depth: d, sequence: seq };
    }
  }

  return null;
}

async function choisirCoupIA() {
  if (fin || enPause || enReplay) return null;

  // 1. Garde-fou absolu
  const urgence = gardeFouTactique();
  if (urgence) {
    return {
      col: urgence.col,
      reason: urgence.type === "WIN"
        ? "Coup gagnant immédiat"
        : "Blocage obligatoire"
    };
  }

  // 2. Selon le type d'IA
  if (IA.type === "db") {
    const seqStr = historique.map(h => h.col + 1).join("");
    const playable = [];
    for (let c = 0; c < L(); c++) {
      playable.push(caseDispo(c) !== -1 ? 1 : 0);
    }

    try {
      const url =
        `${API}/ai/db?seq=${encodeURIComponent(seqStr)}` +
        `&width=${L()}&height=${H()}` +
        `&playable=${playable.join(",")}`;

      const res = await fetch(url);
      const data = await res.json();

      let col = (typeof data.best === "number") ? data.best : null;

      // 2.a filtre coups sûrs
      const t0 = cloneTableau(tableau);
      const safe = coupsSurs(t0, joueurActif);

      if (safe.length && (col == null || !safe.includes(col))) {
        // si la DB propose un coup dangereux, on corrige
        col = safe[0];
      }

      // 2.b fallback si DB trop faible
      if (col == null || (data.coverage ?? 0) < 2) {
        return await choisirCoupMinimaxInterne();
      }

      return {
        col,
        reason: `Choix DB (coverage=${data.coverage ?? 0})`
      };

    } catch (e) {
      console.error("choisirCoupIA DB error:", e);
      return await choisirCoupMinimaxInterne();
    }
  }

  if (IA.type === "minimax") {
    return await choisirCoupMinimaxInterne();
  }

  // aléatoire
  const jouables = [];
  for (let c = 0; c < L(); c++) {
    if (caseDispo(c) !== -1) jouables.push(c);
  }

  if (!jouables.length) return null;

  return {
    col: jouables[(Math.random() * jouables.length) | 0],
    reason: "Choix aléatoire"
  };
}

async function choisirCoupMinimaxInterne() {
  const maxP = joueurActif;
  const t0 = cloneTableau(tableau);

  // Win immédiate
  const winningNow = findImmediateWin(t0, maxP);
  if (winningNow != null) {
    return {
      col: winningNow,
      reason: "Coup gagnant immédiat"
    };
  }

  // Blocage
  const opp = (maxP === "rouge") ? "jaune" : "rouge";
  const oppWinCol = findImmediateWin(t0, opp);
  if (oppWinCol != null) {
    return {
      col: oppWinCol,
      reason: "Blocage obligatoire"
    };
  }

  // Coups sûrs
  const safeMoves = [];
  for (let c = 0; c < L(); c++) {
    const r = caseDispoSur(t0, c);
    if (r !== -1 && !moveAllowsOppImmediateWin(t0, c, maxP)) {
      safeMoves.push(c);
    }
  }

  const candidateMoves = safeMoves.length ? safeMoves : coupsPossibles(t0);

  const totalEmpty = t0.flat().filter(x => x === null).length;
  const depth = Math.min(8, IA.depth + (totalEmpty <= 16 ? 1 : 0));

  let bestCol = null;
  let bestScore = -Infinity;

  for (let i = 0; i < candidateMoves.length; i++) {
    const col = candidateMoves[i];
    const r = caseDispoSur(t0, col);
    if (r === -1) continue;

    t0[r][col] = maxP;
    const val = await minimaxAsync(
      t0,
      depth - 1,
      false,
      maxP,
      -Infinity,
      Infinity
    );
    t0[r][col] = null;

    if (val > bestScore) {
      bestScore = val;
      bestCol = col;
    }
  }

  if (bestCol == null) return null;

  return {
    col: bestCol,
    reason: `Choix Minimax (profondeur ${depth})`
  };
}
/* ===================== IA SUGGÈRE (sans jouer) ===================== */
async function analyserSansJouer(){
  if (fin || enPause || enReplay) return;

  iaThinkingStart();
  await new Promise(r => setTimeout(r, 50));

  // 1) Vérification tactique Rouge
  const redWin = getWinPrediction("rouge", 3);
  if (redWin){
    const txt = redWin.sequence.length
      ? `Analyse : Rouge peut gagner en ${redWin.depth} coup(s) — suite : ${sequenceToText(redWin.sequence)}`
      : `Analyse : Rouge a déjà une position gagnante`;
    statut.textContent = txt;
    iaThinkingProgress(100);
    await iaThinkingStop();
    return;
  }

  // 2) Vérification tactique Jaune
  const yellowWin = getWinPrediction("jaune", 3);
  if (yellowWin){
    const txt = yellowWin.sequence.length
      ? `Analyse : Jaune peut gagner en ${yellowWin.depth} coup(s) — suite : ${sequenceToText(yellowWin.sequence)}`
      : `Analyse : Jaune a déjà une position gagnante`;
    statut.textContent = txt;
    iaThinkingProgress(100);
    await iaThinkingStop();
    return;
  }

  // 3) Sinon fallback sur évaluation
  const t = cloneTableau(tableau);
  const score = evaluation(t, "rouge");

  if (score > 800){
    statut.textContent = "Analyse : Rouge a un avantage décisif";
  } else if (score < -800){
    statut.textContent = "Analyse : Jaune a un avantage décisif";
  } else if (score > 200){
    statut.textContent = "Analyse : Avantage rouge";
  } else if (score < -200){
    statut.textContent = "Analyse : Avantage jaune";
  } else {
    statut.textContent = "Analyse : Position équilibrée";
  }

  iaThinkingProgress(100);
  await iaThinkingStop();
}
/* ===================== UNDO / SAVE / LOAD ===================== */
function annuler(){
  if (historique.length===0) return;

  fin=false; resultat=null; casesGagnantes=[];
  const dernier = historique.pop();
  tableau[dernier.row][dernier.col]=null;

  TabVisu(); viderVisuel();
  tableau = Array.from({ length:H() }, () => Array(L()).fill(null));
  for (const coup of historique){
    tableau[coup.row][coup.col]=coup.joueur;
    pion(coup.row,coup.col,coup.joueur);
  }

  joueurActif = dernier.joueur;

  const prev = historique[historique.length-1] || null;
  setLastMove(prev ? {row:prev.row,col:prev.col,joueur:prev.joueur} : null);

  MAJ();
}

function sauvegarder() {
const seq = historique.map(h => h.col + 1).join("");

const blob = new Blob([seq], { type: "text/plain" });
const file = new File([blob], `${seq}.txt`, { type: "text/plain" });

const fd = new FormData();
fd.append("file", file);
fd.append("width", String(L()));
fd.append("height", String(H()));
fd.append("starts_with", config.commence);

fetch(`${API}/import-file`, {
method: "POST",
body: fd
})
.then(r => r.json())
.then(j => {
statut.textContent = j.message || "Partie enregistrée en base";
refreshGamesList();
})
.catch(() => {
statut.textContent = "Erreur sauvegarde DB";
});
}

function reprendre(){
  const txt = localStorage.getItem("p4_save");
  if (!txt){ statut.textContent="Aucune sauvegarde trouvée."; return; }

  const save = JSON.parse(txt);
  config = save.config; sauverConfig();

  idPartie = save.idPartie || 0;
  mode = save.mode ?? 2;
  tableau = save.tableau;
  joueurActif = save.joueurActif;
  fin = save.fin; resultat = save.resultat;
  historique = save.historique || [];
  lastMove = save.lastMove || null;
  IA = save.IA || IA;

  if (elHuman && save.humanColor) elHuman.value = save.humanColor;

  enPause=false; enReplay=false; replayIndex=0;

  TabVisu(); viderVisuel();
  for (const coup of historique) pion(coup.row,coup.col,coup.joueur);

  if (lastMove) setLastMove(lastMove); else setLastMove(null);

  if (fin && resultat !== "nul" && historique.length>0){
    const last = historique[historique.length-1];
    if (Gagnant(last.row,last.col)) surligner();
  }

  if (elMode) elMode.value = String(mode);
  if (elIaMode) elIaMode.value = IA.type;
  if (elDepth) elDepth.value = IA.depth;

  applyModeRuntime();

  MAJ();
  statut.textContent="Partie reprise.";
  runPrediction();
}

/* ===================== REPLAY ===================== */
function entrerReplay(){
  if (historique.length===0){ statut.textContent="Aucun coup à rejouer."; return; }
  if (enReplay) return;

  snapshotAvantReplay = {
    tableau: cloneTableau(tableau),
    joueurActif,
    fin,
    resultat,
    historique: historique.slice(),
    casesGagnantes: casesGagnantes.slice(),
    lastMove
  };

  historiqueSource = historique.slice();
  enReplay=true;
  replayIndex=0;
  afficherReplay();
}

function afficherReplay(){
  tableau = Array.from({ length:H() }, ()=>Array(L()).fill(null));
  TabVisu(); viderVisuel();

  for(let i=0;i<replayIndex;i++){
    const coup = historiqueSource[i];
    tableau[coup.row][coup.col]=coup.joueur;
    pion(coup.row,coup.col,coup.joueur);
  }

  const prev = (replayIndex>0) ? historiqueSource[replayIndex-1] : null;
  setLastMove(prev ? {row:prev.row,col:prev.col,joueur:prev.joueur} : null);

  MAJ();
}

function replaySuivant(){
  if (!enReplay) entrerReplay();
  if (!enReplay) return;
  replayIndex++;
  if (replayIndex>historiqueSource.length) replayIndex=historiqueSource.length;
  afficherReplay();
}

function replayPrecedent(){
  if (!enReplay) entrerReplay();
  if (!enReplay) return;
  replayIndex--;
  if (replayIndex<0) replayIndex=0;
  afficherReplay();
}

function sortirReplay(){
  if (!enReplay) return;
  enReplay=false;

  tableau = cloneTableau(snapshotAvantReplay.tableau);
  joueurActif = snapshotAvantReplay.joueurActif;
  fin = snapshotAvantReplay.fin;
  resultat = snapshotAvantReplay.resultat;
  historique = snapshotAvantReplay.historique.slice();
  casesGagnantes = snapshotAvantReplay.casesGagnantes.slice();
  lastMove = snapshotAvantReplay.lastMove || null;

  TabVisu(); viderVisuel();
  for(const coup of historique) pion(coup.row,coup.col,coup.joueur);
  if (fin && resultat !== "nul") surligner();

  setLastMove(lastMove);

  snapshotAvantReplay=null;
  MAJ();
  afficherPoids(); // ✅ À AJOUTER
}

/* ===================== PARAMS ===================== */
function parametrage(){
  const h = Number(String(prompt("Nombre de lignes (>=4)", String(config.hauteur))).trim());
  const l = Number(String(prompt("Nombre de colonnes (>=4)", String(config.largeur))).trim());
  const c = String(prompt("Couleur qui commence ? (rouge/jaune)", config.commence)).trim().toLowerCase();

  if(!Number.isFinite(h) || h<4) return alert("Hauteur invalide (>=4)");
  if(!Number.isFinite(l) || l<4) return alert("Largeur invalide (>=4)");
  if(c!=="rouge" && c!=="jaune") return alert("Couleur invalide : rouge ou jaune");

  config = { hauteur:h, largeur:l, commence:c };
  sauverConfig();
  main(true);
}

/* ===================== MODE 0 (IA vs IA) + switch runtime ===================== */
function lancerMode0(){
clearInterval(autoTimer);
autoTimer = setInterval(async () => {
if (!fin && !enPause && !enReplay) {
await jouerCoupIAGaranti();
}
}, 400);
} 

function applyModeRuntime(){
clearInterval(autoTimer);
autoTimer = null;

if (mode === 0) lancerMode0();

if (mode === 1 && !fin && !enPause && !enReplay && joueurActif === getIAColor()){
setTimeout(robotJoue, 200);
}
}
/* ===================== API import / games ===================== */
async function apiImportFile(file, width, height, starts){
  const fd=new FormData();
  fd.append("file", file);
  fd.append("width", String(width));
  fd.append("height", String(height));
  fd.append("starts_with", starts);

  const res = await fetch(`${API}/import-file`, { method:"POST", body:fd });
  return res.json();
}

async function apiListGames(){ const r=await fetch(`${API}/games`); return r.json(); }
async function apiGetGame(id){ const r=await fetch(`${API}/games/${id}`); return r.json(); }
async function apiGetMirror(id){ const r=await fetch(`${API}/games/${id}/mirror`); return r.json(); }

function rejouerSequence(seqStr){
  recommencer();
  TabVisu(); viderVisuel();
  const moves = seqStr.trim().split("").map(Number);
  for (const c of moves){
    const col0 = c-1;
    appliquerCoup(col0);
  }
  MAJ();
  afficherPoids(); // ✅ À AJOUTER
}

async function refreshGamesList(){
  const list=document.getElementById("gamesList");
  if(!list) return;

  let games=[];
  try{ games = await apiListGames(); }
  catch(e){
    list.innerHTML = `<div style="color:#111">API indisponible (${API})</div>`;
    return;
  }

  list.innerHTML="";
  games.forEach(g=>{
    const div=document.createElement("div");
    div.style.padding="10px";
    div.style.border="1px solid #444";
    div.style.borderRadius="10px";
    div.style.color="white";
    div.style.background="rgba(0,0,0,0.35)";

    div.innerHTML = `
      <div><b>Partie #${g.id}</b> (${g.move_count} coups)</div>
      <div>Séquence : ${g.seq_str}</div>
      <div>Canonique : ${g.canonical_seq}</div>
      <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btnShow" data-id="${g.id}">Afficher</button>
        <button class="btn btnMirror" data-id="${g.id}">Symétrie</button>
      </div>
    `;
    list.appendChild(div);
  });

  document.querySelectorAll(".btnShow").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id=btn.dataset.id;
      const g=await apiGetGame(id);
      rejouerSequence(g.seq_str);
    });
  });

  document.querySelectorAll(".btnMirror").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id=btn.dataset.id;
      const m=await apiGetMirror(id);
      rejouerSequence(m.mirrored);
    });
  });
}

/* ===================== CHARGER BGA ===================== */
async function loadFromBGAId(bgaId){
  if (!bgaId) return;

  try{
    const r = await fetch(`${API}/import-bga?id=${encodeURIComponent(bgaId)}`);
    const data = await r.json();

    if (!data || !data.seq_str){
      alert("Backend: je n’ai pas reçu seq_str. Adapte l’endpoint / format.");
      return;
    }
    rejouerSequence(data.seq_str);
    statut.textContent = `Partie BGA ${bgaId} chargée.`;
  }catch(e){
    console.error(e);
    alert("Erreur chargement BGA (endpoint à vérifier côté backend).");
  }
}

/* ===================== MODE PEINTURE ===================== */
const paint = {
  enabled: false,
  brush: "rouge"
};

function paintHover(cell, on){
  if (!paint.enabled) return;
  cell.classList.toggle("paint-hover", on);
}

function onCellClick(row, col){
  if (paint.enabled) return paintApply(row, col);
  return jouer(col);
}

function estimateNextPlayerFromCounts(){
  let r=0, j=0;
  for (let y=0; y<H(); y++){
    for (let x=0; x<L(); x++){
      if (tableau[y][x] === "rouge") r++;
      else if (tableau[y][x] === "jaune") j++;
    }
  }
  if (r === j) return config.commence;
  if (r === j + 1) return "jaune";
  if (j === r + 1) return "rouge";
  return null;
}

function paintApply(row, col){
  if (fin || enReplay) return;

  const b = paint.brush;
  if (b === "erase"){
    tableau[row][col] = null;
  } else {
    tableau[row][col] = b;
  }

  TabVisu(); viderVisuel();
  for (let r=0;r<H();r++){
    for (let c=0;c<L();c++){
      if (tableau[r][c]) pion(r,c,tableau[r][c]);
    }
  }

  fin = false; resultat = null; casesGagnantes = [];
  clearBestScores();

  if (b !== "erase") setLastMove({ row, col, joueur: b });

  const guess = estimateNextPlayerFromCounts();
  if (guess) joueurActif = guess;

  MAJ();
  afficherPoids(); // ✅ À AJOUTER
  syncHistoryFromBoard();
  runPrediction();
}

function clearBoardPaint(){
  tableau = Array.from({ length:H() }, () => Array(L()).fill(null));
  historique = [];
  lastMove = null;
  setLastMove(null);
  fin = false; resultat = null; casesGagnantes = [];

  TabVisu(); viderVisuel();
  MAJ();
}

function syncHistoryFromBoard(){
  const hist = [];
  for (let c=0;c<L();c++){
    for (let r=H()-1;r>=0;r--){
      const v = tableau[r][c];
      if (v) hist.push({ row:r, col:c, joueur:v });
    }
  }
  historique = hist;
  statut.textContent = "Sync séquence fait (approx).";
}

/* ===================== MAIN ===================== */
function main(reset=true){
  chargerConfig();
  chargerIA();

  if (elMode) mode = Number(elMode.value || "2");
  if (elIaMode) elIaMode.value = IA.type;
  if (elDepth) elDepth.value = IA.depth;

  clearInterval(autoTimer); autoTimer=null;

  if (reset){
    idPartie = nouveauNumeroPartie();
    recommencer();
    TabVisu();
    MAJ();
  } else {
    TabVisu(); viderVisuel();
    for (const coup of historique) pion(coup.row,coup.col,coup.joueur);
    MAJ();
  }

  applyModeRuntime();
}

/* ===================== LISTENERS ===================== */
document.getElementById("Puissance4")?.addEventListener("click", ()=>main(true));

document.getElementById("stop")?.addEventListener("click", ()=>{
  if (fin) return;
  enPause = !enPause;
  MAJ();
});

document.getElementById("undo")?.addEventListener("click", annuler);
document.getElementById("save")?.addEventListener("click", sauvegarder);
document.getElementById("load")?.addEventListener("click", reprendre);
document.getElementById("params")?.addEventListener("click", parametrage);

document.getElementById("prev")?.addEventListener("click", replayPrecedent);
document.getElementById("next")?.addEventListener("click", replaySuivant);
document.getElementById("exitReplay")?.addEventListener("click", sortirReplay);

document.getElementById("iaMode")?.addEventListener("change", (e)=>{
  IA.type = e.target.value;
  sauverIA();
});

document.getElementById("depth")?.addEventListener("change", (e)=>{
  IA.depth = Math.max(1, Math.min(8, Number(e.target.value)||4));
  e.target.value = IA.depth;
  sauverIA();
});

document.getElementById("analyseNow")
?.addEventListener("click", conseillerCoup);

document.getElementById("aiPlayOnce")?.addEventListener("click", async () => {
if (fin || enPause || enReplay) return;
await jouerCoupIAGaranti();
});

elMode?.addEventListener("change", ()=>{
  mode = Number(elMode.value || "2");
  applyModeRuntime();
  MAJ();
});

elHuman?.addEventListener("change", ()=>{
  applyModeRuntime();
  MAJ();
});

document.getElementById("importForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();

  const file = document.getElementById("fileInput")?.files?.[0];
  const width = Number(document.getElementById("importWidth")?.value);
  const height = Number(document.getElementById("importHeight")?.value);
  const starts = document.getElementById("importStarts")?.value;

  if (!file) return alert("Choisis un fichier .txt (ex: 3131313.txt)");

  try{
    const res = await apiImportFile(file, width, height, starts);
    alert(res.message ?? "Import terminé");
    await refreshGamesList();
  }catch{
    alert("Erreur d’import");
  }
});



function showPrediction(text, type = "neutral") {
const bar = document.getElementById("predictionBar");
const span = document.getElementById("predictionText");
if (!bar || !span) return;

bar.className = "predictionbar " + type;
span.textContent = text;
bar.style.display = "block";
}
async function detectWinningDepth(board, player, maxDepth = 6) {
const opponent = (player === "rouge") ? "jaune" : "rouge";

for (let depth = 1; depth <= maxDepth; depth++) {
const score = await minimaxAsync(
cloneTableau(board),
depth,
true,
player,
-Infinity,
Infinity
);

// Convention : gros score = win forcée
if (score > 90000) {
return { winner: player, depth };
}
if (score < -90000) {
return { winner: opponent, depth };
}
}

return null; // pas de gain forcé détecté
}


async function getDbAdvantage() {
try {
const seqStr = historique.map(h => h.col + 1).join("");
const playable = [];
for (let c = 0; c < L(); c++) playable.push(caseDispo(c) !== -1 ? 1 : 0);

const url = `${API}/ai/db?seq=${seqStr}&width=${L()}&height=${H()}&playable=${playable.join(",")}`;
const r = await fetch(url);
const data = await r.json();

if (data.coverage < 20) return null;

const avg = data.scores.reduce((a,b)=>a+b,0) / data.scores.length;
return avg > 20 ? "rouge" : avg < -20 ? "jaune" : "neutral";
} catch {
return null;
}
}
async function runPrediction() {
  showPrediction("Analyse de la position…", "neutral");

  // Partie déjà finie
  if (fin) {
    if (resultat === "rouge") {
      showPrediction("Victoire rouge", "good");
      return;
    }
    if (resultat === "jaune") {
      showPrediction("Victoire jaune", "bad");
      return;
    }
    if (resultat === "nul") {
      showPrediction("Match nul", "neutral");
      return;
    }
  }

  try {
    // 1) On cherche une vraie suite gagnante
    const redWin = getWinPrediction("rouge", 7);
    if (redWin) {
      const coups = depthToHumanMoves(redWin.depth);

      if (redWin.sequence.length === 1) {
        showPrediction(
          `Rouge peut gagner immédiatement : colonne ${redWin.sequence[0] + 1}`,
          "good"
        );
      } else {
        showPrediction(
          `Rouge peut gagner en ${coups} coup(s) — suite : ${sequenceToText(redWin.sequence)}`,
          "good"
        );
      }
      return;
    }

    const yellowWin = getWinPrediction("jaune", 7);
    if (yellowWin) {
      const coups = depthToHumanMoves(yellowWin.depth);

      if (yellowWin.sequence.length === 1) {
        showPrediction(
          `Jaune peut gagner immédiatement : colonne ${yellowWin.sequence[0] + 1}`,
          "bad"
        );
      } else {
        showPrediction(
          `Jaune peut gagner en ${coups} coup(s) — suite : ${sequenceToText(yellowWin.sequence)}`,
          "bad"
        );
      }
      return;
    }

    // 2) Si pas de suite gagnante trouvée, on garde ta logique actuelle
    const board = cloneTableau(tableau);
    const current = joueurActif;
    const forced = await detectWinningLine(board, current, 4);

    if (forced.result === "WIN") {
      showPrediction(
        `${labelCouleur(forced.winner)} a une victoire imminente`,
        forced.winner === "rouge" ? "good" : "bad"
      );
      return;
    }

    if (forced.result === "LOSS") {
      const other = forced.winner;
      showPrediction(
        `Attention : ${labelCouleur(other)} menace de gagner`,
        other === "rouge" ? "good" : "bad"
      );
      return;
    }

    // 3) Fallback statistique
    const adv = await getDbAdvantage();

    if (adv === "rouge") {
      showPrediction("Rouge est avantagé (statistique)", "good");
    } else if (adv === "jaune") {
      showPrediction("Jaune est avantagé (statistique)", "bad");
    } else {
      showPrediction("Position incertaine ou équilibrée", "neutral");
    }
  } catch (e) {
    console.error("runPrediction error:", e);
    showPrediction("Analyse indisponible", "neutral");
  }
}


document.getElementById("analyseNow")
?.addEventListener("click", runPrediction);

 

document.getElementById("refreshGames")?.addEventListener("click", refreshGamesList);

document.getElementById("loadBga")?.addEventListener("click", ()=>{
  const id = Number(document.getElementById("bgaId")?.value);
  loadFromBGAId(id);
});

document.getElementById("paintToggle")?.addEventListener("change", (e)=>{
  paint.enabled = !!e.target.checked;
  MAJ();
});

document.querySelectorAll(".brush")?.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".brush").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    paint.brush = btn.dataset.brush;
  });
});

document.querySelector('.brush[data-brush="rouge"]')?.classList.add("active");

document.getElementById("clearBoard")?.addEventListener("click", clearBoardPaint);
document.getElementById("syncHistory")?.addEventListener("click", syncHistoryFromBoard);
document.getElementById("predictBtn")
?.addEventListener("click", runPrediction);

/* ===================== START ===================== */
main(true);
refreshGamesList();
