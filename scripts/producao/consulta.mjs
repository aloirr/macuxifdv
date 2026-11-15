#!/usr/bin/env node
/**
 * Consulta SÓ LEITURA no banco de PRODUÇÃO (autorizada pelo dono do produto, R-20261115-073000-alexandre, item 5).
 * Usada pelo workflow `.github/workflows/producao-consulta.yml`. Sem dependência: só node:fs e node:path.
 *
 * Regras (todas conferidas aqui e nos testes de scripts/ci/producao-consulta.test.mjs):
 *   - nunca SQL livre: o disparo escolhe o NOME de uma consulta do catálogo versionado (scripts/producao/consultas/*.sql,
 *     revisado por PR) e passa só parâmetros simples validados (tenant por código; external_id);
 *   - cada bloco do catálogo é UM comando SELECT/WITH, sem palavra de escrita, sem meta-comando do psql, sem variável além
 *     de :'tenant_id' e :'external_id', sempre filtrando por :'tenant_id';
 *   - sem dado pessoal na saída: as colunas declaradas em `@colunas` não podem ser nome, e-mail, CPF/CNPJ, telefone ou
 *     endereço (só flags `sem_*`/`tem_*`/`com_*`/`*_vazio`/`*_preenchido`, que precisam vir booleanas); a coluna pessoal só
 *     aparece no SQL dentro de um teste que vira flag (`is null`, `= '<literal>'`, `in ('<literal>')`, `like '<literal>'` só no
 *     e-mail, `coalesce(trim(x), '') = ''`);
 *   - a execução roda numa transação READ ONLY (o script que o montar gera; o serviço pgleitura do compose ainda liga
 *     default_transaction_read_only e o statement_timeout), como o papel macuxi_leitura (sem escrita, sem BYPASSRLS);
 *   - a saída é conferida de novo: cabeçalho = colunas declaradas e cada valor com forma de contagem, id, flag, data ou
 *     código (sem espaço, sem e-mail, sem CPF/CNPJ/telefone). Qualquer desvio: nada é publicado.
 *
 * Formato do arquivo do catálogo (`<nome>.sql`, nome em minúsculas com hífen):
 *   -- descricao: <uma linha>
 *   -- parametros: external_id          (ou "nenhum"; tenant é sempre exigido)
 *   -- @consulta <rotulo_em_snake_case>
 *   -- @colunas a, b, c
 *   select ... where x.tenant_id = :'tenant_id' ...;
 *   (mais blocos @consulta)
 *
 * Uso (tudo por variável de ambiente; nada interpolado no shell):
 *   node scripts/producao/consulta.mjs verificar                       confere o catálogo inteiro (CI)
 *   CONSULTA=.. TENANT=.. EXTERNAL_ID=.. node scripts/producao/consulta.mjs montar   script psql no stdout
 *   CONSULTA=.. TENANT=.. EXTERNAL_ID=.. node scripts/producao/consulta.mjs relatorio <saida-do-psql>
 *                                                                       markdown no stdout (e .json ao lado, se SAIDA_JSON)
 * Saída: 0 = ok; 1 = recusado (entrada, catálogo ou saída); 2 = erro de uso.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_CATALOGO = fileURLToPath(new URL('./consultas/', import.meta.url));

/** Código do tenant: os de antes (thathyany, teste-macuxi) ou o da licença (UF + 4 dígitos; 0068). */
const RE_TENANT = /^(?:[a-z0-9][a-z0-9-]{1,39}|(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[0-9]{4})$/;
/** external_id de cadastro do ERP (VEN-000034, PAF.1434): sem espaço, aspas, barra invertida ou dois-pontos. */
const RE_EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const RE_NOME_CONSULTA = /^[a-z0-9][a-z0-9-]{1,59}$/;
const RE_ROTULO = /^[a-z][a-z0-9_]{0,62}$/;
const RE_COLUNA = /^[a-z][a-z0-9_]{0,62}$/;

/** Parâmetros que o catálogo pode declarar (além do tenant, sempre exigido e resolvido para :'tenant_id'). */
const PARAMETROS = { external_id: RE_EXTERNAL_ID };
const VARIAVEIS_PERMITIDAS = new Set(['tenant_id', ...Object.keys(PARAMETROS)]);

/** Palavras que denotam dado pessoal (nome, e-mail, CPF/CNPJ, telefone, endereço) ou segredo, como pedaço de identificador. */
const PESSOAIS = [
  'nome', 'nomes', 'apelido', 'razao', 'fantasia', 'email', 'emails', 'cpf', 'cnpj', 'documento', 'rg', 'telefone', 'celular',
  'fone', 'whatsapp', 'endereco', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'cidade', 'latitude', 'longitude',
  'senha', 'hash', 'token', 'segredo', 'payload', 'mensagem', 'erro', 'observacao',
];
const PESSOAIS_SET = new Set(PESSOAIS);
/** No SQL, o identificador inteiro (não o pedaço): lote_linha_erro é tabela, ultimo_erro é coluna com texto livre. */
const PESSOAIS_SQL = new Set([...PESSOAIS, 'nome_curto', 'nome_fantasia', 'razao_social', 'senha_hash', 'senha_temporaria_hash',
  'ultimo_erro', 'cpf_cnpj', 'inscricao_estadual']);
/** Colunas pessoais só como flag (valor booleano conferido na saída). */
const RE_FLAG = /^(?:sem|tem|com)_|_(?:vazio|preenchido)$/;

/** Palavras de escrita, de controle de sessão/transação e funções perigosas: recusadas no SQL do catálogo. */
const PROIBIDAS = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'truncate', 'drop', 'alter', 'create', 'grant', 'revoke', 'comment',
  'copy', 'call', 'do', 'execute', 'prepare', 'deallocate', 'declare', 'fetch', 'move', 'close', 'set', 'reset', 'show',
  'begin', 'start', 'commit', 'rollback', 'abort', 'savepoint', 'release', 'lock', 'vacuum', 'analyze', 'cluster',
  'reindex', 'refresh', 'listen', 'notify', 'unlisten', 'load', 'discard', 'checkpoint', 'security', 'into', 'returning',
  'set_config', 'pg_sleep', 'dblink', 'nextval', 'setval', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'lo_import', 'lo_export', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_advisory_lock', 'pg_advisory_xact_lock',
  'current_setting', 'txid_current', 'pg_current_xact_id', 'query_to_xml', 'pg_logical_emit_message',
];
const PROIBIDAS_SET = new Set(PROIBIDAS);

const TETO_BLOCOS = 20;
const TETO_LINHAS = 200;

// ---------------------------------------------------------------------------------------------------------------------
// SQL: comentários, literais e palavras

/** Tira comentários (-- e /* *\/) e troca o conteúdo dos literais '...' por espaços (posições preservadas). */
function semComentariosELiterais(sql) {
  let saida = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') { saida += ' '; i++; }
    } else if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const ate = fim < 0 ? sql.length : fim + 2;
      saida += ' '.repeat(ate - i);
      i = ate;
    } else if (c === "'") {
      saida += "'";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { saida += '  '; i += 2; continue; }
        if (sql[i] === "'") break;
        saida += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) { saida += "'"; i++; }
    } else {
      saida += c;
      i++;
    }
  }
  return saida;
}

/** Variáveis do psql usadas (:'x', :"x", :x), fora de literal, de cast (::) e de fatia de array ([1:2]). */
function variaveisDoSql(sql) {
  const mascara = semComentariosELiterais(sql);
  const vars = [];
  for (const m of mascara.matchAll(/(?<![:\w]):(?!:)/g)) {
    const resto = sql.slice(m.index + 1);
    const v = /^(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(resto);
    if (v) vars.push({ nome: v[2], citada: v[1] === "'" });
    else vars.push({ nome: resto.slice(0, 20), citada: false });
  }
  return vars;
}

function nomesPessoais(identificador) {
  return identificador.toLowerCase().split('_').some((p) => PESSOAIS_SET.has(p));
}

/** Coluna de saída com dado pessoal (ou segredo) que não é flag. */
export function colunaPessoal(coluna) {
  return nomesPessoais(coluna) && !RE_FLAG.test(coluna);
}

/**
 * Referências a coluna pessoal no SQL (identificador ou chave de json `->>'nome'`) fora dos usos que viram flag:
 * `<ref> is [not] null`, `<ref> = | <> '<literal>'`, `<ref> [not] in ('<literal>', ...)`, `<ref e-mail> [not] [i]like '<literal>'`
 * e `coalesce(b?trim(<ref>), '') =|<> ''`.
 */
function usosPessoaisIndevidos(sql) {
  const semComentario = sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
  const mascara = semComentariosELiterais(sql);
  const problemas = [];
  const re = /(?:(?<![\w.])(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*\s*->>?\s*'([a-z_][a-z0-9_]*)'|(?<![\w.'"])(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\b(?!\s*\())/gi;
  for (const m of semComentario.matchAll(re)) {
    const chave = m[1] ?? m[2];
    // identificador dentro de literal (que não seja a chave do json) não conta
    if (m[2] !== undefined && mascara.slice(m.index, m.index + m[0].length).trim() !== m[0].trim()) continue;
    if (!PESSOAIS_SQL.has(chave.toLowerCase())) continue;
    const antes = semComentario.slice(0, m.index);
    const depois = semComentario.slice(m.index + m[0].length);
    const ehNulo = /^\s*is\s+(?:not\s+)?null\b/i.test(depois);
    const ehLike = /^email$/i.test(chave) && /^\s*(?:not\s+)?i?like\s+'[^':]*'/i.test(depois);
    const ehComparacao = /^\s*(?:=|<>)\s*'[^':]*'/.test(depois) || /^\s*(?:not\s+)?in\s*\(\s*'[^':]*'(?:\s*,\s*'[^':]*')*\s*\)/i.test(depois);
    const ehVazio = /coalesce\(\s*(?:b?trim\(\s*)?$/i.test(antes) && /^\s*\)?\s*,\s*''\s*\)\s*(?:=|<>)\s*''/.test(depois);
    if (!(ehNulo || ehLike || ehComparacao || ehVazio)) {
      problemas.push(`coluna pessoal "${chave}" fora de flag (is null, = ou in com literal, like no e-mail ou coalesce(trim(x), '') = '')`);
    }
  }
  return problemas;
}

/** Problemas de UM bloco (um comando) do catálogo. */
function verificarBloco(sql, parametrosDeclarados = []) {
  const problemas = [];
  const mascara = semComentariosELiterais(sql);
  if (/[\\]/.test(mascara)) problemas.push('meta-comando do psql (barra invertida) é proibido');
  if (/\$/.test(mascara)) problemas.push('cifrão (dollar quoting ou $n) é proibido');
  if (/"/.test(mascara)) problemas.push('identificador entre aspas duplas é proibido');
  const corpo = mascara.trim();
  if (!corpo) return ['bloco vazio'];
  if (!/^(?:select|with)\b/i.test(corpo)) problemas.push('o comando tem de começar por select ou with');
  const pontoEVirgula = [...corpo.matchAll(/;/g)];
  if (pontoEVirgula.length !== 1 || !corpo.endsWith(';')) problemas.push('um comando por bloco, terminado em ";"');
  const palavras = new Set((corpo.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []));
  for (const p of palavras) if (PROIBIDAS_SET.has(p)) problemas.push(`palavra proibida: ${p}`);
  if (/\b[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*\(/i.test(corpo)) problemas.push('chamada de função com schema (ex.: plataforma.f()) é proibida');
  if (/\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b/i.test(corpo)) problemas.push('trava de linha (for update/share) é proibida');
  for (const v of variaveisDoSql(sql)) {
    if (!VARIAVEIS_PERMITIDAS.has(v.nome)) problemas.push(`variável não permitida: ${v.nome}`);
    else if (!v.citada) problemas.push(`variável ${v.nome} tem de ser citada como :'${v.nome}'`);
    else if (v.nome !== 'tenant_id' && !parametrosDeclarados.includes(v.nome)) problemas.push(`variável ${v.nome} sem declarar em "parametros"`);
  }
  if (!/\btenant_id\s*=\s*:'tenant_id'/.test(sql)) problemas.push("sem filtro tenant_id = :'tenant_id'");
  problemas.push(...usosPessoaisIndevidos(sql));
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------
// Catálogo

/** Lê um arquivo do catálogo: { nome, descricao, parametros, blocos: [{ rotulo, colunas, sql }], problemas }. */
export function analisarArquivo(nome, texto) {
  const problemas = [];
  if (!RE_NOME_CONSULTA.test(nome)) problemas.push(`nome de arquivo inválido: ${nome}.sql`);
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const descricao = (/^-- descricao:\s*(.+)$/m.exec(texto)?.[1] || '').trim();
  if (!descricao) problemas.push('falta a linha "-- descricao: ..."');
  const parametrosLinha = /^-- parametros:\s*(.+)$/m.exec(texto)?.[1]?.trim();
  let parametros = [];
  if (!parametrosLinha) problemas.push('falta a linha "-- parametros: ..." (ou "nenhum")');
  else if (parametrosLinha !== 'nenhum') {
    parametros = parametrosLinha.split(/\s*,\s*/);
    for (const p of parametros) if (!(p in PARAMETROS)) problemas.push(`parâmetro desconhecido: ${p}`);
  }
  const blocos = [];
  let atual = null;
  for (const linha of linhas) {
    const c = /^-- @consulta\s+(\S+)\s*$/.exec(linha);
    if (c) { atual = { rotulo: c[1], colunas: null, sql: '' }; blocos.push(atual); continue; }
    const col = /^-- @colunas\s+(.+)$/.exec(linha);
    if (col) {
      if (!atual || atual.colunas) problemas.push('"-- @colunas" fora de lugar (uma por bloco, logo depois do @consulta)');
      else atual.colunas = col[1].trim().split(/\s*,\s*/);
      continue;
    }
    if (!atual) {
      if (linha.trim() && !/^--/.test(linha)) problemas.push('SQL antes do primeiro "-- @consulta"');
      continue;
    }
    atual.sql += `${linha}\n`;
  }
  if (!blocos.length) problemas.push('nenhum bloco "-- @consulta"');
  if (blocos.length > TETO_BLOCOS) problemas.push(`mais de ${TETO_BLOCOS} blocos`);
  const rotulos = new Set();
  for (const b of blocos) {
    const onde = `[${b.rotulo}]`;
    if (!RE_ROTULO.test(b.rotulo)) problemas.push(`${onde} rótulo inválido (snake_case)`);
    if (rotulos.has(b.rotulo)) problemas.push(`${onde} rótulo repetido`);
    rotulos.add(b.rotulo);
    if (!b.colunas?.length) problemas.push(`${onde} falta "-- @colunas"`);
    else {
      if (new Set(b.colunas).size !== b.colunas.length) problemas.push(`${onde} coluna repetida em @colunas`);
      for (const col of b.colunas) {
        if (!RE_COLUNA.test(col)) problemas.push(`${onde} coluna inválida: ${col}`);
        else if (colunaPessoal(col)) problemas.push(`${onde} coluna com dado pessoal: ${col}`);
      }
    }
    b.sql = b.sql.trim();
    for (const p of verificarBloco(b.sql, parametros)) problemas.push(`${onde} ${p}`);
  }
  return { nome, descricao, parametros, blocos, problemas };
}

/** Catálogo inteiro: Map nome → consulta; `problemas` com o arquivo na frente. */
export function lerCatalogo(pasta = PASTA_CATALOGO) {
  const consultas = new Map();
  const problemas = [];
  const arquivos = readdirSync(pasta).filter((a) => a.endsWith('.sql')).sort();
  if (!arquivos.length) problemas.push('catálogo vazio');
  for (const a of arquivos) {
    const nome = a.slice(0, -4);
    const c = analisarArquivo(nome, readFileSync(join(pasta, a), 'utf8'));
    for (const p of c.problemas) problemas.push(`${a}: ${p}`);
    consultas.set(nome, c);
  }
  return { consultas, problemas };
}

// ---------------------------------------------------------------------------------------------------------------------
// Entrada e montagem

/** Confere a entrada do disparo contra o catálogo. Devolve { consulta, tenant, parametros } ou lança Error. */
export function validarEntrada({ consulta, tenant, external_id: externalId }, catalogo) {
  const nome = String(consulta ?? '').trim();
  if (!RE_NOME_CONSULTA.test(nome) || !catalogo.consultas.has(nome)) throw new Error('consulta fora do catálogo');
  const c = catalogo.consultas.get(nome);
  if (c.problemas.length) throw new Error(`consulta ${nome} recusada pelo verificador do catálogo`);
  const t = String(tenant ?? '').trim();
  if (!RE_TENANT.test(t)) throw new Error('tenant inválido (código da empresa, ex.: AM2808 ou thathyany)');
  const valores = { external_id: String(externalId ?? '').trim() };
  const parametros = {};
  for (const p of c.parametros) {
    if (!PARAMETROS[p].test(valores[p])) throw new Error(`${p} inválido ou vazio (ex.: VEN-000034)`);
    parametros[p] = valores[p];
  }
  for (const p of Object.keys(PARAMETROS)) {
    if (!c.parametros.includes(p) && valores[p]) throw new Error(`a consulta ${nome} não usa ${p}: deixe vazio`);
  }
  return { consulta: c, tenant: t, parametros };
}

const TIMEOUT_INSTRUCAO = '15s';

/**
 * Script do psql (stdin): transação READ ONLY, timeouts curtos, tenant resolvido pelo código (\gset falha sem linha),
 * contexto da RLS (app.tenant_id, local à transação), um marcador por bloco e ROLLBACK no fim. Os valores entram como
 * variáveis do psql (-v), nunca no texto.
 */
export function montarScript(consulta) {
  const partes = [
    '\\set ON_ERROR_STOP on',
    'begin isolation level repeatable read, read only;',
    `set local statement_timeout = '${TIMEOUT_INSTRUCAO}';`,
    "set local lock_timeout = '2s';",
    "set local idle_in_transaction_session_timeout = '60s';",
    "select current_setting('transaction_read_only') as somente_leitura \\gset",
    '\\if :somente_leitura',
    '\\else',
    "\\echo 'ERRO: a transação não está em modo só leitura'",
    'select 1 / 0;',
    '\\endif',
    "select id as tenant_id from plataforma.tenant_por_codigo(:'tenant') \\gset",
    "select set_config('app.tenant_id', :'tenant_id', true) as contexto_tenant \\gset",
  ];
  for (const b of consulta.blocos) partes.push(`\\echo '### ${b.rotulo}'`, b.sql);
  partes.push('rollback;', '');
  return partes.join('\n');
}

/** Argumentos do psql (-v nome=valor) para o ssh; valores já validados. */
export function argumentosPsql(entrada) {
  const args = ['-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-v', `tenant=${entrada.tenant}`];
  for (const [k, v] of Object.entries(entrada.parametros)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  return args;
}

// ---------------------------------------------------------------------------------------------------------------------
// Saída

function linhasCsv(texto) {
  const linhas = [];
  for (const bruta of texto.split('\n')) {
    if (bruta === '') continue;
    const campos = [];
    let i = 0;
    while (i <= bruta.length) {
      if (bruta[i] === '"') {
        let v = '';
        i++;
        while (i < bruta.length) {
          if (bruta[i] === '"' && bruta[i + 1] === '"') { v += '"'; i += 2; continue; }
          if (bruta[i] === '"') { i++; break; }
          v += bruta[i++];
        }
        campos.push(v);
        if (bruta[i] === ',') i++;
        else break;
      } else {
        const fim = bruta.indexOf(',', i);
        if (fim < 0) { campos.push(bruta.slice(i)); break; }
        campos.push(bruta.slice(i, fim));
        i = fim + 1;
        if (i === bruta.length) { campos.push(''); break; }
      }
    }
    linhas.push(campos);
  }
  return linhas;
}

const FORMAS = [
  /^$/, // nulo
  /^[tf]$/, // booleano do psql
  /^-?\d{1,9}$/, // contagem (10+ dígitos podem ser CPF, CNPJ ou telefone)
  /^-?\d{1,12}\.\d{1,6}$/, // número com casas
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, // uuid
  /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::\d{2})?)?)?$/, // data/hora
];
const RE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}(?:@[0-9]{1,3})?$/;
const RE_DOC_FORMATADO = /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{5}-\d{3}$/;

/** Valor com forma permitida (contagem, id, flag, data ou código sem espaço); nunca e-mail, documento ou telefone. */
export function valorPermitido(valor) {
  if (FORMAS.some((r) => r.test(valor))) return true;
  if (RE_DOC_FORMATADO.test(valor)) return false;
  if (/^\d+$/.test(valor)) return false;
  return RE_CODIGO.test(valor);
}

/**
 * Confere a saída do psql (--csv, com os marcadores "### rotulo") contra a consulta: blocos na ordem, cabeçalho igual às
 * colunas declaradas, flag pessoal só booleana, valores com forma permitida e teto de linhas. Lança Error SEM o valor.
 */
export function analisarSaida(texto, consulta) {
  const secoes = [];
  let atual = null;
  const blocos = texto.replace(/\r\n?/g, '\n').split('\n');
  const porSecao = [];
  for (const linha of blocos) {
    const m = /^### ([a-z][a-z0-9_]*)$/.exec(linha);
    if (m) { atual = { rotulo: m[1], linhas: [] }; porSecao.push(atual); continue; }
    if (!linha) continue;
    if (!atual) throw new Error('saída do psql fora de bloco (linha antes do primeiro marcador)');
    atual.linhas.push(linha);
  }
  if (porSecao.length !== consulta.blocos.length) throw new Error(`esperados ${consulta.blocos.length} blocos, vieram ${porSecao.length}`);
  porSecao.forEach((s, i) => {
    const b = consulta.blocos[i];
    if (s.rotulo !== b.rotulo) throw new Error(`bloco ${i + 1}: esperado ${b.rotulo}, veio ${s.rotulo}`);
    const [cabecalho, ...linhas] = linhasCsv(s.linhas.join('\n'));
    if (!cabecalho || cabecalho.join(',') !== b.colunas.join(',')) throw new Error(`[${b.rotulo}] colunas diferentes das declaradas em @colunas`);
    if (linhas.length > TETO_LINHAS) throw new Error(`[${b.rotulo}] mais de ${TETO_LINHAS} linhas: refine a consulta (limit)`);
    linhas.forEach((l, n) => {
      if (l.length !== cabecalho.length) throw new Error(`[${b.rotulo}] linha ${n + 1} com número de colunas errado`);
      l.forEach((v, k) => {
        const col = cabecalho[k];
        if (nomesPessoais(col) && !/^[tf]?$/.test(v)) throw new Error(`[${b.rotulo}] coluna ${col} (flag) com valor não booleano na linha ${n + 1}`);
        if (!valorPermitido(v)) throw new Error(`[${b.rotulo}] coluna ${col}, linha ${n + 1}: valor fora das formas permitidas (contagem, id, flag, data ou código)`);
      });
    });
    secoes.push({ rotulo: b.rotulo, colunas: cabecalho, linhas });
  });
  return secoes;
}

/** Markdown do resultado (GITHUB_STEP_SUMMARY). */
export function paraMarkdown(secoes, { consulta, tenant, parametros }) {
  const params = Object.entries(parametros).map(([k, v]) => `${k}=\`${v}\``).join(', ');
  const saida = [`## Consulta só leitura: \`${consulta.nome}\``, '', `${consulta.descricao}`, '',
    `Tenant \`${tenant}\`${params ? `; ${params}` : ''}. Transação READ ONLY, papel macuxi_leitura, desfeita no fim.`, ''];
  for (const s of secoes) {
    saida.push(`### ${s.rotulo}`, '');
    if (!s.linhas.length) { saida.push('_(nenhuma linha)_', ''); continue; }
    saida.push(`| ${s.colunas.join(' | ')} |`, `|${s.colunas.map(() => ' --- ').join('|')}|`);
    for (const l of s.linhas) saida.push(`| ${l.map((v) => (v === '' ? '∅' : v)).join(' | ')} |`);
    saida.push('');
  }
  return saida.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI

function principal(argv) {
  const [modo, arquivo] = argv;
  const catalogo = lerCatalogo();
  if (modo === 'verificar') {
    if (catalogo.problemas.length) {
      for (const p of catalogo.problemas) console.error(`::error::catálogo de consultas: ${p}`);
      return 1;
    }
    console.log(`catálogo de consultas ok: ${[...catalogo.consultas.keys()].join(', ')}`);
    return 0;
  }
  if (modo !== 'montar' && modo !== 'relatorio') {
    console.error('uso: consulta.mjs verificar | montar | relatorio <saida>');
    return 2;
  }
  let entrada;
  try {
    entrada = validarEntrada({ consulta: process.env.CONSULTA, tenant: process.env.TENANT, external_id: process.env.EXTERNAL_ID }, catalogo);
  } catch (e) {
    console.error(`::error::${e.message}`);
    return 1;
  }
  if (modo === 'montar') {
    process.stdout.write(montarScript(entrada.consulta));
    if (process.env.ARGS_PSQL) writeFileSync(process.env.ARGS_PSQL, `${argumentosPsql(entrada).join('\n')}\n`);
    return 0;
  }
  if (!arquivo) { console.error('uso: consulta.mjs relatorio <saida>'); return 2; }
  let secoes;
  try {
    secoes = analisarSaida(readFileSync(arquivo, 'utf8'), entrada.consulta);
  } catch (e) {
    console.error(`::error::saída recusada, nada publicado: ${e.message}`);
    return 1;
  }
  if (process.env.SAIDA_JSON) {
    const meta = { consulta: entrada.consulta.nome, tenant: entrada.tenant, parametros: entrada.parametros };
    writeFileSync(process.env.SAIDA_JSON, `${JSON.stringify({ ...meta, secoes }, null, 2)}\n`);
  }
  process.stdout.write(`${paraMarkdown(secoes, entrada)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal(process.argv.slice(2));
}
