// p4-server/scripts/import_bga_manual.js

// Usage : node p4-server/scripts/import_bga_manual.js "H:\...\bga_1.txt" "WinnerName" 1780

// Le .txt doit contenir la séquence BGA en 1..9 (ex: 532416754321)

//

// Insère en base : source='bga', confiance (entier), winner_name, winner_elo

// Calcule : canonical_seq (anti-doublon séquence), final_pos_hash (anti-doublon situation), nb_cols.



import fs from 'fs/promises';

import { pool } from '../lib/db.js';

import { canonicalizeSeq, sha256Hex } from '../lib/seq.js';



// ---------- Helpers plateau (mêmes conventions que server.js) ----------

function buildEmptyBoard(H, L) {

  return Array.from({ length: H }, () => Array(L).fill('.'));

}

function drop(board, col0, token) {

  for (let r = board.length - 1; r >= 0; r--) {

    if (board[r][col0] === '.') { board[r][col0] = token; return true; }

  }

  return false;

}

function mirrorBoard(board) {

  return board.map(row => [...row].reverse());

}

function serializeBoard(board) {

  const H = board.length, L = board[0].length;

  let s = '';

  for (let c = 0; c < L; c++) {

    for (let r = H - 1; r >= 0; r--) s += board[r][c]; // bas->haut par colonne

  }

  return s;

}

function canonicalBoardHash(board) {

  const a = serializeBoard(board);

  const b = serializeBoard(mirrorBoard(board));

  const canon = (b < a) ? b : a;

  return sha256Hex(canon);

}

function countPlayableColumns(board) {

  const L = board[0].length;

  let cnt = 0;

  for (let c = 0; c < L; c++) if (board[0][c] === '.') cnt++;

  return cnt;

}



// ---------- Mapping ELO -> confiance (échelle entière demandée par le prof) ----------

// 0=exprès perdre, 1=aléatoire, 2=heuristique, 3=minimax d3 (approx),

// 4=minimax d5 (approx), 5=expert (très fort)

function confianceFromElo(elo) {

  if (!Number.isFinite(elo)) return 2;     // pas d'info => heuristique

  if (elo >= 1000) return 5;               // expert

  if (elo >= 800) return 4;               // très fort

  if (elo >= 600) return 3;               // bon niveau

  if (elo >= 400) return 2;               // intermédiaire

  return 1;                                // faible / proche aléatoire

}



// ---------- Lecture séquence ----------

async function readSeqStrFromTxt(filePath) {

  const raw = (await fs.readFile(filePath, 'utf8'))

    .toString()

    .trim();



  // On autorise des séparateurs " " ou "\n" : on garde UNIQUEMENT les chiffres 1..9

  const cleaned = raw.replace(/[^1-9]/g, '');

  if (!cleaned.length) throw new Error('Aucune séquence 1..9 trouvée dans le fichier.');

  if (!/^[1-9]+$/.test(cleaned)) throw new Error('Séquence invalide (doit être composée de [1-9]).');



  return cleaned;

}



async function main() {

  const filePath    = process.argv[2];                // chemin .txt

  const winnerName  = process.argv[3] ?? null;        // "PseudoGagnant"

  const winnerElo   = Number(process.argv[4] ?? '0'); // 0 = inconnu

  const colorsSwapped = /^1|true|oui$/i.test(String(process.argv[5] ?? 'false')); // si les couleurs ont été permutées en cours de partie (ex: le joueur qui commençait en rouge a finalement joué jaune) => true/false (par défaut false)

  const swapAtMove    = Number(process.argv[6] ?? '4'); // si colorsSwapped=true, à quel move (1-based) les couleurs ont été permutées ? (ex: 4 => après le 4ème coup)  



  if (!filePath) {

    console.error('Usage : node p4-server/scripts/import_bga_manual.js "<fichier.txt>" ["WinnerName"] [winnerElo]');

    process.exit(1);

  }



  // Lecture séquence

  const seqStr = await readSeqStrFromTxt(filePath);

  const seqArr = seqStr.split('').map(Number);



  // Paramètres Mission 3 : 9x9 par défaut

  const H = 9, L = 9;

  const starts_with = 'rouge';              // tu peux décider selon la partie si tu as l’info

  const move_count = seqArr.length;



  // Canonique séquence (anti-doublon séquence miroir)

  const { canonical_seq, was_mirrored } = canonicalizeSeq(seqStr, L);

  const canonical_hash = sha256Hex(canonical_seq);



  // Position finale (anti-doublon situation)

  const board = buildEmptyBoard(H, L);

  let token = (starts_with === 'rouge') ? 'R' : 'Y';

  for (const c1 of seqArr) {

    const col0 = c1 - 1;

    drop(board, col0, token);

    token = (token === 'R') ? 'Y' : 'R';

  }

  const final_pos_hash = canonicalBoardHash(board);

  const nb_cols = countPlayableColumns(board);



  // Confiance basée sur ELO gagnant

  const confiance = confianceFromElo(winnerElo);

  const source = 'bga';



  // INSERT (mêmes colonnes que /import-file + champs gagnant)

  // Si tu n'as pas encore les colonnes winner_name/winner_elo en base, commente-les

  const q = `

    INSERT INTO games (

      height, width, starts_with,

      seq_str, seq, move_count, status, result,

      canonical_seq, canonical_hash, was_mirrored,

      final_pos_hash,

      nb_cols, source, confiance, winner_name, winner_elo,
      colors_swapped, swap_at_move

    )

    VALUES ($1,$2,$3,$4,$5,$6,'in_progress','unknown',

            $7,$8,$9,

            $10,

            $11,$12,$13,$14,$15,
            $16, $17)

    ON CONFLICT (final_pos_hash) DO NOTHING

    RETURNING id

  `;

  const vals = [

    H, L, starts_with,

    seqStr, seqArr, move_count,

    canonical_seq, canonical_hash, was_mirrored,

    final_pos_hash,

    nb_cols, source, confiance, winnerName, (Number.isFinite(winnerElo) ? winnerElo : null),
    colorsSwapped, (Number.isFinite(swapAtMove) ? swapAtMove : null)
    

  ];



  try {

    const r = await pool.query(q, vals);

    if (r.rowCount === 0) {

      console.log('Partie BGA ignorée : doublon de situation finale (final_pos_hash).');

    } else {

      console.log(`Partie BGA importée : id=${r.rows[0].id}, confiance=${confiance}, winner=${winnerName ?? 'n/a'}(${winnerElo || 'n/a'})`);

    }

  } catch (e) {

    console.error('Erreur INSERT :', e);

    process.exit(1);

  } finally {

    process.exit(0);

  }

}



main().catch(e => { console.error(e); process.exit(1); });