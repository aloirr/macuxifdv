import { describe, expect, it } from 'vitest';
import { NOMES_EVENTOS_CONSUMIDOS, EVENTOS_PROPOSTOS } from './contracts';
import manifest from './manifest';

describe('manifesto do gestor', () => {
  it('é válido no platform-sdk e usa pedido.criar_em_nome como opcional', () => {
    expect(manifest.id).toBe('gestor');
    expect(manifest.depende).toEqual(['core']);
    expect(manifest.opcionais).toContain('vendedor');
    expect(manifest.usaExtensoes).toContain('pedido.criar_em_nome');
  });

  it('RN-CORE-03: só o Core é obrigatório; Vendedor, Promotor, Pesquisa e Treinamento são opcionais', () => {
    expect(manifest.opcionais).toEqual(['vendedor', 'promotor', 'pesquisa', 'treinamento']);
  });

  it('doc 03 §2: supervisor e gerente veem e aprovam; analista e admin configuram as regras de alerta', () => {
    expect(manifest.acoes['fila_aprovacao.ver']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(manifest.acoes['fila_aprovacao.decidir']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(manifest.acoes['alerta_equipe.dispensar']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(manifest.acoes['alerta_regra.gerenciar']!.perfis).toEqual(['analista', 'admin']);
    for (const a of ['painel_equipe.ver', 'ranking_equipe.ver', 'alerta_equipe.ver']) expect(manifest.acoes[a]!.perfis).toEqual(expect.arrayContaining(['supervisor', 'gerente']));
  });

  it('RN-GES-07: analista e admin veem os painéis do tenant em modo leitura; nunca decidem aprovação nem dispensam alerta', () => {
    expect(manifest.acoes['painel_tenant.ver']!.perfis).toEqual(['analista', 'admin']);
    for (const a of ['fila_aprovacao.decidir', 'alerta_equipe.dispensar']) {
      expect(manifest.acoes[a]!.perfis).not.toContain('analista');
      expect(manifest.acoes[a]!.perfis).not.toContain('admin');
    }
    for (const a of ['painel_equipe.ver', 'ranking_equipe.ver', 'alerta_equipe.ver', 'fila_aprovacao.ver']) expect(manifest.acoes[a]!.perfis).toEqual(['supervisor', 'gerente']);
  });

  it('RN-GES-06: consome o faturamento do Vendedor (vendido × faturado)', () => {
    expect(manifest.consome).toContain('vendedor.pedido.faturado@1');
  });

  it('RN-PRO-01 e fronteira com o Vendedor: nenhuma ação de pedido nem de alçada é declarada aqui', () => {
    expect(Object.keys(manifest.acoes).filter((a) => a.startsWith('pedido'))).toEqual([]);
    for (const def of Object.values(manifest.acoes)) expect(def.perfis).not.toContain('promotor');
    for (const def of Object.values(manifest.acoes)) expect(def.perfis).not.toContain('vendedor');
  });

  it('toda ação do manifesto vale para perfis que o módulo atende', () => {
    for (const def of Object.values(manifest.acoes)) for (const p of def.perfis) expect(manifest.perfis).toContain(p);
  });

  it('consome só eventos que a projeção entende (e os propostos ainda não estão no manifesto)', () => {
    for (const ev of manifest.consome) expect(NOMES_EVENTOS_CONSUMIDOS).toContain(ev);
    for (const ev of EVENTOS_PROPOSTOS) expect(manifest.consome).not.toContain(ev);
    // o que a projeção entende e não é proposto está declarado
    for (const ev of NOMES_EVENTOS_CONSUMIDOS.filter((n) => !EVENTOS_PROPOSTOS.includes(n))) expect(manifest.consome).toContain(ev);
  });

  it('publica nada: o Gestor é só consumidor de eventos', () => {
    expect(manifest.publica).toEqual([]);
  });
});
