// p4-server/server.js



// A) Imports

import express from 'express';

import cors from 'cors';

import multer from 'multer';



import { pool } from './lib/db.js';

import { parseSeqStr, validateSeq, canonicalizeSeq, sha256Hex } from './lib/seq.js';



// IMPORTANT : on importe le routeur AVANT mais on NE L'UTILISE PAS AVANT la création de app

import aiRouter from './routes/ai.js';



// B) Création app + middlewares

const app = express();

app.use(cors());

app.use(express.json());

const upload = multer({ dest: 'uploads/' });



// C) Health-check

app.get('/health', async (_req, res) => {

  try {

    await pool.query('SELECT 1');

    res.json({ ok: true });

  } catch (e) {

    res.status(500).json({ ok: false, error: String(e) });

  }

});



// D) Helpers plateau (inchangés)

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

    for (let r = H - 1; r >= 0; r--) {

      s += board[r][c];

    }

  }

  return s;

}



function canonicalBoardHash(board, sha256Hex) {

  const a = serializeBoard(board);

  const b = serializeBoard(mirrorBoard(board));

  const canon = (b < a) ? b : a;

  return sha256Hex(canon);

}



function countPlayableColumns(board) {

  const L = board[0].length;

  let cnt = 0;

  for (let c = 0; c < L; c++) {

    if (board[0][c] === '.') cnt++;

  }

  return cnt;

}



// E) Import-file

app.post('/import-file', upload.single('file'), async (req, res) => {

  try {

    if (!req.file || !req.file.originalname) {

      return res.status(400).json({ error: 'Aucun fichier reçu' });

    }



    const originalName = req.file.originalname;

    const seqStr = originalName.replace(/\.txt$/i, '').trim();



    const L = Number(req.body.width) || 9;

    const H = Number(req.body.height) || 9;

    const starts_with = req.body.starts_with === "jaune" ? "jaune" : "rouge";



    const source = req.body.source ?? null;

    const confiance = req.body.confiance != null ? Number(req.body.confiance) : null;



    const seqArr = parseSeqStr(seqStr);

    if (!validateSeq(seqArr, L)) {

      return res.status(400).json({ error: 'Séquence invalide' });

    }



    const { canonical_seq, was_mirrored } = canonicalizeSeq(seqStr, L);

    const canonical_hash = sha256Hex(canonical_seq);

    const move_count = seqArr.length;



    const board = buildEmptyBoard(H, L);

    let token = starts_with === 'rouge' ? 'R' : 'Y';



    for (const c1 of seqArr) {

      const col0 = c1 - 1;

      drop(board, col0, token);

      token = token === 'R' ? 'Y' : 'R';

    }



    const final_pos_hash = canonicalBoardHash(board, sha256Hex);

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



    const r = await pool.query(q, vals);



    if (r.rowCount === 0) {

      return res.json({ message: "Partie déjà présente (doublon situation)", final_pos_hash });

    }



    return res.json({ message: "Partie ajoutée", id: r.rows[0].id });



  } catch (e) {

    console.error("Erreur /import-file :", e);

    res.status(500).json({ error: 'Erreur serveur' });

  }

});



// F) Liste des parties

app.get('/games', async (req, res) => {

  try {

    const r = await pool.query(`

      SELECT id, created_at, height, width, starts_with, move_count, status, result,

             seq_str, canonical_seq, was_mirrored

      FROM games

      ORDER BY id DESC

    `);

    res.json(r.rows);

  } catch (e) {

    res.status(500).json({ error: String(e) });

  }

});



// G) Partie

app.get('/games/:id', async (req, res) => {

  try {

    const id = Number(req.params.id);

    const r = await pool.query('SELECT * FROM games WHERE id = $1', [id]);

    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    res.json(r.rows[0]);

  } catch (e) {

    res.status(500).json({ error: String(e) });

  }

});



// H) Symétrie

app.get('/games/:id/mirror', async (req, res) => {

  try {

    const id = Number(req.params.id);

    const r = await pool.query('SELECT width, seq_str FROM games WHERE id = $1', [id]);

    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });



    const { width, seq_str } = r.rows[0];

    const arr = seq_str.split('').map(Number);

    const mirrored = arr.map(c => width + 1 - c).join('');



    res.json({ seq_str, mirrored });

  } catch (e) {

    res.status(500).json({ error: String(e) });

  }

});



// I) MONTER LE ROUTEUR IA DB ICI (très important)

app.use(aiRouter);



// J) Lancer serveur
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));