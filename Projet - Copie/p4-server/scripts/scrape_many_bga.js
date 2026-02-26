// p4-server/scripts/scrape_many_bga.js

// Compatible Node ESM + cheerio V1.0

import fs from "fs";

import path from "path";

import * as cheerio from "cheerio";   // ← FIX IMPORTANT

import fetch from "node-fetch";



// Extraction simple de la séquence

function extractSeq(text) {

  const m = text.match(/(Moves|Coups)\s*:\s*([1-9\s]+)/i);

  if (!m) return null;

  const seq = m[2].replace(/[^1-9]/g, '');

  return seq.length ? seq : null;

}



function extractWinner(text) {

  const m = text.match(/Winner\s*:\s*([A-Za-z0-9_\-]+)/i);

  return m ? m[1] : null;

}



function extractElo(text) {

  const m = text.match(/Elo\s*:\s*(\d{3,4})/i);

  return m ? Number(m[1]) : null;

}



function detectSwap(text) {

  return /swap|échange/i.test(text);

}



async function importToAPI(seqStr, winnerName, winnerElo, swapped) {

  const res = await fetch("http://localhost:3001/bga/import", {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({

      seqStr,

      winnerName,

      winnerElo,

      colors_swapped: swapped,

      swap_at_move: 4

    })

  });

  return res.json();

}



// ============================ MAIN ============================

if (process.argv.length < 3) {

  console.log("Usage: node scrape_many_bga.js <folder>");

  process.exit(1);

}



const folder = process.argv[2];

if (!fs.existsSync(folder)) {

  console.log("❌ Dossier introuvable :", folder);

  process.exit(1);

}



const files = fs.readdirSync(folder).filter(f => f.endsWith(".html"));

console.log(`🎯 ${files.length} fichiers trouvés dans ${folder}`);



for (const file of files) {

  console.log(`\n📄 Lecture : ${file}`);

  const html = fs.readFileSync(path.join(folder, file), "utf-8");



  const $ = cheerio.load(html);           // ← fonctionne maintenant

  const text = $("body").text();



  const seqStr = extractSeq(text);

  const winnerName = extractWinner(text);

  const winnerElo = extractElo(text);

  const swapped = detectSwap(text);



  if (!seqStr) {

    console.log("❌ Aucune séquence trouvée dans", file);

    continue;

  }



  console.log("  ➤ Séquence :", seqStr);

  console.log("  ➤ Gagnant :", winnerName);

  console.log("  ➤ Elo     :", winnerElo);

  console.log("  ➤ Swap    :", swapped);



  const apiRes = await importToAPI(seqStr, winnerName, winnerElo, swapped);

  console.log("  ➤ API :", apiRes.message || apiRes.error);

}



console.log("\n✅ Terminé !");