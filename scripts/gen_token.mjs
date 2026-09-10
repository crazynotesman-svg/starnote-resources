/**
 * 生成管理口令 ADMIN_TOKEN
 *   node scripts/gen_token.mjs
 *
 * 字母表去掉 0/1/i/l/o 等易混淆字符，便于人工识别与输入；
 * 20 个字符 ≈ 99 bit 熵，远高于在线暴力破解的实际可行范围。
 * 生成后请自行保管（密码管理器），并配到 Cloudflare 环境变量。
 */

import crypto from 'node:crypto';

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // 31 个字符，无 0/1/i/l/o

function group(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

export function generateToken() {
  return ['sn', group(4), group(4), group(4), group(4)].join('-');
}

// 直接执行时打印
if (process.argv[1] && process.argv[1].endsWith('gen_token.mjs')) {
  const t = generateToken();
  const bits = (20 * Math.log2(ALPHABET.length)).toFixed(0);
  console.log(t);
  console.error(`长度 ${t.length} · 约 ${bits} bit 熵`);
}
