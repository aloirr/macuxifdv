/**
 * T-0172: tela única de entrada. O logo do JS fica no mesmo lugar e no mesmo tamanho da splash nativa (sem corte), a lista
 * de etapas só entra se couber abaixo do logo, e os rótulos são só o nome da etapa e o percentual.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  cabeLista,
  erroDeSinal,
  LARGURA_LOGO_ENTRADA,
  posicaoDoLogo,
  progressoProvisorio,
  rotuloDaBarra,
  textoDoErro,
  type EstadoParaEntrada,
} from './entrada';
import { PROPORCAO_LOGO_EMPILHADO } from './logo-marca';

const TODOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento'] as const;

/** Largura e altura de um PNG (cabeçalho IHDR). */
function tamanhoPng(caminho: URL): { largura: number; altura: number } {
  const b = readFileSync(caminho);
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

describe('logo da entrada × splash nativa', () => {
  it('mesma largura do app.config.ts e mesma proporção das splash-*.png', () => {
    const config = readFileSync(new URL('../../app.config.ts', import.meta.url), 'utf8');
    expect(config).toContain(`const LARGURA_LOGO_SPLASH = ${LARGURA_LOGO_ENTRADA};`);
    for (const v of ['campo', 'gestao']) {
      const { largura, altura } = tamanhoPng(new URL(`../../assets/images/splash-${v}.png`, import.meta.url));
      expect(largura / altura).toBeCloseTo(PROPORCAO_LOGO_EMPILHADO, 2);
    }
  });

  it('o logo fica no centro da janela', () => {
    const { altura, topo } = posicaoDoLogo(800);
    expect(altura).toBe(Math.round(LARGURA_LOGO_ENTRADA / PROPORCAO_LOGO_EMPILHADO));
    expect(topo + altura / 2).toBeCloseTo(400, 0);
  });

  it('a lista de etapas só entra se couber abaixo do logo (na tela baixa fica só a barra)', () => {
    expect(cabeLista(860, 5, 48, true)).toBe(true);
    expect(cabeLista(640, 5, 48, true)).toBe(false);
    expect(cabeLista(0, 5, 48, true)).toBe(false);
    // sem o "Olá" sobra mais espaço
    expect(cabeLista(780, 5, 0, false)).toBe(true);
    // parada: o erro e as ações ocupam o lugar da barra; a lista só fica na tela alta
    expect(cabeLista(915, 5, 48, true, true)).toBe(false);
    expect(cabeLista(1280, 5, 48, true, true)).toBe(true);
  });
});

describe('rótulos da entrada', () => {
  const etapa = { id: 'clientes_rota' as const, nome: 'Clientes e rota', numero: 2, situacao: 'atual' as const };

  it('"Etapa n de N · nome" e "Pronto" no fim', () => {
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: false })).toBe('Etapa 2 de 5 · Clientes e rota');
    expect(rotuloDaBarra({ atual: etapa, total: 5, pronta: true })).toBe('Pronto');
  });

  it('erro: "Sem internet" quando falta sinal; senão "Parou"', () => {
    expect(erroDeSinal('Sem sinal: a sincronização fica para quando a conexão voltar.', false)).toBe(true);
    expect(erroDeSinal('HTTP 500', true)).toBe(true);
    expect(erroDeSinal('HTTP 500', false)).toBe(false);
    expect(erroDeSinal(null, false)).toBe(false);
    expect(textoDoErro(etapa, 5, true)).toBe('Sem internet na etapa 2 de 5');
    expect(textoDoErro(etapa, 5, false)).toBe('Parou na etapa 2 de 5');
  });
});

describe('progresso provisório (até o Core exportar progressoDaEntrada)', () => {
  const base: EstadoParaEntrada = { perfil: 'vendedor', modulos: TODOS, carga: { entidade: null, modulo: null }, percentual: 0, pronta: false, parou: false };

  it('Campo com tudo licenciado: 5 etapas; sem entidade em curso, o envio é a atual', () => {
    const p = progressoProvisorio(base);
    expect(p.etapas.map((e) => e.nome)).toEqual(['Envio do que ficou no aparelho', 'Clientes e rota', 'Catálogo e preços', 'Pedidos e metas', 'Fotos e materiais']);
    expect(p.atual.numero).toBe(1);
    expect(p.etapas.map((e) => e.situacao)).toEqual(['atual', 'pendente', 'pendente', 'pendente', 'pendente']);
  });

  it('só as etapas dos módulos efetivos; RN-PRO-01: nada de pedido para o promotor', () => {
    expect(progressoProvisorio({ ...base, modulos: ['core'] }).etapas.map((e) => e.id)).not.toContain('catalogo_precos');
    expect(progressoProvisorio({ ...base, perfil: 'promotor' }).etapas.some((e) => /pedido/i.test(e.nome))).toBe(false);
  });

  it('pronta: tudo feito; parou: a atual vira "parou" e é a parada', () => {
    const pronta = progressoProvisorio({ ...base, pronta: true, percentual: 100 });
    expect(pronta.etapas.every((e) => e.situacao === 'feita')).toBe(true);
    const parou = progressoProvisorio({ ...base, parou: true, carga: { entidade: 'produto', modulo: 'catalogo' } });
    expect(parou.parou_em?.numero).toBe(3);
    expect(parou.etapas[2]?.situacao).toBe('parou');
  });

  it('Gestão: equipe e aprovações (com o Vendedor)', () => {
    const p = progressoProvisorio({ ...base, perfil: 'gerente', carga: { entidade: 'pedido', modulo: 'vendedor' } });
    expect(p.etapas.map((e) => e.nome)).toEqual(['Envio do que ficou no aparelho', 'Equipe', 'Aprovações', 'Metas', 'Alertas']);
    expect(p.atual.nome).toBe('Aprovações');
  });
});
