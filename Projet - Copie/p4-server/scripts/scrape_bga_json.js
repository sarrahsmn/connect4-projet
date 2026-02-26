// p4-server/scripts/scrape_bga_json.js

import fs from "fs";

import path from "path";

import * as cheerio from "cheerio";

import fetch from "node-fetch";



function extractSequenceFromJson(html) {

  // extrait toutes les occurrences de "col": X

  const regex = /"col"\s*:\s*(\d+)/g;

  let seq = [];

  let match;



  while ((match = regex.exec(html)) !== null) {

    // BGA encode les colonnes 0..8 → on convertit en 1..9

    seq.push(Number(match[1]) + 1);

  }



  if (seq.length === 0) return null;

  return seq.join("");

}



async function importToAPI(seqStr) {

  const res = await fetch("http://localhost:3001/bga/import", {

    method: "POST",

    headers: {"Content-Type": "application/json"},

    body: JSON.stringify({

      seqStr,

      winnerName: null,

      winnerElo: null,

      colors_swapped: false,

      swap_at_move: 4

    })

  });

  return res.json();

}



// MAIN

if (process.argv.length < 3) {

  console.log("Usage: node scrape_bga_json.js <folder>");

  process.exit(1);

}



const folder = process.argv[2];

if (!fs.existsSync(folder)) {

  console.log("❌ Dossier introuvable :", folder);

  process.exit(1);

}



const files = fs.readdirSync(folder).filter(f => f.endsWith(".html"));

console.log(`🎯 ${files.length} fichiers trouvés dans ${folder}`);



for (const f of files) {

  console.log(`\n📄 Lecture : ${f}`);

  const html = fs.readFileSync(path.join(folder, f), "utf8");



  const seqStr = extractSequenceFromJson(html);



  if (!seqStr) {

    console.log("❌ Aucune séquence trouvée (pas de \"col\" JSON)");

    continue;

  }



  console.log(`  ➤ Séquence extraite : ${seqStr}`);



  const res = await importToAPI(seqStr);

  console.log("  ➤ API :", res.message || res.error);

}



console.log("\n✅ Terminé !");

