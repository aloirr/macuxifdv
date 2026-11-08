import { PERFIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ACOES_DA_MATRIZ, decisao, podeAcessarBko, podeExecutar, podeVer } from './matriz';

const ACOES_DE_PEDIDO_DO_PROMOTOR = ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.duplicar', 'pedido.excluir'];

describe('matriz perfil × ação (S0-060)', () => {
  it.each(ACOES_DE_PEDIDO_DO_PROMOTOR)('RN-PRO-01: promotor é negado em %s', (acao) => {
    expect(podeExecutar('promotor', acao)).toBe(false);
    expect(decisao('promotor', acao)).toEqual({ acesso: 'negado', escopo: null });
  });

  it('RN-PRO-01: promotor é negado em qualquer ação de pedido, inclusive as não listadas', () => {
    for (const acao of ['pedido.criar_em_nome', 'pedido.aprovar', 'pedido_item.editar', 'pedido.qualquer_coisa']) {
      expect(podeExecutar('promotor', acao)).toBe(false);
    }
  });

  it('RN-PRO-01: vale pelo perfil — a decisão não depende de o promotor ter o módulo Vendedor (S0-064)', () => {
    // a função não recebe módulos nem exceções: nenhuma combinação de licença muda a resposta
    expect(decisao('promotor', 'pedido.criar')).toEqual(decisao('promotor', 'pedido.criar'));
    expect(podeExecutar('promotor', 'pedido.criar')).toBe(false);
  });

  it('matriz §2: promotor vê pedidos da carteira só em leitura', () => {
    expect(decisao('promotor', 'pedido.ver')).toEqual({ acesso: 'leitura', escopo: 'carteira' });
    expect(podeVer('promotor', 'pedido.ver')).toBe(true);
    expect(podeExecutar('promotor', 'pedido.ver')).toBe(false);
  });

  it('matriz §2: vendedor cria, edita, cancela e exclui o próprio pedido', () => {
    for (const acao of ['pedido.criar', 'pedido.editar', 'pedido.cancelar', 'pedido.excluir']) {
      expect(decisao('vendedor', acao)).toEqual({ acesso: 'total', escopo: 'proprio' });
    }
  });

  it('matriz §2: supervisor e gerente criam em nome do vendedor e cancelam na equipe', () => {
    for (const p of ['supervisor', 'gerente'] as const) {
      expect(decisao(p, 'pedido.criar')).toEqual({ acesso: 'total', escopo: 'em_nome' });
      expect(decisao(p, 'pedido.cancelar')).toEqual({ acesso: 'total', escopo: 'equipe' });
    }
  });

  it('matriz §2: analista e assistente operam pedidos; admin não', () => {
    for (const p of ['analista', 'assistente'] as const) expect(podeExecutar(p, 'pedido.criar')).toBe(true);
    expect(podeExecutar('admin', 'pedido.criar')).toBe(false);
    expect(podeExecutar('admin', 'pedido.cancelar')).toBe(false);
  });

  it('matriz §2: aprovar desconto — supervisor/gerente até a alçada, analista acima; os demais não', () => {
    expect(decisao('supervisor', 'desconto.aprovar').escopo).toBe('alcada');
    expect(decisao('analista', 'desconto.aprovar').escopo).toBe('acima_da_alcada');
    for (const p of ['vendedor', 'promotor', 'assistente', 'admin'] as const) expect(podeExecutar(p, 'desconto.aprovar')).toBe(false);
  });

  it('matriz §2: coletas de trade são do promotor; gestão só lê; vendedor e admin não veem', () => {
    expect(podeExecutar('promotor', 'trade.coletar')).toBe(true);
    for (const p of ['supervisor', 'gerente', 'analista', 'assistente'] as const) expect(decisao(p, 'trade.coletar').acesso).toBe('leitura');
    expect(podeVer('vendedor', 'trade.coletar')).toBe(false);
    expect(podeVer('admin', 'trade.coletar')).toBe(false);
  });

  it('matriz §2: cadastros de trade e criação de pesquisa só para analista e admin', () => {
    for (const acao of ['trade.cadastrar', 'pesquisa.criar']) {
      const quem = PERFIS.filter((p) => podeExecutar(p, acao));
      expect(quem).toEqual(['analista', 'admin']);
    }
  });

  it('matriz §2: responder pesquisa — vendedor, promotor, supervisor e gerente', () => {
    expect(PERFIS.filter((p) => podeExecutar(p, 'pesquisa.responder'))).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente']);
  });

  it('matriz §2: só o admin ativa/desativa módulos e usuários (S0-050)', () => {
    expect(PERFIS.filter((p) => podeExecutar(p, 'modulo.gerir_licencas'))).toEqual(['admin']);
  });

  it('matriz §2: Cliente 360 — carteira (vendedor/promotor), equipe (supervisor/gerente), tenant (demais)', () => {
    expect(decisao('vendedor', 'cliente.ver_360').escopo).toBe('carteira');
    expect(decisao('promotor', 'cliente.ver_360').escopo).toBe('carteira');
    expect(decisao('gerente', 'cliente.ver_360').escopo).toBe('equipe');
    expect(decisao('admin', 'cliente.ver_360').escopo).toBe('tenant');
  });

  it('matriz §2: ação desconhecida é negada para todos os perfis (falha fechada)', () => {
    for (const p of PERFIS) expect(podeVer(p, 'coisa.inexistente')).toBe(false);
  });

  it('matriz §2: toda ação da matriz tem decisão definida para os 7 perfis', () => {
    for (const acao of ACOES_DA_MATRIZ) for (const p of PERFIS) expect(['total', 'leitura', 'negado']).toContain(decisao(p, acao).acesso);
  });

  it('esclarecimento Q6: vendedor e promotor não acessam o BKO; os demais perfis sim', () => {
    expect(podeAcessarBko('vendedor')).toBe(false);
    expect(podeAcessarBko('promotor')).toBe(false);
    for (const p of ['admin', 'analista', 'assistente', 'gerente'] as const) expect(podeAcessarBko(p)).toBe(true);
  });
});
