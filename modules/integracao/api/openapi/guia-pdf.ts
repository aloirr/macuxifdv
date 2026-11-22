/**
 * Guia da API em PDF (`docs/guia-api-hub.pdf`): monta o HTML do guia a partir do OpenAPI gerado dos contratos (`gerar.ts`) e dos
 * textos de `guia-pdf-textos.ts`. Puro e determinístico (sem data nem rede): o PDF é impresso por `gravar-pdf.ts`.
 * Tipos, campos, limites, exemplos e status vêm do OpenAPI; as explicações em português vêm dos textos.
 * Marca: `docs/marca/manual.md` (Azul noite, Pérola; fonte do sistema, pesos 400 a 700, nada abaixo de 12 px = 9 pt).
 */
import { createHash } from 'node:crypto';
import { ENTIDADES, EXTERNAL_ID_MAX, LIMITE_ERROS_RESPOSTA_MAX, LIMITE_ERROS_RESPOSTA_PADRAO, LIMITE_PEDIDOS_POLL_MAX, LIMITE_PEDIDOS_POLL_PADRAO, type Entidade } from '../../contracts';
import { PARAMETROS_PADRAO } from '../../domain';
import { DEPENDENCIAS } from '../../domain/ordem';
import { gerarOpenApiHub, type DocumentoOpenApi } from './gerar';
import { ACAO_STATUS, CODIGOS_LINHA, DESCRICAO_CAMPO, ENTIDADE_TEXTO, QUANDO_STATUS, RESUMO_ROTA, SEQUENCIA_PRIMEIRA_CARGA, SUCESSO_ROTA, TEXTO_ENUM, TEXTO_ROTA, TITULO_ROTA, UMA_DAS_ENTIDADES } from './guia-pdf-textos';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RecursosGuia {
  /** Logo negativo (fundo Azul noite) como data URI. */
  logo: string;
}

export interface SecaoGuia {
  id: string;
  numero: string;
  titulo: string;
  /** Título do grupo, impresso acima do título da seção (e listado no sumário na mesma página). */
  grupo?: { id: string; numero: string; titulo: string };
  /** Começa em página nova (cada endpoint, a primeira seção e o Anexo); as demais seguem o texto. */
  quebra?: boolean;
  html: string;
}

export interface LinhaCampo {
  campo: string;
  tipo: string;
  obrigatorio: string;
  descricao: string;
  regra: string;
}

// ------------------------------------------------------------------------------------------------ texto

const esc = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** `código` e **negrito** em texto simples. */
export const md = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const p = (s: string) => `<p>${md(s)}</p>`;
const ul = (itens: readonly string[]) => `<ul>${itens.map((i) => `<li>${md(i)}</li>`).join('')}</ul>`;
const ol = (itens: readonly string[]) => `<ol>${itens.map((i) => `<li>${md(i)}</li>`).join('')}</ol>`;
const aviso = (s: string) => `<div class="aviso">${md(s)}</div>`;
/** Linha de bloco de código acima de 95 caracteres: quebra nos espaços, com recuo de mais 2 (só na exibição; o texto no PDF é o mesmo). */
export const LARGURA_BLOCO = 95;
export function quebrarLinha(linha: string): string[] {
  if (linha.length <= LARGURA_BLOCO) return [linha];
  const recuo = ' '.repeat((/^ */.exec(linha)?.[0].length ?? 0) + 2);
  const saida: string[] = [];
  let atual = '';
  for (const palavra of linha.trimEnd().split(/(?<= )/)) {
    if (atual.length + palavra.length > LARGURA_BLOCO && atual.trim() !== '') {
      saida.push(atual.trimEnd());
      atual = recuo;
    }
    atual += palavra;
  }
  saida.push(atual);
  return saida;
}
/** `<pre>`: blocos curtos (até 30 linhas) não se partem entre páginas. */
const pre = (s: string) => {
  const linhas = s.split('\n').flatMap(quebrarLinha);
  return `<pre${linhas.length <= 30 ? ' class="curto"' : ''}>${esc(linhas.join('\n'))}</pre>`;
};
/** Chaves do Conector Macuxi (pacote de atualização) ficam fora do guia da API direta. */
const CHAVES_DO_CONECTOR = new Set(['pacote', 'atualizacao']);
const json = (v: unknown) => pre(JSON.stringify(v, (k, x) => (CHAVES_DO_CONECTOR.has(k) ? undefined : x), 2));
const tabela = (cabecalho: readonly string[], linhas: readonly (readonly string[])[], classe = '') =>
  `<table class="${classe}"><thead><tr>${cabecalho.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas
    .map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
/** Código de erro: só quebra depois de `_` (nunca no meio de uma palavra). */
const cod = (s: string) => `<code>${esc(s).replaceAll('_', '_<wbr>')}</code>`;
const milhar = (n: number) => n.toLocaleString('pt-BR', { useGrouping: true, minimumGroupingDigits: 1 } as Intl.NumberFormatOptions);
/** Permite quebrar um código só depois de `_`, `.` ou `]` (nunca no meio de uma palavra). */
const comQuebras = (html: string) => html.replace(/<code>([^<]*)<\/code>/g, (_m, c: string) => `<code>${c.replaceAll('_', '_<wbr>')}</code>`);

// ------------------------------------------------------------------------------------------------ campos (OpenAPI -> tabela)

const PADRAO_DATA = String.raw`^\d{4}-\d{2}-\d{2}$`;
const PADRAO_EAN = String.raw`^\d{8}$|^\d{12,14}$`;
const PADROES: Record<string, string> = {
  [PADRAO_DATA]: 'formato AAAA-MM-DD',
  [PADRAO_EAN]: '8, 12, 13 ou 14 dígitos',
  [String.raw`^\d{14}$`]: '14 dígitos, só números',
  [String.raw`^[A-Z]{1,4}$`]: '1 a 4 letras maiúsculas',
  [String.raw`^[A-Z0-9]{1,6}$`]: '1 a 6 letras maiúsculas ou números',
  [String.raw`^[A-Z]{2}$`]: '2 letras maiúsculas',
  [String.raw`^[0-9a-f]{64}$`]: 'SHA-256 em hexadecimal',
};
const ehSemver = (pt: string) => pt.startsWith('^(0|[1-9]');

class Contexto {
  constructor(readonly doc: DocumentoOpenApi) {}
  resolver(q: Json): { q: Json; nome?: string } {
    if (typeof q['$ref'] === 'string') {
      const nome = (q['$ref'] as string).split('/').pop() as string;
      return { q: this.doc.components.schemas[nome] as Json, nome };
    }
    return { q };
  }
}

function rotuloTipo(q: Json, itemDe?: string): string {
  if (q['const'] !== undefined) return 'texto';
  if (q['enum']) return 'texto';
  if (q['type'] === 'string') {
    if (q['format'] === 'date-time') return 'data-hora UTC';
    if (q['format'] === 'uuid') return 'UUID';
    if (q['format'] === 'uri') return 'texto (URL)';
    if (q['pattern'] === PADRAO_DATA) return 'data';
    return 'texto';
  }
  if (q['type'] === 'integer') return 'inteiro';
  if (q['type'] === 'number') return 'número';
  if (q['type'] === 'boolean') return 'verdadeiro/falso';
  if (q['type'] === 'array') return `lista de ${itemDe ?? 'valores'}`;
  return 'objeto';
}

function regraDe(k: string, q: Json): string {
  const r: string[] = [];
  if (q['const'] !== undefined) r.push(`sempre \`${String(q['const'])}\``);
  if (q['enum']) r.push((q['enum'] as string[]).length === ENTIDADES.length && ENTIDADES.every((e) => (q['enum'] as string[]).includes(e)) ? `${UMA_DAS_ENTIDADES} (Anexo A)` : `um de: ${(q['enum'] as string[]).map((v) => `\`${v}\``).join(' ')}`);
  if (q['format'] === 'date-time') r.push('UTC, termina em `Z`');
  if (typeof q['pattern'] === 'string' && q['format'] !== 'date-time') {
    const pt = q['pattern'] as string;
    r.push(PADROES[pt] ?? (ehSemver(pt) ? 'versão X.Y.Z' : `formato \`${pt}\``));
  }
  if (typeof q['maxLength'] === 'number') r.push(`até ${milhar(q['maxLength'])} caracteres`);
  if (typeof q['minimum'] === 'number' && typeof q['maximum'] === 'number') r.push(`de ${milhar(q['minimum'])} a ${milhar(q['maximum'])}`);
  else if (typeof q['minimum'] === 'number' && q['minimum'] !== 0) r.push(`mínimo ${milhar(q['minimum'])}`);
  else if (typeof q['maximum'] === 'number') r.push(`máximo ${milhar(q['maximum'])}`);
  else if (q['minimum'] === 0 && q['type'] === 'integer') r.push('não negativo');
  if (typeof q['maxItems'] === 'number') r.push(`até ${milhar(q['maxItems'])} itens`);
  if (typeof q['minItems'] === 'number' && q['minItems'] > 0) r.push(`ao menos ${milhar(q['minItems'])}`);
  if (q['default'] !== undefined && !Array.isArray(q['default'])) r.push(`padrão \`${String(q['default'])}\``);
  if (k.endsWith('_cents')) r.push('em centavos');
  return r.join('; ');
}

interface Folha {
  q: Json;
  nome?: string;
  anulavel: boolean;
  filhos?: { props: Record<string, Json>; requeridos: Set<string>; nome?: string; prefixo: string };
  lista: boolean;
  /** Item da lista (nome do schema ou `objetos`). */
  itemDe?: string;
  registros?: boolean;
}

/** Une as variantes de um `oneOf` de objetos (frete, transportadora do pedido) em um só conjunto de propriedades. */
function unirVariantes(ctx: Contexto, variantes: Json[]): { props: Record<string, Json>; requeridos: Set<string> } {
  const props: Record<string, Json> = {};
  const contagem = new Map<string, number>();
  const consts = new Map<string, string[]>();
  for (const v of variantes) {
    const alvo = ctx.resolver(v).q;
    for (const [k, q] of Object.entries((alvo['properties'] ?? {}) as Record<string, Json>)) {
      contagem.set(k, (contagem.get(k) ?? 0) + 1);
      if (q['const'] !== undefined) consts.set(k, [...(consts.get(k) ?? []), String(q['const'])]);
      props[k] ??= q;
    }
  }
  for (const [k, vals] of consts) props[k] = { type: 'string', enum: vals };
  const requeridos = new Set<string>();
  for (const [k, n] of contagem) if (n === variantes.length && variantes.every((v) => ((ctx.resolver(v).q['required'] ?? []) as string[]).includes(k))) requeridos.add(k);
  return { props, requeridos };
}

function analisar(ctx: Contexto, bruto: Json, k: string, prefixoPai: string): Folha {
  let q = bruto;
  let anulavel = false;
  let nome: string | undefined;
  if (Array.isArray(q['anyOf'])) {
    const nao = (q['anyOf'] as Json[]).filter((x) => x['type'] !== 'null');
    anulavel = nao.length < (q['anyOf'] as Json[]).length;
    if (nao.length > 3 && nao.every((x) => typeof x['$ref'] === 'string')) return { q, anulavel, lista: false, registros: true };
    if (nao.length === 1) {
      const resto = Object.fromEntries(Object.entries(q).filter(([c]) => c !== 'anyOf'));
      q = { ...(nao[0] as Json), ...resto };
    }
  }
  if (typeof q['$ref'] === 'string') {
    const r = ctx.resolver(q);
    nome = r.nome;
    const descricao = q['description'];
    q = { ...r.q, ...(descricao ? { description: descricao } : {}) };
  }
  if (Array.isArray(q['oneOf'])) {
    const u = unirVariantes(ctx, q['oneOf'] as Json[]);
    return { q: { type: 'object' }, nome, anulavel, lista: false, filhos: { ...u, nome, prefixo: `${prefixoPai}${k}.` } };
  }
  if (q['type'] === 'array') {
    const variantes = ((q['items'] as Json)['anyOf'] ?? []) as Json[];
    if (variantes.length > 3 && variantes.every((x) => typeof x['$ref'] === 'string')) return { q, anulavel, lista: true, registros: true };
    const itens = ctx.resolver(q['items'] as Json);
    if (itens.q['properties']) {
      return {
        q,
        anulavel,
        lista: true,
        itemDe: 'objetos',
        filhos: { props: itens.q['properties'] as Record<string, Json>, requeridos: new Set((itens.q['required'] ?? []) as string[]), nome: itens.nome ?? nome, prefixo: `${prefixoPai}${k}[].` },
      };
    }
    return { q, anulavel, lista: true, itemDe: rotuloTipo(itens.q) === 'texto' ? 'textos' : rotuloTipo(itens.q) === 'inteiro' ? 'inteiros' : 'valores' };
  }
  if (q['type'] === 'object' && q['properties']) {
    return { q, nome, anulavel, lista: false, filhos: { props: q['properties'] as Record<string, Json>, requeridos: new Set((q['required'] ?? []) as string[]), nome, prefixo: `${prefixoPai}${k}.` } };
  }
  return { q, nome, anulavel, lista: false };
}

/** Campos que ficaram sem explicação (o teste exige lista vazia). */
export const CAMPOS_SEM_TEXTO = new Set<string>();

export function achatarCampos(ctx: Contexto, schemaNome: string, schema: Json, prefixo = '', requeridosForcados?: Set<string>, profundidade = 0): LinhaCampo[] {
  const props = (schema['properties'] ?? {}) as Record<string, Json>;
  const requeridos = requeridosForcados ?? new Set((schema['required'] ?? []) as string[]);
  const linhas: LinhaCampo[] = [];
  for (const [k, bruto] of Object.entries(props)) {
    if (CHAVES_DO_CONECTOR.has(k)) continue;
    const f = analisar(ctx, bruto, k, prefixo);
    const chaveEsp = `${schemaNome}.${k}`;
    const descricao = DESCRICAO_CAMPO[chaveEsp] ?? DESCRICAO_CAMPO[k] ?? (typeof bruto['description'] === 'string' ? bruto['description'] : (f.q['description'] as string | undefined)) ?? '';
    if (!descricao) CAMPOS_SEM_TEXTO.add(chaveEsp);
    const obrigatorio = requeridos.has(k) ? 'sim' : 'não';
    if (f.registros) {
      linhas.push({ campo: prefixo + k, tipo: 'lista de objetos', obrigatorio, descricao, regra: `até ${milhar(PARAMETROS_PADRAO.limiteRegistrosLote)} itens; campos por entidade no Anexo A` });
      continue;
    }
    const tipo = f.lista ? `lista de ${f.itemDe ?? 'valores'}` : rotuloTipo(f.q);
    let regra = regraDe(k, f.q);
    if (k === 'entidade' && !regra && f.q['type'] === 'string') regra = `${UMA_DAS_ENTIDADES} (Anexo A)`;
    if (f.lista && !f.filhos) {
      const itens = (bruto['anyOf'] ? ((bruto['anyOf'] as Json[]).find((x) => x['type'] === 'array') as Json) : bruto)['items'] as Json;
      const r = itens ? regraDe(k, ctx.resolver(itens).q) : '';
      if (r) regra = [regra, `cada item: ${r}`].filter(Boolean).join('; ');
    }
    if (f.anulavel && obrigatorio === 'sim') regra = [regra, 'aceita `null`'].filter(Boolean).join('; ');
    linhas.push({ campo: prefixo + k, tipo, obrigatorio, descricao, regra });
    if (f.filhos && profundidade < 4) {
      linhas.push(...achatarCampos(ctx, f.filhos.nome ?? schemaNome, { properties: f.filhos.props }, f.filhos.prefixo, f.filhos.requeridos, profundidade + 1));
    }
  }
  return linhas;
}

/** O que a coluna Regra já diz não se repete na Descrição (uma informação, um lugar). */
export function descricaoSemRegra(descricao: string, regra: string): string {
  let d = descricao;
  if (regra.includes('em centavos')) d = d.replace(/,? em centavos/g, '');
  if (regra.includes('AAAA-MM-DD')) d = d.replace(/\s*\(`?AAAA-MM-DD`?\)/g, '');
  if (/até \d+ itens/.test(regra)) d = d.replace(/\s*\(até \d+\)/g, '');
  if (regra.includes('14 dígitos')) d = d.replace(/,? \(?14 dígitos\)?/g, '');
  if (regra.includes('8, 12, 13 ou 14 dígitos')) d = d.replace(/\s*\(8, 12, 13 ou 14 dígitos\)/g, '');
  return d;
}

const tabelaCampos = (linhas: readonly LinhaCampo[]) =>
  tabela(
    ['Campo', 'Tipo', 'Obrig.', 'Descrição', 'Regra'],
    linhas.map((l) => [`<code>${esc(l.campo).replace(/([.\]])/g, '$1<wbr>')}</code>`, esc(l.tipo), esc(l.obrigatorio), comQuebras(md(descricaoSemRegra(l.descricao, l.regra))), comQuebras(md(l.regra))]),
    'campos',
  );

const tabelaEnum = (nomeEnum: string) => {
  const t = TEXTO_ENUM[nomeEnum];
  if (!t) return '';
  return tabela(['Valor', 'Significado'], Object.entries(t).map(([v, s]) => [cod(v), md(s)]), 'compacta');
};

// ------------------------------------------------------------------------------------------------ rotas

const BASE = '/integracao/v1';
/** Falhas de autenticação por minuto e IP antes do `429` (o mesmo valor da API do Hub). */
const FALHAS_AUTENTICACAO_POR_MIN = 20;
const STATUS_COMUNS = new Set(['401', '403', '426', '429', '500', '503']);

function resolverRef(doc: DocumentoOpenApi, o: Json): Json {
  const ref = o['$ref'];
  if (typeof ref !== 'string') return o;
  const [, , grupo, nome] = ref.split('/') as [string, string, keyof DocumentoOpenApi['components'], string];
  return (doc.components[grupo] as Record<string, Json>)[nome] as Json;
}

function curlDaRota(metodo: string, caminho: string, exemplos: { idem: boolean }): string {
  const url = `"$HUB${caminho.replace('{id}', '$LOTE').replace('{pedido_uuid}', '$PEDIDO').replace('{entidade}', 'produto')}"`;
  if (metodo === 'get') return `curl -sS ${url} "\${H_AUTH[@]}"`;
  return [...(exemplos.idem ? ["CHAVE_IDEM=$(sha256sum corpo.json | cut -d' ' -f1)"] : []), `curl -sS -X POST ${url} "\${H_AUTH[@]}" \\`, '  -H "Content-Type: application/json" \\', ...(exemplos.idem ? ['  -H "Idempotency-Key: $CHAVE_IDEM" \\'] : []), '  --data-binary @corpo.json'].join('\n');
}

function secaoRota(ctx: Contexto, caminho: string, metodo: string, op: Json, indice: number): SecaoGuia {
  const id = op['operationId'] as string;
  const t = TEXTO_ROTA[id];
  if (!t) throw new Error(`guia-pdf: falta texto da rota ${id}`);
  const doc = ctx.doc;
  const partes: string[] = [];
  if (indice === 0) partes.push(p(`Em todas as rotas: cabeçalhos de autenticação (Seção 2) e falhas comuns ${[...STATUS_COMUNS].slice(0, -1).join(', ')} e ${[...STATUS_COMUNS].at(-1)} (Seção 7).`));
  partes.push(`<div class="rota"><span class="metodo ${metodo}">${metodo.toUpperCase()}</span><code>${esc(BASE + caminho)}</code></div>`);
  partes.push(`<p><strong>Para que serve.</strong> ${md(t.serve)}</p>`);
  partes.push(`<p><strong>Quando chamar.</strong> ${md(t.quando)}</p>`);
  partes.push('<h3>Passo a passo</h3>', ol(t.passos));
  partes.push('<h3>Exemplo com curl</h3>', pre(curlDaRota(metodo, caminho, { idem: id === 'enviar_lote' })));

  // cabeçalhos e parâmetros
  const params = ((op['parameters'] ?? []) as Json[]).map((x) => resolverRef(doc, x));
  const linhasParam: string[][] = [];
  for (const prm of params) {
    if (['X-Macuxi-Conector-Id', 'X-Macuxi-Conector-Versao'].includes(String(prm['name']))) continue;
    const ex = prm['example'] !== undefined ? ` Exemplo: \`${String(prm['example'])}\`.` : '';
    const descricao = String(prm['name']).toLowerCase() === 'idempotency-key' ? 'Chave do lote. Regra e formato: Seção 5.' : String(prm['description'] ?? '') + ex;
    linhasParam.push([cod(String(prm['name'])), { header: 'cabeçalho', path: 'caminho', query: 'query' }[String(prm['in'])] ?? String(prm['in']), prm['required'] ? 'sim' : 'não', md(descricao)]);
  }
  if (linhasParam.length) partes.push('<h3>Parâmetros desta rota</h3>', tabela(['Nome', 'Onde', 'Obrig.', 'Descrição'], linhasParam, 'param'));

  // entrada
  const corpo = (op['requestBody'] as Json | undefined)?.['content']?.['application/json'] as Json | undefined;
  if (corpo) {
    const schemaNome = String((corpo['schema'] as Json)['$ref']).split('/').pop() as string;
    const exs = corpo['examples'] as Record<string, { summary: string; value: unknown }>;
    partes.push('<h3>Corpo da requisição</h3>');
    const chaves = [t.exemploEntrada as string, ...(t.exemplosExtraEntrada ?? [])];
    chaves.forEach((c, i) => {
      const e = exs[c];
      if (!e) throw new Error(`guia-pdf: exemplo de entrada ${id}:${c} não existe`);
      partes.push(`<p class="legenda">${i === 0 ? 'Exemplo' : 'Outro exemplo'}: ${md(e.summary)}</p>`, json(e.value));
    });
    partes.push(tabelaCampos(achatarCampos(ctx, schemaNome, doc.components.schemas[schemaNome] as Json)));
    if (id === 'retorno_pedido') partes.push(p('Valores de `status` aceitos no retorno:'), tabelaEnum('StatusRetornoRecebido'));
  }

  // sucesso
  const [stSucesso, resp] = Object.entries(op['responses'] as Record<string, Json>).find(([s]) => s.startsWith('2')) as [string, Json];
  const conteudo = resp['content']['application/json'] as Json;
  const schemaSaida = String((conteudo['schema'] as Json)['$ref']).split('/').pop() as string;
  const exsSaida = conteudo['examples'] as Record<string, { summary: string; value: unknown }>;
  partes.push(`<h3>Resposta de sucesso ${stSucesso}</h3>`, p(SUCESSO_ROTA[id] ?? String(resp['description'])));
  [t.exemploSaida, ...(t.exemplosExtraSaida ?? [])].forEach((c, i) => {
    const e = exsSaida[c];
    if (!e) throw new Error(`guia-pdf: exemplo de saída ${id}:${c} não existe`);
    partes.push(`<p class="legenda">${i === 0 ? 'Exemplo' : 'Outro exemplo'}: ${md(e.summary)}</p>`, json(e.value));
  });
  partes.push(tabelaCampos(achatarCampos(ctx, schemaSaida, doc.components.schemas[schemaSaida] as Json)));
  if (id === 'consultar_lote') partes.push(p('Valores de `status`:'), tabelaEnum('EstadoLote'));

  // status próprios da rota (o que é comum a várias rotas está na Seção 7)
  const especificos: string[][] = [];
  for (const [st, r0] of Object.entries(op['responses'] as Record<string, Json>)) {
    if (st.startsWith('2') || STATUS_COMUNS.has(st)) continue;
    const r = resolverRef(doc, r0);
    const comuns = new Set((ACAO_STATUS.find((a) => a.status === st)?.codigos ?? '').split(', '));
    const proprios = Object.keys(((r['content'] ?? {}) as Json)['application/json']?.['examples'] ?? {}).filter((c) => !comuns.has(c));
    if (!proprios.length) continue;
    // a descrição pode abrir com a lista dos códigos ("Retorno recusado: `a` ou `b`. ..."): a lista vai para a coluna Códigos
    let quando = String(r['description']).replace(/^`[a-z_]+`: /, '');
    const lista = /^(.*?):\s*((?:`[a-z_]+`(?:,\s*| ou )?)+)\.\s*(.*)$/.exec(quando);
    if (lista) {
      for (const c of (lista[2] as string).matchAll(/`([a-z_]+)`/g)) if (!proprios.includes(c[1] as string) && !comuns.has(c[1] as string)) proprios.push(c[1] as string);
      quando = `${lista[1]}. ${lista[3]}`;
    }
    especificos.push([`<strong>${st}</strong>`, proprios.map(cod).join(' '), md(QUANDO_STATUS[`${id}:${st}`] ?? quando)]);
  }
  if (especificos.length) partes.push('<h3>Outros status desta rota</h3>', tabela(['HTTP', 'Códigos', 'Quando'], especificos, 'compacta status'));

  if (t.notas?.length) partes.push('<h3>Observações</h3>', ul(t.notas));

  const num = `8.${indice + 1}`;
  return {
    id: `rota-${id}`,
    numero: num,
    titulo: TITULO_ROTA[id] ?? id,
    ...(indice === 0 ? { grupo: { id: 'endpoints', numero: '8', titulo: 'Referência dos endpoints' } } : {}),
    quebra: true,
    html: partes.join('\n'),
  };
}

// ------------------------------------------------------------------------------------------------ entidades (Anexo A)

/** Campos que toda entidade leva: ficam numa tabela só, no início do Anexo A. */
const CAMPOS_COMUNS = ['external_id', 'alterado_em', 'ativo'];

function schemaDaEntidade(ctx: Contexto, entidade: Entidade): { nome: string; schema: Json } {
  const env = ctx.doc.components.schemas['LoteEnvelope'] as Json;
  const porEntidade = env['x-macuxi-registro-por-entidade'] as Record<string, { $ref: string }>;
  const nome = (porEntidade[entidade] as { $ref: string }).$ref.split('/').pop() as string;
  return { nome, schema: ctx.doc.components.schemas[nome] as Json };
}

function secaoCamposComuns(ctx: Contexto): SecaoGuia {
  const { nome, schema } = schemaDaEntidade(ctx, ENTIDADES[0] as Entidade);
  const linhas = achatarCampos(ctx, nome, schema).filter((l) => CAMPOS_COMUNS.includes(l.campo));
  for (const e of ENTIDADES) {
    const props = Object.keys(schemaDaEntidade(ctx, e).schema['properties'] ?? {});
    for (const c of CAMPOS_COMUNS) if (!props.includes(c)) throw new Error(`guia-pdf: ${e} não tem o campo comum ${c}`);
  }
  return {
    id: 'entidade-comuns',
    numero: 'A.1',
    titulo: 'Campos de toda entidade',
    grupo: { id: 'anexo-a', numero: 'Anexo A', titulo: 'Registros por entidade' },
    quebra: true,
    html: [p('Todo registro de `registros`, de qualquer entidade, leva estes campos. As tabelas das entidades (A.2 em diante) trazem só os campos próprios.'), tabelaCampos(linhas)].join('\n'),
  };
}

function secaoEntidade(ctx: Contexto, entidade: Entidade, indice: number): SecaoGuia {
  const doc = ctx.doc;
  const { nome: schemaNome, schema } = schemaDaEntidade(ctx, entidade);
  const tx = ENTIDADE_TEXTO[entidade];
  const deps = DEPENDENCIAS[entidade];
  const exemplo = (doc.paths['/lotes']?.['post'] as Json)['requestBody'].content['application/json'].examples[entidade].value.registros[0];
  const partes = [
    p(tx.sobre),
    p(`**Valor de \`entidade\`:** \`${entidade}\`. **Carregue depois de:** ${deps.length ? deps.map((d) => `\`${d}\``).join(', ') : 'nada (pode ir primeiro)'}.`),
    ...(tx.nota ? [p(tx.nota)] : []),
    '<p class="legenda">Exemplo de registro</p>',
    json(exemplo),
    tabelaCampos(achatarCampos(ctx, schemaNome, schema).filter((l) => !CAMPOS_COMUNS.includes(l.campo))),
  ];
  return {
    id: `entidade-${entidade}`,
    numero: `A.${indice + 2}`,
    titulo: tx.titulo,
    html: partes.join('\n'),
  };
}

// ------------------------------------------------------------------------------------------------ texto corrido

function secoesTexto(ctx: Contexto): SecaoGuia[] {
  const doc = ctx.doc;
  const pp = PARAMETROS_PADRAO;
  const rotas: { id: string; metodo: string; caminho: string }[] = [];
  for (const [caminho, ops] of Object.entries(doc.paths)) for (const [metodo, op] of Object.entries(ops)) rotas.push({ id: (op as Json)['operationId'], metodo, caminho });
  const servidor = ((doc.servers[0] as Json)['url'] as string).replace('{servidor}', '<servidor>');
  const exLote = (doc.paths['/lotes']?.['post'] as Json)['requestBody'].content['application/json'].examples as Record<string, { value: unknown }>;
  const sequencia = SEQUENCIA_PRIMEIRA_CARGA.map((g) => g.map((e) => `\`${e}\``).join(', '));
  const exemploErro = (((doc.paths['/lotes']?.['post'] as Json)['responses']['422'] as Json)['content']['application/json'].examples as Record<string, { value: unknown }>)['sessao_ausente']?.value;

  const secaoDe = (id: string) => `Seção 8.${rotas.findIndex((r) => r.id === id) + 1}`;
  const GRUPOS_ROTAS: readonly { titulo: string; ids: readonly string[] }[] = [
    { titulo: 'Do ERP para o Macuxi', ids: ['enviar_lote', 'consultar_lote', 'consultar_cursor'] },
    { titulo: 'Do Macuxi para o ERP', ids: ['pedidos_pendentes', 'retorno_pedido'] },
    { titulo: 'Conferência e sinal de vida', ids: ['enviar_reconciliacao', 'sinal'] },
  ];
  const linhasRotas = GRUPOS_ROTAS.flatMap((g) => [
    `<tr class="grupo-rotas"><td colspan="3">${esc(g.titulo)}</td></tr>`,
    ...g.ids.map((id) => {
      const i = rotas.findIndex((r) => r.id === id);
      const r = rotas[i] as { id: string; metodo: string; caminho: string };
      return `<tr><td><span class="metodo ${r.metodo}">${r.metodo.toUpperCase()}</span> ${cod(r.caminho)}</td><td>${md(RESUMO_ROTA[r.id] ?? '')}</td><td>8.${i + 1}</td></tr>`;
    }),
  ]);

  const visao = [
    p('Esta API recebe os dados do seu ERP (clientes, produtos, preços, estoque, títulos e notas) e entrega os pedidos aprovados no Macuxi para o ERP gravar.'),
    '<h3>As 7 rotas</h3>',
    `<table class="compacta rotas"><thead><tr><th>Rota</th><th>Para que serve</th><th>Seção</th></tr></thead><tbody>${linhasRotas.join('')}</tbody></table>`,
    '<h3>Antes de começar</h3>',
    ul([
      `Endereço base: \`${servidor}\`. Em produção, o servidor é \`api.macuxifdv.com.br\`.`,
      'Só HTTPS. Corpo em JSON UTF-8.',
      'Especificação OpenAPI 3.1 para gerar clientes e coleções: `openapi.json`.',
    ]),
  ].join('\n');

  const passo = [
    '<h3>Passo 1. Obter a credencial</h3>',
    p('O administrador da empresa abre o portal de configuração (`config.macuxifdv.com.br`), na aba **Integração**, lado **Integração via API**, e escolhe **Gerar credencial**: informa um identificador (por exemplo `erp-matriz`) e o nome, e marca **Envia os pedidos aprovados ao ERP** se esta credencial vai buscar os pedidos. A chave aparece **uma única vez**: guarde-a em um cofre de segredos.'),
    p(`Se perder a chave, o administrador gira a chave no BKO. A anterior continua valendo por uma janela de convivência (padrão ${pp.convivenciaChaveMin / 60} horas, até ${pp.convivenciaChaveMaxMin / 1440} dias) para você trocar sem parar a integração.`),
    '<h3>Passo 2. Autenticar</h3>',
    p('Toda chamada leva estes cabeçalhos:'),
    tabela(
      ['Cabeçalho', 'Valor'],
      [
        [cod('Authorization'), md('`Bearer <chave de API>` (formato `mxc_` e 43 caracteres)')],
        [cod('X-Macuxi-Conector-Id'), md('identificador cadastrado com a credencial')],
        [cod('X-Macuxi-Conector-Versao'), md('opcional: versão do seu software (`1.2.1`). Abaixo da mínima da empresa, as rotas de dados respondem `426`.')],
        [cod('Content-Type'), md('`application/json` nos `POST`')],
      ],
      'compacta',
    ),
    p(`A empresa vem da chave: nunca envie \`tenant_id\`. Os exemplos \`curl\` do guia usam estas variáveis; para testar a credencial, rode o curl da ${secaoDe('consultar_cursor')}: \`200\` confirma a chave. Falhas: Seção 7.`),
    pre(`export HUB="https://api.macuxifdv.com.br${BASE}"\nexport MACUXI_CHAVE="<chave de API>"\nexport MACUXI_CONECTOR="erp-matriz"\nH_AUTH=(-H "Authorization: Bearer $MACUXI_CHAVE" -H "X-Macuxi-Conector-Id: $MACUXI_CONECTOR")`),
    '<h3>Passo 3. Respeitar a ordem de carga</h3>',
    p('Um registro que cita outro (um cliente cita o vendedor) só entra se o alvo já existir; senão a linha vira `referencia_ausente`. Na primeira carga, envie nesta ordem (cada grupo depende dos anteriores; dentro do grupo, qualquer ordem):'),
    ol(sequencia),
    p('As dependências de cada entidade estão no Anexo A. Envie só as entidades que o administrador marcou para o seu Conector: outra entidade recebe `422 entidade_de_outro_conector`.'),
    '<h3>Passo 4. Fazer o primeiro envio</h3>',
    ol([
      `Consulte o cursor da entidade (${secaoDe('consultar_cursor')}); a regra do cursor está na Seção 4.`,
      `Envie o lote com \`POST /lotes\`. Exemplo e curl: ${secaoDe('enviar_lote')}.`,
      `Acompanhe o resultado com \`GET /lotes/{id}\` e leia \`erros[]\` (${secaoDe('consultar_lote')}).`,
    ]),
    '<h3>Passo 5. Buscar os pedidos</h3>',
    p(`Chame \`GET /pedidos/pendentes\` e grave cada pedido no ERP pelo \`pedido_uuid\` (${secaoDe('pedidos_pendentes')}).`),
    '<h3>Passo 6. Devolver o status</h3>',
    p(`Envie \`POST /pedidos/{pedido_uuid}/retorno\` com o resultado do ERP: integrado, faturado ou rejeitado (${secaoDe('retorno_pedido')}).`),
  ].join('\n');

  const convencoes = [
    ul([
      '**Dinheiro** em centavos inteiros (campos `_cents`): R$ 7,90 é `790`.',
      '**Data-hora** em UTC com `Z` (`2026-11-05T13:45:10Z`). Deslocamento como `-03:00` é recusado.',
      '**Data civil** no formato `AAAA-MM-DD`.',
      '**`external_id`**: a chave do registro no seu ERP, (limite na Seção 6). Toda linha leva `external_id` e `alterado_em`.',
      '**`ativo: false`** inativa o registro no Macuxi; nada é apagado.',
      '**Campos desconhecidos** são ignorados. Campo novo opcional é compatível com `v1`; qualquer outra mudança vira `/v2`.',
      '**`X-Request-Id`**: toda resposta traz esse cabeçalho; os erros trazem o mesmo valor em `requisicao_id`. Informe-o ao suporte.',
    ]),
  ].join('\n');

  const delta = [
    p('**Delta** (`modo: "delta"`): só o que mudou desde o último envio. Não leva `sessao`.'),
    p(`**Completo** (\`modo: "completo"\`): a foto inteira da entidade, em partes de uma mesma sessão. Exige \`sessao: { id, parte, ultimo }\`: \`id\` é um UUID que você gera e repete em todas as partes; \`parte\` vai de 1 em diante; \`ultimo: true\` na última parte fecha a sessão, que tem ${pp.ttlSessaoMin / 60} horas para fechar. Cada parte respeita o limite de registros da Seção 6.`),
    json((exLote['carga_completa_parte_1'] as { value: { sessao: unknown } }).value.sessao),
    '<h3>Cursor</h3>',
    p('O Macuxi guarda, por Conector e entidade, o maior par (`alterado_em`, `external_id`) já aceito. Consulte antes de enviar delta (`GET /cursores/{entidade}`):'),
    ul([
      '**Cursor nulo**: faça a carga inicial completa.',
      '**Com cursor**: envie tudo o que tem `alterado_em` maior que o do cursor (ou igual e `external_id` maior, em ordem de bytes, não por idioma).',
      'O cursor só avança quando o lote termina (`concluido` ou `concluido_com_erros`).',
    ]),
    '<h3>Trava de inativação</h3>',
    p(`Ao fechar uma carga completa, os registros ativos que **não vieram** seriam inativados. Se isso atingir mais de ${pp.limiteInativacaoPct}% dos ativos, o Macuxi não inativa: o resultado traz \`inativacao.situacao = "aguardando_confirmacao"\` e um administrador decide no BKO em até ${pp.ttlConfirmacaoInativacaoDias} dias.`),
    '<h3>Esperando as dependências</h3>',
    p(`Um lote espera até ${pp.esperaMaxDependenciaMin} minutos por lotes ainda em aberto das entidades de que depende. Passado o prazo, é aplicado e as linhas sem alvo viram \`referencia_ausente\`; quando o lote da dependência termina, essas linhas são reprocessadas sozinhas.`),
  ].join('\n');

  const idem = [
    p('**Por lote.** `Idempotency-Key` é obrigatória em `POST /lotes`: 16 a 128 caracteres entre letras, números, `.`, `-`, `_` e `:`. Recomendado: SHA-256 hexadecimal do conteúdo.'),
    tabela(
      ['Situação', 'Resposta'],
      [
        ['Chave nova', '`202`; o lote é criado'],
        ['Mesma chave e **mesmo conteúdo**', '`202` com o **mesmo** `lote_id`, `repetido: true` e o cabeçalho `Idempotent-Replay: true`; nada é reprocessado'],
        ['Mesma chave e **conteúdo diferente**', '`409 chave_idempotencia_reutilizada`'],
      ].map((l) => [md(l[0] as string), md(l[1] as string)]),
      'compacta',
    ),
    p('Se a resposta se perder (queda, tempo esgotado), reenvie o mesmo lote com a mesma chave. O conteúdo que conta é versão, entidade, modo, sessão, `registros` e linhas inválidas; `enviado_em`, `cursor`, `conector_id` e `versao_conector` ficam de fora.'),
    p('**Por registro.** O Macuxi compara cada linha com o último registro aceito por `external_id` e `alterado_em`:'),
    ul([
      '`alterado_em` **menor** que o atual: a linha é `obsoleta`; nada muda e não é erro.',
      'Conteúdo idêntico: `inalterada`. Conteúdo diferente: `atualizada` (ou `nova`, se o `external_id` não existia). Em empate de `alterado_em` com conteúdo diferente, vale a última a chegar.',
      'O mesmo `external_id` duas vezes no lote: vale a última (as anteriores geram o aviso `duplicado_no_lote`).',
    ]),
    aviso('`alterado_em` precisa ser crescente: nunca envie de propósito uma versão mais antiga esperando sobrescrever.'),
    p('**Retorno de pedido.** O mesmo retorno enviado de novo devolve `200` com `repetido: true`. **Gravação no ERP:** use o `pedido_uuid` como chave para nunca gravar o mesmo pedido duas vezes.'),
  ].join('\n');

  const limites = [
    tabela(
      ['Limite', 'Valor'],
      [
        ['Registros por lote', `${milhar(pp.limiteRegistrosLote)} (\`422 acima_do_limite\`). Na carga completa, divida em partes`],
        ['Corpo de `POST /lotes`', `${pp.limiteCorpoLoteBytes / 2 ** 20} MiB (\`413 corpo_grande\`). Recomendado: até cerca de 4 MiB`],
        ['Corpo das demais rotas', `${pp.limiteCorpoGeralBytes / 2 ** 20} MiB`],
        ['Linhas inválidas detalhadas por lote', `${pp.limiteLinhasInvalidas}; o excedente só entra em \`linhas_invalidas_omitidas\``],
        ['`external_id`', `1 a ${EXTERNAL_ID_MAX} caracteres`],
        ['Taxa de `POST /lotes`', `balde de ${pp.taxaPorConector.lote.capacidade} chamadas, repõe ${pp.taxaPorConector.lote.reposicaoPorMin} por minuto, por Conector`],
        ['Taxa das demais rotas', `balde de ${pp.taxaPorConector.geral.capacidade}, repõe ${pp.taxaPorConector.geral.reposicaoPorMin} por minuto, por Conector`],
        ['Falhas de autenticação', `mais de ${FALHAS_AUTENTICACAO_POR_MIN} por minuto do mesmo IP levam a \`429\``],
        ['Erros em `GET /lotes/{id}`', `${milhar(LIMITE_ERROS_RESPOSTA_PADRAO)} por padrão, até ${milhar(LIMITE_ERROS_RESPOSTA_MAX)}, com \`?limite_erros=\``],
        ['Pedidos por `GET /pedidos/pendentes`', `${LIMITE_PEDIDOS_POLL_PADRAO} por padrão, até ${LIMITE_PEDIDOS_POLL_MAX}, com \`?limite=\``],
        ['Pedido sem retorno', `volta à fila após ${pp.timeoutEnvioMin} minutos`],
      ].map((l) => [md(l[0] as string), md(l[1] as string)]),
      'compacta',
    ),
    p('Ao receber `429` ou `503`, espere os segundos do cabeçalho `Retry-After` e repita, com espera crescente se persistir.'),
  ].join('\n');

  const erros = [
    p('Todo erro tem o corpo `{ "codigo", "mensagem", "detalhes"?, "requisicao_id" }`. As recusas de lote e de retorno acrescentam `erros[]` (`codigo`, `campo`, `mensagem`).'),
    json(exemploErro),
    '<h3>O que fazer por status HTTP</h3>',
    tabela(['HTTP', 'Códigos', 'O que fazer'], ACAO_STATUS.map((a) => [`<strong>${a.status}</strong>`, a.codigos.startsWith('Em cada') ? esc(a.codigos) : a.codigos.split(', ').map(cod).join(' '), md(a.acao)]), 'compacta status'),
    '<h3>Erros por linha</h3>',
    p('Um lote aceito (`202`) pode ter linhas com erro. Elas não travam o lote: as válidas são aplicadas e o lote termina `concluido_com_erros`. `GET /lotes/{id}` lista cada erro com `indice`, `external_id`, `codigo`, `campo`, `mensagem` e `reprocessavel`.'),
    tabela(['Código da linha', 'Significado', 'Reprocessável'], CODIGOS_LINHA.map((c) => [cod(c.codigo), md(c.significado), c.reprocessavel ? 'sim' : 'não']), 'compacta linhas'),
    p('`reprocessavel: true`: o Macuxi tenta a linha de novo sozinho. Nas demais, corrija na origem e reenvie o registro com `alterado_em` atualizado.'),
  ].join('\n');

  const textos: SecaoGuia[] = [
    { id: 'visao', numero: '1', titulo: 'Visão geral', quebra: true, html: visao },
    { id: 'passo-a-passo', numero: '2', titulo: 'Primeira integração, passo a passo', html: passo },
    { id: 'convencoes', numero: '3', titulo: 'Convenções', html: convencoes },
    { id: 'delta-cursor', numero: '4', titulo: 'Delta, carga completa e cursor', html: delta },
    { id: 'idempotencia', numero: '5', titulo: 'Idempotência', html: idem },
    { id: 'limites', numero: '6', titulo: 'Limites', html: limites },
    { id: 'erros', numero: '7', titulo: 'Erros e códigos', html: erros },
  ];
  return textos;
}

// ------------------------------------------------------------------------------------------------ montagem

export function secoesDoGuia(doc: DocumentoOpenApi): SecaoGuia[] {
  const ctx = new Contexto(doc);
  const rotas: { metodo: string; caminho: string; op: Json }[] = [];
  for (const [caminho, ops] of Object.entries(doc.paths)) for (const [metodo, op] of Object.entries(ops)) rotas.push({ metodo, caminho, op: op as Json });
  const secoes = [...secoesTexto(ctx), ...rotas.map((r, i) => secaoRota(ctx, r.caminho, r.metodo, r.op, i)), secaoCamposComuns(ctx), ...ENTIDADES.map((e, i) => secaoEntidade(ctx, e, i))];
  return secoes;
}

const CSS = String.raw`
@page { size: A4; margin: 20mm 16mm 20mm 16mm; @bottom-left { content: "Macuxi FDV · Guia da API de Integração · v1"; font: 400 9pt Arial, 'Liberation Sans', sans-serif; color: #4A5562; } @bottom-right { content: counter(page); font: 600 9pt system-ui, 'Segoe UI', Roboto, Arial, sans-serif; color: #1E3350; } }
@page capa { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
:root { --texto: Arial, 'Liberation Sans', sans-serif; --mono: ui-monospace, 'Cascadia Mono', 'Roboto Mono', monospace; }
* { box-sizing: border-box; }
html { color: #16202A; font: 400 9.4pt/1.45 var(--texto); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; }
h1, h2, h3 { font-family: var(--texto); color: #1E3350; margin: 0; }
h2 { font-weight: 700; font-size: 19pt; padding-bottom: 6px; border-bottom: 2px solid #1E3350; margin-bottom: 12px; }
h2 .num { color: #4A5562; font-weight: 700; margin-right: 8px; }
h3 { font-weight: 700; font-size: 11.5pt; margin: 16px 0 6px; break-after: avoid; }
.grupo { font: 700 9pt var(--texto); letter-spacing: .08em; text-transform: uppercase; color: #4A5562; margin-bottom: 4px; }
p { margin: 0 0 7px; }
ul, ol { margin: 0 0 8px; padding-left: 20px; } li { margin-bottom: 3px; }
code { font: 500 9pt var(--mono); background: #ECEEF1; padding: 0 3px; border-radius: 3px; overflow-wrap: anywhere; }
pre { font: 500 9pt/1.4 var(--mono); background: #F8F6F1; border: 1px solid #C9CED5; border-radius: 4px; padding: 7px 9px; margin: 0 0 9px; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 4; widows: 4; }
pre.curto { break-inside: avoid; }
.legenda { font-size: 9pt; color: #4A5562; margin: 8px 0 3px; break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9pt; }
th { background: #1E3350; color: #fff; text-align: left; font-weight: 600; padding: 4px 6px; }
td { padding: 3px 6px; border-bottom: 1px solid #DFE2E6; vertical-align: top; }
tr { break-inside: avoid; } thead { display: table-header-group; }
table.campos { table-layout: fixed; }
table.campos th:nth-child(1) { width: 30%; } table.campos th:nth-child(2) { width: 13%; } table.campos th:nth-child(3) { width: 7%; } table.campos th:nth-child(4) { width: 28%; } table.campos th:nth-child(5) { width: 22%; }
table.campos code { font-size: 9pt; }
table.compacta code { overflow-wrap: normal; }
table.status { table-layout: fixed; } table.status th:nth-child(1) { width: 8%; } table.status th:nth-child(2) { width: 38%; }
table.linhas { table-layout: fixed; } table.linhas th:nth-child(1) { width: 32%; } table.linhas th:nth-child(3) { width: 16%; }
table.rotas th:nth-child(3), table.rotas td:nth-child(3) { width: 9%; } tr.grupo-rotas td { background: #F8F6F1; font: 700 9pt var(--texto); color: #1E3350; }
table.param td:nth-child(1), table.param td:nth-child(2) { white-space: nowrap; }
.rota { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
.rota code { font-size: 10.5pt; background: #DFE2E6; padding: 3px 8px; }
.metodo { display: inline-block; font: 700 9pt var(--texto); color: #fff; background: #1E3350; border-radius: 3px; padding: 2px 7px; }
.metodo.get { background: #4A5562; }
.aviso { background: #DFE2E6; border-left: 4px solid #1E3350; padding: 6px 10px; margin: 0 0 9px; }
.fluxo { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 10px 0 6px; }
.caixa { flex: 1; text-align: center; background: #F8F6F1; border: 1px solid #C9CED5; border-radius: 6px; padding: 12px 6px; font-weight: 600; }
.caixa.destaque { background: #1E3350; color: #fff; border-color: #1E3350; } .caixa.destaque code { background: transparent; color: #C9CED5; }
.seta { text-align: center; font-size: 9pt; color: #4A5562; width: 150px; }
section.sec { break-before: page; }
.capa { page: capa; height: 296mm; background: #1E3350; color: #fff; padding: 70mm 22mm 0; position: relative; }
.capa img { width: 90mm; display: block; margin-bottom: 36mm; }
.capa h1 { color: #fff; font-weight: 700; font-size: 34pt; line-height: 1.1; }
.capa .sub { font-size: 13pt; color: #C9CED5; margin-top: 8mm; max-width: 140mm; }
.capa .faixa { position: absolute; left: 22mm; bottom: 22mm; font-size: 10pt; color: #C9CED5; border-top: 3px solid #C9CED5; padding-top: 5mm; width: 120mm; }
.toc { break-before: page; }
.toc a { color: inherit; text-decoration: none; }
.toc .l { display: flex; align-items: baseline; gap: 6px; padding: 1.6px 0; }
.toc .l .t { flex: 0 1 auto; } .toc .l .pt { flex: 1; border-bottom: 1px dotted #C9CED5; transform: translateY(-3px); } .toc .l .pg { font-weight: 600; color: #1E3350; }
.toc .g { font: 700 9.6pt var(--texto); color: #1E3350; margin-top: 7px; } .toc .f { padding-left: 16px; font-size: 9pt; }
`;

export interface OpcoesMontagem {
  /** Página inicial de cada id do sumário; sem ela, os números ficam em branco (base do teste de deriva). */
  paginas?: Record<string, number>;
}

const titulo2 = (s: SecaoGuia) => `<h2 id="${s.id}"><span class="num">${esc(s.numero)}</span>${esc(s.titulo)}</h2>`;

export function montarHtml(secoes: readonly SecaoGuia[], recursos: RecursosGuia, opcoes: OpcoesMontagem = {}): string {
  const pg = (id: string) => (opcoes.paginas?.[id] !== undefined ? String(opcoes.paginas[id]) : '');
  const linhaToc = (id: string, texto: string, classe: string) => `<a href="#${id}" class="l ${classe}"><span class="t">${esc(texto)}</span><span class="pt"></span><span class="pg">${pg(id)}</span></a>`;
  const toc: string[] = [];
  let anexoAberto = false;
  for (const s of secoes) {
    if (s.grupo) {
      toc.push(linhaToc(s.grupo.id, `${s.grupo.numero}${s.grupo.numero === 'Anexo A' ? '. ' : ' '}${s.grupo.titulo}`, 'g'));
      anexoAberto = true;
    }
    toc.push(linhaToc(s.id, `${s.numero} ${s.titulo}`, s.grupo || anexoAberto ? 'f' : ''));
  }
  const capa = `<div class="capa"><img src="${recursos.logo}" alt="Macuxi"/><h1>Guia da API<br/>de Integração</h1><div class="sub">Como enviar os dados do ERP ao Macuxi FDV e devolver os pedidos, rota por rota e campo por campo.</div><div class="faixa">Contrato v1 · ${BASE}</div></div>`;
  const sumario = `<section class="toc"><h2>Sumário</h2>${toc.join('')}</section>`;
  const corpo = secoes
    .map((s) => `<section class="sec" id="s-${s.id}">${s.grupo ? `<div class="grupo" id="${s.grupo.id}">${esc(s.grupo.numero)}${s.grupo.numero === 'Anexo A' ? '. ' : ' '}${esc(s.grupo.titulo)}</div>` : ''}${titulo2(s)}${s.html}</section>`)
    .join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Guia da API de Integração - Macuxi FDV</title><style>${CSS}</style></head><body>${capa}${sumario}${corpo}</body></html>`;
}

export function entradasDoSumario(secoes: readonly SecaoGuia[]): string[] {
  return secoes.flatMap((s) => [...(s.grupo ? [s.grupo.id] : []), s.id]);
}

/** Conteúdo base (sem fontes nem logo) usado no teste de deriva do PDF. */
export const RECURSOS_VAZIOS: RecursosGuia = { logo: '' };

/** Hash do HTML base (sem fontes e sem numeração do sumário): muda quando o OpenAPI ou os textos mudam. */
export function hashDoGuia(): string {
  return createHash('sha256').update(montarHtml(secoesDoGuia(gerarOpenApiHub()), RECURSOS_VAZIOS)).digest('hex');
}
