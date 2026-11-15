import { matrizDeFabrica, perfilDeFabrica, PERFIS, pode, resolverPerfil, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  avaliarAlteracaoDeUsuario,
  diffAuditavelDeUsuario,
  normalizarEmail,
  podeVerUsuarios,
  recortarUsuarios,
  superiorImediatoNaEquipe,
  validarDadosDeUsuario,
  validarSenhaInicial,
} from './usuarios';
import { perfisDeFabrica } from './matriz';

describe('usuários no BKO (RF-CORE-02): quem pode gerir e ver', () => {
  it('RF-CORE-02 / RN-CORE-35: pelas chaves do motor, só o admin de fábrica cria, edita, desativa e redefine senha', () => {
    for (const chave of ['usuario.criar', 'usuario.editar', 'usuario.desativar', 'senha.redefinir', 'perfil.gerir']) {
      expect(PERFIS.filter((p) => pode(perfisDeFabrica(p), chave)), chave).toEqual(['admin']);
    }
  });
  it('RN-CORE-04/33: leitura da lista para gerente e admin; supervisor (sem BKO) e os demais perfis não', () => {
    expect(PERFIS.filter((p) => podeVerUsuarios(p))).toEqual(['gerente', 'admin']);
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
  it('RN-CORE-32: senha inicial exige 8+ caracteres com letra, número e especial, e não pode ser o e-mail', () => {
    expect(validarSenhaInicial('Abcdef1!', 'a@b.co')).toBeNull();
    expect(validarSenhaInicial('Abcdef12', 'a@b.co')).toBe('Falta um caractere especial.');
    expect(validarSenhaInicial('curta1!', 'a@b.co')).toContain('pelo menos 8 caracteres');
    expect(validarSenhaInicial('somenteletras', 'a@b.co')).toBe('Faltam um número e um caractere especial.');
    expect(validarSenhaInicial('123456789!', 'a@b.co')).toBe('Falta uma letra.');
    expect(validarSenhaInicial('ana@exemplo.com.br', 'ana@exemplo.com.br')).toBe('Falta um número.');
  });
  it('RN-CORE-32: senha igual ao e-mail é recusada mesmo cumprindo a regra', () => {
    expect(validarSenhaInicial('ana1@exemplo.com.br', 'ana1@exemplo.com.br')).toBe('A senha não pode ser igual ao e-mail.');
  });
});

describe('desativar e alterar perfil (RF-CORE-01/02; RN-CORE-01/35)', () => {
  const matriz = matrizDeFabrica([]);
  const admin = { id: 'a1', perfis: perfisDeFabrica('admin') };
  type U = { id: string; perfil: Perfil; ativo: boolean };
  const u = (o: Partial<U> = {}): U => ({ id: 'u1', perfil: 'vendedor', ativo: true, ...o });
  const adm = (id: string, o: Partial<U> = {}): U => u({ id, perfil: 'admin', ...o });
  const avaliar = (ator: { id: string; perfis: ReturnType<typeof perfisDeFabrica> }, alvo: U, depois: { perfil: Perfil; ativo: boolean }, outros: U[]) =>
    avaliarAlteracaoDeUsuario({ ator, alvo, depois, usuarios: [...outros, alvo], matriz });
  it('RN-CORE-35: quem não tem usuario.editar é recusado (USUARIO_SEM_PERMISSAO), qualquer que seja o perfil', () => {
    for (const p of PERFIS.filter((x) => x !== 'admin')) {
      const r = avaliar({ id: 's1', perfis: perfisDeFabrica(p) }, u(), { perfil: 'vendedor', ativo: true }, [adm('a1')]);
      expect(r, p).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
    }
  });
  it('RN-CORE-35: a chave concedida a outro perfil por sobreposição basta, sem ser admin (nada de nome fixo)', () => {
    const gerente = resolverPerfil({ ...perfilDeFabrica('gerente'), codigo: 'coord', fabrica: false, sobreposicoes: [{ chave: 'usuario.editar', concedida: true }] }, matriz);
    expect(avaliar({ id: 'g1', perfis: [gerente] }, u(), { perfil: 'promotor', ativo: true }, [adm('a1')])).toEqual({ ok: true });
    // desativar é outra chave
    expect(avaliar({ id: 'g1', perfis: [gerente] }, u(), { perfil: 'vendedor', ativo: false }, [adm('a1')])).toMatchObject({ ok: false, codigo: 'USUARIO_SEM_PERMISSAO' });
  });
  it('RF-CORE-02: admin desativa outro usuário', () => {
    expect(avaliar(admin, u(), { perfil: 'vendedor', ativo: false }, [adm('a1')])).toEqual({ ok: true });
  });
  it('RF-CORE-02: o admin não desativa a si mesmo (usuario.desativar nunca no próprio)', () => {
    const r = avaliar(admin, adm('a1'), { perfil: 'admin', ativo: false }, [adm('a2'), adm('a3')]);
    expect(r).toMatchObject({ ok: false, codigo: 'USUARIO_AUTODESATIVACAO' });
  });
  it('RN-CORE-35: o admin não tira de si mesmo a gestão do acesso (AUTOGESTAO, 422 com a regra)', () => {
    const r = avaliar(admin, adm('a1'), { perfil: 'gerente', ativo: true }, [adm('a2'), adm('a3')]);
    expect(r).toMatchObject({ ok: false, codigo: 'USUARIO_AUTORREBAIXA', regra: 'RN-CORE-35' });
  });
  it('RN-CORE-35: o último admin ativo não é desativado nem rebaixado (ULTIMO_ADMIN)', () => {
    const outro = adm('a2');
    expect(avaliar(admin, outro, { perfil: 'admin', ativo: false }, [])).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN', regra: 'RN-CORE-35' });
    expect(avaliar(admin, outro, { perfil: 'analista', ativo: true }, [])).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(avaliar(admin, outro, { perfil: 'admin', ativo: false }, [adm('a3')])).toEqual({ ok: true });
  });
  it('RN-CORE-01: reativar usa usuario.editar e não derruba ninguém', () => {
    expect(avaliar(admin, u({ ativo: false }), { perfil: 'vendedor', ativo: true }, [adm('a1')])).toEqual({ ok: true });
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
