/******************************************************
 * Puissance 4 — Sarrah Osmani
 * - Ton moteur (config/IA/import/etc.)
 * - + Dernier coup clair
 * - + Choix couleur humaine (mode 1)
 * - + Boutons : IA suggère / IA jouerait
 * - + Switch mode en pleine partie sans reset
 * - + Mode peinture (rouge/jaune/effacer) pour entretien
 * - + Input BGA (hook backend)
 ******************************************************/

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
  // rows/cols affichés en 1-based
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

  // message demandé par ton prof (qui vient de jouer + qui doit jouer)
  if (lastMove){
    const prochain = labelCouleur(joueurActif);
    statut.textContent = `${lastMini.textContent} — au tour de ${prochain}`;
  } else {
    statut.textContent = `Au tour du ${labelCouleur(joueurActif)}`;
  }
}

/* ===================== SCORES ===================== */
function initScores(){
  const S = document.getElementById("scores");
  if (!S) return;

  S.innerHTML = "";

  // colsTotal = (colonne labels) + L()
  S.style.setProperty("--colsTotal", L() + 1);

  // spacer (colonne des labels à gauche)
  const spacer = document.createElement("div");
  spacer.className = "scorecell spacer";
  spacer.textContent = "";
  S.appendChild(spacer);

  // puis les scores des colonnes jouables
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

  // +1 car S.children[0] = spacer
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

  // +1 car spacer
  const cell = S.children[col + 1];
  if (cell) cell.classList.add("best");
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

  clearBestScores();

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
  MAJ();
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

  // mode 1 : interdire le clic quand c'est au tour de l'IA
  if (mode === 1 && joueurActif === getIAColor()) return;

  if (!appliquerCoup(col)) return;

  // si on est en mode 1 et que c’est maintenant au tour IA => jouer
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
  for (let r=0;r<H();r++) if(t[r][centerCol]===maxP) score+=6;

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

function minimax(t, depth, maximizing, maxP, alpha, beta){
  const w=gagnantSur(t);
  if (w===maxP) return 100000-(100-depth);
  if (w && w!==maxP) return -100000+(100-depth);
  if (depth===0 || pleinSur(t)) return evaluation(t,maxP);

  const minP=(maxP==="rouge")?"jaune":"rouge";
  const moves=coupsPossibles(t);

  if (maximizing){
    let best=-Infinity;
    for(const col of moves){
      const row=caseDispoSur(t,col);
      t[row][col]=maxP;
      const val=minimax(t,depth-1,false,maxP,alpha,beta);
      t[row][col]=null;
      if(val>best) best=val;
      if(best>alpha) alpha=best;
      if(beta<=alpha) break;
    }
    return best;
  } else {
    let best=Infinity;
    for(const col of moves){
      const row=caseDispoSur(t,col);
      t[row][col]=minP;
      const val=minimax(t,depth-1,true,maxP,alpha,beta);
      t[row][col]=null;
      if(val<best) best=val;
      if(best<beta) beta=best;
      if(beta<=alpha) break;
    }
    return best;
  }
}

function robotAleatoire(){
  if (fin || enPause || enReplay) return;
  const jouables=[];
  for(let c=0;c<L();c++) if(caseDispo(c)!==-1) jouables.push(c);
  if(!jouables.length) return;
  const col = jouables[(Math.random()*jouables.length)|0];
  appliquerCoup(col);
}

function robotMinimax(jouerVraiment=true){
  if (fin || enPause || enReplay) return;

  const maxP = joueurActif;
  const depth = IA.depth;
  const t = cloneTableau(tableau);
  const moves = coupsPossibles(t);

  clearBestScores();
  for (let c=0;c<L();c++) setScoreCol(c, null, false);

  let bestCol=null, bestScore=-Infinity;

  for (const col of moves){
    const row=caseDispoSur(t,col);
    t[row][col]=maxP;
    const val=minimax(t, depth-1, false, maxP, -Infinity, +Infinity);
    t[row][col]=null;

    setScoreCol(col, val, true);
    if (val>bestScore){ bestScore=val; bestCol=col; }
  }

  if (bestCol != null){
    markBestScore(bestCol);
    statut.textContent = `Minimax : meilleur coup = colonne ${bestCol+1} (score ${bestScore})`;
    if (jouerVraiment) appliquerCoup(bestCol);
  } else {
    if (jouerVraiment) robotAleatoire();
  }
}

const API = "https://connect4-projet.onrender.com";

async function robotDb(){
  if (fin || enPause || enReplay) return;

  // si le plateau a été “peint”, l’historique peut être faux => fallback minimax
  if (paint.enabled){
    statut.textContent = "DB : mode peinture actif → fallback Minimax.";
    return robotMinimax(true);
  }

  const seqStr = (historique || []).map(h => h.col+1).join('');
  const playable=[];
  for(let c=0;c<L();c++) playable.push(caseDispo(c)!==-1 ? 1 : 0);

  try{
    const url = `${API}/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;
    const res = await fetch(url);
    const data = await res.json();

    clearBestScores();
    if (Array.isArray(data.scores) && data.scores.length===L()){
      for(let c=0;c<L();c++) setScoreCol(c, data.scores[c], true);
    } else {
      for(let c=0;c<L();c++) setScoreCol(c, null, false);
    }

    let col = (typeof data.best === "number") ? data.best : null;
    if (col == null || data.fallback === "low_coverage"){
      statut.textContent = `DB : couverture faible (${data.coverage ?? 0}) → Minimax`;
      return robotMinimax(true);
    }

    markBestScore(col);
    statut.textContent = `DB joue colonne ${col+1} (coverage=${data.coverage ?? 0})`;
    appliquerCoup(col);
  } catch(e){
    console.error("robotDb error:", e);
    statut.textContent = "DB : erreur → aléatoire";
    robotAleatoire();
  }
}

function robotJoue(){
  if (IA.type === "db") return robotDb();
  if (IA.type === "minimax") return robotMinimax(true);
  return robotAleatoire();
}

/* ===================== IA SUGGÈRE (sans jouer) ===================== */
async function analyserSansJouer(){
  if (fin || enPause || enReplay) return;

  // si peinture => Minimax (car DB dépend séquence)
  if (paint.enabled || IA.type === "minimax" || IA.type === "aleatoire"){
    robotMinimax(false);
    return;
  }

  // IA DB mais sans jouer : on appelle DB et on n'applique pas le coup
  try{
    const seqStr = (historique || []).map(h => h.col+1).join('');
    const playable=[];
    for(let c=0;c<L();c++) playable.push(caseDispo(c)!==-1 ? 1 : 0);

    const url = `${API}/ai/db?seq=${encodeURIComponent(seqStr)}&width=${L()}&height=${H()}&playable=${playable.join(',')}`;
    const res = await fetch(url);
    const data = await res.json();

    clearBestScores();
    if (Array.isArray(data.scores) && data.scores.length===L()){
      for(let c=0;c<L();c++) setScoreCol(c, data.scores[c], true);
    } else {
      for(let c=0;c<L();c++) setScoreCol(c, null, false);
    }

    if (typeof data.best === "number"){
      markBestScore(data.best);
      statut.textContent = `DB : meilleur coup = colonne ${data.best+1} (coverage=${data.coverage ?? 0})`;
    } else {
      statut.textContent = `DB : pas assez de données (coverage=${data.coverage ?? 0}).`;
    }
  } catch(e){
    console.error("analyse db error:", e);
    statut.textContent = "Analyse DB : erreur → Minimax";
    robotMinimax(false);
  }
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

  // recalcul dernier coup
  const prev = historique[historique.length-1] || null;
  setLastMove(prev ? {row:prev.row,col:prev.col,joueur:prev.joueur} : null);

  MAJ();
}

function sauvegarder(){
  const save = {
    idPartie, config, mode, tableau, joueurActif, fin, resultat,
    historique, lastMove, IA, humanColor: getHumanColor()
  };
  localStorage.setItem("p4_save", JSON.stringify(save));
  statut.textContent = "Sauvegarde faite.";
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
  for(const coup of historique) pion(coup.row,coup.col,coup.joueur);

  if (lastMove) setLastMove(lastMove); else setLastMove(null);

  if (fin && resultat !== "nul" && historique.length>0){
    const last = historique[historique.length-1];
    if (Gagnant(last.row,last.col)) surligner();
  }

  // synchro UI
  if (elMode) elMode.value = String(mode);
  if (elIaMode) elIaMode.value = IA.type;
  if (elDepth) elDepth.value = IA.depth;

  applyModeRuntime();

  MAJ();
  statut.textContent="Partie reprise.";
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
  autoTimer = setInterval(()=>{
    if (!fin && !enPause && !enReplay) robotJoue();
  }, 400);
}

function applyModeRuntime(){
  clearInterval(autoTimer);
  autoTimer=null;
  if (mode === 0) lancerMode0();

  // si mode 1 et c'est au tour IA => lancer un coup auto
  if (mode === 1 && !fin && !enPause && !enReplay && joueurActif === getIAColor()){
    setTimeout(robotJoue, 200);
  }
}

/* ===================== API import / games (ton code) ===================== */
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

/* ===================== MISSION 4.1 : CHARGER BGA (hook backend) ===================== */
/**
 * IMPORTANT:
 * Je ne peux pas deviner ton endpoint exact.
 * Ici je mets 2 options :
 *  - /bga/:id (GET) -> { seq_str: "..." } (exemple)
 *  - /import-bga?id= (POST/GET) -> { seq_str: "..." }
 * Tu adaptes 1 ligne quand tu sais ton endpoint.
 */
async function loadFromBGAId(bgaId){
  if (!bgaId) return;

  try{
    // OPTION A (à adapter)
    // const r = await fetch(`${API}/bga/${bgaId}`);
    // const data = await r.json();

    // OPTION B (à adapter)
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
  brush: "rouge" // "rouge" | "jaune" | "erase"
};

function paintHover(cell, on){
  if (!paint.enabled) return;
  cell.classList.toggle("paint-hover", on);
}

function onCellClick(row, col){
  if (paint.enabled) return paintApply(row, col);
  return jouer(col); // ton gameplay normal = clic colonne
}

function paintApply(row, col){
  if (fin || enReplay) return;

  const b = paint.brush;
  if (b === "erase"){
    tableau[row][col] = null;
  } else {
    tableau[row][col] = b;
  }

  // rendu simple : on redraw le plateau (rapide et fiable)
  TabVisu(); viderVisuel();
  for (let r=0;r<H();r++){
    for (let c=0;c<L();c++){
      if (tableau[r][c]) pion(r,c,tableau[r][c]);
    }
  }

  // pas de victoire auto en peinture (sinon ça bloque l’entretien)
  fin = false; resultat = null; casesGagnantes = [];
  clearBestScores();

  // dernier coup affiché = le dernier “paint”
  if (b !== "erase") setLastMove({ row, col, joueur: b });

  MAJ();
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

/**
 * Sync option : tente de reconstruire une séquence “jouable”
 * (c’est impossible parfaitement si la peinture met des pions en l’air),
 * donc on fait un “best effort” : on reconstruit l’historique par gravité.
 */
function syncHistoryFromBoard(){
  // reconstruit un historique en lisant colonne par colonne de bas en haut
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

  // mode au démarrage
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
    // si on ne reset pas, on re-render juste si besoin
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

// Replay
document.getElementById("prev")?.addEventListener("click", replayPrecedent);
document.getElementById("next")?.addEventListener("click", replaySuivant);
document.getElementById("exitReplay")?.addEventListener("click", sortirReplay);

// IA
document.getElementById("iaMode")?.addEventListener("change", (e)=>{
  IA.type = e.target.value;
  sauverIA();
});
document.getElementById("depth")?.addEventListener("change", (e)=>{
  IA.depth = Math.max(1, Math.min(8, Number(e.target.value)||4));
  e.target.value = IA.depth;
  sauverIA();
});

document.getElementById("analyseNow")?.addEventListener("click", analyserSansJouer);
document.getElementById("aiPlayOnce")?.addEventListener("click", ()=>{
  if (fin || enPause || enReplay) return;
  robotJoue();
});

// Mode switch runtime (sans reset)
elMode?.addEventListener("change", ()=>{
  mode = Number(elMode.value || "2");
  applyModeRuntime();
  MAJ();
});

// Human color change runtime
elHuman?.addEventListener("change", ()=>{
  // si mode 1 et maintenant c’est au tour IA → joue
  applyModeRuntime();
  MAJ();
});

// Import file + liste
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
document.getElementById("refreshGames")?.addEventListener("click", refreshGamesList);

// BGA
document.getElementById("loadBga")?.addEventListener("click", ()=>{
  const id = Number(document.getElementById("bgaId")?.value);
  loadFromBGAId(id);
});

// Peinture
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

// Start
main(true);
refreshGamesList();
