/** `vendedor.preco_prazo_padrao@1` no aparelho: criarShell + motor com armazenamento em memória, lendo as linhas locais do pull. */
import { ambienteIndisponivel, criarArmazenamentoEmMemoria, criarMotorSync, criarShell, defineModule, definirEntidadeSync, definirModuloShell, type AmbienteAparelho } from '@macuxi/platform-sdk';
import { ClienteSyncSchema } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';
import { CONSULTA_PRECO_PRAZO_PADRAO } from '../contracts';
import { ENTIDADES_VENDEDOR } from '../contracts/entidades';
import { manifest } from '../manifest';
import { consultaPrecoPrazoPadraoAparelho } from './consulta-preco-prazo-padrao';

const id = (n: number) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const C1 = id(1);
const C_FORA = id(2);

const prazo = (pct: number) => ({ id: id(20), ...base, forma_pagamento_id: id(10), codigo: 'P1', descricao: '28 dias', parcelas_dias: [28], prazo_medio_dias: 28, ativo: true, ordem: 1, percentual_ajuste: pct });
const linhasCom = (pct: number | null) => ({
  'ent:cliente': { [C1]: { id: C1, ...base, nome: 'Cliente' } },
  'ent:forma_pagamento': { [id(10)]: { id: id(10), ...base, codigo: 'BOL', nome: 'Boleto', ativo: true, ordem: 1 } },
  'ent:prazo_pagamento': pct === null ? {} : { [id(20)]: prazo(pct) },
});

// o Vendedor depende do Core e do Catálogo e usa consultas deles: os dois entram só como donos dessas consultas
const mCore = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], apps: { campo: { abas: [] } }, ofereceConsultas: ['core.cadastro_resumo@1', 'core.filiais@1', 'core.promotor_ve_pedidos@1', 'core.financeiro_cliente@1'], sync: ['cliente'] });
const mCatalogo = defineModule({
  id: 'catalogo',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor'],
  apps: { campo: { abas: [] } },
  ofereceConsultas: ['catalogo.precos_cliente@1', 'catalogo.textos_produto@1', 'catalogo.busca_produtos@1', 'catalogo.veiculos@1', 'catalogo.sugestoes_pedido@1', 'catalogo.foto_produto@1', 'catalogo.estoque_filial@1'],
  // o Catálogo é quem consome a consulta (PR #503)
  usaConsultasOpcionais: ['vendedor.preco_prazo_padrao@1'],
});
const entCliente = definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteSyncSchema });
const moduloApp = definirModuloShell({ manifesto: manifest, entidadesSync: ENTIDADES_VENDEDOR, consultas: [consultaPrecoPrazoPadraoAparelho] });

async function motorDo(pct: number | null) {
  const shell = criarShell('campo', [definirModuloShell({ manifesto: mCore, entidadesSync: [entCliente] }), moduloApp, definirModuloShell({ manifesto: mCatalogo })]);
  const ambiente: AmbienteAparelho = { ...ambienteIndisponivel(), usuario: () => ({ id: id(900), nome: 'Teste', perfil: 'vendedor' }) };
  const motor = criarMotorSync({
    registro: shell.registroSync,
    armazenamento: criarArmazenamentoEmMemoria(linhasCom(pct) as never),
    transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
    consultas: shell.consultas,
    ambiente,
    agora: () => new Date('2026-11-01T12:00:00.000Z'),
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor'], {});
  return motor;
}
const consultar = (m: Awaited<ReturnType<typeof motorDo>>, cliente: string, cents: number[]) => m.ambiente.consultar(CONSULTA_PRECO_PRAZO_PADRAO, { cliente_id: cliente, cents });

describe('Vendedor no aparelho: vendedor.preco_prazo_padrao@1', () => {
  it('RN-VEN-43: o manifesto oferece a consulta', () => {
    expect(manifest.ofereceConsultas).toContain('vendedor.preco_prazo_padrao@1');
  });
  it('RN-VEN-43: offline, ajusta pelo prazo padrão (-1,71% e +2,5%), mesmo tamanho e ordem', async () => {
    expect(await consultar(await motorDo(-1.71), C1, [1000, 0, 333])).toEqual({ cents: [983, 0, 327] });
    expect(await consultar(await motorDo(2.5), C1, [1000, 0, 333])).toEqual({ cents: [1025, 0, 341] });
  });
  it('RN-VEN-43: sem prazo padrão ou cliente fora do aparelho, valores iguais', async () => {
    expect(await consultar(await motorDo(null), C1, [1000, 50])).toEqual({ cents: [1000, 50] });
    expect(await consultar(await motorDo(5), C_FORA, [1000, 50])).toEqual({ cents: [1000, 50] });
  });
});
