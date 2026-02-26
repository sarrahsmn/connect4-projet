// node p4-server/scripts/scrape_bga_example.js chemin/partie_bga.html "WinnerName" 1720

import fs from 'fs/promises';

import { pool } from '../lib/db.js';

import { canonicalizeSeq, sha256Hex } from '../lib/seq.js';



// ---- Helpers plateau (mêmes conventions que server.js) ----

function buildEmptyBoard(H,L){ return Array.from({length:H},()=>Array(L).fill('.')); }

function drop(b,c,t){ for(let r=b.length-1;r>=0;r--){ if(b[r][c]==='.') { b[r][c]=t; return true; } } return false; }

function mirrorBoard(b){ return b.map(row=>[...row].reverse()); }

function serializeBoard(b){ const H=b.length,L=b[0].length; let s=''; for(let c=0;c<L;c++){ for(let r=H-1;r>=0;r--){ s+=b[r][c]; } } return s; }

function canonicalBoardHash(b){ const a=serializeBoard(b), c=serializeBoard(mirrorBoard(b)); return sha256Hex((c<a)?c:a); }

function countPlayableColumns(b){ let k=0; for(let c=0;c<b[0].length;c++) if(b[0][c]==='.') k++; return k; }



// ---- Mapping Elo -> confiance (échelle prof 0..5) ----

function confianceFromElo(elo){

  if (!Number.isFinite(elo)) return 2;   // pas d'info

  if (elo >= 1800) return 5;

  if (elo >= 1600) return 4;

  if (elo >= 1400) return 3;

  if (elo >= 1200) return 2;

  return 1;

}



// ---- Extraction très simple (A ADAPTER à la page) ----

// Exemple: dans ton HTML, tu te débrouilles pour trouver une ligne "Moves: 5 1 6 9 7 4 8"

function extractSeqFromHtml(html){

  const m = html.match(/Moves:\s*([1-9\s]+)/i);

  if (!m) return null;

  const arr = m[1].trim().split(/\s+/).map(Number);

  if (!arr.every(d => Number.isFinite(d) && d>=1 && d<=9)) return null;

  return arr.join('');

}



async function main(){

  const file        = process.argv[2];

  const winnerName  = process.argv[3] ?? null;        // si tu veux tracer le gagnant

  const winnerElo   = Number(process.argv[4] ?? '0'); // si non fourni -> 0 => confianceFromElo -> 2



  if (!file) { console.error('Usage: node .../scrape_bga_example.js <fichier.html> ["Winner Name"] [eloWinner]'); process.exit(1); }



  const html = await fs.readFile(file, 'utf8');

  const seqStr = extractSeqFromHtml(html);

  if (!seqStr) { console.error('Impossible d’extraire une séquence (adapte extractSeqFromHtml)'); process.exit(1); }



  // Params 9×9 (Mission 3)

  const H=9, L=9, starts_with='rouge';

  const seqArr = seqStr.split('').map(Number);

  const move_count = seqArr.length;



  // Canonique séquence (anti-doublon séquence)

  const { canonical_seq, was_mirrored } = canonicalizeSeq(seqStr, L);

  const canonical_hash = sha256Hex(canonical_seq);



  // Position finale (anti-doublon situation)

  const board = buildEmptyBoard(H,L);

  let token='R';

  for (const c1 of seqArr){ drop(board, c1-1, token); token=(token==='R')?'Y':'R'; }

  const final_pos_hash = canonicalBoardHash(board);

  const nb_cols = countPlayableColumns(board);



  // Confiance d’après Elo gagnant

  const confiance = confianceFromElo(winnerElo);

  const source = 'bga';



  // INSERT

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

            $11,$12,$13,$14,$15, $16,$17)

    ON CONFLICT (final_pos_hash) DO NOTHING

    RETURNING id

  `;

  const vals = [H,L,starts_with, seqStr, seqArr, move_count,

                canonical_seq, canonical_hash, was_mirrored,

                final_pos_hash,

                nb_cols, source, confiance, winnerName, (Number.isFinite(winnerElo)? winnerElo : null),
              colorsSwapped, (Number.isFinite(swapAtMove) ? swapAtMove : null)

];



  const r = await pool.query(q, vals);

  if (r.rowCount===0) console.log('doublon de situation finale — ignoré');

  else console.log('partie BGA importée, id=', r.rows[0].id, 'confiance=', confiance);

}



main().catch(e=>{ console.error(e); process.exit(1); });