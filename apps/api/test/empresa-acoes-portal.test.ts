/**
 * Ações da empresa no portal (ADR 0052; desenho docs/desenho/empresa-acoes.md) sem banco real: desligado por padrão, só
 * super-admin, Inativar/Reativar (RN-PLA-07), Backup (RN-PLA-08) com a falha fechada sem bucket ou chave, Excluir (RN-PLA-09)
 * com a senha do super-admin conferida de novo no limite de falhas do login do portal, a tradução dos SQLSTATE das `sa_*` e o
 * bloco `acoes` da lista de empresas. As funções `sa_*` de verdade são testadas no CI (`*.db.test.ts` do banco-dados).
 */
import {
  BackupEmpresaSchema,
  ExclusaoEmpresaSchema,
  ListaEmpresasSchema,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  SituacaoEmpresaRespostaSchema,
  type AcessoPortalAutenticado,
  type AcoesDaEmpresa,
  type BackupEmpresa,
  type ExclusaoEmpresa,
} from '@macuxi/platform-sdk';
import { chaveDeTentativaDoPortal } from '@macuxi/platform-sdk/tentativas-portal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { backupEmpresaDisponivel, empresaAcoesLigadas } from '../src/config';
import type { EstadoTentativaPortal, FonteAcoesEmpresa } from '../src/empresa-acoes-portal';
import { fontePlataformaNoBanco, type FontePlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const EMPRESA = '0a000000-0000-4000-8000-000000000001';
const OUTRA = '0a000000-0000-4000-8000-000000000002';
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: EMPRESA, usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const BACKUP = '9c000000-0000-4000-8000-000000000001';
const EXCLUSAO = '9d000000-0000-4000-8000-000000000001';
const SEGREDO = 's'.repeat(40);
const { SENHA, HASH } = vi.hoisted(() => ({ SENHA: 'Senha#Certa2026', HASH: '$argon2id$v=19$m=19456,t=2,p=1$c2Fs$HASH' }));
// argon2 de verdade é do @macuxi/db (testado lá); aqui só a resposta da conferência
vi.mock('@macuxi/db', async (original) => ({
  ...(await original<typeof import('@macuxi/db')>()),
  verificarSenha: (senha: string, phc: string) => senha === SENHA && phc === HASH,
}));
const EMAIL = 'Equipe@Macuxi.com.br';
const AGORA = new Date('2026-11-15T12:00:00Z');

const backupCru = (situacao: 'em_andamento' | 'pronto' = 'em_andamento'): BackupEmpresa => ({
  id: BACKUP,
  tenant_id: EMPRESA,
  situacao,
  consistente: true,
  pedido_em: '2026-11-15T11:00:00+00:00',
  iniciado_em: null,
  concluido_em: situacao === 'pronto' ? '2026-11-15T11:30:00+00:00' : null,
  expira_em: null,
  progresso_pct: situacao === 'pronto' ? 100 : 0,
  tamanho_bytes: situacao === 'pronto' ? 1024 : null,
  tabelas: null,
  linhas: null,
  arquivos: null,
  erro_codigo: null,
});
const exclusaoCrua: ExclusaoEmpresa = {
  id: EXCLUSAO,
  tenant_id: EMPRESA,
  codigo: 'distrib',
  backup_id: BACKUP,
  situacao: 'em_andamento',
  etapa: 'banco',
  pedida_em: '2026-11-15T12:00:00+00:00',
  concluida_em: null,
  linhas_apagadas: null,
  arquivos_apagados: null,
  erro_codigo: null,
};
const acoesCruas: AcoesDaEmpresa = {
  inativada_em: '2026-11-15T10:00:00+00:00',
  motivo_inativacao: null,
  ultimo_backup: backupCru('pronto'),
  exclusao: null,
  exclusao_bloqueada: null,
};
const erroPg = (code: string, hint?: string) => Object.assign(new Error(code), { code, ...(hint ? { hint } : {}) });

interface OpcoesMontar {
  ligado?: boolean;
  backup?: boolean;
  falha?: Partial<Record<keyof FonteAcoesEmpresa, Error>>;
  bloqueadoAte?: Date | null;
  bloqueiaNaFalha?: boolean;
  semConta?: boolean;
}

function montar(op: OpcoesMontar = {}) {
  const chamadas: { funcao: keyof FonteAcoesEmpresa; args: unknown[] }[] = [];
  const estado = (bloqueado: Date | null): EstadoTentativaPortal => ({ falhas: bloqueado ? 5 : 1, bloqueado_ate: bloqueado });
  const registrar =
    <K extends keyof FonteAcoesEmpresa>(funcao: K, resposta: (...args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      chamadas.push({ funcao, args: args.slice(0, -1) });
      const erro = op.falha?.[funcao];
      if (erro) throw erro;
      return resposta(...args);
    };
  const fonte = {
    inativar: registrar('inativar', (_s, t, motivo) => ({ tenant_id: t, status: 'suspenso', inativada_em: '2026-11-15T12:00:00+00:00', motivo, resultado: 'alterado' })),
    reativar: registrar('reativar', (_s, t) => ({ tenant_id: t, status: 'ativo', inativada_em: null, motivo: null, resultado: 'sem_mudanca' })),
    pedirBackup: registrar('pedirBackup', () => backupCru()),
    listarBackups: registrar('listarBackups', (_s, _t, id) => ({ itens: id === null || id === BACKUP ? [backupCru('pronto')] : [] })),
    pedirExclusao: registrar('pedirExclusao', () => exclusaoCrua),
    lerExclusao: registrar('lerExclusao', (_s, t) => (t === EMPRESA ? exclusaoCrua : null)),
    reautenticar: registrar('reautenticar', () => (op.semConta ? null : { super_admin_id: SA.tipo === 'super_admin' ? SA.id : '', email: EMAIL, senha_hash: HASH })),
    tentativaEstado: registrar('tentativaEstado', () => estado(op.bloqueadoAte ?? null)),
    tentativaFalha: registrar('tentativaFalha', () => estado(op.bloqueiaNaFalha ? new Date(AGORA.getTime() + 900_000) : null)),
    tentativaSucesso: registrar('tentativaSucesso', () => undefined),
    acoesDasEmpresas: registrar('acoesDasEmpresas', () => ({ itens: [{ tenant_id: EMPRESA, ...acoesCruas }] })),
  } as FonteAcoesEmpresa;
  const plataforma: FontePlataforma = {
    ...fontePlataformaNoBanco,
    auditar: async () => undefined,
    listarEmpresas: async () => ({
      itens: [EMPRESA, OUTRA].map((id, i) => ({
        id,
        codigo: `emp${i}`,
        razao_social: `Empresa ${i}`,
        cnpj: null,
        fuso: 'America/Sao_Paulo',
        status: 'ativo',
        criada_em: '2026-11-01T00:00:00+00:00',
        modulos: [],
      })),
    }),
  };
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma,
      fonteAcoesEmpresa: fonte,
      backupEmpresaDisponivel: op.backup ?? true,
      relogio: () => AGORA,
      ...(op.ligado === false ? {} : { empresaAcoesPortal: true }),
    }),
  );
  const de = (f: keyof FonteAcoesEmpresa) => chamadas.filter((c) => c.funcao === f);
  return { app, chamadas, de };
}

const sa = { 'x-quem': 'sa' };
const cli = { 'x-quem': 'cli' };
const url = (resto: string, t = EMPRESA) => `/v1/plataforma/empresas/${t}/${resto}`;
const corpoExclusao = (senha = SENHA) => ({ id: EXCLUSAO, backup_id: BACKUP, codigo_confirmacao: 'DISTRIB', senha });

describe('Portal › Ações da empresa (ADR 0052)', () => {
  beforeEach(() => vi.stubEnv('MACUXI_JWT_SEGREDO_PLATAFORMA', SEGREDO));
  afterEach(() => vi.unstubAllEnvs());

  it('desligado por padrão: sem empresaAcoesPortal as rotas não existem (404) e a lista sai sem `acoes`', async () => {
    const { app, chamadas } = montar({ ligado: false });
    expect((await app.inject({ method: 'POST', url: url('inativar'), headers: sa, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: url('backups'), headers: sa })).statusCode).toBe(404);
    const lista = await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: sa });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().itens.every((e: object) => !('acoes' in e))).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('RN-PLA-07: só super-admin; admin do cliente = 403 PERFIL_SEM_ACESSO e sem sessão = 401, sem chamar o banco', async () => {
    const { app, chamadas } = montar();
    const negado = await app.inject({ method: 'POST', url: url('inativar'), headers: cli, payload: {} });
    expect([negado.statusCode, negado.json().codigo, negado.json().mensagem]).toEqual([403, 'PERFIL_SEM_ACESSO', MENSAGEM_SO_SUPER_ADMIN_ACOES]);
    const exclusao = await app.inject({ method: 'POST', url: url('exclusao'), headers: cli, payload: corpoExclusao() });
    expect(exclusao.statusCode).toBe(403);
    const anonimo = await app.inject({ method: 'POST', url: url('reativar'), payload: {} });
    expect([anonimo.statusCode, anonimo.json().codigo]).toEqual([401, 'NAO_AUTENTICADO']);
    expect(chamadas).toEqual([]);
  });

  it('RN-PLA-07: inativar com corpo `{}` passa motivo null e devolve 200 no contrato; com motivo, o motivo', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('inativar'), headers: sa, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(SituacaoEmpresaRespostaSchema.parse(r.json())).toMatchObject({ tenant_id: EMPRESA, status: 'suspenso', motivo: null });
    expect(de('inativar')[0]?.args).toEqual([SA.sessao_id, EMPRESA, null]);
    await app.inject({ method: 'POST', url: url('inativar'), headers: sa, payload: { motivo: 'inadimplencia' } });
    expect(de('inativar')[1]?.args).toEqual([SA.sessao_id, EMPRESA, 'inadimplencia']);
    const ruim = await app.inject({ method: 'POST', url: url('inativar'), headers: sa, payload: { motivo: 'texto livre' } });
    expect(ruim.statusCode).toBe(400);
    expect(de('inativar')).toHaveLength(2);
  });

  it('RN-PLA-07: reativar devolve 200 no contrato (idempotente: sem_mudanca)', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('reativar'), headers: sa, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(SituacaoEmpresaRespostaSchema.parse(r.json())).toMatchObject({ status: 'ativo', resultado: 'sem_mudanca' });
    expect(de('reativar')[0]?.args).toEqual([SA.sessao_id, EMPRESA]);
  });

  it('RN-PLA-08: pedir backup = 202 no contrato; sem bucket ou chave = 503 BACKUP_INDISPONIVEL sem chamar o banco', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('backups'), headers: sa, payload: { id: BACKUP } });
    expect(r.statusCode).toBe(202);
    expect(BackupEmpresaSchema.parse(r.json()).id).toBe(BACKUP);
    expect(de('pedirBackup')[0]?.args).toEqual([SA.sessao_id, EMPRESA, BACKUP]);
    const sem = montar({ backup: false });
    const r2 = await sem.app.inject({ method: 'POST', url: url('backups'), headers: sa, payload: { id: BACKUP } });
    expect([r2.statusCode, r2.json().codigo]).toEqual([503, 'BACKUP_INDISPONIVEL']);
    expect(sem.chamadas).toEqual([]);
  });

  it('RN-PLA-08: lista e um backup; backup inexistente = 404', async () => {
    const { app } = montar();
    const lista = await app.inject({ method: 'GET', url: url('backups'), headers: sa });
    expect([lista.statusCode, lista.json().itens.length]).toEqual([200, 1]);
    expect((await app.inject({ method: 'GET', url: url(`backups/${BACKUP}`), headers: sa })).json().id).toBe(BACKUP);
    const nada = await app.inject({ method: 'GET', url: url(`backups/${EXCLUSAO}`), headers: sa });
    expect([nada.statusCode, nada.json().codigo]).toEqual([404, 'BACKUP_NAO_ENCONTRADO']);
  });

  it('RN-PLA-08/09: SQLSTATE das sa_* pelo hint (55000 = 409, 22023 = 422, P0002 = 404, 28000 = 401, 42501 = 403)', async () => {
    const casos: [Partial<Record<keyof FonteAcoesEmpresa, Error>>, string, unknown, number, string][] = [
      [{ pedirBackup: erroPg('55000', 'BACKUP_EM_ANDAMENTO') }, 'backups', { id: BACKUP }, 409, 'BACKUP_EM_ANDAMENTO'],
      [{ pedirBackup: erroPg('55000', 'EXCLUSAO_EM_ANDAMENTO') }, 'backups', { id: BACKUP }, 409, 'EXCLUSAO_EM_ANDAMENTO'],
      [{ pedirExclusao: erroPg('22023', 'EXCLUSAO_SEM_BACKUP') }, 'exclusao', corpoExclusao(), 422, 'EXCLUSAO_SEM_BACKUP'],
      [{ pedirExclusao: erroPg('22023', 'EXCLUSAO_EMPRESA_ATIVA') }, 'exclusao', corpoExclusao(), 422, 'EXCLUSAO_EMPRESA_ATIVA'],
      [{ pedirExclusao: erroPg('22023', 'EXCLUSAO_CODIGO_NAO_CONFERE') }, 'exclusao', corpoExclusao(), 422, 'EXCLUSAO_CODIGO_NAO_CONFERE'],
      [{ inativar: erroPg('22023') }, 'inativar', {}, 400, 'VALIDACAO'],
      [{ inativar: erroPg('P0002') }, 'inativar', {}, 404, 'TENANT_NAO_ENCONTRADO'],
      [{ reativar: erroPg('28000') }, 'reativar', {}, 401, 'NAO_AUTENTICADO'],
      [{ reativar: erroPg('42501') }, 'reativar', {}, 403, 'PERFIL_SEM_ACESSO'],
      [{ pedirBackup: erroPg('23505') }, 'backups', { id: BACKUP }, 409, 'ID_EM_USO'],
    ];
    for (const [falha, rota, payload, status, codigo] of casos) {
      const { app } = montar({ falha });
      const r = await app.inject({ method: 'POST', url: url(rota), headers: sa, payload: payload as object });
      expect([rota, r.statusCode, r.json().codigo]).toEqual([rota, status, codigo]);
    }
  });

  it('RN-PLA-09: exclusão com a senha certa = 202 no contrato; a fonte NÃO recebe a senha e a tentativa zera', async () => {
    const { app, de, chamadas } = montar();
    const r = await app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao() });
    expect(r.statusCode).toBe(202);
    expect(ExclusaoEmpresaSchema.parse(r.json()).id).toBe(EXCLUSAO);
    expect(de('pedirExclusao')[0]?.args).toEqual([SA.sessao_id, EMPRESA, { id: EXCLUSAO, backup_id: BACKUP, codigo_confirmacao: 'DISTRIB' }]);
    expect(JSON.stringify(chamadas)).not.toContain(SENHA);
    expect(de('tentativaSucesso')).toHaveLength(1);
    expect(de('tentativaFalha')).toHaveLength(0);
  });

  it('RN-PLA-09: senha errada = 403 REAUTENTICACAO_FALHOU e conta a falha na chave do login do portal; nada é pedido', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao('Errada#2026') });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'REAUTENTICACAO_FALHOU']);
    expect(de('tentativaFalha')[0]?.args).toEqual([chaveDeTentativaDoPortal(SEGREDO, EMAIL)]);
    expect(de('pedirExclusao')).toHaveLength(0);
    const conta = montar({ semConta: true });
    const r2 = await conta.app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao() });
    expect([r2.statusCode, r2.json().codigo]).toEqual([403, 'REAUTENTICACAO_FALHOU']);
  });

  it('RN-PLA-09: bloqueado (antes ou na 5ª falha) = 423 BLOQUEADO; sem segredo do portal = 503 PORTAL_INDISPONIVEL', async () => {
    const antes = montar({ bloqueadoAte: new Date(AGORA.getTime() + 60_000) });
    const r = await antes.app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao() });
    expect([r.statusCode, r.json().codigo]).toEqual([423, 'BLOQUEADO']);
    expect(antes.de('pedirExclusao')).toHaveLength(0);
    const quinta = montar({ bloqueiaNaFalha: true });
    const r2 = await quinta.app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao('Errada#2026') });
    expect([r2.statusCode, r2.json().codigo]).toEqual([423, 'BLOQUEADO']);
    vi.stubEnv('MACUXI_JWT_SEGREDO_PLATAFORMA', '');
    const sem = montar();
    const r3 = await sem.app.inject({ method: 'POST', url: url('exclusao'), headers: sa, payload: corpoExclusao() });
    expect([r3.statusCode, r3.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
    expect(sem.chamadas).toEqual([]);
  });

  it('RN-PLA-09: GET da exclusão no contrato; nenhuma = 404', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'GET', url: url('exclusao'), headers: sa });
    expect([r.statusCode, ExclusaoEmpresaSchema.parse(r.json()).situacao]).toEqual([200, 'em_andamento']);
    const nada = await app.inject({ method: 'GET', url: url('exclusao', OUTRA), headers: sa });
    expect([nada.statusCode, nada.json().codigo]).toEqual([404, 'EXCLUSAO_NAO_ENCONTRADA']);
  });

  it('RN-PLA-07/08/09: a lista de empresas ganha `acoes` só para o super-admin e só na empresa com bloco', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: sa });
    expect(r.statusCode).toBe(200);
    const lista = ListaEmpresasSchema.parse(r.json());
    expect(lista.itens.find((e) => e.id === EMPRESA)?.acoes).toEqual(acoesCruas);
    expect(lista.itens.find((e) => e.id === OUTRA)?.acoes).toBeUndefined();
    const doCliente = await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: cli });
    expect(doCliente.json().itens.every((e: object) => !('acoes' in e))).toBe(true);
    expect(de('acoesDasEmpresas')).toHaveLength(1);
  });
});

describe('config: MACUXI_EMPRESA_ACOES e backup de empresa (ADR 0052)', () => {
  it('empresaAcoesLigadas: só 1/true/sim liga', () => {
    expect(empresaAcoesLigadas({})).toBe(false);
    expect(empresaAcoesLigadas({ MACUXI_EMPRESA_ACOES: 'nao' })).toBe(false);
    for (const v of ['1', 'true', 'SIM']) expect(empresaAcoesLigadas({ MACUXI_EMPRESA_ACOES: v })).toBe(true);
  });

  it('backupEmpresaDisponivel: só com driver s3 e chave de 32 bytes (base64 ou 64 hex)', () => {
    const hex = 'ab'.repeat(32);
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 's3', MACUXI_BACKUP_EMPRESA_CHAVE: hex })).toBe(true);
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 's3', MACUXI_BACKUP_EMPRESA_CHAVE: b64 })).toBe(true);
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 'disco', MACUXI_BACKUP_EMPRESA_CHAVE: hex })).toBe(false);
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 's3' })).toBe(false);
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 's3', MACUXI_BACKUP_EMPRESA_CHAVE: Buffer.alloc(16).toString('base64') })).toBe(false);
    expect(backupEmpresaDisponivel({ MACUXI_ARQUIVOS_DRIVER: 's3', MACUXI_BACKUP_EMPRESA_CHAVE: 'não é chave' })).toBe(false);
  });
});
