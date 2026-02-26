// p4-server/routes/ai.js

import express from 'express';

import { pool } from '../lib/db.js';

import { canonicalizeSeq } from '../lib/seq.js';



const router = express.Router();



/**

 * IA "data-driven" basée sur la base:

 * GET /ai/db?seq=...&width=9&height=9&playable=1,1,1,1,1,1,1,1,1

 * - seq   : séquence courante (1..L) dans le repère du FRONT

 * - width : L (par défaut 9)

 * - height: H (par défaut 9) — ici juste informatif

 * - playable : 0/1 pour indiquer si la colonne est jouable (longueur L)

 *

 * Réponse:

 * { ok, used_prefix, was_mirrored, coverage, scores[L], best, best_col_1based, fallback? }

 */

router.get('/ai/db', async (req, res) => {

  try {

    const L = Number(req.query.width ?? 9);

    const seqRaw = String(req.query.seq ?? '').replace(/[^1-9]/g, '');

    const playable = String(req.query.playable ?? '')

      .split(',')

      .map(x => x.trim() === '1');



    // 1) Canonicaliser le préfixe (miroir éventuel)

    const { canonical_seq: prefixCanon, was_mirrored } = canonicalizeSeq(seqRaw, L);

    const len = prefixCanon.length;



    // 2) (Option) filtrage par source/confiance si tu veux privilégier BGA/forts

    //    Ici on prend tout, pondéré par "confiance".

    const sql = `

      SELECT

        CAST(SUBSTRING(canonical_seq FROM $1+1 FOR 1) AS int) AS next_col,

        SUM(GREATEST(COALESCE(confiance,0),0)) AS w_sum,

        COUNT(*) AS n

      FROM games

      WHERE LENGTH(canonical_seq) > $1

        AND LEFT(canonical_seq, $1) = $2

      GROUP BY 1

      ORDER BY w_sum DESC, n DESC

    `;

    const { rows } = await pool.query(sql, [len, prefixCanon]);



    // 3) Scores en repère canonique (taille L)

    const scoreCanon = Array(L).fill(0);

    for (const r of rows) {

      const c1 = Number(r.next_col);

      if (Number.isFinite(c1) && c1 >= 1 && c1 <= L) {

        // pondération simple : somme des confiances

        scoreCanon[c1 - 1] = Number(r.w_sum);

      }

    }



    // 4) Revenir au repère du FRONT si on a mirrorré

    const eps = 1e-6;

    let scores = scoreCanon.map(s => (s > 0 ? s : eps));

    if (was_mirrored) scores = scores.slice().reverse();



    // 5) Choix de la meilleure colonne jouable (si "playable" fourni)

    let bestIdx = null;

    let bestVal = -Infinity;

    for (let c = 0; c < L; c++) {

      if (playable.length === L && playable[c] === false) continue;

      if (scores[c] > bestVal) {

        bestVal = scores[c];

        bestIdx = c;

      }

    }



    // 6) Couverture totale (pour fallback)

    const coverage = rows.reduce((a, r) => a + Number(r.n), 0);

    const fallback = (bestIdx == null) || coverage < 3 ? 'low_coverage' : null;



    return res.json({

      ok: true,

      used_prefix: prefixCanon,

      was_mirrored,

      coverage,

      scores,                              // [L]

      best: bestIdx,                       // 0..L-1 ou null

      best_col_1based: bestIdx != null ? bestIdx + 1 : null,

      fallback

    });

  } catch (e) {

    console.error(e);

    res.status(500).json({ ok: false, error: 'server_error' });

  }

});



export default router;