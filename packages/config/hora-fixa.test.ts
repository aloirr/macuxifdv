/**
 * Regra `macuxi/hora-fixa-em-teste` (T-0043, ADR 0015): casos que acusa e que deixa passar.
 * Os trechos abaixo são CÓDIGO-EXEMPLO dentro de strings (o próprio arquivo não mistura relógios).
 */
import { RuleTester } from 'eslint';
import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { horaFixaEmTeste } from './regras/hora-fixa.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('macuxi/hora-fixa-em-teste', () => {
  it('casos válidos e inválidos', () => {
    tester.run('hora-fixa-em-teste', horaFixaEmTeste, {
      valid: [
        // só instantes fixos: domain puro, uma linha do tempo
        `const AGORA = new Date('2026-11-01T15:00:00Z'); expect(diaDe(AGORA)).toBe('2026-11-01');`,
        // só relógio real
        `const t = Date.now(); expect(Date.now() - t).toBeLessThan(10);`,
        // relógio do teste derivando as datas (uma linha do tempo: a do banco)
        `const r = await relogioDoBanco(c); const ate = r.relativo({ minutos: 1 }); await q('select * from x where c < now()');`,
        // relógio do Node fixado (vi.setSystemTime): new Date() é o relógio do teste
        `vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T03:59:00Z')); expect(hoje(new Date())).toBe('2026-11-03');`,
        // medir duração com exceção explícita
        `const AGORA = new Date('2026-11-01T15:00:00Z');
         const t0 = Date.now(); // hora-fixa-ok: só mede duração
         expect(Date.now() - t0).toBeLessThan(50); // hora-fixa-ok: idem`,
        // nome que só contém "now" dentro de outra palavra não é AGORA
        `const nowrap = '2026-11-01'; const known = '2026-11-01';`,
        // menção a hora-fixa-ok sem os dois-pontos não é exceção nem acusa semMotivo
        `// ver hora-fixa-ok no ADR
         const x = 1;`,
        // exceção explícita com motivo (linha de cima e mesma linha)
        `// hora-fixa-ok: payload de exemplo, nunca comparado ao relógio
         const criado = '2026-11-01T15:00:00Z'; const t = Date.now();`,
        `const criado = new Date('2026-11-01T15:00:00Z'); /* hora-fixa-ok: data do contrato */ const t = new Date();`,
        // título de teste que só cita now() não conta como relógio real
        `it('compara com now() do banco', () => {}); const x = new Date('2026-11-01T15:00:00Z');`,
        // data civil sem nome de "agora" (cadastro de fixture)
        `const nascimento = '1990-05-01'; const t = Date.now();`,
      ],
      invalid: [
        {
          // o caso do pedido.db.test.ts: AGORA fixo × janela pelo relógio real
          code: `const AGORA = new Date('2026-11-01T15:00:00.000Z');\nconst ate = new Date(Date.now() + 3600000);`,
          errors: [
            { messageId: 'agoraFixo', data: { nome: 'AGORA', real: 'Date.now()', linha: '2' } },
            { messageId: 'relogioReal', data: { real: 'Date.now()', linha: '1' } },
          ],
        },
        {
          code: `const t0 = Date.parse('2026-11-01T15:00:00Z');\nawait c.query("select count(*) from x where criado_em < now()");`,
          errors: [{ messageId: 'sqlRelogio', data: { n: '1', linha: '1' } }],
        },
        {
          code: 'const x = new Date(Date.UTC(2026, 10, 1));\nawait c.query(`update x set y = now() where id = ${id}`);\nawait c.query("delete from x where z < now() - interval \'1 day\'");',
          errors: [{ messageId: 'sqlRelogio', data: { n: '2', linha: '1' } }],
        },
        {
          code: `const linha = { checkin_em: '2026-11-01T14:00:00Z' }; const agora = new Date(); const t = Date.now();`,
          errors: [{ messageId: 'relogioReal' }, { messageId: 'relogioReal' }],
        },
        {
          // data civil "HOJE" fixa conta como evidência e é acusada
          code: `const dataDeHoje = '2026-11-01'; const agoraReal = new Date();`,
          errors: [{ messageId: 'agoraFixo', data: { nome: 'dataDeHoje', real: 'new Date()', linha: '1' } }, { messageId: 'relogioReal' }],
        },
        {
          // relógio do Node fixado no arquivo: new Date() é o do teste, mas o now() do SQL continua real
          code: `vi.setSystemTime(new Date('2026-11-01T15:00:00Z')); const a = new Date(); await q('select now()');`,
          errors: [{ messageId: 'sqlRelogio', data: { n: '1', linha: '1' } }],
        },
        {
          code: `const hoje = new Date().toISOString().slice(0, 10); const mes = new Date().toISOString().substring(0, 7); const d = new Date(Date.now()).toISOString().split('T')[0];`,
          errors: [{ messageId: 'dataUtc' }, { messageId: 'dataUtc' }, { messageId: 'dataUtc' }],
        },
        {
          code: `// hora-fixa-ok:\nconst AGORA = new Date('2026-11-01T15:00:00Z'); const t = Date.now();`,
          errors: [{ messageId: 'semMotivo' }],
        },
      ],
    });
  });

  it('está ligada como AVISO nos arquivos de teste da raiz e não em código de produção', async () => {
    const eslint = new ESLint({ cwd: join(aqui, '..', '..') });
    const emTeste = (await eslint.calculateConfigForFile('modules/x/api/a.db.test.ts')) as { rules: Record<string, unknown> };
    expect(emTeste.rules['macuxi/hora-fixa-em-teste']).toEqual([1]);
    for (const f of ['tests/integracao/a.ts', 'db/testes/a.ts', 'apps/api/test/a.ts', 'packages/comum/src/a.test.ts']) {
      const c = (await eslint.calculateConfigForFile(f)) as { rules: Record<string, unknown> };
      expect(c.rules['macuxi/hora-fixa-em-teste'], f).toEqual([1]);
    }
    const producao = (await eslint.calculateConfigForFile('modules/x/api/a.ts')) as { rules: Record<string, unknown> };
    expect(producao.rules['macuxi/hora-fixa-em-teste']).toBeUndefined();
  });
});
