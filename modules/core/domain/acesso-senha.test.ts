import { matrizDeFabrica, perfilDeFabrica, PERFIS, perfilUsaApp, resolverPerfil, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { perfisDeFabrica, podeAcessarBko, podeUsarApp, podeVer } from './matriz';
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

describe('RN-CORE-34/35: podeRedefinirSenha (chave senha.redefinir do motor)', () => {
  const ator = { id: 'a1', perfis: perfisDeFabrica('admin') };
  const alvo = (id: string, p: Perfil, ativo = true) => ({ id, perfis: [{ codigo: p, base: p }], ativo });
  it('RN-CORE-34: o admin redefine vendedor, supervisor, gerente e demais perfis ativos', () => {
    for (const p of PERFIS.filter((x) => x !== 'admin')) expect(podeRedefinirSenha(ator, alvo('x', p)), p).toEqual({ ok: true });
  });
  it('RN-CORE-34 (P7): recusa a própria senha, a de outro admin e usuário inativo', () => {
    expect(podeRedefinirSenha(ator, alvo('a1', 'admin'))).toMatchObject({ ok: false, codigo: 'SENHA_PROPRIA' });
    expect(podeRedefinirSenha(ator, alvo('a1', 'vendedor'))).toMatchObject({ ok: false, codigo: 'SENHA_PROPRIA' });
    expect(podeRedefinirSenha(ator, alvo('a2', 'admin'))).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
    expect(podeRedefinirSenha(ator, alvo('x', 'vendedor', false))).toMatchObject({ ok: false, codigo: 'USUARIO_INATIVO' });
  });
  it('RN-CORE-35 (P2): sem a chave senha.redefinir ninguém redefine, qualquer que seja o perfil', () => {
    for (const p of PERFIS.filter((x) => x !== 'admin')) {
      expect(podeRedefinirSenha({ id: 'z', perfis: perfisDeFabrica(p) }, alvo('x', 'vendedor')), p).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    }
  });
  it('RN-CORE-35: com a chave concedida só para alguns perfis-alvo, o resto é recusado', () => {
    const coord = resolverPerfil({ ...perfilDeFabrica('gerente'), codigo: 'coord', fabrica: false, sobreposicoes: [{ chave: 'senha.redefinir', concedida: true, alvos: ['vendedor'] }] }, matrizDeFabrica([]));
    const g = { id: 'g1', perfis: [coord] };
    expect(podeRedefinirSenha(g, alvo('x', 'vendedor'))).toEqual({ ok: true });
    expect(podeRedefinirSenha(g, alvo('x', 'promotor'))).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    expect(podeRedefinirSenha(g, alvo('x', 'admin'))).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
  });
});

describe('RN-CORE-34/35 (T-0111): podeRedefinirSenha olha TODOS os perfis do alvo', () => {
  const ator = { id: 'a1', perfis: perfisDeFabrica('admin') };
  const ref = (p: Perfil) => ({ codigo: p, base: p });
  const coord = (alvos: string[]) =>
    resolverPerfil({ ...perfilDeFabrica('gerente'), codigo: 'coord', fabrica: false, sobreposicoes: [{ chave: 'senha.redefinir', concedida: true, alvos }] }, matrizDeFabrica([]));
  it('RN-CORE-34: alvo [analista, admin] é recusado como admin, mesmo com o principal analista e com a lista "todos"', () => {
    expect(podeRedefinirSenha(ator, { id: 'x', perfis: [ref('analista'), ref('admin')], ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
    expect(podeRedefinirSenha(ator, { id: 'x', perfis: [ref('admin'), ref('analista')], ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
    expect(podeRedefinirSenha({ id: 'g1', perfis: [coord(['analista'])] }, { id: 'x', perfis: [ref('analista'), ref('admin')], ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_DE_ADMIN' });
  });
  it('RN-CORE-35: alvo [vendedor, supervisor] só passa se a lista cobre os dois perfis', () => {
    const alvo = { id: 'x', perfis: [ref('vendedor'), ref('supervisor')], ativo: true };
    expect(podeRedefinirSenha(ator, alvo)).toEqual({ ok: true });
    expect(podeRedefinirSenha({ id: 'g1', perfis: [coord(['vendedor'])] }, alvo)).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    expect(podeRedefinirSenha({ id: 'g1', perfis: [coord(['supervisor'])] }, alvo)).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    expect(podeRedefinirSenha({ id: 'g1', perfis: [coord(['vendedor', 'supervisor'])] }, alvo)).toEqual({ ok: true });
  });
  it('RN-CORE-34: a própria senha é sempre recusada, também com vários perfis', () => {
    expect(podeRedefinirSenha(ator, { id: 'a1', perfis: [ref('vendedor'), ref('supervisor')], ativo: true })).toMatchObject({ ok: false, codigo: 'SENHA_PROPRIA' });
  });
  it('RN-CORE-35: alvo sem nenhum perfil conhecido é recusado (falha fechada) para quem tem lista restrita', () => {
    expect(podeRedefinirSenha({ id: 'g1', perfis: [coord(['vendedor'])] }, { id: 'x', perfis: [], ativo: true })).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
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
  it('RN-CORE-33: podeAcessarBko e podeUsarApp seguem as chaves acesso.* da fábrica; vendedor, promotor e supervisor ficam fora do BKO', () => {
    const NO_BKO = ['gerente', 'analista', 'assistente', 'admin'];
    for (const p of PERFIS) expect(podeAcessarBko(perfisDeFabrica(p)), p).toBe(NO_BKO.includes(p));
    expect(podeAcessarBko(perfisDeFabrica('vendedor'))).toBe(false);
    expect(podeAcessarBko(perfisDeFabrica('promotor'))).toBe(false);
    for (const p of PERFIS) for (const app of ['campo', 'gestao', 'web'] as const) expect(podeUsarApp(perfisDeFabrica(p), app), `${p} ${app}`).toBe(app === 'web' ? NO_BKO.includes(p) : perfilUsaApp(p, app));
  });
  it('RN-CORE-33: supervisor não vê a lista de usuários (tela do BKO)', () => {
    expect(podeVer('supervisor', 'usuario.ver')).toBe(false);
    expect(podeVer('gerente', 'usuario.ver')).toBe(true);
    expect(podeVer('admin', 'usuario.ver')).toBe(true);
  });
});
