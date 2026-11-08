// Funções puras das Actions do repositório de recados (ADR 0035 do aloirr/macuxifdv, T-0139).
// Sem dependências: Node 24 (fetch, Intl). Testes: node --test .github/scripts/recados-lib.test.mjs
//
// O formato do recado é o do scripts/coord.mjs do repositório de código (doc 07, "Protocolo de recados"):
// front matter com id, de, para, cc, tipo, prioridade, tarefa, responde_a, encerra, contrato e criado_em, nessa
// ordem, e depois "# <assunto>", uma linha em branco e o corpo. Destinos e tipos iguais aos da coord-lib.

export const AGENTES = [
  'gerente-projetos', 'engenheiro-software', 'engenheiro-apps', 'designer-ux', 'banco-dados', 'testes',
  'modulo-core', 'modulo-catalogo', 'modulo-vendedor', 'modulo-promotor', 'modulo-gestor', 'modulo-pesquisa',
  'modulo-treinamento', 'modulo-integracao', 'corretor-redundancias',
];
export const DESTINOS = [...AGENTES, 'alexandre', 'todos'];
export const TIPOS = ['pedido', 'pergunta', 'resposta', 'aviso', 'bloqueio', 'entrega', 'revisao'];
export const PRIORIDADES = ['alta', 'normal', 'baixa'];
/** Remetente dos recados do formulário: o dono do produto. */
export const REMETENTE = 'alexandre';

/** Rótulo do campo no formulário (.github/ISSUE_TEMPLATE/recado.yml) → chave do recado. */
export const ROTULOS = {
  'Para': 'para',
  'Cópia (cc)': 'cc',
  'Tipo': 'tipo',
  'Prioridade': 'prioridade',
  'Tarefa': 'tarefa',
  'Responde a': 'responde_a',
  'Encerra o assunto': 'encerra',
  'Texto': 'texto',
};

const SEM_RESPOSTA = /^_?No response_?$/i;

/**
 * Corpo da issue de formulário ("### Rótulo\n\nvalor\n\n### Outro...") → {chave: valor}. Campo vazio = ''.
 * Rótulo que não é do formulário é ignorado. Sem nenhum rótulo conhecido → null (não é issue de recado).
 */
export function lerFormulario(corpo) {
  const texto = String(corpo || '').replace(/\r\n?/g, '\n');
  const partes = texto.split(/^### +/m).slice(1);
  const campos = {};
  for (const parte of partes) {
    const quebra = parte.indexOf('\n');
    const rotulo = (quebra < 0 ? parte : parte.slice(0, quebra)).trim();
    const chave = ROTULOS[rotulo];
    if (!chave) continue;
    const valor = (quebra < 0 ? '' : parte.slice(quebra + 1)).trim();
    campos[chave] = SEM_RESPOSTA.test(valor) ? '' : valor;
  }
  return Object.keys(campos).length ? campos : null;
}

const lista = (v) => String(v || '').split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Valida o formulário e devolve o recado (sem id e sem data) ou os erros, em português, para o comentário na issue.
 * @returns {{erros: string[], recado?: object}}
 */
export function validarFormulario({ titulo, campos }) {
  const erros = [];
  const assunto = String(titulo || '').replace(/^\s*\[recado\]\s*/i, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!assunto) erros.push('o título da issue é o assunto do recado: escreva o assunto no título');
  const para = [...new Set(lista(campos.para))];
  const cc = [...new Set(lista(campos.cc))].filter((c) => !para.includes(c));
  if (!para.length) erros.push('escolha ao menos um destinatário em "Para"');
  for (const d of [...para, ...cc]) if (!DESTINOS.includes(d)) erros.push(`destinatário inválido: ${d}`);
  const tipo = String(campos.tipo || '').trim().toLowerCase();
  if (!TIPOS.includes(tipo)) erros.push(`tipo inválido: "${campos.tipo || ''}" (use ${TIPOS.join(', ')})`);
  const prioridadeInformada = String(campos.prioridade || '').trim().toLowerCase();
  const prioridade = PRIORIDADES.includes(prioridadeInformada) ? prioridadeInformada : 'normal';
  const tarefa = String(campos.tarefa || '').trim().toUpperCase();
  if (tarefa && !/^T-\d{4}$/.test(tarefa)) erros.push(`tarefa inválida: "${campos.tarefa}" (formato T-0000)`);
  const respondeA = String(campos.responde_a || '').trim();
  if (respondeA && !/^R-\d{8}-\d{6}(-\d+)?-[a-z-]+$/.test(respondeA)) erros.push(`"Responde a" inválido: "${respondeA}" (formato R-AAAAMMDD-HHMMSS-remetente)`);
  const encerra = /\[x\]/i.test(String(campos.encerra || ''));
  if (encerra && !respondeA) erros.push('"Encerra o assunto" só vale numa resposta: preencha "Responde a"');
  const corpo = String(campos.texto || '').replace(/\r\n?/g, '\n').trim();
  if (!corpo) erros.push('o texto do recado está vazio');
  if (erros.length) return { erros };
  // Bloqueio vai sempre com cópia ao gerente (mesma regra do coord.mjs enviar).
  if (tipo === 'bloqueio' && !para.includes('gerente-projetos') && !cc.includes('gerente-projetos')) cc.push('gerente-projetos');
  return { erros: [], recado: { assunto, para, cc, tipo, prioridade, tarefa: tarefa || null, responde_a: respondeA || null, encerra, corpo } };
}

/** Data/hora no fuso do time: {iso: '2026-11-08T13:28:42-04:00', compacto: '20261108-132842'} (igual ao coord.mjs). */
export function horaLocal(data, fuso = 'America/Boa_Vista') {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(data).map((p) => [p.type, p.value]));
  const desloc = partes.timeZoneName === 'GMT' ? '+00:00' : partes.timeZoneName.replace('GMT', '');
  const local = `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}`;
  return { iso: `${local}${desloc}`, compacto: local.replace(/[-:]/g, '').replace('T', '-') };
}

/** Id livre: R-<compacto>-alexandre ou R-<compacto>-<n>-alexandre (n a partir de 2), como o coord.mjs. */
export function idLivre(compacto, existentes, de = REMETENTE) {
  let id = `R-${compacto}-${de}`;
  for (let n = 2; existentes.has(id); n++) id = `R-${compacto}-${n}-${de}`;
  return id;
}

/** Texto do arquivo do recado, idêntico ao do coord.mjs enviar. */
export function montarRecado({ id, de = REMETENTE, para, cc = [], tipo, prioridade = 'normal', tarefa = null, responde_a = null, encerra = false, contrato = null, criado_em, assunto, corpo }) {
  return [
    '---',
    `id: ${id}`,
    `de: ${de}`,
    `para: [${para.join(', ')}]`,
    `cc: [${cc.join(', ')}]`,
    `tipo: ${tipo}`,
    `prioridade: ${prioridade}`,
    `tarefa: ${tarefa || 'null'}`,
    `responde_a: ${responde_a || 'null'}`,
    `encerra: ${encerra ? 'true' : 'false'}`,
    `contrato: ${contrato || 'null'}`,
    `criado_em: ${criado_em}`,
    '---',
    `# ${assunto}`,
    '',
    `${corpo.replace(/\n+$/, '')}\n`,
  ].join('\n');
}

/** Caminhos do recado no repositório: um arquivo por destino (para + cc), como o coord.mjs. */
export function caminhosDoRecado(id, para, cc = []) {
  return [...new Set([...para, ...cc])].map((d) => `recados/${d}/${id}.md`);
}

// ───────────────────────── Telegram ─────────────────────────

export const LIMITE_TELEGRAM = 4000; // a API aceita 4096 caracteres por mensagem

/** Cabeçalho e corpo de um recado (front matter simples, como o coord.mjs lê). */
export function lerRecado(texto) {
  const m = String(texto || '').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const mm = linha.match(/^([a-z_]+):\s*(.*?)\s*(#.*)?$/i);
    if (mm) meta[mm[1]] = mm[2];
  }
  const corpo = m[2].replace(/\r\n?/g, '\n');
  const titulo = (corpo.match(/^# +(.+)$/m) || [])[1]?.trim() || meta.id || '(sem título)';
  const resto = corpo.replace(/^# +.+\n?/m, '').trim();
  return { meta, titulo, resto };
}

const cortar = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Aviso de recado novo na caixa do dono do produto: título, remetente, tipo e as primeiras linhas. */
export function montarAviso(texto, { link = '', maxLinhas = 8, maxCaracteres = 900 } = {}) {
  const r = lerRecado(texto);
  if (!r) return null;
  const { meta } = r;
  const cab = [`Recado para você — ${r.titulo}`, `de ${meta.de || '?'} · ${meta.tipo || '?'}${meta.prioridade === 'alta' ? ' · ALTA' : ''}${meta.tarefa && meta.tarefa !== 'null' ? ` · ${meta.tarefa}` : ''}`];
  const linhas = r.resto.split('\n').filter((l) => l.trim()).slice(0, maxLinhas).join('\n');
  const partes = [cab.join('\n'), cortar(linhas, maxCaracteres)];
  if (link) partes.push(link);
  return cortar(partes.filter(Boolean).join('\n\n'), LIMITE_TELEGRAM);
}

/**
 * Novidades do resumo de hora em hora: arquivos ADICIONADOS em recados/todos/ e recados/alexandre/ (função pura,
 * sobre a lista do git diff --diff-filter=A). Um recado com cópia em várias pastas conta uma vez em cada seção.
 */
export function separarNovidades(caminhos) {
  const caixa = [];
  const todos = [];
  for (const c of caminhos) {
    const m = String(c).match(/^recados\/(alexandre|todos)\/(R-[^/]+\.md)$/);
    if (!m) continue;
    (m[1] === 'alexandre' ? caixa : todos).push(c);
  }
  return { caixa: caixa.sort(), todos: todos.sort() };
}

/** Texto do resumo; null quando não há novidade (o workflow não envia nada). */
export function montarResumo({ caixa = [], todos = [], quando = '', link = '', maxPorSecao = 15 }) {
  if (!caixa.length && !todos.length) return null;
  const linha = (r) => `• [${r.meta.tipo || '?'}] ${cortar(r.titulo, 120)} — ${r.meta.de || '?'}`;
  const secao = (nome, itens) => {
    if (!itens.length) return '';
    const mais = itens.length > maxPorSecao ? `\n… e mais ${itens.length - maxPorSecao}` : '';
    return `${nome} (${itens.length}):\n${itens.slice(0, maxPorSecao).map(linha).join('\n')}${mais}`;
  };
  const partes = [`Resumo dos recados${quando ? ` — ${quando}` : ''}`, secao('Na sua caixa', caixa), secao('Para todos', todos), link];
  return cortar(partes.filter(Boolean).join('\n\n'), LIMITE_TELEGRAM);
}

/**
 * Envia uma mensagem de texto puro ao Telegram. O token só vai na URL da API; nada dele aparece em erro ou log.
 * `fetch` injetável (testes). Erro → lança Error com o código HTTP, sem a URL.
 */
export async function enviarTelegram(texto, { token, chatId, fetch: buscar = globalThis.fetch } = {}) {
  if (!token || !chatId) throw new Error('faltam os secrets TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID');
  const resposta = await buscar(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true }),
  });
  if (!resposta.ok) throw new Error(`Telegram respondeu HTTP ${resposta.status}`);
  return true;
}

/** Máscara do GitHub Actions para os secrets (::add-mask::), antes de qualquer saída. */
export function mascarar(valores, escrever = (l) => process.stdout.write(l)) {
  for (const v of valores) if (v) escrever(`::add-mask::${v}\n`);
}
