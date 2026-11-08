import { PERFIS, perfilUsaApp } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { podeAcessarBko, podeVer } from './matriz';
import {
  SENHA_TEMPORARIA_HORAS,
  avaliarSenhaDoLogin,
  gerarSenhaTemporaria,
  podeRedefinirSenha,
  validadeDaSenhaTemporaria,
  validarSenhaNova,
} from './acesso-senha';
import { senhaServe } from './senha';

const AGORA = new Date('2026-11-07T12:00:00Z');
const h = (horas: number, base = AGORA) => new Date(base.getTime() + horas * 3_600_000);
const base = { certaAtual: false, certaTemporaria: false, trocarSenha: false, senhaExpiraEm: null, temporariaExpiraEm: null, ultimoLoginEm: null, agora: AGORA };

describe('RN-CORE-34: validade da senha temporária', () => {
  it('RN-CORE-34: a senha temporária vale 72 horas', () => {
    expect(SENHA_TEMPORARIA_HORAS).toBe(72);
    expect(validadeDaSenhaTemporaria(AGORA).toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('RN-CORE-34: avaliarSenhaDoLogin', () => {
  it('RN-CORE-34: senha definitiva certa entra (ok), mesmo com temporária paralela (P6)', () => {
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true })).toEqual({ tipo: 'ok' });
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true, temporariaExpiraEm: h(10) })).toEqual({ tipo: 'ok' });
  });
  it('RN-CORE-34: senha atual temporária certa, usuário nunca entrou = troca por primeiro_acesso', () => {
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true, trocarSenha: true, senhaExpiraEm: h(5) })).toEqual({ tipo: 'trocar', motivo: 'primeiro_acesso', expiraEm: h(5), usada: 'atual' });
  });
  it('RN-CORE-34: senha atual temporária certa, usuário já entrou antes = senha_temporaria', () => {
    const r = avaliarSenhaDoLogin({ ...base, certaAtual: true, trocarSenha: true, senhaExpiraEm: h(5), ultimoLoginEm: h(-100) });
    expect(r).toMatchObject({ tipo: 'trocar', motivo: 'senha_temporaria', usada: 'atual' });
  });
  it('RN-CORE-34 (P5): senha master sem validade pede troca com expiraEm nulo', () => {
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true, trocarSenha: true })).toEqual({ tipo: 'trocar', motivo: 'primeiro_acesso', expiraEm: null, usada: 'atual' });
  });
  it('RN-CORE-34: 71 h 59 min vale; 72 h exatas vence', () => {
    const exp = validadeDaSenhaTemporaria(AGORA);
    const vale = new Date(AGORA.getTime() + 71 * 3_600_000 + 59 * 60_000);
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true, trocarSenha: true, senhaExpiraEm: exp, agora: vale }).tipo).toBe('trocar');
    expect(avaliarSenhaDoLogin({ ...base, certaAtual: true, trocarSenha: true, senhaExpiraEm: exp, agora: exp }).tipo).toBe('vencida');
    expect(avaliarSenhaDoLogin({ ...base, certaTemporaria: true, temporariaExpiraEm: exp, agora: vale }).tipo).toBe('trocar');
    expect(avaliarSenhaDoLogin({ ...base, certaTemporaria: true, temporariaExpiraEm: exp, agora: exp }).tipo).toBe('vencida');
  });
  it('RN-CORE-34: temporária do "Esqueci" certa e válida pede troca (senha_temporaria)', () => {
    expect(avaliarSenhaDoLogin({ ...base, certaTemporaria: true, temporariaExpiraEm: h(3) })).toEqual({ tipo: 'trocar', motivo: 'senha_temporaria', expiraEm: h(3), usada: 'temporaria' });
  });
  it('RN-CORE-34: temporária certa sem validade registrada é vencida (falha fechada)', () => {
    expect(avaliarSenhaDoLogin({ ...base, certaTemporaria: true }).tipo).toBe('vencida');
  });
  it('RN-CORE-34: nenhuma senha certa = errada', () => {
    expect(avaliarSenhaDoLogin({ ...base, trocarSenha: true, senhaExpiraEm: h(-1) })).toEqual({ tipo: 'errada' });
  });
});

describe('RN-CORE-32/34: validarSenhaNova', () => {
  it('RN-CORE-32: aplica a política e recusa igual ao e-mail', () => {
    expect(validarSenhaNova('abc', 'a@b.com', false)).toMatchObject({ codigo: 'RN-CORE-32' });
    expect(validarSenhaNova('a@b.com', 'a@b.com', false)).toMatchObject({ codigo: 'RN-CORE-32' });
    const r = validarSenhaNova('abc', 'a@b.com', false);
    expect(r && 'faltas' in r ? r.faltas : []).toContain('caracteres');
  });
  it('RN-CORE-34: recusa repetir a senha usada para entrar', () => {
    expect(validarSenhaNova('Boa#Senha1', 'a@b.com', true)).toEqual({ codigo: 'RN-CORE-34', mensagem: 'A senha nova não pode ser igual à senha temporária.' });
  });
  it('RN-CORE-32: senha boa e diferente passa', () => {
    expect(validarSenhaNova('Boa#Senha1', 'a@b.com', false)).toBeNull();
  });
});

describe('RN-CORE-34: podeRedefinirSenha', () => {
  const ator = { id: 'a1', perfil: 'admin' as const };
  it('RN-CORE-34: o admin redefine vendedor, supervisor, gerente e demais perfis ativos', () => {
    for (const p of PERFIS.filter((x) => x !== 'admin')) expect(podeRedefinirSenha(ator, { id: 'x', perfil: p, ativo: true }), p).toEqual({ ok: true });
  });
  it('RN-CORE-34 (P7): recusa a própria senha, a de outro admin e usuário inativo', () => {
    expect(podeRedefinirSenha(ator, { id: 'a1', perfil: 'admin', ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_PROPRIA' });
    expect(podeRedefinirSenha(ator, { id: 'a1', perfil: 'vendedor', ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_PROPRIA' });
    expect(podeRedefinirSenha(ator, { id: 'a2', perfil: 'admin', ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
    expect(podeRedefinirSenha(ator, { id: 'x', perfil: 'vendedor', ativo: false })).toMatchObject({ ok: false, codigo: 'USUARIO_INATIVO' });
  });
  it('RN-CORE-34 (P2): só quem tem usuario.gerir (admin) redefine', () => {
    for (const p of PERFIS.filter((x) => x !== 'admin')) {
      expect(podeRedefinirSenha({ id: 'z', perfil: p }, { id: 'x', perfil: 'vendedor', ativo: true }), p).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    }
  });
});

describe('RN-CORE-34: gerarSenhaTemporaria', () => {
  const fonte = (semente: number) => {
    let s = semente;
    return (n: number) => Uint8Array.from({ length: n }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16) & 0xff);
  };
  it('RN-CORE-34: 12 caracteres, sem ambíguos, com letra, número e especial, e passa na RN-CORE-32', () => {
    for (let i = 1; i <= 200; i++) {
      const s = gerarSenhaTemporaria(fonte(i));
      expect(s).toHaveLength(12);
      expect(s).not.toMatch(/[0O1lI\s]/);
      expect(s).toMatch(/[A-Za-z]/);
      expect(s).toMatch(/[2-9]/);
      expect(s).toMatch(/[!@#$%&*?]/);
      expect(senhaServe(s)).toBe(true);
    }
  });
  it('RN-CORE-34: fontes diferentes dão senhas diferentes', () => {
    expect(gerarSenhaTemporaria(fonte(1))).not.toBe(gerarSenhaTemporaria(fonte(2)));
  });
});

describe('RN-CORE-33: acesso ao BKO', () => {
  it('RN-CORE-33: podeAcessarBko segue perfilUsaApp(web) do SDK; vendedor e promotor ficam de fora', () => {
    for (const p of PERFIS) expect(podeAcessarBko(p), p).toBe(perfilUsaApp(p, 'web'));
    expect(podeAcessarBko('vendedor')).toBe(false);
    expect(podeAcessarBko('promotor')).toBe(false);
  });
  it('RN-CORE-33: supervisor não vê a lista de usuários (tela do BKO)', () => {
    expect(podeVer('supervisor', 'usuario.ver')).toBe(false);
    expect(podeVer('gerente', 'usuario.ver')).toBe(true);
    expect(podeVer('admin', 'usuario.ver')).toBe(true);
  });
});
