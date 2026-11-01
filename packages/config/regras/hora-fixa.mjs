// @ts-check
/**
 * Regra `macuxi/hora-fixa-em-teste` (T-0043, ADR 0015): acusa, em arquivo de teste, duas linhas do tempo misturadas —
 * o padrão que deixou o main vermelho três vezes (passa num horário e reprova em outro).
 *
 * Evidências no arquivo: instante FIXO (`new Date('2026-…')`, `new Date(2026, 10, 1)`, `Date.UTC(…)`,
 * `Date.parse('2026-…')`, `'2026-11-01T15:00:00Z'`, `const HOJE = '2026-11-01'`) e relógio REAL (`Date.now()`,
 * `new Date()` sem argumento, `now()`/`current_date`/`current_timestamp` dentro de SQL). Com as duas:
 *  - `relogioReal`: cada `Date.now()`/`new Date()` (a correção típica é trocar por `relogio.agora()`);
 *  - `sqlRelogio`: o primeiro `now()` do SQL, com a contagem do arquivo (a correção típica é derivar os instantes do
 *    teste de `relogioDoBanco()` ou passar o instante do teste como parâmetro);
 *  - `agoraFixo`: cada constante tipo AGORA/HOJE com valor fixo (é ela que acaba comparada ao relógio).
 * Sempre (com ou sem mistura): `dataUtc` — `new Date().toISOString().slice(0, 10|7)` / `.split('T')[0]`, o "hoje" em
 * UTC, que entre 20:00 e 24:00 de Manaus já é amanhã.
 * `vi.useFakeTimers`/`vi.setSystemTime` no arquivo: `Date.now()`/`new Date()` passam a ser o relógio do teste (o
 * `now()` do SQL continua real).
 *
 * Exceção explícita, no nó ou na linha de cima: `// hora-fixa-ok: <motivo>` (motivo obrigatório; sem motivo acusa
 * `semMotivo`). Uma exceção num instante fixo o tira das evidências. `eslint-disable-next-line` também funciona.
 * Arquivo só com instantes fixos (ou só com relógio real) não é acusado.
 */

const RE_INSTANTE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const PALAVRAS_AGORA = new Set(['agora', 'hoje', 'now', 'today']);
/** nome com a palavra agora/hoje/now/today (camelCase ou SNAKE): AGORA, AGORA_FIXO, agoraFixo, dataDeHoje. @param {string} nome */
const ehNomeDeAgora = (nome) =>
  nome
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_$]+/)
    .some((p) => PALAVRAS_AGORA.has(p));
const RE_SQL_RELOGIO =
  /\b(now\s*\(\s*\)|current_date|current_timestamp|localtimestamp|clock_timestamp\s*\(|statement_timestamp\s*\(|transaction_timestamp\s*\()/i;
/** SQL de verdade (não título de teste que só cita now()). */
const RE_SQL = /\b(select|insert|update|delete|values|where|set|default|returning|interval)\b/i;
/** @param {string} t */
const ehSqlComRelogio = (t) => RE_SQL_RELOGIO.test(t) && RE_SQL.test(t);
const RE_EXCECAO = /(?:^|\s)hora-fixa-ok:(.*)$/;

/** @param {any} n */
const ehDate = (n) => n && n.type === 'Identifier' && n.name === 'Date';
/** @param {any} n @param {string} metodo */
const ehDateMetodo = (n, metodo) =>
  n &&
  n.type === 'CallExpression' &&
  n.callee.type === 'MemberExpression' &&
  ehDate(n.callee.object) &&
  !n.callee.computed &&
  n.callee.property.name === metodo;
/** @param {any} n */
const ehNewDateVazio = (n) => n && n.type === 'NewExpression' && ehDate(n.callee) && n.arguments.length === 0;
/** texto de Literal string ou template sem expressões; senão null. @param {any} n */
function textoFixo(n) {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
}
/** argumento literal (texto ou número) de new Date / Date.parse. @param {any} n */
const ehLiteralDeInstante = (n) =>
  n && ((n.type === 'Literal' && (typeof n.value === 'number' || typeof n.value === 'string')) || textoFixo(n) !== null);
/** Date.UTC(…) com todos os argumentos numéricos literais. @param {any} n */
const ehDateUtcFixo = (n) =>
  ehDateMetodo(n, 'UTC') && n.arguments.length > 0 && n.arguments.every((/** @type {any} */ a) => a.type === 'Literal');

/** @type {import('eslint').Rule.RuleModule} */
export const horaFixaEmTeste = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Teste não mistura instante fixo com o relógio real; "hoje" vem do fuso do tenant (T-0043, ADR 0015).',
    },
    schema: [],
    messages: {
      relogioReal:
        'Relógio real ({{real}}) em teste que também usa instante fixo (linha {{linha}}): use UMA linha do tempo — relogio.agora() de criarRelogio() (@macuxi/comum/relogio). Uso legítimo: `// hora-fixa-ok: <motivo>`.',
      sqlRelogio:
        'now() do SQL ({{n}} uso(s) no arquivo) em teste que também usa instante fixo (linha {{linha}}): derive os instantes de relogioDoBanco() ou passe o instante do relógio do teste como parâmetro. Uso nunca comparado: `// hora-fixa-ok: <motivo>`.',
      agoraFixo:
        '"{{nome}}" fixo em teste que também lê o relógio real ({{real}}, linha {{linha}}): troque por criarRelogio({ agora }) e injete relogio.agora(), ou derive de relogioDoBanco(). Nunca comparado: `// hora-fixa-ok: <motivo>`.',
      dataUtc:
        '"Hoje" em UTC ({{trecho}}): entre 20:00 e 24:00 de Manaus já é amanhã. Use relogio.hoje() / diaCivil(agora, 0, fuso) de @macuxi/comum/relogio.',
      semMotivo: 'Exceção `hora-fixa-ok:` sem motivo: escreva `// hora-fixa-ok: <por que é seguro>`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** instantes fixos (evidência da linha do tempo fixa) @type {any[]} */
    const fixos = [];
    /** leituras do relógio real @type {Array<{ node: any, real: string, js: boolean }>} */
    const reais = [];
    /** constantes tipo AGORA/HOJE com valor fixo @type {Array<{ node: any, nome: string }>} */
    const agoras = [];
    /** "hoje" em UTC @type {any[]} */
    const datasUtc = [];
    /** o arquivo fixa o relógio do Node (vi.useFakeTimers/vi.setSystemTime): new Date()/Date.now() já são o relógio do teste */
    let relogioDoNodeFixado = false;

    /** @param {any} node */
    const ehArgumentoDeData = (node) => {
      const p = node.parent;
      return p && ((p.type === 'NewExpression' && ehDate(p.callee)) || ehDateMetodo(p, 'parse') || ehDateMetodo(p, 'UTC'));
    };
    /** nó é um instante fixo por si só? @param {any} n */
    const ehInstanteFixo = (n) => {
      if (!n) return false;
      if (n.type === 'NewExpression' && ehDate(n.callee) && n.arguments.length > 0) {
        const a = n.arguments[0];
        return (
          (n.arguments.length === 1 && ehLiteralDeInstante(a)) ||
          ehDateUtcFixo(a) ||
          n.arguments.every((/** @type {any} */ x) => x.type === 'Literal' && typeof x.value === 'number')
        );
      }
      if (ehDateMetodo(n, 'parse')) return ehLiteralDeInstante(n.arguments[0]);
      if (ehDateUtcFixo(n)) return true;
      const t = textoFixo(n);
      return t !== null && (RE_INSTANTE.test(t) || RE_DATA.test(t));
    };

    return {
      NewExpression(node) {
        if (!ehDate(node.callee)) return;
        if (node.arguments.length === 0) return void reais.push({ node, real: 'new Date()', js: true });
        if (ehInstanteFixo(node)) fixos.push(node);
      },
      CallExpression(node) {
        const n = /** @type {any} */ (node);
        const c = n.callee;
        if (
          c.type === 'MemberExpression' &&
          !c.computed &&
          c.object.type === 'Identifier' &&
          (c.object.name === 'vi' || c.object.name === 'jest') &&
          (c.property.name === 'setSystemTime' || c.property.name === 'useFakeTimers')
        )
          relogioDoNodeFixado = true;
        if (ehDateMetodo(n, 'now')) return void reais.push({ node: n, real: 'Date.now()', js: true });
        if ((ehDateMetodo(n, 'parse') && ehInstanteFixo(n)) || (ehDateUtcFixo(n) && !ehArgumentoDeData(n))) return void fixos.push(n);
        // new Date().toISOString().slice(0, 10|7) / .substring(0, 10) / .split('T')[0]
        if (c.type !== 'MemberExpression' || c.computed) return;
        const obj = c.object;
        const ehIsoDoRelogio =
          obj.type === 'CallExpression' &&
          obj.callee.type === 'MemberExpression' &&
          !obj.callee.computed &&
          obj.callee.property.name === 'toISOString' &&
          (ehNewDateVazio(obj.callee.object) ||
            (obj.callee.object.type === 'NewExpression' && ehDate(obj.callee.object.callee) && ehDateMetodo(obj.callee.object.arguments[0], 'now')));
        if (!ehIsoDoRelogio) return;
        const nome = c.property.name;
        const [a0, a1] = n.arguments;
        const corte =
          ((nome === 'slice' || nome === 'substring' || nome === 'substr') &&
            a0?.type === 'Literal' &&
            a0.value === 0 &&
            a1?.type === 'Literal' &&
            (a1.value === 10 || a1.value === 7)) ||
          (nome === 'split' && textoFixo(a0) === 'T');
        if (corte) datasUtc.push(n);
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (ehSqlComRelogio(node.value)) reais.push({ node, real: 'now() do SQL', js: false });
        if (RE_INSTANTE.test(node.value) && !ehArgumentoDeData(node)) fixos.push(node);
      },
      TemplateLiteral(node) {
        if (ehSqlComRelogio(node.quasis.map((q) => q.value.cooked ?? '').join(' '))) reais.push({ node, real: 'now() do SQL', js: false });
        const t = textoFixo(node);
        if (t !== null && RE_INSTANTE.test(t) && !ehArgumentoDeData(node)) fixos.push(node);
      },
      VariableDeclarator(node) {
        const n = /** @type {any} */ (node);
        if (n.id.type !== 'Identifier' || !ehNomeDeAgora(n.id.name) || !ehInstanteFixo(n.init)) return;
        // (o instante em si já entrou em `fixos` pelo seu próprio nó; a data civil "HOJE" entra aqui)
        agoras.push({ node: n.init, nome: n.id.name });
        if (textoFixo(n.init) !== null && RE_DATA.test(textoFixo(n.init) ?? '')) fixos.push(n.init); // data civil "HOJE"
      },
      'Program:exit'() {
        // linhas cobertas por `hora-fixa-ok: motivo` (a do comentário e a de baixo); valor = tem motivo
        /** @type {Map<number, boolean>} */
        const excecoes = new Map();
        for (const c of sourceCode.getAllComments()) {
          const m = RE_EXCECAO.exec(c.value);
          if (!m || !c.loc) continue;
          const comMotivo = (m[1] ?? '').trim().length >= 3;
          for (const l of [c.loc.end.line, c.loc.end.line + 1]) excecoes.set(l, (excecoes.get(l) ?? false) || comMotivo);
        }
        /** true = exceção válida (ignora o nó); acusa semMotivo uma vez por linha @param {any} node */
        const avisados = new Set();
        const excetuado = (/** @type {any} */ node) => {
          const linha = node.loc.start.line;
          if (!excecoes.has(linha)) return false;
          if (!excecoes.get(linha) && !avisados.has(linha)) {
            avisados.add(linha);
            context.report({ node, messageId: 'semMotivo' });
          }
          return true;
        };
        for (const n of datasUtc) if (!excetuado(n)) context.report({ node: n, messageId: 'dataUtc', data: { trecho: sourceCode.getText(n).slice(0, 60) } });
        const fixosValidos = fixos.filter((n) => !excetuado(n));
        const reaisValidos = reais.filter((r) => !(r.js && relogioDoNodeFixado) && !excetuado(r.node));
        if (fixosValidos.length === 0 || reaisValidos.length === 0) return;
        const primeiroFixo = Math.min(...fixosValidos.map((n) => n.loc.start.line));
        const primeiroReal = reaisValidos.reduce((a, b) => (b.node.loc.start.line < a.node.loc.start.line ? b : a));
        const sql = reaisValidos.filter((r) => !r.js);
        for (const r of reaisValidos)
          if (r.js) context.report({ node: r.node, messageId: 'relogioReal', data: { real: r.real, linha: String(primeiroFixo) } });
        if (sql[0])
          context.report({ node: sql[0].node, messageId: 'sqlRelogio', data: { n: String(sql.length), linha: String(primeiroFixo) } });
        for (const a of agoras)
          if (!excetuado(a.node))
            context.report({ node: a.node, messageId: 'agoraFixo', data: { nome: a.nome, real: primeiroReal.real, linha: String(primeiroReal.node.loc.start.line) } });
      },
    };
  },
};

/** Plugin `macuxi` (flat config). */
export const pluginMacuxi = {
  meta: { name: 'macuxi' },
  rules: { 'hora-fixa-em-teste': horaFixaEmTeste },
};

/** Arquivos de teste (e de apoio a teste) onde a regra vale. Domain puro com instante fixo e sem relógio não é acusado. */
export const ARQUIVOS_DE_TESTE = [
  '**/*.test.{ts,tsx,mts,cts,js,mjs,cjs}',
  '**/*.spec.{ts,tsx,mts,js,mjs}',
  '**/__tests__/**/*.{ts,tsx,js,mjs}',
  '**/test/**/*.{ts,tsx,mts,js,mjs}',
  '**/testes/**/*.{ts,tsx,mts,js,mjs}',
  'tests/**/*.{ts,tsx,mts,js,mjs,cjs}',
];
