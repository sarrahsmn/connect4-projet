// p4-server/scripts/seed_random.js

// Exécuter: node p4-server/scripts/seed_random.js [N=100] [mode=random|center] [confiance=0.3]



import { pool } from '../lib/db.js';

import { canonicalizeSeq, sha256Hex } from '../lib/seq.js';



// ---------- Helpers simples (mêmes conventions que server.js) ----------



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

    for (let r = H - 1; r >= 0; r--) s += board[r][c];

  }

  return s;

}



function canonicalBoardHash(board) {

  const a = serializeBoard(board);

  const b = serializeBoard(mirrorBoard(board));

  const canon = (b < a) ? b : a;

  return sha256Hex(canon);

}



function playableCols(board) {

  const L = board[0].length, res = [];

  for (let c = 0; c < L; c++) if (board[0][c] === '.') res.push(c);

  return res;

}



function countPlayableColumns(board) {

  let k = 0;

  for (let c = 0; c < board[0].length; c++) if (board[0][c] === '.') k++;

  return k;

}



// ---------- Générateurs de séquences 9×9 ----------



function genRandomSeq(H = 9, L = 9, maxMoves = 42) {

  const board = buildEmptyBoard(H, L);

  let token = 'R';

  const seq = [];



  for (let i = 0; i < maxMoves; i++) {

    const cols = playableCols(board);

    if (cols.length === 0) break;

    // aléatoire pur

    const c = cols[Math.floor(Math.random() * cols.length)];

    drop(board, c, token);

    seq.push(c + 1);          // on stocke 1..L

    token = (token === 'R') ? 'Y' : 'R';

  }

  return { seqStr: seq.join(''), H, L, board };

}



function genCenterBiasedSeq(H = 9, L = 9, maxMoves = 42) {

  const board = buildEmptyBoard(H, L);

  let token = 'R';

  const seq = [];

  const center = (L - 1) / 2;



  function pickBiased(cols) {

    // pondère par la proximité du centre : poids = 1 / (1 + |c-center|)

    const weights = cols.map(c => 1 / (1 + Math.abs(c - center)));

    const sum = weights.reduce((a, b) => a + b, 0);

    let r = Math.random() * sum;

    for (let i = 0; i < cols.length; i++) {

      if ((r -= weights[i]) <= 0) return cols[i];

    }

    return cols[cols.length - 1];

  }



  for (let i = 0; i < maxMoves; i++) {

    const cols = playableCols(board);

    if (cols.length === 0) break;

    const c = pickBiased(cols);

    drop(board, c, token);

    seq.push(c + 1);

    token = (token === 'R') ? 'Y' : 'R';

  }

  return { seqStr: seq.join(''), H, L, board };

}



// ---------- Insertion DB (mêmes colonnes que server.js) ----------



async function insertOne({ seqStr, H, L, board }, { source, confiance }) {

  const starts_with = 'rouge';                // on peut alterner plus tard si besoin

  const seqArr = seqStr.split('').map(Number);

  const move_count = seqArr.length;



  const { canonical_seq, was_mirrored } = canonicalizeSeq(seqStr, L);

  const canonical_hash = sha256Hex(canonical_seq);



  const final_pos_hash = canonicalBoardHash(board);

  const nb_cols = countPlayableColumns(board);



  const q = `

    INSERT INTO games (

      height, width, starts_with,

      seq_str, seq, move_count, status, result,

      canonical_seq, canonical_hash, was_mirrored,

      final_pos_hash,

      nb_cols, source, confiance

    )

    VALUES ($1,$2,$3,$4,$5,$6,'in_progress','unknown',

            $7,$8,$9,

            $10,

            $11,$12,$13)

    ON CONFLICT (final_pos_hash) DO NOTHING

    RETURNING id

  `;

  const vals = [

    H, L, starts_with,

    seqStr, seqArr, move_count,

    canonical_seq, canonical_hash, was_mirrored,

    final_pos_hash,

    nb_cols, source, confiance

  ];



  try {

    const r = await pool.query(q, vals);

    if (r.rowCount === 0) {

      // doublon de situation finale → ignoré silencieusement

      return null;

    }

    return r.rows[0].id;

  } catch (e) {

    console.error('Erreur insert:', e);

    return null;

  }

}



// ---------- Main ----------



async function main() {

  const N = Number(process.argv[2] ?? '100');

  const mode = String(process.argv[3] ?? 'random');   // 'random' | 'center'

// barème entier conforme consigne: 0=exprès perdre, 1=aléatoire, 2=heuristique, 3=minimax_d3, 4=minimax_d5, 5=expert
  const confiance = Number(process.argv[4] ?? (mode === 'center' ? 1 : 1)); // aléatoire = 1

  const source = 'seed_random';



  console.log(`Seed: N=${N}, mode=${mode}, confiance=${confiance}`);



  let added = 0, dup = 0;

  for (let i = 0; i < N; i++) {

    const gen = (mode === 'center') ? genCenterBiasedSeq : genRandomSeq;

    const sample = gen(9, 9, 42);       // 9×9 pour la M3

    const id = await insertOne(sample, { source, confiance });

    if (id) { added++; if (added % 10 === 0) console.log(`+ ${added} insérées`); }

    else     { dup++; }

  }

  console.log(`Terminé. Ajoutées=${added}, doublons=${dup}`);

  process.exit(0);

}



main().catch(e => { console.error(e); process.exit(1); });