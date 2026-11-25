/**
 * Regra `macuxi/perfil-fixo` (ADR 0073 §2.8, E3): o nome fixo de perfil não volta ao código de produção.
 * Os trechos abaixo são CÓDIGO-EXEMPLO dentro de strings.
 */
import { ESLint, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { perfilFixo } from './regras/perfil-fixo.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('macuxi/perfil-fixo', () => {
  it('casos válidos e inválidos', () => {
    tester.run('perfil-fixo', perfilFixo, {
      valid: [
        // permissão por chave e hierarquia pelo cargo
        `if (pode(u.perfis, 'pedido.aprovar')) aprovar();`,
        `if (u.cargo === 'promotor') barrar();`,
        `if (u.perfil_acesso.cargo === 'supervisor') equipe();`,
        // outro campo com nome de perfil, ou perfil comparado com algo que não é nome de perfil
        `const x = linha.tipo === 'admin';`,
        `const y = u.perfil === outro.perfil;`,
        `const z = u.base === 'tenant';`,
        // exceção explícita com motivo
        `// perfil-fixo-ok: nome de compatibilidade (ADR 0073 §2.8)
         const a = u.perfil === 'admin';`,
        `switch (u.cargo) { case 'vendedor': break; }`,
      ],
      invalid: [
        {
          code: `if (u.perfil === 'admin') x();`,
          errors: [{ messageId: 'comparacao', data: { nome: 'admin' } }],
        },
        { code: `const v = 'promotor' !== ctx.usuario.perfil;`, errors: [{ messageId: 'comparacao' }] },
        {
          code: `const b = perfis.some((p) => p.base == 'analista');`,
          errors: [{ messageId: 'comparacao' }],
        },
        { code: `const c = u?.perfil === 'gerente';`, errors: [{ messageId: 'comparacao' }] },
        { code: 'switch (u.perfil) { case `vendedor`: break; }', errors: [{ messageId: 'caso' }] },
        {
          code: `const d = ['admin', 'analista'].includes(u.perfil);`,
          errors: [{ messageId: 'perfilEmLista' }],
        },
        { code: `const e = PERFIS_AUDITORIA.includes(p.base);`, errors: [{ messageId: 'perfilEmLista' }] },
        // exceção sem motivo não vale
        {
          code: `// perfil-fixo-ok:\nconst f = u.perfil === 'admin';`,
          errors: [{ messageId: 'comparacao' }],
        },
      ],
    });
  });

  it('vale como AVISO no código de produção e fica fora dos testes (configuração compartilhada)', async () => {
    const eslint = new ESLint({ cwd: import.meta.dirname });
    const codigo = `export const ehAdmin = (u: { perfil: string }) => u.perfil === 'admin';\n`;
    const [prod] = await eslint.lintText(codigo, { filePath: 'src/exemplo.ts' });
    expect(prod!.messages.map((m) => [m.ruleId, m.severity])).toEqual([['macuxi/perfil-fixo', 1]]);
    const [teste] = await eslint.lintText(codigo, { filePath: 'src/exemplo.test.ts' });
    expect(teste!.messages.filter((m) => m.ruleId === 'macuxi/perfil-fixo')).toEqual([]);
  });
});
