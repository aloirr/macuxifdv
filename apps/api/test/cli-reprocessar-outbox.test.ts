/**
 * CLI `reprocessar-outbox` (workflow producao-reprocessar-outbox.yml). Banco FALSO: argumentos, códigos de saída, o
 * `--confirmar` repassado e a saída só com contagens, ids técnicos, nomes de evento e classes. O caminho no banco está em
 * reprocessar-outbox.banco.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { executarReprocessarOutbox, formatarResultado, type BancoReprocesso } from '../src/cli/reprocessar-outbox';
import { ErroTetoReprocesso, type ResultadoReprocesso } from '../src/reprocessar-outbox';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NO = 'integracao.catalogo_no.atualizado@1';
const PRODUTO = 'integracao.produto.atualizado@1';
const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

const selecionados = [
  { evento_id: ID1, nome: NO, classe: 'catalogo: SQLSTATE 23505, catalogo_no_codigo_uk' },
  { evento_id: ID2, nome: PRODUTO, classe: 'catalogo: ReferenciaAusenteErp' },
];

function rodar(argv: string[], r: ResultadoReprocesso | Error, tenant: string | null = TENANT) {
  const saida: string[] = [];
  const erro: string[] = [];
  const pedidos: { tenantId: string; confirmar: boolean }[] = [];
  let fechado = false;
  const banco: BancoReprocesso = {
    tenantPorCodigo: async () => tenant,
    reprocessar: async (o) => {
      pedidos.push(o);
      if (r instanceof Error) throw r;
      return r;
    },
    fechar: async () => void (fechado = true),
  };
  return executarReprocessarOutbox(argv, { abrirBanco: async () => banco, saida: (l) => saida.push(l), erro: (l) => erro.push(l) }).then((codigo) => ({ codigo, saida, erro, pedidos, fechado: () => fechado }));
}

describe('reprocessar-outbox (CLI)', () => {
  it('sem --confirmar: só leitura, com a contagem por evento e classe', async () => {
    const r = await rodar(['--empresa', 'AM2808'], { modo: 'leitura', maxTentativas: 10, selecionados, ja_tentados: 0, itens: [] });
    expect(r.codigo).toBe(0);
    expect(r.pedidos).toEqual([{ tenantId: TENANT, confirmar: false }]);
    expect(r.saida.join('\n')).toContain('só leitura (confirmar=false): nada mudou');
    expect(r.saida).toContain('  1 | integracao.catalogo_no.atualizado@1 | catalogo: SQLSTATE 23505, catalogo_no_codigo_uk');
    expect(r.fechado()).toBe(true);
  });

  it('com --confirmar: mostra quantos publicaram e quantos pararam de novo, com a classe', async () => {
    const r = await rodar(['--empresa', 'AM2808', '--confirmar'], {
      modo: 'reprocessado',
      maxTentativas: 10,
      selecionados,
      ja_tentados: 1,
      itens: [
        { evento_id: ID1, nome: NO, classe_antes: selecionados[0]!.classe, resultado: 'publicado', classe_depois: null },
        { evento_id: ID2, nome: PRODUTO, classe_antes: selecionados[1]!.classe, resultado: 'parado_de_novo', classe_depois: 'catalogo: ReferenciaAusenteErp' },
      ],
    });
    expect(r.codigo).toBe(0);
    expect(r.pedidos).toEqual([{ tenantId: TENANT, confirmar: true }]);
    const texto = r.saida.join('\n');
    expect(texto).toContain('resultado: 1 publicados · 1 pararam de novo (não serão tentados outra vez)');
    expect(texto).toContain('já reprocessados antes e parados de novo (fora): 1');
    expect(texto).toContain(`  ${ID2} | ${PRODUTO} | parado_de_novo | catalogo: ReferenciaAusenteErp`);
  });

  it('uso errado = 2 e não abre o banco para código inválido; empresa não encontrada = 3', async () => {
    for (const argv of [[], ['--empresa', "AM2808'; drop"], ['--empresa', 'AM2808', '--outro']]) {
      expect((await rodar(argv, new Error('não chama'))).codigo).toBe(2);
    }
    const r = await rodar(['--empresa', 'AM9999'], new Error('não chama'), null);
    expect(r.codigo).toBe(3);
    expect(r.pedidos).toEqual([]);
  });

  it('acima do teto = 5 (nada mudou); erro do banco = 1 só com o nome do erro', async () => {
    expect((await rodar(['--empresa', 'AM2808', '--confirmar'], new ErroTetoReprocesso(150))).codigo).toBe(5);
    const r = await rodar(['--empresa', 'AM2808'], new Error('valor "Maria" viola a chave'));
    expect(r.codigo).toBe(1);
    expect(r.erro.join('\n')).not.toContain('Maria');
  });

  it('a saída nunca traz payload nem mensagem do erro', () => {
    const linhas = formatarResultado('AM2808', { modo: 'leitura', maxTentativas: 10, selecionados, ja_tentados: 0, itens: [] });
    expect(linhas.join('\n')).not.toMatch(/registro\(s\)|KIT|external_id/);
  });
});
