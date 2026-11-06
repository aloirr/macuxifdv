/** T-0087: sessão do super-admin no portal (lib/portal-sessao.ts) e erros do cliente do portal (lib/portal-api.ts). */
import { describe, expect, it } from 'vitest';

import { ehRotaAusente, ErroPortal, lerErroDaApi, mensagemDoErro, MENSAGEM_PADRAO } from './portal-api';
import { CHAVE_SESSAO_PORTAL, estadoDaSessao, lerSessaoPortal, limparSessaoPortal, minutosAteOTeto, salvarSessaoPortal, type SessaoPortal } from './portal-sessao';

const T0 = Date.parse('2026-11-06T10:00:00Z');
const sessao = (tokenMin: number, tetoMin: number): SessaoPortal => ({
  token: 'x'.repeat(40),
  expira_em: new Date(T0 + tokenMin * 60_000).toISOString(),
  sessao_expira_em: new Date(T0 + tetoMin * 60_000).toISOString(),
  recuperacao_restantes: 10,
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
    expect(lerSessaoPortal(st)?.recuperacao_restantes).toBe(10);
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
