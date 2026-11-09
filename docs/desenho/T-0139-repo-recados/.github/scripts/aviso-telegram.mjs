#!/usr/bin/env node
// Aviso no Telegram dos recados novos na caixa do dono do produto (workflow aviso-telegram.yml, ADR 0035).
// Uso: node .github/scripts/aviso-telegram.mjs
// Ambiente: ANTES e DEPOIS (SHAs do push), REPO_URL, TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (secrets).
// Os secrets são mascarados (::add-mask::) antes de qualquer saída e nunca são impressos.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { montarAviso, enviarTelegram, mascarar } from './recados-lib.mjs';

const MAXIMO = 10;
const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8' });

/** Recados adicionados em recados/alexandre/ entre ANTES e DEPOIS (push que cria o ramo: só o commit DEPOIS). */
export function recadosNovos(antes, depois, rodar = git) {
  const zero = !antes || /^0+$/.test(antes);
  let base = antes;
  if (!zero) { try { rodar('cat-file', '-e', `${antes}^{commit}`); } catch { base = null; } }
  const args = zero || !base
    ? ['diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '--diff-filter=A', depois, '--', 'recados/alexandre/']
    : ['diff', '--name-only', '--diff-filter=A', base, depois, '--', 'recados/alexandre/'];
  return rodar(...args).split('\n').map((s) => s.trim()).filter((s) => /^recados\/alexandre\/R-[^/]+\.md$/.test(s)).sort();
}

/**
 * Mensagens do aviso (função pura). Até `maximo` recados novos: um aviso por recado. Acima disso é carga em lote
 * (migração, recados represados): UMA mensagem com o total e o link da caixa, para não inundar o chat nem bater
 * no limite da API do Telegram (~1 mensagem por segundo no mesmo chat).
 * @param {string[]} novos caminhos recados/alexandre/R-....md
 * @param {(caminho: string) => string} ler conteúdo do arquivo
 */
export function mensagensDoAviso(novos, ler, { repo = '', maximo = MAXIMO } = {}) {
  if (novos.length > maximo) {
    return [`${novos.length} recados novos na sua caixa de uma vez (carga em lote). Veja a lista: ${repo}/tree/main/recados/alexandre`];
  }
  return novos.map((c) => montarAviso(ler(c), { link: repo ? `${repo}/blob/main/${c}` : '' })).filter(Boolean);
}

if (import.meta.main) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  mascarar([token, chatId]);
  const novos = recadosNovos(process.env.ANTES, process.env.DEPOIS || 'HEAD');
  console.log(`${novos.length} recado(s) novo(s) na caixa do dono do produto`);
  const mensagens = mensagensDoAviso(novos, (c) => readFileSync(c, 'utf8'), { repo: process.env.REPO_URL || '' });
  for (const [i, texto] of mensagens.entries()) {
    if (i) await new Promise((ok) => setTimeout(ok, 1100)); // ~1 mensagem por segundo no mesmo chat
    try {
      await enviarTelegram(texto, { token, chatId });
    } catch (e) {
      // A causa vale para as demais (403, 401, secret errado): para no primeiro erro, sem repetir 10 vezes no log.
      console.log(`falha no envio: ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`${mensagens.length} mensagem(ns) enviada(s)`);
}
