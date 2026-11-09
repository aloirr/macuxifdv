/**
 * RF-GES-05 / RN-VEN-35: o Vendedor registra o item do slot `pedido.criar_em_nome` que ele mesmo oferece. As telas importam
 * React Native (não rodam no Node), então a declaração é lida do fonte de `app/index.ts`, como em tests/modulos.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';

const fonte = readFileSync(join(__dirname, 'index.ts'), 'utf8');
const rotas = readFileSync(join(__dirname, 'rotas.ts'), 'utf8'); // rotas.ts importa expo-router (não roda no Node)
const bloco = fonte.slice(fonte.indexOf("slot: 'pedido.criar_em_nome'"), fonte.indexOf("slot: 'inicio.cards'"));

describe('RF-GES-05: item do slot pedido.criar_em_nome no app Gestão', () => {
  it('o manifesto oferece o slot e a ação é só de supervisor e gerente (o promotor nunca vê, regra 7)', () => {
    expect(manifest.ofereceExtensoes).toContain('pedido.criar_em_nome');
    expect(manifest.acoes['pedido.criar_em_nome']!.perfis).toEqual(['supervisor', 'gerente']);
  });
  it('registrado só no app Gestão, com a ação pedido.criar_em_nome', () => {
    expect(bloco).toContain("acao: 'pedido.criar_em_nome'");
    expect(bloco).toContain("apps: ['gestao']");
  });
  it('abre o novo pedido com o vendedor e o autor do contexto', () => {
    expect(bloco).toMatch(/irParaNovoPedido\(\{ vendedorId: ctx\.vendedor_id, autorId: ctx\.autor_id, vendedorNome: ctx\.vendedor_nome \}\)/);
    expect(rotas).toMatch(/ParamsNovoPedido = \{[^}]*vendedorId\?: string; autorId\?: string/);
  });
  it('a página do novo pedido também existe no app Gestão (o pedido em nome usa o mesmo motor)', () => {
    expect(fonte).toMatch(/id: 'novo-pedido'[^\n]*apps: \['campo', 'gestao'\]/);
  });
});
