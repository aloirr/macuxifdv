/**
 * `catalogo.sugestoes_pedido@1` no aparelho (T-0071 §4.2): motor com armazenamento em memória, lendo só as linhas
 * locais do Catálogo. Cenário da base demo: café com açúcar/filtro/leite e água com a versão superior.
 */
import { ambienteIndisponivel, criarArmazenamentoEmMemoria, criarMotorSync, criarShell, defineModule, definirEntidadeSync, definirModuloShell, type AmbienteAparelho } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ClienteSyncSchema, FilialSyncSchema } from '@macuxi/core/contracts';
import { CONSULTA_SUGESTOES_PEDIDO, ENTIDADES_CONTEUDO, ENTIDADES_PRECO, entidadeProdutoRelacao } from '../contracts';
import { manifest } from '../manifest';
import { consultaSugestoesPedidoAparelho } from './sugestoes';

const moduloApp = definirModuloShell({ manifesto: manifest, entidadesSync: [...ENTIDADES_PRECO, ...ENTIDADES_CONTEUDO, entidadeProdutoRelacao], consultas: [consultaSugestoesPedidoAparelho] });

const id = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TAB = id(2);
const C1 = id(101);
const [CAFE, AGUA, ACUCAR, FILTRO, LEITE, SEM_PRECO, SEM_ESTOQUE, AGUA15] = [11, 12, 13, 14, 15, 16, 17, 18].map(id) as [string, string, string, string, string, string, string, string];
const AGORA = new Date('2026-11-03T12:00:00.000Z');
const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const item = (k: string, produto_id: string, preco_cents: number) => ({ [k]: { id: k, ...base, tabela_preco_id: TAB, produto_id, preco_cents, vigencia_inicio: null, vigencia_fim: null } });
const rel = (k: string, produto_id: string, relacionado_id: string, tipo: string, ordem: number) => ({ [k]: { id: k, ...base, produto_id, relacionado_id, tipo, ordem, ativo: true } });
const saldo = (k: string, produto_id: string, quantidade: number) => ({ [k]: { id: k, ...base, produto_id, deposito_id: id(900), quantidade, atualizado_em: null } });

const linhas = {
  'ent:tabela_preco': { [TAB]: { id: TAB, ...base, codigo: 'ATACADO', nome: 'Atacado', ativo: true } },
  'ent:cliente_tabela_preco': { v1: { id: 'v1', ...base, cliente_id: C1, tabela_preco_id: TAB } },
  'ent:tabela_preco_item': {
    ...item('i1', ACUCAR, 499),
    ...item('i2', FILTRO, 549),
    ...item('i3', LEITE, 1690),
    ...item('i4', SEM_ESTOQUE, 100),
    ...item('i5', AGUA15, 1990),
    // CX do açúcar com preço próprio: não pode virar o preço da UN
    i6: { id: 'i6', ...base, tabela_preco_id: TAB, produto_id: ACUCAR, preco_cents: 1, vigencia_inicio: null, vigencia_fim: null, unidade: 'CX' },
  },
  'ent:estoque_saldo': { ...saldo('s1', ACUCAR, 40), ...saldo('s2', FILTRO, 5), ...saldo('s3', LEITE, 12), ...saldo('s4', SEM_PRECO, 9), ...saldo('s5', SEM_ESTOQUE, 0), ...saldo('s6', AGUA15, 3) },
  'ent:produto_relacao': {
    ...rel('r1', CAFE, LEITE, 'complementar', 3),
    ...rel('r2', CAFE, ACUCAR, 'complementar', 1),
    ...rel('r3', CAFE, FILTRO, 'complementar', 2),
    ...rel('r4', CAFE, SEM_PRECO, 'complementar', 4),
    ...rel('r5', CAFE, SEM_ESTOQUE, 'complementar', 5),
    ...rel('r6', AGUA, AGUA15, 'superior', 1),
  },
};

// entidades do Core que o Catálogo lê no aparelho (RN-CORE-39: filial do cliente e filiais)
const entidadesCore = [
  definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteSyncSchema }),
  definirEntidadeSync({ nome: 'filial', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: FilialSyncSchema }),
];
const mCore = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'promotor'], apps: { campo: { abas: [] } }, ofereceConsultas: ['core.cadastro_resumo@1', 'core.filiais@1', 'core.filiais_do_usuario@1'], sync: ['cliente', 'filial'] });
const mConsumidor = defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core', 'catalogo'], perfis: ['vendedor'], apps: { campo: { abas: ['Pedidos'] } }, usaConsultas: ['catalogo.sugestoes_pedido@1'] });

async function motorDo(perfil: 'vendedor' | 'promotor' | null, parametros: Record<string, unknown> = {}) {
  const shell = criarShell('campo', [definirModuloShell({ manifesto: mCore, entidadesSync: entidadesCore }), moduloApp, definirModuloShell({ manifesto: mConsumidor })]);
  const ambiente: AmbienteAparelho = { ...ambienteIndisponivel(), usuario: () => (perfil ? { id: id(990), nome: 'Teste', perfil } : null) };
  const motor = criarMotorSync({
    registro: shell.registroSync,
    armazenamento: criarArmazenamentoEmMemoria(linhas as never),
    transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
    consultas: shell.consultas,
    ambiente,
    agora: () => AGORA,
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor'], { catalogo: parametros });
  return motor;
}

const consultar = async (motor: Awaited<ReturnType<typeof motorDo>>, produtos: string[], cliente = C1) =>
  motor.ambiente.consultar(CONSULTA_SUGESTOES_PEDIDO, { cliente_id: cliente, produto_ids: produtos, em: AGORA.toISOString() });

describe('Catálogo no aparelho: catalogo.sugestoes_pedido@1', () => {
  it('o manifesto oferece a consulta e sincroniza produto_relacao', () => {
    expect(manifest.ofereceConsultas).toContain('catalogo.sugestoes_pedido@1');
    expect(manifest.sync).toContain('produto_relacao');
  });

  it('RF-CAT-03: complementares na ordem da relação, sem preço e sem estoque fora; superior da água; preço da UN', async () => {
    const r = await consultar(await motorDo('vendedor'), [CAFE, AGUA]);
    expect(r.complementares.map((s) => [s.produto_id, s.preco_cents, s.origem_produto_id])).toEqual([
      [ACUCAR, 499, CAFE],
      [FILTRO, 549, CAFE],
      [LEITE, 1690, CAFE],
    ]);
    expect(r.superiores).toEqual([{ produto_id: AGUA15, tipo: 'superior', origem_produto_id: AGUA, preco_cents: 1990 }]);
  });

  it('RF-CAT-03: o que já está no pedido não é sugerido', async () => {
    const r = await consultar(await motorDo('vendedor'), [CAFE, ACUCAR]);
    expect(r.complementares.map((s) => s.produto_id)).toEqual([FILTRO, LEITE]);
  });

  it('RN-CAT-06: cliente sem tabela não recebe sugestões', async () => {
    expect(await consultar(await motorDo('vendedor'), [CAFE], id(103))).toEqual({ complementares: [], superiores: [] });
  });

  it('RN-CAT-05: promotor recebe saída vazia; com o parâmetro ligado recebe; sem usuário, vazia', async () => {
    expect(await consultar(await motorDo('promotor'), [CAFE])).toEqual({ complementares: [], superiores: [] });
    expect((await consultar(await motorDo('promotor', { promotor_ve_preco_estoque: true }), [CAFE])).complementares).toHaveLength(3);
    expect(await consultar(await motorDo(null), [CAFE])).toEqual({ complementares: [], superiores: [] });
  });
});
