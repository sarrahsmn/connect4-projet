import crypto from 'crypto';



export function parseSeqStr(seqStr) {

  return seqStr.trim().split('').map(Number);

}



export function validateSeq(arr, L) {

  return arr.every(n => Number.isFinite(n) && n >= 1 && n <= L);

}



export function mirrorSeq1toL(arr, L) {

  return arr.map(c => (L + 1 - c));

}



export function canonicalizeSeq(seqStr, L) {

  const orig = seqStr.trim();

  const mirror = mirrorSeq1toL(parseSeqStr(orig), L).join('');

  if (mirror < orig) {

    return { canonical_seq: mirror, was_mirrored: true };

  }

  return { canonical_seq: orig, was_mirrored: false };

}



export function sha256Hex(s) {

  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');

}