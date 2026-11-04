import { criarPermissoes, PERFIS, verificarAcao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

const permissoes = criarPermissoes([manifest]);
const quem = (acao: string) => PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, acao).ok);

describe('RN-CORE-26: ações do Início de boas-vindas no manifesto (T-0073)', () => {
  it('RN-CORE-26: inicio.ver é de vendedor, promotor, supervisor e gerente (analista, assistente e admin não têm Início)', () => {
    expect(quem('inicio.ver')).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente']);
  });
  it('RN-CORE-26: só supervisor e gerente marcam o recado do dia', () => {
    expect(quem('notificacao.recado_do_dia')).toEqual(['supervisor', 'gerente']);
  });
  it('RN-CORE-26: analista e admin editam os parâmetros do Início', () => {
    expect(quem('parametro.inicio')).toEqual(['analista', 'admin']);
  });
  it('RN-PRO-01: o manifesto do Core não ganha ação de pedido', () => {
    expect(Object.keys(manifest.acoes ?? {}).filter((a) => /^pedido/.test(a))).toEqual([]);
  });
});
