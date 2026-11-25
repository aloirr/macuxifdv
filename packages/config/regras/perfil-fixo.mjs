// @ts-check
/**
 * Regra `macuxi/perfil-fixo` (ADR 0073 §2.8, etapa E3): acusa uso NOVO do nome fixo de perfil no código de produção. "Pode
 * fazer X" é sempre chave (`pode(...)`, `podePeloCargo(...)` ou `acao` da rota); "onde está na hierarquia" é `usuario.cargo`.
 *
 * Acusa, quando o outro lado é um dos 7 nomes de perfil (`vendedor` … `admin`) em texto literal:
 *  - comparação `x.perfil === 'admin'` / `!==` / `==` / `!=` (também `x.base`, o `perfis[].base` do motor antigo);
 *  - `switch (x.perfil)` com `case 'admin':`;
 *  - qualquer lista consultada com o perfil: `['admin', 'analista'].includes(u.perfil)`, `PERFIS_AUDITORIA.includes(p.base)`.
 *
 * AVISO até a troca de leitura (E6); depois, erro. Os usos de hoje (~70 arquivos, ADR 0073 §1.3) saem nos PRs de cada dono.
 * Exceção pontual: `// perfil-fixo-ok: <motivo>` na linha ou na de cima (ex.: o motor antigo e o nome de compatibilidade).
 */

const NOMES_DE_PERFIL = new Set([
  'vendedor',
  'promotor',
  'supervisor',
  'gerente',
  'analista',
  'assistente',
  'admin',
]);
const PROPRIEDADES = new Set(['perfil', 'base']);
const RE_EXCECAO = /(?:^|\s)perfil-fixo-ok:\s*\S/;

/** `x.perfil`, `x?.perfil`, `x.base` (não computado). @param {any} n */
function ehLeituraDoPerfil(n) {
  if (!n) return false;
  if (n.type === 'ChainExpression') return ehLeituraDoPerfil(n.expression);
  if (n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression') return ehLeituraDoPerfil(n.expression);
  return (
    n.type === 'MemberExpression' &&
    !n.computed &&
    n.property.type === 'Identifier' &&
    PROPRIEDADES.has(n.property.name)
  );
}
/** Literal string (ou template sem expressões) com um nome de perfil. @param {any} n */
function ehNomeDePerfil(n) {
  if (!n) return false;
  if (n.type === 'Literal' && typeof n.value === 'string') return NOMES_DE_PERFIL.has(n.value);
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0)
    return NOMES_DE_PERFIL.has(n.quasis[0].value.cooked);
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export const perfilFixo = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Sem nome fixo de perfil: use a permissão (chave) ou o cargo (ADR 0073 §2.8).' },
    schema: [],
    messages: {
      comparacao:
        'Comparação com o nome fixo de perfil "{{nome}}" (ADR 0073 §2.8): use a permissão (`pode`, `acao` da rota) ou `usuario.cargo`.',
      caso: 'switch pelo nome fixo de perfil (ADR 0073 §2.8): use a permissão (`pode`, `acao` da rota) ou `usuario.cargo`.',
      perfilEmLista:
        'Lista de nomes de perfil consultada com o perfil do usuário (ADR 0073 §2.8): use a permissão (`pode`, `acao` da rota) ou `usuario.cargo`.',
    },
  },
  create(context) {
    const fonte = context.sourceCode;
    /** @param {any} no */
    const excecao = (no) => {
      const linha = no.loc.start.line;
      return fonte
        .getAllComments()
        .some(
          (c) =>
            c.loc && (c.loc.end.line === linha || c.loc.end.line === linha - 1) && RE_EXCECAO.test(c.value),
        );
    };
    return {
      /** @param {any} no */
      BinaryExpression(no) {
        if (!['===', '!==', '==', '!='].includes(no.operator)) return;
        const par = ehLeituraDoPerfil(no.left) ? no.right : ehLeituraDoPerfil(no.right) ? no.left : null;
        if (!par || !ehNomeDePerfil(par) || excecao(no)) return;
        context.report({
          node: no,
          messageId: 'comparacao',
          data: { nome: par.type === 'Literal' ? par.value : par.quasis[0].value.cooked },
        });
      },
      /** @param {any} no */
      SwitchStatement(no) {
        if (
          !ehLeituraDoPerfil(no.discriminant) ||
          !no.cases.some((/** @type {any} */ c) => ehNomeDePerfil(c.test)) ||
          excecao(no)
        )
          return;
        context.report({ node: no.discriminant, messageId: 'caso' });
      },
      /** @param {any} no */
      CallExpression(no) {
        const c = no.callee.type === 'ChainExpression' ? no.callee.expression : no.callee;
        if (c.type !== 'MemberExpression' || c.computed || c.property.name !== 'includes') return;
        if (!ehLeituraDoPerfil(no.arguments[0]) || excecao(no)) return;
        context.report({ node: no, messageId: 'perfilEmLista' });
      },
    };
  },
};
