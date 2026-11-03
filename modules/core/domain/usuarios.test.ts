import { PERFIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  avaliarAlteracaoDeUsuario,
  diffAuditavelDeUsuario,
  normalizarEmail,
  podeGerirUsuarios,
  podeVerUsuarios,
  recortarUsuarios,
  superiorImediatoNaEquipe,
  validarDadosDeUsuario,
  validarSenhaInicial,
} from './usuarios';

describe('usuários no BKO (RF-CORE-02): quem pode gerir e ver', () => {
  it('RF-CORE-02: só o admin cria, edita, desativa e define senha', () => {
    expect(PERFIS.filter((p) => podeGerirUsuarios(p))).toEqual(['admin']);
  });
  it('RN-CORE-04: leitura da lista para supervisor, gerente e admin; os demais perfis não', () => {
    expect(PERFIS.filter((p) => podeVerUsuarios(p))).toEqual(['supervisor', 'gerente', 'admin']);
  });
});

describe('validação de entrada (RF-CORE-02)', () => {
  const ok = { nome: 'Ana Souza', email: 'Ana@Exemplo.com.br', perfil: 'vendedor', external_id: null } as const;
  it('RF-CORE-02: e-mail é normalizado (aparado e em minúsculas)', () => {
    expect(normalizarEmail('  Ana@Exemplo.COM.br ')).toBe('ana@exemplo.com.br');
  });
  it('RF-CORE-02: dados válidos passam sem erros', () => {
    expect(validarDadosDeUsuario(ok)).toEqual([]);
  });
  it('RF-CORE-02: nome vazio e e-mail sem domínio são recusados com mensagem em português', () => {
    const e = validarDadosDeUsuario({ ...ok, nome: '   ', email: 'ana@exemplo' });
    expect(e.map((x) => x.campo).sort()).toEqual(['email', 'nome']);
    expect(e.every((x) => x.mensagem.length > 0)).toBe(true);
  });
  it('RF-CORE-02: perfil fora da lista é recusado', () => {
    expect(validarDadosDeUsuario({ ...ok, perfil: 'dono' }).map((x) => x.campo)).toEqual(['perfil']);
  });
  it('RF-CORE-02: external_id em branco é recusado (use vazio/nulo para "sem código")', () => {
    expect(validarDadosDeUsuario({ ...ok, external_id: '  ' }).map((x) => x.campo)).toEqual(['external_id']);
  });
  it('RF-CORE-01: senha inicial exige 8+ caracteres com letra e número, e não pode ser o e-mail', () => {
    expect(validarSenhaInicial('Abcdef12', 'a@b.co')).toBeNull();
    expect(validarSenhaInicial('curta1', 'a@b.co')).not.toBeNull();
    expect(validarSenhaInicial('somenteletras', 'a@b.co')).not.toBeNull();
    expect(validarSenhaInicial('123456789', 'a@b.co')).not.toBeNull();
    expect(validarSenhaInicial('ana@exemplo.com.br', 'ana@exemplo.com.br')).not.toBeNull();
  });
});

describe('desativar e alterar perfil (RF-CORE-01/02)', () => {
  const admin = { id: 'a1', perfil: 'admin' as const };
  const alvo = (o: Partial<{ id: string; perfil: (typeof PERFIS)[number]; ativo: boolean }> = {}) => ({ id: 'u1', perfil: 'vendedor' as const, ativo: true, ...o });
  it('RF-CORE-02: não-admin é recusado (USUARIO_SEM_PERMISSAO)', () => {
    const r = avaliarAlteracaoDeUsuario({ ator: { id: 's1', perfil: 'supervisor' }, alvo: alvo(), depois: { perfil: 'vendedor', ativo: true }, adminsAtivos: 2 });
    expect(r).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
  });
  it('RF-CORE-02: admin desativa outro usuário', () => {
    expect(avaliarAlteracaoDeUsuario({ ator: admin, alvo: alvo(), depois: { perfil: 'vendedor', ativo: false }, adminsAtivos: 1 })).toEqual({ ok: true });
  });
  it('RF-CORE-02: o admin não desativa a si mesmo (perderia o acesso)', () => {
    const r = avaliarAlteracaoDeUsuario({ ator: admin, alvo: alvo({ id: 'a1', perfil: 'admin' }), depois: { perfil: 'admin', ativo: false }, adminsAtivos: 3 });
    expect(r).toMatchObject({ ok: false, codigo: 'USUARIO_AUTODESATIVACAO' });
  });
  it('RF-CORE-02: o admin não rebaixa o próprio perfil', () => {
    const r = avaliarAlteracaoDeUsuario({ ator: admin, alvo: alvo({ id: 'a1', perfil: 'admin' }), depois: { perfil: 'gerente', ativo: true }, adminsAtivos: 3 });
    expect(r).toMatchObject({ ok: false, codigo: 'USUARIO_AUTORREBAIXA' });
  });
  it('RF-CORE-02: o último admin ativo não é desativado nem rebaixado', () => {
    const outro = alvo({ id: 'a2', perfil: 'admin' });
    expect(avaliarAlteracaoDeUsuario({ ator: admin, alvo: outro, depois: { perfil: 'admin', ativo: false }, adminsAtivos: 1 })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(avaliarAlteracaoDeUsuario({ ator: admin, alvo: outro, depois: { perfil: 'analista', ativo: true }, adminsAtivos: 1 })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(avaliarAlteracaoDeUsuario({ ator: admin, alvo: outro, depois: { perfil: 'admin', ativo: false }, adminsAtivos: 2 })).toEqual({ ok: true });
  });
});

describe('visibilidade da lista (RN-CORE-04)', () => {
  const itens = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('RN-CORE-04: escopo de tenant devolve todos', () => {
    expect(recortarUsuarios(itens, 'tenant')).toHaveLength(3);
  });
  it('RN-CORE-04: escopo de equipe devolve só os ids visíveis', () => {
    expect(recortarUsuarios(itens, new Set(['b'])).map((i) => i.id)).toEqual(['b']);
  });
  it('RN-CORE-04: escopo vazio devolve lista vazia', () => {
    expect(recortarUsuarios(itens, new Set())).toEqual([]);
  });
});

describe('auditoria da alteração (RN-AUD-01)', () => {
  const base = { nome: 'Ana', nome_curto: null, email: 'ana@x.com', perfil: 'vendedor', equipe_id: 'e1', ativo: true, external_id: null };
  it('RN-AUD-01: registra só o que mudou, sem nome e e-mail em claro', () => {
    const d = diffAuditavelDeUsuario(base, { ...base, nome: 'Ana Maria', email: 'nova@x.com', perfil: 'supervisor' });
    expect(d.campos_alterados.sort()).toEqual(['email', 'nome', 'perfil']);
    expect(d.antes).toEqual({ perfil: 'vendedor' });
    expect(d.depois).toEqual({ perfil: 'supervisor' });
    expect(JSON.stringify(d)).not.toContain('nova@x.com');
    expect(JSON.stringify(d)).not.toContain('Ana Maria');
  });
  it('RN-AUD-01: nunca inclui senha ou hash, mesmo que venham no objeto', () => {
    const d = diffAuditavelDeUsuario({ ...base, senha_hash: '$argon2id$a' } as never, { ...base, ativo: false, senha_hash: '$argon2id$b' } as never);
    expect(JSON.stringify(d)).not.toContain('argon2');
    expect(d.antes).toEqual({ ativo: true });
    expect(d.depois).toEqual({ ativo: false });
  });
  it('RN-AUD-01: sem mudança, lista vazia', () => {
    expect(diffAuditavelDeUsuario(base, { ...base }).campos_alterados).toEqual([]);
  });
});

describe('superior imediato derivado da equipe (RF-CORE-02; RN-CORE-04)', () => {
  const equipes = [
    { id: 'regional', equipe_pai_id: null, responsavel_id: 'ger' },
    { id: 'eq1', equipe_pai_id: 'regional', responsavel_id: 'sup' },
    { id: 'eq2', equipe_pai_id: 'regional', responsavel_id: null },
  ];
  it('RN-CORE-04: o superior de quem entra na equipe é o responsável dela', () => {
    expect(superiorImediatoNaEquipe(equipes, 'eq1')).toBe('sup');
  });
  it('RN-CORE-04: equipe sem responsável sobe para o responsável da equipe-pai', () => {
    expect(superiorImediatoNaEquipe(equipes, 'eq2')).toBe('ger');
  });
  it('RN-CORE-04: sem equipe (ou equipe desconhecida) não há superior', () => {
    expect(superiorImediatoNaEquipe(equipes, null)).toBeNull();
    expect(superiorImediatoNaEquipe(equipes, 'nada')).toBeNull();
  });
});
