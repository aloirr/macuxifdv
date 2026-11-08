/**
 * T-0094 fatia T — multiperfil (RN-CORE-35; ADR 0033 §6; RN-CORE-33; RN-PRO-01) com os MANIFESTOS REAIS dos 8 módulos e o motor
 * de permissões do SDK (`matrizDeFabrica`, `resolverPerfil`, `combinarPerfis`, `pode`, `podeEntrar`, `criarPermissoes`,
 * `verificarAcao`). Sem banco: roda no PC.
 *
 * RN-CORE-35: nas AÇÕES vale a união dos perfis; nos ACESSOS (BKO, portal) vale a regra mais restritiva (basta um perfil de base
 * vendedor, promotor ou supervisor para fechar o BKO e o portal; o portal é só de quem é só admin).
 *
 * MP-05 "vendedor + promotor CRIA pedido" (dono do produto, 07/11 21h50, R-20261107-213844): a RN-PRO-01 trava o PERFIL promotor
 * (`resolverPerfil`), não o usuário; o `combinarPerfis` só une (R-20261108-005709-engenheiro-software).
 * MP-06 (API com Postgres, CI): tests/integracao/api/multiperfil-api-t0094.test.ts.
 */
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  BASES_SEM_BKO,
  combinarPerfis,
  criarPermissoes,
  ehAcaoDeEscritaDePedido,
  escopoDosPerfis,
  matrizDeFabrica,
  PERFIS,
  perfilDeFabrica,
  pode,
  podeEntrar,
  resolverPerfil,
  verificarAcao,
  type Manifesto,
  type ModuloId,
  type Perfil,
  type PerfilDaRequisicao,
  type PerfilDeAcesso,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

const MANIFESTOS: readonly Manifesto[] = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];
const TODOS: readonly ModuloId[] = MANIFESTOS.map((m) => m.id);
const MATRIZ = matrizDeFabrica(MANIFESTOS);
const PERMS = criarPermissoes(MANIFESTOS);

const fabrica = (base: Perfil): PerfilDaRequisicao => resolverPerfil(perfilDeFabrica(base), MATRIZ);
const derivado = (codigo: string, base: Perfil, concede: readonly string[]): PerfilDaRequisicao => {
  const p: PerfilDeAcesso = { codigo, base, ativo: true, fabrica: false, sobreposicoes: concede.map((chave) => ({ chave, concedida: true })) };
  return resolverPerfil(p, MATRIZ);
};
/** Usuário da requisição como a API monta (`ctx.usuario`): perfil principal + os perfis resolvidos + módulos efetivos. */
const usuario = (perfis: PerfilDaRequisicao[], modulos: readonly ModuloId[] = TODOS) => ({ id: 'u-1', tenant_id: 't-a', perfil: perfis[0]!.base, modulos, perfis });

/** Perfis base que entram no BKO pela RN-CORE-33 (P1: o gerente continua). */
const BKO: readonly Perfil[] = ['admin', 'analista', 'assistente', 'gerente'];
const ACOES_PROMOTOR = Object.entries(promotor.acoes).filter(([, d]) => d.perfis.includes('promotor')).map(([a]) => a);
const ACOES_VENDEDOR = MANIFESTOS.flatMap((m) => Object.entries(m.acoes).filter(([, d]) => d.perfis.includes('vendedor')).map(([a]) => a));
const ESCRITA_DE_PEDIDO = Object.keys(vendedor.acoes).filter(ehAcaoDeEscritaDePedido);

describe('T-0094 multiperfil (RN-CORE-35) com os manifestos reais', () => {
  it('MP-01 fábrica: os 8 manifestos montam a matriz; vendedor escreve pedido, promotor não (RN-PRO-01); promotor coleta', () => {
    expect(ACOES_PROMOTOR.length).toBeGreaterThan(5);
    expect(ESCRITA_DE_PEDIDO).toContain('pedido.criar');
    expect(pode([fabrica('vendedor')], 'pedido.criar')).toBe(true);
    for (const a of ESCRITA_DE_PEDIDO) expect([a, pode([fabrica('promotor')], a)]).toEqual([a, false]);
    for (const a of ACOES_PROMOTOR) expect([a, pode([fabrica('promotor')], a)]).toEqual([a, true]);
  });

  it('MP-02 acessos pela regra mais restritiva: em todo par de perfis base, BKO só se os dois são do BKO; portal só admin; os apps somam', () => {
    for (const a of PERFIS) {
      for (const b of PERFIS) {
        const u = [fabrica(a), fabrica(b)];
        const caso = `${a} + ${b}`;
        expect([caso, 'bko', podeEntrar(u, 'bko')]).toEqual([caso, 'bko', BKO.includes(a) && BKO.includes(b)]);
        expect([caso, 'portal', podeEntrar(u, 'portal')]).toEqual([caso, 'portal', a === 'admin' && b === 'admin']);
        const campo = ['vendedor', 'promotor'].includes(a) || ['vendedor', 'promotor'].includes(b);
        const gestao = ['supervisor', 'gerente'].includes(a) || ['supervisor', 'gerente'].includes(b);
        expect([caso, 'campo', podeEntrar(u, 'campo')]).toEqual([caso, 'campo', campo]);
        expect([caso, 'gestao', podeEntrar(u, 'gestao')]).toEqual([caso, 'gestao', gestao]);
      }
    }
  });

  it('MP-02b vendedor + promotor: entra no Campo; nunca no BKO, no portal nem no Gestão; o escopo segue a carteira', () => {
    const vp = [fabrica('vendedor'), fabrica('promotor')];
    expect(podeEntrar(vp, 'campo')).toBe(true);
    expect(podeEntrar(vp, 'bko')).toBe(false);
    expect(podeEntrar(vp, 'portal')).toBe(false);
    expect(podeEntrar(vp, 'gestao')).toBe(false);
    expect(escopoDosPerfis(vp)).toBe('carteira');
    expect(combinarPerfis(vp)['acesso.bko']).toBeUndefined();
  });

  it('MP-03 RN-CORE-33 nos derivados: perfil personalizado de base vendedor, promotor ou supervisor com o BKO e o portal concedidos continua fora, sozinho ou somado ao admin', () => {
    for (const base of BASES_SEM_BKO) {
      const d = derivado(`${base}_mais`, base, ['acesso.bko', 'acesso.portal']);
      expect([base, podeEntrar([d], 'bko'), podeEntrar([d], 'portal')]).toEqual([base, false, false]);
      expect([base, podeEntrar([fabrica('admin'), d], 'bko'), podeEntrar([fabrica('admin'), d], 'portal')]).toEqual([base, false, false]);
    }
    // o analista com o portal concedido também não entra (o portal é só do admin)
    expect(podeEntrar([derivado('analista_portal', 'analista', ['acesso.portal'])], 'portal')).toBe(false);
  });

  it('MP-04 união nas ações: vendedor + promotor faz o trade do promotor e as ações do vendedor que não escrevem pedido, com o módulo licenciado', () => {
    const vp = usuario([fabrica('vendedor'), fabrica('promotor')]);
    for (const a of ACOES_PROMOTOR) expect([a, verificarAcao(vp, PERMS, a)]).toEqual([a, { ok: true }]);
    for (const a of ACOES_VENDEDOR.filter((x) => !ehAcaoDeEscritaDePedido(x))) expect([a, verificarAcao(vp, PERMS, a)]).toEqual([a, { ok: true }]);
    // licença continua antes do perfil: sem o Promotor no tenant, a coleta = MODULO_INATIVO
    const semPromotor = usuario([fabrica('vendedor'), fabrica('promotor')], TODOS.filter((m) => m !== 'promotor'));
    expect(verificarAcao(semPromotor, PERMS, ACOES_PROMOTOR[0]!)).toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
  });

  it('MP-04b o promotor sozinho segue sem escrever pedido (RN-PRO-01 no perfil), mesmo com o Vendedor licenciado e com a chave concedida no derivado', () => {
    const so = usuario([fabrica('promotor')]);
    for (const a of ESCRITA_DE_PEDIDO) expect([a, verificarAcao(so, PERMS, a)]).toEqual([a, expect.objectContaining({ status: 403, codigo: 'PERFIL_SEM_ACESSO' })]);
    const d = usuario([derivado('promotor_pedido', 'promotor', ['pedido.criar'])]);
    expect(verificarAcao(d, PERMS, 'pedido.criar')).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    // dois perfis de base promotor também não somam a escrita
    expect(pode([fabrica('promotor'), derivado('promotor_pedido', 'promotor', ['pedido.criar'])], 'pedido.criar')).toBe(false);
  });

  it('MP-05 vendedor + promotor CRIA pedido pelo perfil de vendedor (RN-CORE-35: união nas ações; RN-PRO-01 trava o perfil promotor, não o usuário), em qualquer ordem dos perfis', () => {
    const doVendedor = ESCRITA_DE_PEDIDO.filter((a) => pode([fabrica('vendedor')], a));
    expect(doVendedor).toContain('pedido.criar');
    for (const perfis of [
      [fabrica('vendedor'), fabrica('promotor')],
      [fabrica('promotor'), fabrica('vendedor')],
    ]) {
      const u = usuario(perfis);
      const ordem = perfis.map((p) => p.base).join('+');
      expect(combinarPerfis(perfis)['pedido.criar'], ordem).toBeDefined();
      for (const a of doVendedor) {
        expect([ordem, a, pode(perfis, a)]).toEqual([ordem, a, true]);
        expect([ordem, a, verificarAcao(u, PERMS, a)]).toEqual([ordem, a, { ok: true }]);
      }
      // escrita que o vendedor de fábrica não tem continua fora (a união não inventa ação)
      for (const a of ESCRITA_DE_PEDIDO.filter((x) => !doVendedor.includes(x))) expect([ordem, a, pode(perfis, a)]).toEqual([ordem, a, false]);
    }
    // sem o Vendedor licenciado para o usuário, a licença vem antes: MODULO_INATIVO
    const semVendedor = usuario([fabrica('vendedor'), fabrica('promotor')], TODOS.filter((m) => m !== 'vendedor'));
    expect(verificarAcao(semVendedor, PERMS, 'pedido.criar')).toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
    // o derivado de base vendedor sem a escrita (revogada) + promotor: ninguém escreve
    const vendedorSemPedido: PerfilDeAcesso = { codigo: 'vendedor_consulta', base: 'vendedor', ativo: true, fabrica: false, sobreposicoes: [{ chave: 'pedido.criar', concedida: false }] };
    expect(pode([resolverPerfil(vendedorSemPedido, MATRIZ), fabrica('promotor')], 'pedido.criar')).toBe(false);
  });
});
