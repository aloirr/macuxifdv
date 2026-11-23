/**
 * "Zerar dados" da empresa no portal (ADR 0068; desenho docs/desenho/empresa-zerar.md §5; RN-PLA-12) sem banco real: ligado com as
 * ações da empresa, só super-admin, prévia (inteira ou por entidade), pedido com a senha conferida de novo (a mesma `reautenticar`
 * do Excluir), leitura do mais recente, a tradução dos SQLSTATE das `sa_*` da 0100 e a lista das entidades igual à do Hub. As
 * funções de verdade são testadas nos `*.db.test.ts` do banco-dados.
 */
import { mensagemBloqueioPorTentativas } from '@macuxi/core/contracts';
import { ORDEM_CARGA_ENTIDADES } from '@macuxi/integracao/contracts';
import {
  ENTIDADES_ZERAR,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  mensagemDoZerar,
  PreviaZerarEmpresaSchema,
  ZerarEmpresaSchema,
  type AcessoPortalAutenticado,
  type PreviaZerarEmpresa,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { EstadoTentativaPortal, FonteAcoesEmpresa } from '../src/empresa-acoes-portal';
import type { FonteZerarEmpresa } from '../src/empresa-zerar-portal';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const EMPRESA = '0a000000-0000-4000-8000-000000000001';
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: EMPRESA, usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const ZERAR = '9e000000-0000-4000-8000-000000000001';
const SEGREDO = 's'.repeat(40);
const { SENHA, HASH } = vi.hoisted(() => ({ SENHA: 'Senha#Certa2026', HASH: '$argon2id$v=19$m=19456,t=2,p=1$c2Fs$HASH' }));
vi.mock('@macuxi/db', async (original) => ({
  ...(await original<typeof import('@macuxi/db')>()),
  verificarSenha: (senha: string, phc: string) => senha === SENHA && phc === HASH,
}));
const AGORA = new Date('2026-11-23T12:00:00Z');

const previaCrua: PreviaZerarEmpresa = {
  tenant_id: EMPRESA,
  codigo: 'distrib',
  entidades: null,
  entidades_afetadas: ['cliente'],
  contado_em: '2026-11-23T12:00:00+00:00',
  total_linhas: 130,
  tabelas: [
    { tabela: 'vendedor.pedido_item', modo: 'soft', linhas: 100 },
    { tabela: 'core.cliente', modo: 'soft', linhas: 30 },
    { tabela: 'core.filial', modo: 'filial', linhas: 1 },
  ],
  bloqueio: null,
};
const zerarCru: ZerarEmpresa = {
  id: ZERAR,
  tenant_id: EMPRESA,
  codigo: 'distrib',
  entidades: null,
  entidades_afetadas: null,
  lote: '20261123T120000Z-9e000000',
  situacao: 'em_andamento',
  pedido_em: '2026-11-23T12:00:00+00:00',
  concluido_em: null,
  linhas_apagadas: null,
  contagem: null,
  copia_expira_em: null,
  erro_codigo: null,
};
const erroPg = (code: string, hint?: string) => Object.assign(new Error(code), { code, ...(hint ? { hint } : {}) });

interface OpcoesMontar {
  ligado?: boolean;
  falha?: Partial<Record<keyof FonteZerarEmpresa, Error>>;
  semZerar?: boolean;
  bloqueiaNaFalha?: boolean;
  previa?: unknown;
}

function montar(op: OpcoesMontar = {}) {
  const chamadas: { funcao: string; args: unknown[] }[] = [];
  const registrar =
    (funcao: string, resposta: (...args: unknown[]) => unknown, erro?: Error) =>
    async (...args: unknown[]) => {
      chamadas.push({ funcao, args: args.slice(0, -1) });
      if (erro) throw erro;
      return resposta(...args);
    };
  const fonte: FonteZerarEmpresa = {
    previa: registrar('previa', () => op.previa ?? previaCrua, op.falha?.previa),
    pedir: registrar('pedir', () => zerarCru, op.falha?.pedir),
    ler: registrar('ler', () => (op.semZerar ? null : zerarCru), op.falha?.ler),
  } as FonteZerarEmpresa;
  const estado = (b: Date | null): EstadoTentativaPortal => ({ falhas: b ? 5 : 1, bloqueado_ate: b });
  const acoes = {
    reautenticar: registrar('reautenticar', () => ({ super_admin_id: SA.tipo === 'super_admin' ? SA.id : '', email: 'equipe@macuxi.com.br', senha_hash: HASH })),
    tentativaEstado: registrar('tentativaEstado', () => estado(null)),
    tentativaFalha: registrar('tentativaFalha', () => estado(op.bloqueiaNaFalha ? new Date(AGORA.getTime() + 600_000) : null)),
    tentativaSucesso: registrar('tentativaSucesso', () => undefined),
  } as unknown as FonteAcoesEmpresa;
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      fonteAcoesEmpresa: acoes,
      fonteZerarEmpresa: fonte,
      relogio: () => AGORA,
      ...(op.ligado === false ? {} : { empresaAcoesPortal: true }),
    }),
  );
  const de = (f: string) => chamadas.filter((c) => c.funcao === f);
  return { app, chamadas, de };
}

const sa = { 'x-quem': 'sa' };
const cli = { 'x-quem': 'cli' };
const url = (resto: string) => `/v1/plataforma/empresas/${EMPRESA}/${resto}`;
const corpo = (senha = SENHA) => ({ id: ZERAR, codigo_confirmacao: 'DISTRIB', senha });

describe('Portal › Zerar dados da empresa (ADR 0068, RN-PLA-12)', () => {
  beforeEach(() => vi.stubEnv('MACUXI_JWT_SEGREDO_PLATAFORMA', SEGREDO));
  afterEach(() => vi.unstubAllEnvs());

  it('desligado com as ações da empresa: sem empresaAcoesPortal as rotas não existem (404) e o banco não é chamado', async () => {
    const { app, chamadas } = montar({ ligado: false });
    expect((await app.inject({ method: 'GET', url: url('zerar/previa'), headers: sa })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo() })).statusCode).toBe(404);
    expect(chamadas).toEqual([]);
  });

  it('RN-PLA-12: só super-admin; admin do cliente = 403 PERFIL_SEM_ACESSO e sem sessão = 401, sem chamar o banco', async () => {
    const { app, chamadas } = montar();
    for (const [method, rota] of [['GET', 'zerar/previa'], ['POST', 'zerar'], ['GET', 'zerar']] as const) {
      const r = await app.inject({ method, url: url(rota), headers: cli, ...(method === 'POST' ? { payload: corpo() } : {}) });
      expect([r.statusCode, r.json().codigo, r.json().mensagem]).toEqual([403, 'PERFIL_SEM_ACESSO', MENSAGEM_SO_SUPER_ADMIN_ACOES]);
    }
    const anonimo = await app.inject({ method: 'GET', url: url('zerar/previa') });
    expect([anonimo.statusCode, anonimo.json().codigo]).toEqual([401, 'NAO_AUTENTICADO']);
    expect(chamadas).toEqual([]);
  });

  it('RN-PLA-12: a prévia devolve 200 no contrato; formato fora do contrato = 500', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'GET', url: url('zerar/previa'), headers: sa });
    expect(r.statusCode).toBe(200);
    expect(PreviaZerarEmpresaSchema.parse(r.json())).toEqual(previaCrua);
    expect(de('previa')[0]?.args).toEqual([SA.sessao_id, EMPRESA, null]);
    const ruim = montar({ previa: { ...previaCrua, total_linhas: 1 } });
    expect((await ruim.app.inject({ method: 'GET', url: url('zerar/previa'), headers: sa })).statusCode).toBe(500);
  });

  it('RN-PLA-12: prévia por entidade: a lista vai normalizada ao banco; entidade fora da lista = 400 sem chamar o banco', async () => {
    const { app, de, chamadas } = montar();
    const r = await app.inject({ method: 'GET', url: url('zerar/previa?entidades=nota,cliente'), headers: sa });
    expect(r.statusCode).toBe(200);
    expect(de('previa')[0]?.args).toEqual([SA.sessao_id, EMPRESA, ['cliente', 'nota']]);
    const n = chamadas.length;
    for (const q of ['entidades=pedido', 'entidades=', 'entidades=cliente,cliente', 'outra=1']) {
      expect((await app.inject({ method: 'GET', url: url(`zerar/previa?${q}`), headers: sa })).statusCode, q).toBe(400);
    }
    expect(chamadas).toHaveLength(n);
  });

  it('a lista de entidades do zerar é a ordem de carga do Hub (uma lista só)', () => {
    expect([...ENTIDADES_ZERAR]).toEqual([...ORDEM_CARGA_ENTIDADES]);
  });

  it('RN-PLA-12: pedir = senha conferida de novo e 202 no contrato; a senha não vai ao banco do zerar nem volta', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo() });
    expect(r.statusCode).toBe(202);
    expect(ZerarEmpresaSchema.parse(r.json())).toEqual(zerarCru);
    expect(r.body).not.toContain(SENHA);
    expect(de('reautenticar')).toHaveLength(1);
    expect(de('tentativaSucesso')).toHaveLength(1);
    expect(de('pedir')[0]?.args).toEqual([SA.sessao_id, EMPRESA, ZERAR, 'DISTRIB', null]);
    const p = montar();
    const r2 = await p.app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { ...corpo(), entidades: ['titulo', 'cliente'] } });
    expect(r2.statusCode).toBe(202);
    expect(p.de('pedir')[0]?.args).toEqual([SA.sessao_id, EMPRESA, ZERAR, 'DISTRIB', ['cliente', 'titulo']]);
  });

  it('RN-PLA-12: corpo fora do contrato = 400 sem conferir a senha nem pedir', async () => {
    const { app, chamadas } = montar();
    for (const payload of [{ ...corpo(), id: 'x' }, { ...corpo(), extra: 1 }, { id: ZERAR, codigo_confirmacao: 'DISTRIB' }, { ...corpo(), entidades: [] }]) {
      expect((await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload })).statusCode).toBe(400);
    }
    expect(chamadas).toEqual([]);
  });

  it('senha errada = 403 REAUTENTICACAO_FALHOU sem pedir; na 5ª falha = 423 BLOQUEADO (RN-CORE-31); sem segredo = 503', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo('errada') });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'REAUTENTICACAO_FALHOU']);
    expect(de('pedir')).toEqual([]);
    const b = montar({ bloqueiaNaFalha: true });
    const r2 = await b.app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo('errada') });
    expect([r2.statusCode, r2.json().mensagem]).toEqual([423, mensagemBloqueioPorTentativas(10)]);
    vi.stubEnv('MACUXI_JWT_SEGREDO_PLATAFORMA', '');
    const r3 = await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo() });
    expect([r3.statusCode, r3.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
  });

  it('SQLSTATE das sa_* → HTTP com o código e a frase do SDK (409, 422, 404, 403, 409 ID_EM_USO)', async () => {
    const casos: [Error, number, string][] = [
      [erroPg('55000', 'ZERAR_EM_ANDAMENTO'), 409, 'ZERAR_EM_ANDAMENTO'],
      [erroPg('55000', 'EXCLUSAO_EM_ANDAMENTO'), 409, 'EXCLUSAO_EM_ANDAMENTO'],
      [erroPg('55000', 'BACKUP_EM_ANDAMENTO'), 409, 'BACKUP_EM_ANDAMENTO'],
      [erroPg('55000', 'ZERAR_HUB_PROCESSANDO'), 409, 'ZERAR_HUB_PROCESSANDO'],
      [erroPg('22023', 'ZERAR_CODIGO_NAO_CONFERE'), 422, 'ZERAR_CODIGO_NAO_CONFERE'],
      [erroPg('22023', 'ZERAR_VOLUME_ALTO'), 422, 'ZERAR_VOLUME_ALTO'],
      [erroPg('22023'), 400, 'VALIDACAO'],
      [erroPg('P0002'), 404, 'TENANT_NAO_ENCONTRADO'],
      [erroPg('42501'), 403, 'PERFIL_SEM_ACESSO'],
      [erroPg('23505'), 409, 'ID_EM_USO'],
    ];
    for (const [e, status, codigo] of casos) {
      const { app } = montar({ falha: { pedir: e } });
      const r = await app.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: corpo() });
      expect([r.statusCode, r.json().codigo]).toEqual([status, codigo]);
      const frase = mensagemDoZerar(codigo);
      if (frase && status !== 403) expect(r.json().mensagem).toBe(frase);
    }
  });

  it('GET …/zerar: 200 com o mais recente; nenhum = 404 ZERAR_NAO_ENCONTRADO', async () => {
    const { app, de } = montar();
    const r = await app.inject({ method: 'GET', url: url('zerar'), headers: sa });
    expect([r.statusCode, r.json()]).toEqual([200, zerarCru]);
    expect(de('ler')[0]?.args).toEqual([SA.sessao_id, EMPRESA]);
    const vazio = montar({ semZerar: true });
    const r2 = await vazio.app.inject({ method: 'GET', url: url('zerar'), headers: sa });
    expect([r2.statusCode, r2.json().codigo, r2.json().mensagem]).toEqual([404, 'ZERAR_NAO_ENCONTRADO', mensagemDoZerar('ZERAR_NAO_ENCONTRADO')]);
  });
});
