/**
 * T-0178 (RF-CORE-01; RN-CORE-32 e RN-CORE-34; spec docs/design/trocar-senha/spec.md §2, §6 e §7): a ligação do shell à
 * "Trocar senha" do Perfil. As telas são do Core (`TelaTrocarSenha`, `TelaEsqueciSenha`); aqui, a conta da sessão e a troca da
 * sessão pela nova que a API devolve (a troca sobe a `sessao_versao` e os tokens antigos deixam de valer).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contaDaSessao, sessaoDepoisDaTroca } from './trocar-senha-shell';

const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const atual = {
  token: 'acesso-antigo',
  user: { id: 'u1', name: 'Lucas', email: 'lucas@exemplo.com.br', perfil: 'vendedor' as const },
  tenant: { id: 't1', codigo: 'RR0001', nome: 'Empresa', fuso: 'America/Manaus' },
  modo: 'v1' as const,
};
const resposta = {
  access_token: 'acesso-novo',
  refresh_token: 'renovacao-nova',
  usuario: { id: 'u1', nome: 'Lucas Silva', email: 'lucas@exemplo.com.br', perfil: 'vendedor' as const },
  tenant: { id: 't1', codigo: 'RR0001', nome: 'Empresa', fuso: 'America/Manaus' },
};

describe('contaDaSessao: código da empresa e e-mail de quem está no app (RN-CORE-32/34 valem só na API real)', () => {
  it('na API real, vem do tenant e do usuário da sessão', () => {
    expect(contaDaSessao(atual)).toEqual({ codigoEmpresa: 'RR0001', email: 'lucas@exemplo.com.br' });
  });
  it('sem sessão, na demonstração (sem senha) ou sem tenant: não há troca de senha', () => {
    expect(contaDaSessao(null)).toBeNull();
    expect(contaDaSessao({ ...atual, modo: 'demo' })).toBeNull();
    expect(contaDaSessao({ ...atual, tenant: null })).toBeNull();
  });
});

describe('sessaoDepoisDaTroca: a sessão nova toma o lugar da atual (RN-CORE-34, tokens antigos deixam de valer)', () => {
  it('mesmo usuário e mesmo tenant: troca o token e mantém o resto da sessão', () => {
    const nova = sessaoDepoisDaTroca(atual, resposta);
    expect(nova).toEqual({ ...atual, token: 'acesso-novo', user: { ...atual.user, name: 'Lucas Silva' } });
  });
  it('resposta de outro usuário ou de outro tenant: não troca (o shell não mistura sessões)', () => {
    expect(
      sessaoDepoisDaTroca(atual, { ...resposta, usuario: { ...resposta.usuario, id: 'u2' } }),
    ).toBeNull();
    expect(sessaoDepoisDaTroca(atual, { ...resposta, tenant: { ...resposta.tenant, id: 't2' } })).toBeNull();
    expect(sessaoDepoisDaTroca(null, resposta)).toBeNull();
  });
});

describe('ligação nas rotas: a senha só vive na memória da tela', () => {
  const trocar = fonte('../app/trocar-senha.tsx');
  const esqueci = fonte('../app/esqueci-senha.tsx');
  const plataforma = fonte('../state/plataforma.tsx');
  it('a troca usa trocarMinhaSenha com o app da variante e salva só os tokens novos', () => {
    expect(plataforma).toMatch(/trocarMinhaSenha\(post, conta, corpo, variante, await aparelhoDoLogin\(\)\)/);
    expect(plataforma).toMatch(/gravarTokens\(\{ access: r\.access_token, refresh: r\.refresh_token \}\)/);
  });
  it('a senha nunca vai a SecureStore, AsyncStorage, URL ou log', () => {
    for (const t of [trocar, esqueci]) {
      expect(t).not.toMatch(/SecureStore\.|AsyncStorage\.|writeJson\(|gravarTokens\(/);
      expect(t).not.toMatch(/\bconsole\s*\./);
      expect(t).not.toMatch(/router\.\w+\([^)]*senha_/);
    }
  });
  it('sucesso volta ao Perfil com "Senha trocada." e "Esqueci a senha" abre empilhada (spec §6 e §7)', () => {
    expect(trocar).toMatch(/guardarAvisoPosLogin\(TEXTOS_TROCAR_SENHA\.trocada\)/);
    expect(trocar).toMatch(/router\.push\('\/esqueci-senha'\)/);
    expect(esqueci).toMatch(/dentroDoApp=\{conta\}/);
  });
  it('a TelaTrocarSenha do Core não recebe a sessão (Revisão 4 do core)', () => {
    expect(trocar).not.toMatch(/\bsessao=/);
  });
});
