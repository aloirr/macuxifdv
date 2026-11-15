import { describe, expect, it } from 'vitest';
import { abaVisivel, FILTROS_VAZIOS, lerFiltros, mesDoFiltro, paraBusca, queryDasTrilhas, queryDoPainel } from './filtros-url';
import { apiTreinamento, hrefEditarTrilha, hrefTrilhas } from './rotas';

const EQUIPE = '0f290000-0000-4000-8000-000000000006';

describe('filtros da página Trilhas na URL (RF-TRE-01, RF-TRE-05)', () => {
  it('RF-TRE-05: ida e volta — o que está na URL volta igual', () => {
    const f = { aba: 'pessoas' as const, mes: '2026-11', equipe: EQUIPE, status: 'publicada', busca: 'boas' };
    expect(lerFiltros(paraBusca(f))).toEqual(f);
  });

  it('sem filtro a URL fica limpa', () => {
    expect(paraBusca(FILTROS_VAZIOS)).toBe('');
    expect(lerFiltros('')).toEqual(FILTROS_VAZIOS);
  });

  it('link velho ou digitado à mão: aba, mês, equipe e status inválidos são ignorados', () => {
    expect(lerFiltros('?aba=xpto&mes=2026-13&equipe=1%27or&status=apagada&busca=a')).toEqual({ ...FILTROS_VAZIOS, busca: 'a' });
  });

  it('RF-TRE-05: a query do painel leva só mês e equipe válidos (id incompleto = escopo inteiro)', () => {
    expect(queryDoPainel({ ...FILTROS_VAZIOS, mes: '2026-11', equipe: EQUIPE })).toEqual({ mes: '2026-11', equipe_id: EQUIPE });
    expect(queryDoPainel({ ...FILTROS_VAZIOS, equipe: '0f29' })).toEqual({});
  });

  it('RF-TRE-01: a query do cadastro leva status e busca aparada', () => {
    expect(queryDasTrilhas({ ...FILTROS_VAZIOS, status: 'rascunho', busca: '  boas ' })).toEqual({ status: 'rascunho', busca: 'boas' });
    expect(queryDasTrilhas(FILTROS_VAZIOS)).toEqual({});
  });

  it('RF-TRE-05: abre a aba pedida se o perfil pode; senão a primeira permitida; nenhuma = null', () => {
    const gestor = { adesao: true, pessoas: true, trilhas: false };
    expect(abaVisivel('trilhas', gestor)).toBe('adesao');
    expect(abaVisivel('pessoas', gestor)).toBe('pessoas');
    expect(abaVisivel('', { adesao: false, pessoas: false, trilhas: true })).toBe('trilhas');
    expect(abaVisivel('', { adesao: false, pessoas: false, trilhas: false })).toBeNull();
  });
});

describe('caminhos (ADR 0003)', () => {
  it('a API é chamada sem o /v1 (a base do cliente já tem) e as páginas abrem no shell', () => {
    expect(apiTreinamento.adesao).toBe('/treinamento/adesao');
    expect(apiTreinamento.bkoPublicar(EQUIPE)).toBe(`/treinamento/bko/trilhas/${EQUIPE}/publicar`);
    expect(hrefEditarTrilha()).toBe('/trilha-editar');
    expect(hrefEditarTrilha(EQUIPE)).toBe(`/trilha-editar?id=${EQUIPE}`);
    expect(hrefTrilhas('trilhas')).toBe('/trilhas?aba=trilhas');
  });

  it('RF-TRE-05: o campo Mês vem com o mês atual no fuso do tenant quando a URL não traz mês', () => {
    const agora = new Date('2026-12-01T02:30:00Z'); // 30/11 22h30 em Manaus
    expect(mesDoFiltro(FILTROS_VAZIOS, 'America/Manaus', agora)).toBe('2026-11');
    expect(mesDoFiltro(FILTROS_VAZIOS, 'UTC', agora)).toBe('2026-12');
    expect(mesDoFiltro({ ...FILTROS_VAZIOS, mes: '2026-05' }, 'America/Manaus', agora)).toBe('2026-05');
  });
});
