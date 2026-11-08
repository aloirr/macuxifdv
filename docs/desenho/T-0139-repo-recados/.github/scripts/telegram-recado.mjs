#!/usr/bin/env node
// Mensagem do dono do produto no Telegram → recado R-...-alexandre.md (workflow telegram-recado.yml, ADR 0035 §8).
// Uso:
//   node .github/scripts/telegram-recado.mjs gravar     lê o getUpdates, grava os recados e o estado, prepara as respostas
//   node .github/scripts/telegram-recado.mjs responder  manda as respostas preparadas (só depois do push)
// Ambiente: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (secrets, mascarados antes de qualquer saída), ESTADO (arquivo do
// último update gravado, versionado no repositório; padrão estado/telegram-ultimo-update.txt), RESPOSTAS (JSON das
// respostas, fora do repositório: $RUNNER_TEMP), MENSAGEM (arquivo da mensagem do commit), FUSO.
// O log tem só contagens e ids de recado: nunca o texto das mensagens nem nada de outro chat.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buscarUpdates, planejarMensagens, enviarTelegram, mascarar } from './recados-lib.mjs';
import { idsExistentes } from './issue-recado.mjs';

export const ESTADO_PADRAO = 'estado/telegram-ultimo-update.txt';

/** Último update_id gravado (null: arquivo ausente ou inválido → o getUpdates vem sem offset). */
export function lerUltimo(arquivo) {
  try {
    const n = Number.parseInt(readFileSync(arquivo, 'utf8').trim(), 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Lê as mensagens novas e grava, no clone em `raiz`, os recados e o novo último update (o commit e o push são do
 * workflow, no mesmo commit: recado e estado andam juntos). Arquivo de recado nunca é sobrescrito (flag "wx").
 */
export async function gravar({ raiz = process.cwd(), token, chatId, estado = ESTADO_PADRAO, fuso = 'America/Boa_Vista', fetch } = {}) {
  if (!chatId) throw new Error('falta o secret TELEGRAM_CHAT_ID');
  const arquivoEstado = join(raiz, estado);
  const ultimo = lerUltimo(arquivoEstado);
  const updates = await buscarUpdates({ token, offset: ultimo === null ? null : ultimo + 1, fetch });
  const botId = String(token).split(':')[0] || null;
  const plano = planejarMensagens(updates, { chatId, botId, ultimo, existentes: idsExistentes(raiz), fuso });
  for (const r of plano.recados) {
    for (const c of r.caminhos) {
      mkdirSync(dirname(join(raiz, c)), { recursive: true });
      writeFileSync(join(raiz, c), r.texto, { encoding: 'utf8', flag: 'wx' });
    }
  }
  if (plano.ultimo !== null && plano.ultimo !== ultimo) {
    mkdirSync(dirname(arquivoEstado), { recursive: true });
    writeFileSync(arquivoEstado, `${plano.ultimo}\n`, 'utf8');
  }
  return plano;
}

/** Mensagem do commit: os ids gravados (texto gerado por nós, nunca o da mensagem). */
export function mensagemDoCommit(plano) {
  if (!plano.recados.length) return `recados: telegram, estado até o update ${plano.ultimo}`;
  return `recados: ${plano.recados.map((r) => r.id).join(', ')} pelo Telegram`;
}

/** Manda as respostas preparadas; devolve quantas falharam (o recado já está gravado: falha só fica no log). */
export async function responder(respostas, { token, chatId, fetch } = {}) {
  let falhas = 0;
  for (const r of respostas) {
    try { await enviarTelegram(r.texto, { token, chatId, responderA: r.responderA, fetch }); } catch (e) { falhas++; console.log(`falha no envio: ${e.message}`); }
  }
  return falhas;
}

if (import.meta.main) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  mascarar([token, chatId]);
  const arquivoRespostas = process.env.RESPOSTAS || join(process.env.RUNNER_TEMP || '.', 'respostas-telegram.json');
  const modo = process.argv[2];
  try {
    if (modo === 'gravar') {
      const plano = await gravar({ token, chatId, estado: process.env.ESTADO || ESTADO_PADRAO, fuso: process.env.FUSO || 'America/Boa_Vista' });
      writeFileSync(arquivoRespostas, JSON.stringify(plano.respostas), 'utf8');
      if (process.env.MENSAGEM) writeFileSync(process.env.MENSAGEM, `${mensagemDoCommit(plano)}\n`, 'utf8');
      const ids = plano.recados.map((r) => r.id).join(', ');
      console.log(`${plano.recados.length} recado(s) gravado(s)${ids ? `: ${ids}` : ''}; ${plano.respostas.length} resposta(s) a mandar; ${plano.ignoradas} mensagem(ns) de outros chats ignorada(s)`);
    } else if (modo === 'responder') {
      let respostas = [];
      try { respostas = JSON.parse(readFileSync(arquivoRespostas, 'utf8')); } catch { /* nada a responder */ }
      const falhas = await responder(respostas, { token, chatId });
      console.log(`${respostas.length - falhas} resposta(s) enviada(s), ${falhas} falha(s)`);
      if (falhas) process.exitCode = 1;
    } else {
      console.log('uso: telegram-recado.mjs gravar|responder');
      process.exitCode = 2;
    }
  } catch (e) {
    console.log(`erro: ${e.message}`);
    process.exitCode = 1;
  }
}
