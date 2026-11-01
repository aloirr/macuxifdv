import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  corpoDoErroModulo,
  definirConsumidor,
  definirModuloApi,
  dependenciasDosManifestos,
  ehCaminhoDePedido,
  ErroHttpModulo,
  ErroNaoEncontrado,
  ErroRegraNegocio,
  promotorBarradoNaRota,
  retryAfterDoErroModulo,
  type RotaModulo,
} from './api';
import { definirEvento } from './eventos';
import { defineModule } from './manifesto';
import { definirEntidadeSync } from './sync';

const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'],
  sync: ['pedido', 'politica'],
  acoes: { 'pedido.criar': { perfis: ['vendedor', 'supervisor'] }, 'pedido.ver': { perfis: ['vendedor', 'promotor', 'supervisor'] } },
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

  it('RN-PRO-01 / O-3: ação de leitura de pedido só em GET', () => {
    expect(definirModuloApi({ manifesto: vendedor, rotas: [rota({ acao: 'pedido.ver' })] }).rotas).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: vendedor, rotas: [rota({ metodo: 'POST', acao: 'pedido.ver' })] })).toThrow(/só em GET/);
  });

  it('RN-PRO-01 / O-3: promotor barrado em escrita e caminho de pedido; GET com pedido.ver segue para o manifesto', () => {
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'pedidos', acao: 'pedido.ver' })).toBe(false);
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'pedidos/:id', acao: 'pedido.ver' })).toBe(false);
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'pedidos' })).toBe(true); // leitura sem ação: só por manifesto
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'pedidos', acao: 'cliente.ver' })).toBe(true);
    expect(promotorBarradoNaRota({ metodo: 'POST', caminho: 'pedidos', acao: 'pedido.ver' })).toBe(true);
    expect(promotorBarradoNaRota({ metodo: 'POST', caminho: 'pedidos', acao: 'pedido.criar' })).toBe(true);
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'relatorios', acao: 'pedido.aprovar' })).toBe(true);
    expect(promotorBarradoNaRota({ metodo: 'POST', caminho: 'gondolas', acao: 'gondola.registrar' })).toBe(false);
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

  it('ADR 0009 §2/§4: escopo do provedor só entre os quatro e só com puxar; schemaLinha só em entidade com pull', () => {
    const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.unknown(), schemaLinha: z.object({ id: z.string() }) });
    expect(definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: 'usuarios', puxar: async () => [] }] }).sync?.[0]?.escopo).toBe('usuarios');
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: 'equipe' as never, puxar: async () => [] }] })).toThrow(/escopo equipe inválido/);
    expect(definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: ['usuarios', 'carteira'], puxar: async () => [] }] }).sync).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: ['usuarios', 'equipe' as never], puxar: async () => [] }] })).toThrow(/escopo equipe inválido/);
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: [], puxar: async () => [] }] })).toThrow(/lista de escopo vazia/);
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: pedido, escopo: 'carteira', receber: async () => [] }] })).toThrow(/escopo só vale para provedor com puxar/);
    const soEnvio = definirEntidadeSync({ nome: 'politica', modulo: 'vendedor', direcao: 'push', conflito: 'somente_insercao', schema: z.unknown(), schemaLinha: z.unknown() });
    expect(() => definirModuloApi({ manifesto: vendedor, sync: [{ entidade: soEnvio, receber: async () => [] }] })).toThrow(/schemaLinha só vale/);
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

  it('ErroHttpModulo: status de módulo (401/423/503…) com corpo ErroApi; 422 e 404 são casos dele', () => {
    const e = new ErroHttpModulo(423, 'USUARIO_BLOQUEADO', 'Acesso bloqueado.');
    expect(e).toMatchObject({ status: 423, codigo: 'USUARIO_BLOQUEADO', message: 'Acesso bloqueado.' });
    expect(corpoDoErroModulo(e)).toEqual({ codigo: 'USUARIO_BLOQUEADO', mensagem: 'Acesso bloqueado.' });
    expect(corpoDoErroModulo(new ErroRegraNegocio('RN-VEN-03', 'x', { limite: 10 }))).toEqual({ codigo: 'RN-VEN-03', mensagem: 'x', detalhes: { limite: 10 } });
    expect(new ErroRegraNegocio('RN-VEN-03', 'x')).toBeInstanceOf(ErroHttpModulo);
    expect(new ErroNaoEncontrado('X', 'x')).toBeInstanceOf(ErroHttpModulo);
    // 400/500 são da plataforma: o módulo não usa
    expect(() => new ErroHttpModulo(500 as never, 'X', 'x')).toThrow(/não é de módulo/);
    expect(() => new ErroHttpModulo(400 as never, 'X', 'x')).toThrow(/não é de módulo/);
  });

  it('ErroHttpModulo 429 (limite próprio do módulo, T-0026): retry-after só com retry_after_s inteiro > 0', () => {
    const e = new ErroHttpModulo(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas.', { retry_after_s: 120 });
    expect(e.status).toBe(429);
    expect(retryAfterDoErroModulo(e)).toBe(120);
    expect(retryAfterDoErroModulo(new ErroHttpModulo(429, 'X', 'x'))).toBeNull();
    expect(retryAfterDoErroModulo(new ErroHttpModulo(429, 'X', 'x', { retry_after_s: 1.5 }))).toBeNull();
    expect(retryAfterDoErroModulo(new ErroHttpModulo(429, 'X', 'x', { retry_after_s: '60' }))).toBeNull();
    expect(retryAfterDoErroModulo(new ErroHttpModulo(423, 'X', 'x', { retry_after_s: 60 }))).toBeNull();
  });

  it('RN-CORE-03: dependenciasDosManifestos devolve o "depende" de cada módulo instalado', () => {
    const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'] });
    const d = dependenciasDosManifestos([core, vendedor]);
    expect(d).toEqual({ core: [], vendedor: ['core'] });
    expect(Object.isFrozen(d)).toBe(true);
  });
});

describe('definirModuloApi — consumidores de evento (ADR 0007; T-0022)', () => {
  const checkin = definirEvento('core.visita.checkin@1', z.object({ visita_id: z.string().uuid() }));
  const consumidor = defineModule({
    id: 'promotor',
    versao: '1.0.0',
    depende: ['core'],
    perfis: ['promotor'],
    consome: ['core.visita.checkin@1'],
  });

  it('aceita consumidor de evento declarado em "consome" (o payload tipado sai do schema)', () => {
    const api = definirModuloApi({
      manifesto: consumidor,
      consumidores: [definirConsumidor({ evento: checkin, executar: async (p) => void p.visita_id })],
    });
    expect(api.consumidores?.map((c) => c.evento.nome)).toEqual(['core.visita.checkin@1']);
  });

  it('recusa evento fora de "consome" e consumidor repetido', () => {
    const outro = definirEvento('core.visita.checkout@1', z.object({}));
    expect(() => definirModuloApi({ manifesto: consumidor, consumidores: [definirConsumidor({ evento: outro, executar: async () => undefined })] })).toThrow(
      /não está em "consome"/,
    );
    const c = definirConsumidor({ evento: checkin, executar: async () => undefined });
    expect(() => definirModuloApi({ manifesto: consumidor, consumidores: [c, c] })).toThrow(/repetido/);
  });
});
