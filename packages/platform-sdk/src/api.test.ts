import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { definirModuloApi, ehCaminhoDePedido, ErroNaoEncontrado, ErroRegraNegocio, type RotaModulo } from './api';
import { defineModule } from './manifesto';
import { definirEntidadeSync } from './sync';

const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'],
  sync: ['pedido', 'politica'],
  acoes: { 'pedido.criar': { perfis: ['vendedor', 'supervisor'] } },
});

const ok = async () => ({});
const rota = (r: Partial<RotaModulo>): RotaModulo => ({ metodo: 'GET', caminho: 'pedidos', carteira: 'filtrar_no_dominio', executar: ok, ...r });

describe('definirModuloApi (desenho T-0004 §3)', () => {
  it('aceita rotas declaradas com ação do manifesto e escopo de carteira', () => {
    const api = definirModuloApi({
      manifesto: vendedor,
      rotas: [
        rota({ perfis: ['vendedor', 'supervisor'] }),
        rota({ metodo: 'POST', acao: 'pedido.criar', carteira: (e) => (e.corpo as { cliente_id: string }).cliente_id, corpo: z.object({ cliente_id: z.string() }) }),
        rota({ caminho: 'pedidos/:id' }),
      ],
    });
    expect(api.rotas).toHaveLength(3);
  });

  it('ADR 0004: rota de escrita sem ação é recusada', () => {
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ metodo: 'POST' })] })).toThrow(/precisa de "acao"/);
  });

  it('ação precisa estar no manifesto do próprio módulo', () => {
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ metodo: 'POST', acao: 'rota.editar' })] })).toThrow(/não está em "acoes"/);
  });

  it('RN-PRO-01: rota de pedido que aceita promotor é recusada na definição', () => {
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ perfis: ['vendedor', 'promotor'] })] })).toThrow(/RN-PRO-01/);
  });

  it('caminho com barra inicial ou repetido é recusado', () => {
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ caminho: '/pedidos' })] })).toThrow(/caminho inválido/);
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ caminho: 'pedidos/:id' }), rota({ caminho: 'pedidos/:pedidoId' })] })).toThrow(/repetida/);
  });

  it('RN-CORE-04: rota sem escopo de carteira é recusada', () => {
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ carteira: undefined as never })] })).toThrow(/escopo de carteira/);
  });

  it('provedor de sync só serve entidade do próprio manifesto e na direção certa', () => {
    const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.unknown() });
    const politica = definirEntidadeSync({ nome: 'politica', modulo: 'vendedor', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });
    expect(definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, puxar: async () => [], receber: async () => [] }] }).sync).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: politica, receber: async () => [] }] })).toThrow(/não recebe push/);
    const alheia = definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.unknown() });
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: alheia, puxar: async () => [] }] })).toThrow(/servida por vendedor/);
  });

  it('reconhece caminhos de pedido', () => {
    expect(ehCaminhoDePedido('pedidos')).toBe(true);
    expect(ehCaminhoDePedido('clientes/:id/pedidos')).toBe(true);
    expect(ehCaminhoDePedido('pedido_item/:id')).toBe(true);
    expect(ehCaminhoDePedido('pedidos-sugeridos')).toBe(true);
    expect(ehCaminhoDePedido('gondolas')).toBe(false);
  });

  it('T-0002 §6 item 4: rota pública só no core e sempre com limite de tentativas', () => {
    const publica = { metodo: 'POST' as const, caminho: 'auth/login', limite: { max: 5, janelaMs: 60_000 }, executar: ok };
    expect(() => definirModuloApi({ manifesto: vendedor, rotasPublicas: [publica] })).toThrow(/só o core/);
    const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'] });
    expect(definirModuloApi({ manifesto: core, rotasPublicas: [publica] }).rotasPublicas).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [{ ...publica, limite: { max: 0, janelaMs: 1 } }] })).toThrow(/limite de tentativas/);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [{ ...publica, caminho: 'sync/pull' }] })).toThrow(/reservado/);
  });

  it('ErroRegraNegocio carrega o código da RN e status 422', () => {
    const e = new ErroRegraNegocio('RN-VEN-03', 'Desconto acima da alçada');
    expect(e).toMatchObject({ status: 422, codigo: 'RN-VEN-03', message: 'Desconto acima da alçada' });
    expect(new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.')).toMatchObject({ status: 404, codigo: 'PEDIDO_NAO_ENCONTRADO' });
  });
});
