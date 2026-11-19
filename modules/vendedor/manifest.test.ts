import { describe, expect, it } from 'vitest';
import { defineModule } from '@macuxi/platform-sdk';
import manifest from './manifest';

describe('manifesto do vendedor', () => {
  it('RN-PRO-01: nenhuma ação de pedido tem promotor e promotor não é perfil do módulo', () => {
    const acoes = Object.entries(manifest.acoes);
    expect(acoes.map(([nome]) => nome).sort()).toEqual(['alcada.gerenciar', 'forma_pagamento.gerenciar', 'forma_pagamento.ver', 'pedido.aprovar', 'pedido.cancelar', 'pedido.criar', 'pedido.criar_em_nome', 'pedido.editar', 'pedido.excluir', 'pedido.ver', 'transportadora.gerenciar', 'transportadora.ver']);
    // RN-PRO-01 / O-3: só a leitura (pedido.ver) pode incluir promotor, com escopo de carteira; escrita nunca.
    for (const [nome, def] of acoes) if (nome !== 'pedido.ver') expect(def.perfis).not.toContain('promotor');
    expect(manifest.perfis).not.toContain('promotor');
  });

  it('RN-VEN: aprovar e criar em nome ficam com supervisão/gestão; o manifesto recusa promotor em pedido', () => {
    expect(manifest.acoes['pedido.aprovar']!.perfis).toEqual(['supervisor', 'gerente', 'analista']);
    expect(manifest.acoes['pedido.criar_em_nome']!.perfis).toEqual(['supervisor', 'gerente']);
    expect(() => defineModule({ ...manifest, acoes: { 'pedido.criar': { perfis: ['promotor'] } } })).toThrow(/RN-PRO-01/);
  });

  it('T-0029 / matriz §2: supervisor, gerente e admin entram nos perfis; Gestão tem a aba Pedidos', () => {
    expect(manifest.perfis).toEqual(expect.arrayContaining(['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']));
    expect(manifest.apps.gestao?.abas).toEqual(['Pedidos']);
    expect(manifest.apps.campo?.abas).toEqual(['Pedidos']);
    expect(manifest.acoes['pedido.ver']!.perfis).toContain('admin');
    expect(manifest.acoes['pedido.criar']!.perfis).not.toContain('admin');
  });

  it('T-0029 / ADR 0011 e 0012: publica criado, status, aprovação e aprovado; usa as consultas do Catálogo e do Core', () => {
    expect(manifest.publica).toEqual(
      expect.arrayContaining(['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'vendedor.pedido.aprovado@1']),
    );
    expect(manifest.usaConsultas).toEqual(['catalogo.precos_cliente@1', 'catalogo.textos_produto@1', 'catalogo.busca_produtos@1', 'catalogo.sugestoes_pedido@1', 'catalogo.foto_produto@1', 'catalogo.estoque_filial@1', 'core.cadastro_resumo@1', 'core.filiais@1', 'core.promotor_ve_pedidos@1', 'core.financeiro_cliente@1']);
    expect(manifest.ofereceConsultas).toEqual(['vendedor.pedidos_da_meta@1', 'vendedor.formas_pagamento@1']);
    expect(manifest.sync).toEqual(expect.arrayContaining(['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao']));
  });
});
