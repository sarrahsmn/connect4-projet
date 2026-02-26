
//config miss 1.2
let config = { hauteur: 8, largeur: 9, commence: "rouge" };
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

//variable etat de jeu
let tableau;
let joueurActif;
let fin;
let resultat = null;   // "rouge" / "jaune" / "nul" / null
let mode = 2;          // 0 robot vs robot / 1 humain vs robot / 2 humains
let autoTimer = null;
let enPause = false;

let idPartie = 0;
let historique = [];       // [{row,col,joueur}]
let casesGagnantes = [];   // [{row,col}]

let enReplay = false;
let replayIndex = 0;
let snapshotAvantReplay = null;
let historiqueSource = [];
// Paramètres IA
let IA = { type: "aleatoire", depth: 4 };

function chargerIA(){
  try{
    const txt = localStorage.getItem("p4_ai");
    if (!txt) return;
    const o = JSON.parse(txt);
    if (o && (o.type === "aleatoire" || o.type === "minimax")) IA.type = o.type;
    if (Number.isFinite(o.depth)) IA.depth = Math.max(1, Math.min(8, o.depth));
  }catch{}
}

function sauverIA(){
  localStorage.setItem("p4_ai", JSON.stringify(IA));
}

//dom
const Tab = document.getElementById("tableau");
const statut = document.getElementById("deroulement");
const elMode = document.getElementById("mode");

//
function isPlateauPlein() {
  return tableau.every(ligne => ligne.every(cell => cell !== null));
}

function MAJ() {
  document.getElementById("stop").textContent = (enPause && !fin) ? "Reprendre" : "Arrêter";

  if (enReplay) {
    statut.textContent = `Replay : coup ${replayIndex}/${historiqueSource.length}`;
    return;
  }
  if (enPause && !fin) {
    statut.textContent = " Pause (clique sur Reprendre)";
    return;
  }
  if (fin) {
    if (resultat === "nul") statut.textContent = " Match nul !";
    else statut.textContent = ` ${resultat === "rouge" ? "Rouge" : "Jaune"} gagne !`;
    return;
  }
  statut.textContent = `Au tour du ${joueurActif === "rouge" ? "Rouge" : "Jaune"}`;
}

function cloneTableau(t = tableau) {
  return t.map(l => l.slice());
}
function TabVisu() {
  Tab.innerHTML = "";

  // → dimensions du plateau (avec labels)
  Tab.style.setProperty("--cols", L() + 1);
  Tab.style.setProperty("--rows", H() + 1);

  // → dimensions de la barre des scores (sans labels)
  document.getElementById("scores").style.setProperty("--cols", L());

  // Case vide en haut à gauche
  const corner = document.createElement("div");
  corner.className = "label";
  Tab.appendChild(corner);

  // Ligne des colonnes (1 → L)
  for (let col = 0; col < L(); col++) {
    const head = document.createElement("div");
    head.className = "label";
    head.textContent = col + 1;
    Tab.appendChild(head);
  }

  // Lignes suivantes
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
      cell.addEventListener("click", () => jouer(col));
      Tab.appendChild(cell);
    }
  }

  // → re-construit la barre des scores pour avoir L cases
  initScores();
}
//plateau visuel ui 
function TabVisu() {
  Tab.innerHTML = "";

  // Dimensions du plateau (avec labels)
  Tab.style.setProperty("--cols", L() + 1);
  Tab.style.setProperty("--rows", H() + 1);

  // Dimensions de la barre des scores (sans labels)
  const Scores = document.getElementById("scores");
  if (Scores) Scores.style.setProperty("--cols", L());

  // Case vide en haut à gauche
  const corner = document.createElement("div");
  corner.className = "label";
  Tab.appendChild(corner);

  // Ligne des colonnes (1 → L)
  for (let col = 0; col < L(); col++) {
    const head = document.createElement("div");
    head.className = "label";
    head.textContent = col + 1;
    Tab.appendChild(head);
  }

  // Lignes suivantes
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
      cell.addEventListener("click", () => jouer(col));
      Tab.appendChild(cell);
    }
  }

  // Re-construit la barre des scores pour avoir L cases
  initScores();
}


function viderVisuel() {
  Tab.querySelectorAll(".Case").forEach(cell => {
    cell.className = "Case";
  });
}


function indexCase(row, col) {
  const colsTotal = L() + 1;          // +1 pour la colonne des labels
  const header = colsTotal;          // 1ère ligne = labels (L+1 cases)
  return header + row * colsTotal + 1 + col; // +1 pour le label à gauche
}

function pion(row, col, joueur) {
  const idx = indexCase(row, col);
  Tab.children[idx]?.classList.add(joueur);
}


function surligner() {
  for (const pos of casesGagnantes) {
    const idx = indexCase(pos.row, pos.col);
    Tab.children[idx]?.classList.add("win");
  }
}


//recommencer/initialiser la partie
function recommencer() {
  tableau = Array.from({ length: H() }, () => Array(L()).fill(null));
  joueurActif = config.commence;
  fin = false;
  resultat = null;
  historique = [];
  casesGagnantes = [];

  enPause = false;
  enReplay = false;
  replayIndex = 0;

  MAJ();

  // → réinitialise l’affichage des scores (L cases, toutes à "—")
  initScores();
}



//trouver la case dispo selon gravité                                    
function caseDispo(col) {
  for (let r = H() - 1; r >= 0; r--) if (tableau[r][col] === null) return r;
  return -1;
}

//victoire 
function Gagnant(row, col) {
  const p = tableau[row][col];
  if (!p) return false;

  const dirs = [
    { dr: 0, dc: 1 },   // horizontal
    { dr: 1, dc: 0 },   // vertical
    { dr: 1, dc: 1 },   // diag \
    { dr: 1, dc: -1 }   // diag /
  ];

  for (const { dr, dc } of dirs) {
    const ligne = [{ row, col }];

    // va dans le sens + (ex: droite, bas, diag)
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < H() && c >= 0 && c < L() && tableau[r][c] === p) {
      ligne.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    // va dans le sens - (ex: gauche, haut, diag)
    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < H() && c >= 0 && c < L() && tableau[r][c] === p) {
      ligne.push({ row: r, col: c });
      r -= dr;
      c -= dc;
    }

    // si on a 4 ou plus, victoire
    if (ligne.length >= 4) {
      casesGagnantes = ligne;
      return true;
    }
  }

  return false;
}


//coup/tour
function appliquerCoup(col) {
  const row = caseDispo(col);
  if (row === -1) return false;

  tableau[row][col] = joueurActif;
  pion(row, col, joueurActif);
  historique.push({ row, col, joueur: joueurActif });

  if (Gagnant(row, col)) {
    fin = true;
    resultat = joueurActif;
    surligner();
    MAJ();

    // sauvegarde résultat (Mission 1.2)
    const results = JSON.parse(localStorage.getItem("p4_results") || "[]");
    results.push({ idPartie, date: new Date().toISOString(), H: H(), L: L(), commence: config.commence, resultat });
    localStorage.setItem("p4_results", JSON.stringify(results));

    return true;
  }
  
  
  if (isPlateauPlein()) {
    fin = true;
    resultat = "nul";
    MAJ();

    const results = JSON.parse(localStorage.getItem("p4_results") || "[]");
    results.push({ idPartie, date: new Date().toISOString(), H: H(), L: L(), commence: config.commence, resultat });
    localStorage.setItem("p4_results", JSON.stringify(results));

    return true;
  }

  joueurActif = (joueurActif === "rouge") ? "jaune" : "rouge";
  MAJ();
  return true;
}
function caseDispoSur(t, col){
  for (let r = H() - 1; r >= 0; r--) if (t[r][col] === null) return r;
  return -1;
}

function coupsPossibles(t){
  const arr = [];
  for (let c = 0; c < L(); c++) if (caseDispoSur(t, c) !== -1) arr.push(c);
  // ordre par proximité du centre pour mieux pruner
  const center = (L() - 1) / 2;
  arr.sort((a,b)=> Math.abs(a - center) - Math.abs(b - center));
  return arr;
}

// Vérifie gagnant dans un tableau t (sans dépendre des globals)
function gagnantSur(t){
  const dirs = [
    { dr:0, dc:1 },  // horiz
    { dr:1, dc:0 },  // vert
    { dr:1, dc:1 },  // diag \
    { dr:1, dc:-1 }  // diag /
  ];
  for (let r = 0; r < H(); r++){
    for (let c = 0; c < L(); c++){
      const p = t[r][c];
      if (!p) continue;
      for (const {dr,dc} of dirs){
        let count = 1;
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < H() && cc >= 0 && cc < L() && t[rr][cc] === p){
          count++; rr += dr; cc += dc;
        }
        rr = r - dr; cc = c - dc;
        while (rr >= 0 && rr < H() && cc >= 0 && cc < L() && t[rr][cc] === p){
          count++; rr -= dr; cc -= dc;
        }
        if (count >= 4) return p; // "rouge" ou "jaune"
      }
    }
  }
  return null;
}

function pleinSur(t){
  return t.every(ligne => ligne.every(cell => cell !== null));
}
function evalFenetre(cells, maxP, minP){
  const nbMax = cells.filter(x => x === maxP).length;
  const nbMin = cells.filter(x => x === minP).length;
  const nbEmpty = cells.filter(x => x === null).length;

  // Terminal immédiat sur la fenêtre (utile pour équilibrer)
  if (nbMax === 4) return 100000;
  if (nbMin === 4) return -100000;

  let score = 0;
  if (nbMax === 3 && nbEmpty === 1) score += 120;
  if (nbMax === 2 && nbEmpty === 2) score += 15;

  if (nbMin === 3 && nbEmpty === 1) score -= 110;
  if (nbMin === 2 && nbEmpty === 2) score -= 12;

  return score;
}

function evaluation(t, maxP){
  // minP = autre couleur
  const minP = (maxP === "rouge") ? "jaune" : "rouge";
  let score = 0;

  // Bonus centre
  const centerCol = Math.floor(L()/2);
  let centerCount = 0;
  for (let r = 0; r < H(); r++) if (t[r][centerCol] === maxP) centerCount++;
  score += centerCount * 6;

  // Parcourt toutes les fenêtres de 4
  // Horizontal
  for (let r = 0; r < H(); r++){
    for (let c = 0; c <= L() - 4; c++){
      const window = [t[r][c], t[r][c+1], t[r][c+2], t[r][c+3]];
      score += evalFenetre(window, maxP, minP);
    }
  }
  // Vertical
  for (let r = 0; r <= H() - 4; r++){
    for (let c = 0; c < L(); c++){
      const window = [t[r][c], t[r+1][c], t[r+2][c], t[r+3][c]];
      score += evalFenetre(window, maxP, minP);
    }
  }
  // Diag \
  for (let r = 0; r <= H() - 4; r++){
    for (let c = 0; c <= L() - 4; c++){
      const window = [t[r][c], t[r+1][c+1], t[r+2][c+2], t[r+3][c+3]];
      score += evalFenetre(window, maxP, minP);
    }
  }
  // Diag /
  for (let r = 3; r < H(); r++){
    for (let c = 0; c <= L() - 4; c++){
      const window = [t[r][c], t[r-1][c+1], t[r-2][c+2], t[r-3][c+3]];
      score += evalFenetre(window, maxP, minP);
    }
  }

  return score;
}
// Stats pour affichage de progression
let searchStats = { nodes: 0 };

function minimax(t, depth, maximizing, maxP, alpha, beta){
  searchStats.nodes++;

  // Résultats immédiats
  const w = gagnantSur(t);
  if (w === maxP) return 100000 - (100 - depth);         // plus rapide = meilleur
  if (w && w !== maxP) return -100000 + (100 - depth);   // plus rapide = pire
  if (depth === 0 || pleinSur(t)) return evaluation(t, maxP);

  const minP = (maxP === "rouge") ? "jaune" : "rouge";
  const moves = coupsPossibles(t);

  if (maximizing){
    let best = -Infinity;
    for (const col of moves){
      const row = caseDispoSur(t, col);
      t[row][col] = maxP;
      const val = minimax(t, depth-1, false, maxP, alpha, beta);
      t[row][col] = null;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break; // alpha-beta cut
    }
    return best;
  } else {
    let best = +Infinity;
    for (const col of moves){
      const row = caseDispoSur(t, col);
      t[row][col] = minP;
      const val = minimax(t, depth-1, true, maxP, alpha, beta);
      t[row][col] = null;
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }
}
function initScores(){
  const S = document.getElementById("scores");
  S.innerHTML = "";
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
  const cell = S.children[col];
  if (!cell) return;
  cell.textContent = (value === null || value === undefined) ? "—" : String(value);
  cell.classList.toggle("invalide", !valid);
}

// Appelé quand on redessine le plateau ou change taille
function syncScoresGrid(){
  document.getElementById("scores").style.setProperty("--cols", L());
  initScores();
}
function robotMinimax(){
  if (fin || enPause || enReplay) return;

  const maxP = joueurActif; // la couleur qui joue est celle à maximiser
  const depth = IA.depth;
  const t = cloneTableau(tableau);
  const moves = coupsPossibles(t);

  // Prépare affichage progression
  searchStats.nodes = 0;
  let bestCol = null;
  let bestScore = -Infinity;
  let progressTimer = setInterval(()=>{
    statut.textContent = `IA (Minimax d=${depth}) : ${searchStats.nodes} nœuds explorés…`;
  }, 120);

  // Nettoie et initialise scores
  for (let c = 0; c < L(); c++) setScoreCol(c, null, false);

  let i = 0;
  function evalNext(){
    if (i >= moves.length){
      clearInterval(progressTimer);
      // Choisit et joue
      if (bestCol === null){
        // fallback si pas de coups (devrait pas arriver)
        robotAleatoire();
        return;
      }
      statut.textContent = `IA : colonne ${bestCol+1} (score ${bestScore})`;
      appliquerCoup(bestCol);
      return;
    }

    const col = moves[i++];
    const row = caseDispoSur(t, col);

    // simule le coup du joueur actif
    t[row][col] = maxP;
    const val = minimax(t, depth-1, false, maxP, -Infinity, +Infinity);
    t[row][col] = null;

    setScoreCol(col, val, true);

    if (val > bestScore){
      bestScore = val;
      bestCol = col;
    }

    // Yield pour laisser le DOM respirer (progression visible)
    setTimeout(evalNext, 0);
  }

  evalNext();
}
function robotJoue(){
  if (IA.type === "minimax") robotMinimax();
  else robotAleatoire();
}
// jouer et garde fous 
function jouer(col) {
  if (fin || enPause || enReplay) return;

  if (mode === 0) return; // humain interdit
  if (mode === 1 && joueurActif === "jaune") return; // tour de l'IA : on bloque le clic

  if (!appliquerCoup(col)) return;

  // mode 1 : l'IA (jaune) joue après le coup humain
  if (mode === 1 && !fin && joueurActif === "jaune") {
    setTimeout(robotJoue, 200);
  }
}

// robot aléatoire 
function robotAleatoire() {
  if (fin || enPause || enReplay) return;

  const jouables = [];
  for (let c = 0; c < L(); c++) if (caseDispo(c) !== -1) jouables.push(c);
  if (jouables.length === 0) return;

  const col = jouables[(Math.random() * jouables.length) | 0];
  appliquerCoup(col);
}

//mode 0
function lancerMode0() {
  clearInterval(autoTimer);
 autoTimer = setInterval(() => {
  if (!fin && !enPause && !enReplay) robotJoue();
}, 400);
}

//undo 1.2 
function annuler() {
  if (historique.length === 0) return;

  fin = false;
  resultat = null;
  casesGagnantes = [];

  const dernier = historique.pop();
  tableau[dernier.row][dernier.col] = null;

  TabVisu();
  viderVisuel();
  //  reconstruction du tableau depuis historique
  tableau = Array.from({ length: H() }, () => Array(L()).fill(null));
  for (const coup of historique) {
    tableau[coup.row][coup.col] = coup.joueur;
    pion(coup.row, coup.col, coup.joueur);
  }

  joueurActif = dernier.joueur;
  MAJ();
}

// enregistrer charger 1.2
function sauvegarder() {
  if (historique.length === 0 && !fin) {
    statut.textContent = " Rien à sauvegarder (aucun coup).";
    return;
  }
  const save = { idPartie, config, mode, tableau, joueurActif, fin, resultat, historique };
  localStorage.setItem("p4_save", JSON.stringify(save));
  statut.textContent = " Sauvegarde faite.";
}

function reprendre() {
  const txt = localStorage.getItem("p4_save");
  if (!txt) { statut.textContent = " Aucune sauvegarde trouvée."; return; }

  const save = JSON.parse(txt);
  if (!save.config || !Number.isFinite(save.config.hauteur) || !Number.isFinite(save.config.largeur)) {
    statut.textContent = " Sauvegarde invalide."; return;
  }

  config = save.config;
  sauverConfig();

  idPartie = save.idPartie || 0;
  mode = save.mode ?? 2;
  tableau = save.tableau;
  joueurActif = save.joueurActif;
  fin = save.fin;
  resultat = save.resultat;
  historique = save.historique || [];

  enPause = false;
  enReplay = false;
  replayIndex = 0;

  TabVisu();
  viderVisuel();
  for (const coup of historique) pion(coup.row, coup.col, coup.joueur);

  // resurligner si victoire
  if (fin && resultat !== "nul" && historique.length > 0) {
    const last = historique[historique.length - 1];
    if (Gagnant(last.row, last.col)) surligner();
  }

  //synchro
  elMode.value = String(mode);

  clearInterval(autoTimer);
  autoTimer = null;
  if (mode === 0) lancerMode0();

  MAJ();
  statut.textContent = " Partie reprise.";
}

//replay 1.2 navigation 
function entrerReplay() {
  if (historique.length === 0) { statut.textContent = " Aucun coup à rejouer."; return; }
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

// parametre 1.2
function parametrage() {
  const h = Number(String(prompt("Nombre de lignes (>=4)", String(config.hauteur))).trim());
  const l = Number(String(prompt("Nombre de colonnes (>=4)", String(config.largeur))).trim());
  const c = String(prompt("Couleur qui commence ? (rouge/jaune)", config.commence)).trim().toLowerCase();

  // garde-fous
  if (!Number.isFinite(h) || h < 4) return alert("Hauteur invalide (>=4)");
  if (!Number.isFinite(l) || l < 4) return alert("Largeur invalide (>=4)");
  if (c !== "rouge" && c !== "jaune") return alert("Couleur invalide : rouge ou jaune");

  config = { hauteur: h, largeur: l, commence: c };
  sauverConfig();
  main();
}

//main 
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
  const elDepth = document.getElementById("depth");
  if (elIaMode) elIaMode.value = IA.type;
  if (elDepth) elDepth.value = IA.depth;

  // (optionnel) on a déjà fait initScores() via TabVisu()
  // const Scores = document.getElementById("scores");
  // if (Scores) Scores.style.setProperty("--cols", L());
  // initScores();

  if (mode === 0) lancerMode0();
}

// Launch
main();

// Events
document.getElementById("Puissance4")?.addEventListener("click", main);
document.getElementById("stop")?.addEventListener("click", () => { if (fin) return; enPause = !enPause; MAJ(); });
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
// parti simple si on change mode
elMode?.addEventListener("change", main);
