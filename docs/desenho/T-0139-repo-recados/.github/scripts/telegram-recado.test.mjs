// Testes da resposta pelo Telegram (ADR 0035 §8 do aloirr/macuxifdv, T-0139). node:test, sem dependências.
// Rodar: node --test .github/scripts/telegram-recado.test.mjs
// Dentro do repositório de código (docs/desenho/T-0139-repo-recados/), confere também o recado gerado contra o
// scripts/coord.mjs de verdade (caixa, ler e fio); no repositório de recados esse teste é pulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  montarRecado, montarAviso, alvoDaResposta, remetenteDoId, interpretarMensagem, planejarMensagens, textoConfirmacao,
  buscarUpdates, enviarTelegram, AGENTES,
} from './recados-lib.mjs';
import { gravar, responder, lerUltimo, mensagemDoCommit, ESTADO_PADRAO } from './telegram-recado.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_CODIGO = join(AQUI, '..', '..', '..', '..', '..');
const COORD = join(RAIZ_CODIGO, 'scripts', 'coord.mjs');
const temCoord = existsSync(COORD) && existsSync(join(RAIZ_CODIGO, 'scripts', 'coord-lib.mjs'));

const temporarios = [];
process.on('exit', () => { for (const d of temporarios) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); temporarios.push(d); return d; };

const TOKEN = '777:SEGREDO-DO-BOT';
const BOT = { id: 777, is_bot: true, first_name: 'Macuxi Recados' };
const DONO = { id: 4242, is_bot: false, first_name: 'Alexandre' };
const CHAT = '4242';
const DATA = Date.UTC(2026, 10, 8, 20, 50, 30) / 1000; // 16:50:30 em Boa Vista

/** Aviso que o aviso-telegram manda para um recado do gerente com tarefa. */
const AVISO = montarAviso(montarRecado({
  id: 'R-20261108-165317-gerente-projetos', de: 'gerente-projetos', para: ['alexandre'], tipo: 'pergunta', prioridade: 'alta',
  tarefa: 'T-0139', criado_em: '2026-11-08T16:53:17-04:00', assunto: 'Pode liberar o build?', corpo: 'Linha 1\nVer também R-20261101-010101-testes.',
}), { link: 'https://github.com/aloirr/macuxifdv-recados/blob/main/recados/alexandre/R-20261108-165317-gerente-projetos.md' });

let proximoUpdate = 1000;
function mensagem(texto, { chat = CHAT, de = DONO, resposta = null, data = DATA, extra = {} } = {}) {
  const id = proximoUpdate++;
  const message = { message_id: id + 5000, date: data, chat: { id: Number(chat), type: 'private' }, from: de, ...extra };
  if (texto !== null) message.text = texto;
  if (resposta) message.reply_to_message = { message_id: 1, date: data - 60, chat: { id: Number(chat) }, from: BOT, text: resposta };
  return { update_id: id, message };
}

test('montarAviso traz a linha "id:" e a dica de resposta; alvoDaResposta acha o recado e o remetente', () => {
  assert.match(AVISO, /^Recado para você — Pode liberar o build\?\nde gerente-projetos · pergunta · ALTA · T-0139\nid: R-20261108-165317-gerente-projetos\n\nLinha 1\n/);
  assert.match(AVISO, /\n\nResponda a esta mensagem para devolver a gerente-projetos\.$/);
  assert.deepEqual(alvoDaResposta(AVISO), { id: 'R-20261108-165317-gerente-projetos', para: ['gerente-projetos'], titulo: 'Pode liberar o build?', tarefa: 'T-0139' });
  assert.equal(remetenteDoId('R-20261108-132842-2-modulo-core'), 'modulo-core');
  assert.equal(remetenteDoId('R-1-x'), null);
  // Resumo, ajuda e erro não têm "id:": a resposta vira mensagem solta.
  assert.equal(alvoDaResposta('Resumo dos recados — 2026-11-08 14:07\n\nNa sua caixa (1):\n• [entrega] X — testes'), null);
  // Recado de quem não é agente (ex.: o próprio dono do produto) não tem a quem voltar.
  assert.equal(alvoDaResposta('Recado para você — x\nde alexandre · aviso\nid: R-20261108-165317-alexandre'), null);
  // Responder à confirmação complementa o recado: mesmo destino, responde_a = o recado dele.
  const conf = textoConfirmacao({ id: 'R-20261108-165030-alexandre', para: ['modulo-core', 'testes'], assunto: 'Re: Pode liberar o build?' });
  assert.deepEqual(alvoDaResposta(conf), { id: 'R-20261108-165030-alexandre', para: ['modulo-core', 'testes'], titulo: 'Pode liberar o build?', tarefa: null });
});

test('resposta a um aviso do bot: tipo resposta, responde_a, mesmo destino (o remetente) e a tarefa do aviso', () => {
  const r = interpretarMensagem(mensagem('Pode sim.\nSegunda linha.', { resposta: AVISO }), { chatId: CHAT, botId: '777' });
  assert.equal(r.acao, 'recado');
  assert.deepEqual(r.recado, {
    para: ['gerente-projetos'], tipo: 'resposta', responde_a: 'R-20261108-165317-gerente-projetos', tarefa: 'T-0139',
    assunto: 'Re: Pode liberar o build?', corpo: 'Pode sim.\nSegunda linha.',
  });
  // Resposta a uma mensagem que não é deste bot (outro bot, ou a própria mensagem dele) vira solta.
  const outroBot = mensagem('ok', { resposta: AVISO });
  outroBot.message.reply_to_message.from = { id: 999, is_bot: true };
  assert.equal(interpretarMensagem(outroBot, { chatId: CHAT, botId: '777' }).recado.tipo, 'aviso');
  assert.deepEqual(interpretarMensagem(outroBot, { chatId: CHAT, botId: '777' }).recado.para, ['gerente-projetos']);
});

test('mensagem solta: aviso para o gerente-projetos, assunto pela 1ª linha', () => {
  const r = interpretarMensagem(mensagem('# Ideia para a demo\n\nMostrar o catálogo primeiro.'), { chatId: CHAT, botId: '777' });
  assert.deepEqual(r.recado, { para: ['gerente-projetos'], tipo: 'aviso', responde_a: null, tarefa: null, assunto: 'Ideia para a demo', corpo: '# Ideia para a demo\n\nMostrar o catálogo primeiro.' });
  const longa = interpretarMensagem(mensagem('a'.repeat(300)), { chatId: CHAT });
  assert.ok(longa.recado.assunto.length <= 100);
  assert.equal(longa.recado.corpo.length, 300, 'o corpo leva o texto inteiro');
  // Legenda de foto vale como texto; foto sem legenda, áudio ou figurinha → erro, sem recado.
  assert.equal(interpretarMensagem(mensagem(null, { extra: { caption: 'foto da gôndola', photo: [{}] } }), { chatId: CHAT }).recado.corpo, 'foto da gôndola');
  const audio = interpretarMensagem(mensagem(null, { extra: { voice: {} } }), { chatId: CHAT });
  assert.equal(audio.acao, 'erro');
  assert.match(audio.texto, /^Só mensagem de texto/);
});

test('/para válido: um ou vários agentes (e todos), com @bot no comando; /para com resposta guarda o responde_a', () => {
  const um = interpretarMensagem(mensagem('/para modulo-core Revisar o login\ncom calma'), { chatId: CHAT });
  assert.deepEqual(um.recado.para, ['modulo-core']);
  assert.equal(um.recado.tipo, 'aviso');
  assert.equal(um.recado.corpo, 'Revisar o login\ncom calma');
  assert.equal(um.recado.assunto, 'Revisar o login');
  assert.deepEqual(interpretarMensagem(mensagem('/para@macuxi_recados_bot Testes,MODULO-CORE,testes oi'), { chatId: CHAT }).recado.para, ['testes', 'modulo-core']);
  assert.deepEqual(interpretarMensagem(mensagem('/para todos Reunião às 17h'), { chatId: CHAT }).recado.para, ['todos']);
  const comResposta = interpretarMensagem(mensagem('/para testes confira isto', { resposta: AVISO }), { chatId: CHAT, botId: '777' });
  assert.deepEqual(comResposta.recado.para, ['testes']);
  assert.equal(comResposta.recado.tipo, 'resposta');
  assert.equal(comResposta.recado.responde_a, 'R-20261108-165317-gerente-projetos');
});

test('/para inválido, sem texto ou comando desconhecido: resposta de erro, nenhum recado; /start e /ajuda: ajuda', () => {
  const invalido = interpretarMensagem(mensagem('/para fulano faz isso'), { chatId: CHAT });
  assert.equal(invalido.acao, 'erro');
  assert.match(invalido.texto, /^Agente inválido: fulano\. Nada foi gravado\./);
  assert.match(invalido.texto, /modulo-integracao/);
  assert.match(interpretarMensagem(mensagem('/para alexandre oi'), { chatId: CHAT }).texto, /Agente inválido: alexandre/, 'a caixa dele não é destino');
  assert.match(interpretarMensagem(mensagem('/para testes,ninguem oi'), { chatId: CHAT }).texto, /Agente inválido: ninguem/);
  assert.match(interpretarMensagem(mensagem('/para testes'), { chatId: CHAT }).texto, /^Faltou o texto/);
  assert.match(interpretarMensagem(mensagem('/para'), { chatId: CHAT }).texto, /^Use \/para <agente> <texto>/);
  assert.match(interpretarMensagem(mensagem('/apagar R-1'), { chatId: CHAT }).texto, /^Comando desconhecido: \/apagar/);
  for (const c of ['/start', '/ajuda', '/help@macuxi_recados_bot']) assert.equal(interpretarMensagem(mensagem(c), { chatId: CHAT }).acao, 'ajuda');
});

test('chat de outra pessoa, mensagem de bot, edição e chat id ausente: ignorados, sem recado e sem resposta', () => {
  assert.equal(interpretarMensagem(mensagem('/para testes oi', { chat: '5555', de: { id: 5555, is_bot: false } }), { chatId: CHAT }).acao, 'ignorar');
  assert.equal(interpretarMensagem(mensagem('oi', { de: { id: 1, is_bot: true } }), { chatId: CHAT }).acao, 'ignorar');
  assert.equal(interpretarMensagem({ update_id: 1, edited_message: { text: 'x', chat: { id: 4242 } } }, { chatId: CHAT }).acao, 'ignorar');
  assert.equal(interpretarMensagem(mensagem('oi'), { chatId: '' }).acao, 'ignorar', 'sem o secret ninguém passa');
  const plano = planejarMensagens([mensagem('segredo de outro', { chat: '5555', de: { id: 5555, is_bot: false } })], { chatId: CHAT, ultimo: 10 });
  assert.deepEqual(plano.recados, []);
  assert.deepEqual(plano.respostas, []);
  assert.equal(plano.ignoradas, 1);
  assert.ok(plano.ultimo > 10, 'o estado avança mesmo assim: o lixo de outro chat não ocupa a página do getUpdates');
});

test('planejarMensagens: ids pela hora da mensagem, -n no mesmo segundo, só update_id > último, confirmação por recado', () => {
  const a = mensagem('primeira');
  const b = mensagem('/para testes segunda');
  const c = mensagem('/para fulano x');
  const existentes = new Set(['R-20261108-165030-alexandre']);
  const plano = planejarMensagens([c, b, a], { chatId: CHAT, botId: '777', ultimo: a.update_id - 1, existentes });
  assert.deepEqual(plano.recados.map((r) => r.id), ['R-20261108-165030-2-alexandre', 'R-20261108-165030-3-alexandre']);
  assert.deepEqual(plano.recados[1].caminhos, ['recados/testes/R-20261108-165030-3-alexandre.md']);
  assert.equal(plano.ultimo, c.update_id);
  assert.deepEqual(plano.respostas.map((r) => r.texto.split('\n')[0]), [
    'Recado R-20261108-165030-2-alexandre gravado para gerente-projetos.',
    'Recado R-20261108-165030-3-alexandre gravado para testes.',
    'Agente inválido: fulano. Nada foi gravado.',
  ]);
  assert.equal(plano.respostas[0].responderA, a.message.message_id, 'a confirmação responde à mensagem dele');
  assert.equal(existentes.size, 1, 'o conjunto recebido não é alterado');
  assert.match(plano.recados[0].texto, /^---\nid: R-20261108-165030-2-alexandre\nde: alexandre\npara: \[gerente-projetos\]\ncc: \[\]\ntipo: aviso\nprioridade: normal\ntarefa: null\nresponde_a: null\nencerra: false\ncontrato: null\ncriado_em: 2026-11-08T16:50:30-04:00\n---\n# primeira\n\nprimeira\n\n_Enviado pelo Telegram em 2026-11-08 16:50 \(fuso de Boa Vista\)\._\n$/);
  // O mesmo lote de novo (push que não aconteceu): mesmos ids. Com o último já gravado: nada.
  assert.deepEqual(planejarMensagens([a, b, c], { chatId: CHAT, ultimo: a.update_id - 1, existentes }).recados.map((r) => r.id), plano.recados.map((r) => r.id));
  const depois = planejarMensagens([a, b, c], { chatId: CHAT, ultimo: plano.ultimo, existentes });
  assert.deepEqual(depois, { ultimo: plano.ultimo, recados: [], respostas: [], ignoradas: 0 });
});

/** getUpdates de mentira que se comporta como o Telegram: offset confirma (apaga) o que veio antes. */
function telegramFalso(pendentes) {
  const chamadas = [];
  const fila = [...pendentes];
  const fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadas.push({ url, corpo });
    if (url.endsWith('/getUpdates')) {
      if (corpo.offset !== undefined) while (fila.length && fila[0].update_id < corpo.offset) fila.shift();
      return { ok: true, status: 200, json: async () => ({ ok: true, result: fila.slice(0, corpo.limit) }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { fetch, chamadas, fila };
}

test('gravar: offset idempotente com o estado no repositório; push que falhou relê o lote; nada se perde nem duplica', async () => {
  const raiz = tmp('telegram-recado-');
  const a = mensagem('primeira');
  const b = mensagem('/para modulo-core segunda', { data: DATA + 1 });
  const tg = telegramFalso([a, b]);
  // 1ª execução: sem estado → getUpdates sem offset; grava os 2 recados e o último update.
  const p1 = await gravar({ raiz, token: TOKEN, chatId: CHAT, fetch: tg.fetch });
  assert.equal(tg.chamadas[0].corpo.offset, undefined);
  assert.deepEqual(tg.chamadas[0].corpo.allowed_updates, ['message']);
  assert.deepEqual(p1.recados.map((r) => r.id), ['R-20261108-165030-alexandre', 'R-20261108-165031-alexandre']);
  assert.equal(lerUltimo(join(raiz, ESTADO_PADRAO)), b.update_id);
  assert.ok(existsSync(join(raiz, 'recados', 'modulo-core', 'R-20261108-165031-alexandre.md')));
  assert.equal(mensagemDoCommit(p1), 'recados: R-20261108-165030-alexandre, R-20261108-165031-alexandre pelo Telegram');
  // Push falhou: o workflow volta ao main (sem os arquivos e com o estado antigo) e roda de novo → mesmo plano.
  rmSync(join(raiz, 'recados'), { recursive: true });
  rmSync(join(raiz, 'estado'), { recursive: true });
  const p2 = await gravar({ raiz, token: TOKEN, chatId: CHAT, fetch: tg.fetch });
  assert.deepEqual(p2.recados.map((r) => r.id), p1.recados.map((r) => r.id));
  assert.equal(tg.fila.length, 2, 'nada foi confirmado ao Telegram antes do push');
  // Push deu certo: a próxima execução pede offset = último + 1, o Telegram descarta o lote, nada é gravado de novo.
  const p3 = await gravar({ raiz, token: TOKEN, chatId: CHAT, fetch: tg.fetch });
  assert.equal(tg.chamadas.at(-1).corpo.offset, b.update_id + 1);
  assert.deepEqual(p3.recados, []);
  assert.equal(tg.fila.length, 0);
  assert.equal(readdirSync(join(raiz, 'recados', 'gerente-projetos')).length, 1);
  // Mesmo que o Telegram devolva de novo um update já gravado, ele não duplica (update_id <= último).
  const tg2 = telegramFalso([a, b]);
  assert.deepEqual((await gravar({ raiz, token: TOKEN, chatId: CHAT, fetch: tg2.fetch })).recados, []);
  // Recado nunca é sobrescrito: id já usado (pelo formulário, por exemplo) é pulado com -n.
  const c = mensagem('terceira', { data: DATA + 2 });
  writeFileSync(join(raiz, 'recados', 'gerente-projetos', 'R-20261108-165032-alexandre.md'), 'do formulário\n');
  const p4 = await gravar({ raiz, token: TOKEN, chatId: CHAT, fetch: telegramFalso([c]).fetch });
  assert.equal(p4.recados[0].id, 'R-20261108-165032-2-alexandre', 'o id existente é pulado');
  assert.equal(readFileSync(join(raiz, 'recados', 'gerente-projetos', 'R-20261108-165032-alexandre.md'), 'utf8'), 'do formulário\n');
  assert.equal(lerUltimo(join(raiz, 'nao-existe.txt')), null);
});

test('buscarUpdates e responder: token só na URL, nunca no erro; confirmação encadeada à mensagem dele', async () => {
  const tg = telegramFalso([]);
  await buscarUpdates({ token: TOKEN, offset: 5, fetch: tg.fetch });
  assert.equal(tg.chamadas[0].url, `https://api.telegram.org/bot${TOKEN}/getUpdates`);
  assert.deepEqual(tg.chamadas[0].corpo, { limit: 100, timeout: 0, allowed_updates: ['message'], offset: 5 });
  await assert.rejects(buscarUpdates({ token: TOKEN, fetch: async () => ({ ok: false, status: 409 }) }), (e) => /HTTP 409 .*webhook/.test(e.message) && !e.message.includes('SEGREDO'));
  await assert.rejects(buscarUpdates({ token: TOKEN, fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }) }), /sem resultado/);
  await assert.rejects(buscarUpdates({ token: '' }), /TELEGRAM_BOT_TOKEN/);
  await assert.rejects(gravar({ raiz: tmp('tg-'), token: TOKEN, chatId: '', fetch: tg.fetch }), /TELEGRAM_CHAT_ID/);
  const envio = telegramFalso([]);
  await enviarTelegram('oi', { token: TOKEN, chatId: CHAT, responderA: 77, fetch: envio.fetch });
  assert.deepEqual(envio.chamadas[0].corpo, { chat_id: CHAT, text: 'oi', disable_web_page_preview: true, reply_parameters: { message_id: 77, allow_sending_without_reply: true } });
  let n = 0;
  const metade = async () => (n++ % 2 ? { ok: false, status: 500 } : { ok: true, status: 200 });
  const log = console.log;
  const linhas = [];
  console.log = (l) => linhas.push(l);
  try {
    assert.equal(await responder([{ texto: 'a', responderA: 1 }, { texto: 'b', responderA: 2 }], { token: TOKEN, chatId: CHAT, fetch: metade }), 1);
  } finally { console.log = log; }
  assert.ok(linhas.every((l) => !l.includes('SEGREDO')));
});

test('o recado do Telegram aparece na caixa, no ler e no fio do coord.mjs de verdade', { skip: temCoord ? false : 'fora do repositório de código' }, async () => {
  const raiz = tmp('telegram-coord-');
  mkdirSync(join(raiz, 'scripts'));
  copyFileSync(COORD, join(raiz, 'scripts', 'coord.mjs'));
  copyFileSync(join(RAIZ_CODIGO, 'scripts', 'coord-lib.mjs'), join(raiz, 'scripts', 'coord-lib.mjs'));
  mkdirSync(join(raiz, '.coord', 'recados', 'alexandre'), { recursive: true });
  writeFileSync(join(raiz, '.coord', 'donos.json'), JSON.stringify({ versao: 1, regras: [{ padrao: '**', dono: 'gerente-projetos' }] }));
  const original = montarRecado({ id: 'R-20261108-165317-gerente-projetos', de: 'gerente-projetos', para: ['alexandre'], tipo: 'pergunta', tarefa: 'T-0139', criado_em: '2026-11-08T16:53:17-04:00', assunto: 'Pode liberar o build?', corpo: 'Pergunta.' });
  writeFileSync(join(raiz, '.coord', 'recados', 'alexandre', 'R-20261108-165317-gerente-projetos.md'), original);
  const tg = telegramFalso([mensagem('Pode sim.', { resposta: montarAviso(original) })]);
  const plano = await gravar({ raiz: join(raiz, '.coord'), token: TOKEN, chatId: CHAT, estado: 'estado.txt', fetch: tg.fetch });
  assert.equal(plano.recados.length, 1);
  const rodar = (...a) => spawnSync(process.execPath, [join(raiz, 'scripts', 'coord.mjs'), ...a], { cwd: raiz, encoding: 'utf8' });
  const caixa = rodar('caixa', 'gerente-projetos');
  assert.equal(caixa.status, 0, caixa.stderr);
  assert.match(caixa.stdout, /R-20261108-165030-alexandre\s+\[resposta\] de alexandre/);
  assert.match(caixa.stdout, /Re: Pode liberar o build\?/);
  const fio = rodar('fio', 'R-20261108-165317-gerente-projetos'); // o fio parte do recado original
  assert.equal(fio.status, 0, fio.stderr);
  assert.match(fio.stdout, /gerente-projetos → alexandre {2}\[pergunta\]\n {2}Pode liberar o build\?/);
  assert.match(fio.stdout, /alexandre → gerente-projetos {2}\[resposta\]\n {2}Re: Pode liberar o build\?/);
});

test('a lista de agentes do /para é a da coord-lib (sem alexandre)', { skip: temCoord ? false : 'fora do repositório de código' }, async () => {
  const { pathToFileURL } = await import('node:url');
  const lib = await import(pathToFileURL(join(RAIZ_CODIGO, 'scripts', 'coord-lib.mjs')).href);
  assert.deepEqual([...AGENTES].sort(), [...lib.AGENTES].sort());
});
