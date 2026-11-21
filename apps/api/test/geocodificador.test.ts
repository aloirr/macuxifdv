/**
 * T-0191 (RN-CORE-77): `ctx.geocodificador` nas rotas de módulo — desligado por padrão (503) e a porta injetada (fábrica com o
 * log do app) chega à rota, a mesma instância em todas as requisições (a fila de 1 req/s e o cache são do processo).
 */
import { definirModuloApi, GEOCODIFICADOR_DESLIGADO, type Geocodificador, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, vendedorApi } from './apoio';

const ENDERECO = { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69005010' };

describe('ctx.geocodificador nas rotas de módulo', () => {
  const vistos = new Set<Geocodificador>();
  const rota: RotaModulo = {
    metodo: 'POST',
    caminho: 'localizar-teste',
    acao: 'pedido.criar',
    carteira: 'nao_se_aplica',
    executar: async (ctx) => {
      vistos.add(ctx.geocodificador!);
      return { coordenada: await ctx.geocodificador!.localizar(ENDERECO) };
    },
  };
  const modulos = () => modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota] }) });

  it('padrão desligado: 503 GEOCODIFICADOR_INDISPONIVEL', async () => {
    const r = await createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulos() })).inject({ method: 'POST', url: '/v1/vendedor/localizar-teste', headers: cab('vendedor') });
    expect(r.statusCode).toBe(503);
    expect(r.json().codigo).toBe('GEOCODIFICADOR_INDISPONIVEL');
  });

  it('a porta injetada chega à rota (fábrica com o log do app), a mesma em todas as requisições', async () => {
    vistos.clear();
    let fabricas = 0;
    const falso: Geocodificador = { disponivel: () => true, localizar: async () => ({ lat: -3.1, lng: -60, precisao: 'rua' }) };
    const app = createApp(
      opcoesDeTeste(LICENCAS_PADRAO, {
        geocodificador: (log) => {
          fabricas++;
          return log ? falso : GEOCODIFICADOR_DESLIGADO;
        },
        modulos: modulos(),
      }),
    );
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/vendedor/localizar-teste', headers: cab('vendedor') });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ coordenada: { lat: -3.1, lng: -60, precisao: 'rua' } });
    }
    expect(fabricas).toBe(1);
    expect([...vistos]).toEqual([falso]);
  });
});
