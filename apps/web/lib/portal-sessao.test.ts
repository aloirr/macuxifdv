/** T-0087/T-0093: sessão do portal (lib/portal-sessao.ts) e erros do cliente do portal (lib/portal-api.ts). */
import { describe, expect, it } from 'vitest';

import { ehRotaAusente, ErroPortal, lerErroDaApi, mensagemDoErro, MENSAGEM_PADRAO } from './portal-api';
import {
  caminhoDeRetornoSeguro,
  CHAVE_RETORNO_PORTAL,
  CHAVE_SESSAO_PORTAL,
  apagarRetornoPortal,
  consumirRetornoPortal,
  estadoDaSessao,
  guardarRetornoPortal,
  lerRetornoPortal,
  lerSessaoPortal,
  limparSessaoPortal,
  marcarSaidaPedida,
  minutosAteOTeto,
  retirarSaidaPedida,
  salvarSessaoPortal,
  type SessaoPortal,
} from './portal-sessao';

const T0 = Date.parse('2026-11-06T10:00:00Z');
const sessao = (tokenMin: number, tetoMin: number): SessaoPortal => ({
  token: 'x'.repeat(40),
  expira_em: new Date(T0 + tokenMin * 60_000).toISOString(),
  sessao_expira_em: new Date(T0 + tetoMin * 60_000).toISOString(),
  tipo: 'super_admin',
  empresa: null,
  empresas: [],
});

class Memoria implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('estadoDaSessao (ADR 0029 §4: 15 min renováveis, teto de 8 h)', () => {
  it('sem sessão = ausente; token com folga = válida', () => {
    expect(estadoDaSessao(null, T0)).toBe('ausente');
    expect(estadoDaSessao(sessao(15, 480), T0)).toBe('valida');
  });
  it('faltando 3 min ou menos = renovar; token vencido = expirada', () => {
    expect(estadoDaSessao(sessao(3, 480), T0)).toBe('renovar');
    expect(estadoDaSessao(sessao(1, 480), T0)).toBe('renovar');
    expect(estadoDaSessao(sessao(0, 480), T0)).toBe('expirada');
  });
  it('passado o teto de 8 h = expirada, mesmo com token novo', () => {
    expect(estadoDaSessao(sessao(15, 0), T0)).toBe('expirada');
    expect(minutosAteOTeto(sessao(15, 90), T0)).toBe(90);
  });
  it('data ilegível = expirada', () => {
    expect(estadoDaSessao({ ...sessao(15, 480), expira_em: 'x' }, T0)).toBe('expirada');
  });
});

describe('armazenamento da sessão (sessionStorage, nunca localStorage)', () => {
  it('salva, lê e limpa; JSON estranho = sem sessão', () => {
    const st = new Memoria();
    expect(lerSessaoPortal(st)).toBeNull();
    salvarSessaoPortal(sessao(15, 480), st);
    expect(lerSessaoPortal(st)?.tipo).toBe('super_admin');
    limparSessaoPortal(st);
    expect(lerSessaoPortal(st)).toBeNull();
    st.setItem(CHAVE_SESSAO_PORTAL, '{"token":1}');
    expect(lerSessaoPortal(st)).toBeNull();
    st.setItem(CHAVE_SESSAO_PORTAL, 'não é json');
    expect(lerSessaoPortal(st)).toBeNull();
  });
});

describe('erros do cliente do portal', () => {
  it('lê o corpo de erro da API (ADR 0008) e cai no padrão sem corpo', () => {
    const e = lerErroDaApi(423, { codigo: 'BLOQUEADO', mensagem: 'Muitas tentativas. Tente em 15 min.', detalhes: { ate: 'x' } });
    expect(e).toMatchObject({ status: 423, codigo: 'BLOQUEADO', message: 'Muitas tentativas. Tente em 15 min.', detalhes: { ate: 'x' } });
    expect(lerErroDaApi(500, null)).toMatchObject({ codigo: 'http_500', message: MENSAGEM_PADRAO });
  });
  it('mensagem para a tela nunca é JSON nem pilha', () => {
    expect(mensagemDoErro(new ErroPortal(400, 'X', 'Confira o CNPJ.'))).toBe('Confira o CNPJ.');
    expect(mensagemDoErro(new ErroPortal(400, 'X', '[{"code":"invalid_type"}]'))).toBe(MENSAGEM_PADRAO);
    expect(mensagemDoErro(new Error('TypeError: x is undefined'))).toBe(MENSAGEM_PADRAO);
    expect(mensagemDoErro('qualquer')).toBe(MENSAGEM_PADRAO);
  });
  it('rota ausente (N1/N2 antes do merge) ≠ recurso não encontrado', () => {
    expect(ehRotaAusente(new ErroPortal(404, 'NAO_ENCONTRADO', 'Rota não encontrada.'))).toBe(true);
    expect(ehRotaAusente(new ErroPortal(404, 'LOTE_NAO_ENCONTRADO', 'Lote não encontrado.'))).toBe(false);
    expect(ehRotaAusente(new ErroPortal(403, 'MODULO_INATIVO', 'x'))).toBe(false);
  });
});

describe('volta depois do login (R-20261106-023316 🟡 10)', () => {
  it('só caminhos do portal: /empresas, /empresas/<id> e o #aba', () => {
    expect(caminhoDeRetornoSeguro('/empresas')).toBe('/empresas');
    expect(caminhoDeRetornoSeguro('/empresas/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b#integracao')).toBe('/empresas/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b#integracao');
    expect(caminhoDeRetornoSeguro('/empresas/nova')).toBe('/empresas/nova');
    for (const ruim of ['//mal.com/empresas', 'https://mal.com', '/empresas/../entrar', '/empresas?x=1', '/entrar', '/empresas/a/b', '', 42, null]) expect(caminhoDeRetornoSeguro(ruim)).toBeNull();
  });
  it('trava a lista branca contra afrouxamento (R-20261107-094706 🟢 1)', () => {
    const ruins = [
      '/\\mal.com',
      '%2F%2Fmal.com',
      '/empresas/%2F%2Fmal.com',
      '/empresas/%2e%2e',
      '/empresas/..',
      'javascript:alert(1)',
      '/empresas\n',
      '/empresas/abc\n',
      '/empresas\\mal.com',
      '/empresas/abc/',
      '/empresas@mal.com',
      '/empresas#a/../b',
      '/empresas#ABA',
      '/empresas/abc#',
      '/EMPRESAS',
      ' /empresas',
      '/empresas ',
      'http:/empresas',
      `/empresas/${'a'.repeat(65)}`,
      `/empresas/abc#${'a'.repeat(21)}`,
      `/empresas/${'a'.repeat(64)}#${'a'.repeat(20)}x`,
      undefined,
      {},
      ['/empresas'],
    ];
    for (const ruim of ruins) expect(caminhoDeRetornoSeguro(ruim), JSON.stringify(ruim)).toBeNull();
    // o limite de 64 do id e de 20 do #aba ainda passa
    const noLimite = `/empresas/${'a'.repeat(64)}#${'a'.repeat(20)}`;
    expect(caminhoDeRetornoSeguro(noLimite)).toBe(noLimite);
  });
  it('guarda, lê uma vez e apaga; caminho estranho vira null', () => {
    const st = new Memoria();
    guardarRetornoPortal({ caminho: '/empresas/abc#bases', sessaoTerminou: true }, st);
    expect(consumirRetornoPortal(st)).toEqual({ caminho: '/empresas/abc#bases', sessaoTerminou: true });
    expect(consumirRetornoPortal(st)).toBeNull();
    guardarRetornoPortal({ caminho: '//mal.com', sessaoTerminou: false }, st);
    expect(consumirRetornoPortal(st)).toEqual({ caminho: null, sessaoTerminou: false });
    st.setItem(CHAVE_RETORNO_PORTAL, '{"caminho":"https://mal.com","sessaoTerminou":"sim"}');
    expect(consumirRetornoPortal(st)).toEqual({ caminho: null, sessaoTerminou: false });
  });
  it('"Sair" pedido vale uma vez', () => {
    expect(retirarSaidaPedida()).toBe(false);
    marcarSaidaPedida();
    expect(retirarSaidaPedida()).toBe(true);
    expect(retirarSaidaPedida()).toBe(false);
  });
  it('lerRetornoPortal não apaga (F5 na entrada); apagarRetornoPortal apaga depois do login (R-20261107-093612 🟢 4)', () => {
    const st = new Memoria();
    guardarRetornoPortal({ caminho: '/empresas/abc#equipe', sessaoTerminou: true }, st);
    expect(lerRetornoPortal(st)).toEqual({ caminho: '/empresas/abc#equipe', sessaoTerminou: true });
    expect(lerRetornoPortal(st)).toEqual({ caminho: '/empresas/abc#equipe', sessaoTerminou: true });
    apagarRetornoPortal(st);
    expect(lerRetornoPortal(st)).toBeNull();
    st.setItem(CHAVE_RETORNO_PORTAL, '{"caminho":"//mal.com","sessaoTerminou":true}');
    expect(lerRetornoPortal(st)).toEqual({ caminho: null, sessaoTerminou: true });
  });
  it('sessão nova zera um "Sair" que a guarda não consumiu (R-20261107-093612 🟢 5)', () => {
    marcarSaidaPedida();
    salvarSessaoPortal(sessao(15, 480), new Memoria());
    expect(retirarSaidaPedida()).toBe(false);
  });
});
