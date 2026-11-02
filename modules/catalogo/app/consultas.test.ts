/**
 * `catalogo.precos_cliente@1` no aparelho: criarShell + motor com armazenamento em memória (adaptador de teste do SDK),
 * lendo as linhas locais de pull. Mesmos casos da API (api/precos.db.test.ts): o resultado tem de ser igual.
 */
import { ambienteIndisponivel, criarArmazenamentoEmMemoria, criarMotorSync, criarShell, defineModule, definirModuloShell, type AmbienteAparelho } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_PRECOS_CLIENTE, ENTIDADES_PRECO } from '../contracts';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';

/** A parte do `moduloApp` que a consulta usa (o índice importa as telas React Native, que não rodam no Node). */
const moduloApp = definirModuloShell({ manifesto: manifest, entidadesSync: ENTIDADES_PRECO, consultas: [consultaPrecosClienteAparelho] });

const id = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TAB_ATACADO = id(2);
const TAB_INATIVA = id(3);
const C1 = id(101);
const C2 = id(102);
const C3 = id(103);
const P_COM = id(11);
const P_FORA = id(12);
const P_VIGENCIA = id(13);
const AGORA = new Date('2026-11-01T12:00:00.000Z');
const iso = (dias: number) => new Date(AGORA.getTime() + dias * 86_400_000).toISOString();
const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };

const linhas = {
  'ent:tabela_preco': {
    [TAB_ATACADO]: { id: TAB_ATACADO, ...base, codigo: 'ATACADO', nome: 'Atacado', ativo: true },
    [TAB_INATIVA]: { id: TAB_INATIVA, ...base, codigo: 'INATIVA', nome: 'Inativa', ativo: false },
  },
  'ent:tabela_preco_item': {
    a: { id: 'a', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_COM, preco_cents: 930, vigencia_inicio: null, vigencia_fim: null },
    b: { id: 'b', ...base, tabela_preco_id: id(1), produto_id: P_FORA, preco_cents: 500, vigencia_inicio: null, vigencia_fim: null },
    c: { id: 'c', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_VIGENCIA, preco_cents: 800, vigencia_inicio: null, vigencia_fim: iso(-10) },
    d: { id: 'd', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_VIGENCIA, preco_cents: 900, vigencia_inicio: iso(-10), vigencia_fim: null },
  },
  'ent:cliente_tabela_preco': {
    v1: { id: 'v1', ...base, cliente_id: C1, tabela_preco_id: TAB_ATACADO },
    v2: { id: 'v2', ...base, cliente_id: C2, tabela_preco_id: TAB_INATIVA },
  },
};

// o Core oferece core.cadastro_resumo@1 (o Catálogo usa na API desde a T-0052; o shell confere o conjunto)
const mCore = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'promotor'], apps: { campo: { abas: [] } }, ofereceConsultas: ['core.cadastro_resumo@1'] });
// consumidor mínimo (o Vendedor real declara o mesmo em usaConsultas)
const mConsumidor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core', 'catalogo'],
  perfis: ['vendedor'],
  apps: { campo: { abas: ['Pedidos'] } },
  usaConsultas: ['catalogo.precos_cliente@1'],
});

async function motorDo(perfil: 'vendedor' | 'promotor' | null, parametros: Record<string, unknown> = {}) {
  const shell = criarShell('campo', [definirModuloShell({ manifesto: mCore }), moduloApp, definirModuloShell({ manifesto: mConsumidor })]);
  const ambiente: AmbienteAparelho = { ...ambienteIndisponivel(), usuario: () => (perfil ? { id: id(900), nome: 'Teste', perfil } : null) };
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

const consultar = async (motor: Awaited<ReturnType<typeof motorDo>>, produtos: string[], cliente = C1, em = AGORA.toISOString()) =>
  motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente, produto_ids: produtos, em });

describe('Catálogo no aparelho: catalogo.precos_cliente@1', () => {
  it('o manifesto oferece a consulta e sincroniza o vínculo cliente × tabela', () => {
    expect(manifest.ofereceConsultas).toContain('catalogo.precos_cliente@1');
    expect(manifest.sync).toContain('cliente_tabela_preco');
  });

  it('RN-CAT-06: preço vem da tabela do cliente, offline', async () => {
    const r = await consultar(await motorDo('vendedor'), [P_COM]);
    expect(r).toEqual({ tabela_preco_id: TAB_ATACADO, itens: [{ produto_id: P_COM, preco_cents: 930, motivo_sem_preco: null }] });
  });

  it('RN-CAT-06: produto fora da tabela do cliente = sem preço (não cai na outra tabela)', async () => {
    const r = await consultar(await motorDo('vendedor'), [P_COM, P_FORA]);
    expect(r.itens[1]).toEqual({ produto_id: P_FORA, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
  });

  it('RN-CAT-06: cliente sem tabela, ou com tabela inativa, fica sem preço', async () => {
    const motor = await motorDo('vendedor');
    for (const cliente of [C3, C2]) {
      expect(await consultar(motor, [P_COM], cliente)).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' }] });
    }
  });

  it('RN-CAT-05: promotor não recebe preço; com o parâmetro ligado recebe; sem usuário, falha fechada', async () => {
    expect(await consultar(await motorDo('promotor'), [P_COM])).toEqual({
      tabela_preco_id: null,
      itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Preço não disponível para o seu perfil.' }],
    });
    expect((await consultar(await motorDo('promotor', { promotor_ve_preco_estoque: true }), [P_COM])).itens[0]!.preco_cents).toBe(930);
    expect((await consultar(await motorDo(null), [P_COM])).itens[0]!.preco_cents).toBeNull();
  });

  it('P-4: preço pela data informada, até 7 dias para trás e nunca no futuro', async () => {
    const motor = await motorDo('vendedor');
    expect((await consultar(motor, [P_VIGENCIA], C1, iso(-10))).itens[0]!.preco_cents).toBe(900);
    expect((await consultar(motor, [P_VIGENCIA], C1, iso(-8))).itens[0]!.preco_cents).toBe(900);
    expect((await consultar(motor, [P_VIGENCIA], C1, iso(5))).itens[0]!.preco_cents).toBe(900);
  });

  it('ADR 0012: mais de 500 produtos é recusado pelo contrato', async () => {
    const motor = await motorDo('vendedor');
    await expect(consultar(motor, Array.from({ length: 501 }, (_, i) => id(1000 + i)))).rejects.toThrow('entrada inválida');
  });
});
