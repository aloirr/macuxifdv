/**
 * T-0059 (R-20261102-090915): frases da carga por perfil e módulo efetivo, sem nome técnico.
 */
import { describe, expect, it } from 'vitest';

import { AVISO_APP_ABERTO, FRASE_RETOMADA, frasesDaCarga, mensagemDeErroDaCarga, TODAS_AS_FRASES } from './frases-carga';
import { MANIFESTOS_INSTALADOS } from './instalados';

/** Nomes técnicos que não podem aparecer: entidades de sync dos manifestos e ids dos módulos. */
const NOMES_TECNICOS: readonly string[] = [...new Set(MANIFESTOS_INSTALADOS.flatMap((m) => [...m.sync, m.id]))];

const TODOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento'] as const;

describe('frasesDaCarga', () => {
  it('nenhuma frase traz nome de entidade ou de módulo (snake_case ou id)', () => {
    expect(NOMES_TECNICOS).toEqual(expect.arrayContaining(['cliente_condicao', 'pedido']));
    for (const f of TODAS_AS_FRASES) {
      expect(f).not.toMatch(/[a-z]+_[a-z]+/);
      for (const nome of NOMES_TECNICOS.filter((n) => n.includes('_'))) expect(f).not.toContain(nome);
    }
  });

  it('vendedor com tudo licenciado: frases do vendedor, de pedido e de preço; nada de gestão nem de promotor', () => {
    const f = frasesDaCarga('campo', 'vendedor', TODOS);
    expect(f).toContain('Preparando tudo para você bater sua meta hoje');
    expect(f).toContain('Baixando seus clientes e a tabela de preços');
    expect(f.some((x) => /pedido/i.test(x))).toBe(true);
    expect(f.some((x) => /gôndola|equipe/i.test(x))).toBe(false);
  });

  it('sem o Vendedor licenciado, nenhuma frase fala de pedido; sem o Catálogo, nenhuma de tabela de preços', () => {
    const f = frasesDaCarga('campo', 'vendedor', ['core']);
    expect(f.some((x) => /pedido/i.test(x))).toBe(false);
    expect(f.some((x) => /preço/i.test(x))).toBe(false);
    expect(f.length).toBeGreaterThanOrEqual(3);
  });

  it('RN-PRO-01: o promotor nunca lê frase de pedido, mesmo com o Vendedor efetivo', () => {
    const f = frasesDaCarga('campo', 'promotor', TODOS);
    expect(f.some((x) => /pedido/i.test(x))).toBe(false);
    expect(f.some((x) => /gôndola/i.test(x))).toBe(true);
  });

  it('Gestão: frases da equipe; pedidos para aprovar só com o Vendedor, metas e alertas só com o Gestor', () => {
    const tudo = frasesDaCarga('gestao', 'supervisor', TODOS);
    expect(tudo).toContain('Juntando os números da sua equipe');
    expect(tudo).toContain('Trazendo os pedidos que aguardam a sua aprovação');
    expect(tudo.some((x) => /rota de hoje|bater sua meta/i.test(x))).toBe(false);
    const soCore = frasesDaCarga('gestao', 'gerente', ['core']);
    expect(soCore.some((x) => /pedido|alertas/i.test(x))).toBe(false);
  });

  it('sem perfil conhecido: só as frases gerais (nunca vazio)', () => {
    const f = frasesDaCarga('campo', null, TODOS);
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => /pedido/i.test(x))).toBe(false);
  });

  it('módulo em andamento (carga.modulo): as frases dos dados dele vêm primeiro e as de outros módulos saem', () => {
    const vendas = frasesDaCarga('campo', 'vendedor', TODOS, 'vendedor');
    expect(vendas[0]).toBe('Trazendo seus pedidos recentes para consultar sem sinal');
    expect(vendas.some((x) => /pesquisas|treinamentos/i.test(x))).toBe(false);
    expect(vendas).toContain('Quase lá: deixando tudo pronto para funcionar sem sinal');
    const core = frasesDaCarga('campo', 'vendedor', TODOS, 'core');
    expect(core.slice(0, 2)).toEqual(['Sincronizando os dados da sua rota', 'Baixando seus clientes e a tabela de preços']);
    // RN-PRO-01: o promotor baixando dados do Vendedor não ganha frase de pedido (vale a lista inteira dele)
    const promotor = frasesDaCarga('campo', 'promotor', TODOS, 'vendedor');
    expect(promotor.some((x) => /pedido/i.test(x))).toBe(false);
    expect(promotor).toEqual(frasesDaCarga('campo', 'promotor', TODOS));
    // módulo sem frase própria para o usuário: lista inteira
    expect(frasesDaCarga('campo', 'vendedor', ['core'], 'integracao')).toEqual(frasesDaCarga('campo', 'vendedor', ['core']));
  });

  it('avisos fixos sem nome técnico', () => {
    for (const f of [AVISO_APP_ABERTO, FRASE_RETOMADA]) expect(f).not.toMatch(/[a-z]+_[a-z]+/);
    expect(AVISO_APP_ABERTO).toMatch(/Mantenha o app aberto/);
  });

  it('erro amigável, sem detalhe técnico', () => {
    expect(mensagemDeErroDaCarga(false)).toBe('Não conseguimos baixar seus dados. Confira o sinal e tente de novo.');
    expect(mensagemDeErroDaCarga(true)).toMatch(/modo sem sinal/);
  });
});
