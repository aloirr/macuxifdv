/** T-0176, RN-CORE-39 (ADR 0056): decisão da guarda do usuário sem filial de cadastro e quem pode declarar exceção. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definirModuloApi, type ProvedorSync, type RotaModulo } from './api';
import { defineModule } from './manifesto';
import { acessoSemFilial, problemasLiberadoSemFilial } from './sem-filial';
import { definirEntidadeSync } from './sync';

const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin', 'vendedor'], sync: ['usuario'] });
const catalogo = defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'vendedor'], sync: ['produto_preco'] });

describe('RN-CORE-39: acessoSemFilial', () => {
  it('com filial (ou estado não informado) é livre, liberada ou não', () => {
    expect(acessoSemFilial({ sem_filial: false }, false)).toBe('livre');
    expect(acessoSemFilial({}, false)).toBe('livre');
    expect(acessoSemFilial({ sem_filial: false }, true)).toBe('livre');
  });
  it('sem filial: bloqueado nas entradas comuns, restrito nas liberadas', () => {
    expect(acessoSemFilial({ sem_filial: true }, false)).toBe('bloqueado');
    expect(acessoSemFilial({ sem_filial: true }, true)).toBe('restrito');
  });
});

describe('RN-CORE-39: só o core declara exceção', () => {
  it('problemasLiberadoSemFilial', () => {
    expect(problemasLiberadoSemFilial('core', 'GET /v1/core/x', true)).toEqual([]);
    expect(problemasLiberadoSemFilial('catalogo', 'GET /v1/catalogo/x', undefined)).toEqual([]);
    expect(problemasLiberadoSemFilial('catalogo', 'GET /v1/catalogo/x', true)[0]).toMatch(/só o core/);
  });

  it('definirModuloApi recusa rota liberada fora do core e aceita no core', () => {
    const rota = { metodo: 'GET', caminho: 'eu/teste', carteira: 'nao_se_aplica', liberadaSemFilial: true, executar: async () => ({}) } as RotaModulo;
    expect(() => definirModuloApi({ manifesto: catalogo, rotas: [rota] })).toThrow(/só o core libera/);
    expect(() => definirModuloApi({ manifesto: core, rotas: [rota] })).not.toThrow();
  });

  it('definirModuloApi recusa provedor liberado fora do core ou sem puxar', () => {
    const deCatalogo: ProvedorSync = {
      entidade: definirEntidadeSync({ nome: 'produto_preco', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }),
      puxar: async () => [],
      liberadoSemFilial: true,
    };
    expect(() => definirModuloApi({ manifesto: catalogo, sync: [deCatalogo] })).toThrow(/só o core libera/);
    const usuario: ProvedorSync = {
      entidade: definirEntidadeSync({ nome: 'usuario', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) }),
      puxar: async () => [],
      escopo: 'usuarios',
      liberadoSemFilial: true,
    };
    expect(() => definirModuloApi({ manifesto: core, sync: [usuario] })).not.toThrow();
    const soPush: ProvedorSync = {
      entidade: definirEntidadeSync({ nome: 'usuario', modulo: 'core', direcao: 'push', conflito: 'servidor_vence', schema: z.object({}) }),
      receber: async () => [],
      liberadoSemFilial: true,
    };
    expect(() => definirModuloApi({ manifesto: core, sync: [soPush] })).toThrow(/só vale para provedor com puxar/);
  });
});
