/**
 * Planos e licenças (ADR 0047) e CNPJ pela Receita (ADR 0048) no modo falso do portal (`lib/portal-falso.ts`), contra os schemas
 * do SDK: catálogo, ficha e troca de plano (RN-PLA-05), criar empresa com plano (RN-PLA-01, `simular`) e os CNPJs-gatilho.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cnpjValido } from '@macuxi/comum/documento';
import {
  ConsultaCnpjRespostaSchema,
  CriarEmpresaComPlanoRespostaSchema,
  FichaAssinaturaSchema,
  ListaPlanosSchema,
  SessaoPortalSchema,
} from '@macuxi/platform-sdk';

import { CNPJS_GATILHO_FALSO, responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL } from './portal-rotas';

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

const UMA = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const NORTE = '0b6f1a52-5c1e-4c4e-9a43-000000000002';
const CARACARAI = '0b6f1a52-5c1e-4c4e-9a43-000000000011';
const PEDIDO = '3f2b1c0a-9d8e-4f7a-8b6c-000000000001';

async function entrar(email: string): Promise<Record<string, string>> {
  const r = await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'qualquer' }, {});
  const s = SessaoPortalSchema.parse(await r.json());
  return { Authorization: `Bearer ${s.token}` };
}

const corpoNova = (x: { codigo?: string; cnpj?: string; plano?: string; simular?: boolean; adicionais?: unknown[] } = {}) => ({
  codigo: x.codigo ?? 'am4821',
  razao_social: 'Empresa Fictícia Ltda',
  cnpj: x.cnpj ?? '11444777000161',
  fuso: 'America/Manaus',
  admin: { nome: 'Ana Souza', email: 'ana@ficticia.com.br', senha: 'Senha@Forte2026' },
  assinatura: { plano: x.plano ?? 'pme', ciclo: 'mensal', adicionais: x.adicionais ?? [], com_teste: true, pedido_id: PEDIDO },
  simular: x.simular ?? false,
});

describe('modo falso: planos e CNPJ', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const chamar = async (metodo: string, caminho: string, corpo: unknown, cab: Record<string, string>) => {
    const p = responderFalso(metodo, caminho, corpo, cab);
    await vi.runAllTimersAsync();
    return p;
  };

  it('GET planos: o catálogo na ordem, no ListaPlanosSchema; sem sessão = 401', async () => {
    expect((await chamar('GET', ROTAS_PORTAL.planos, null, {})).status).toBe(401);
    const time = await chamar('POST', ROTAS_PORTAL.login, { email: 'time@macuxi.com.br', senha: 'x' }, {});
    const token = { Authorization: `Bearer ${SessaoPortalSchema.parse(await time.json()).token}` };
    const r = await chamar('GET', ROTAS_PORTAL.planos, null, token);
    expect(r.status).toBe(200);
    expect(ListaPlanosSchema.parse(await r.json()).itens.map((p) => p.codigo)).toEqual(['light', 'pme', 'enterprise', 'corporate']);
  });

  it('GET assinatura: ficha no FichaAssinaturaSchema; sem plano = 404 SEM_ASSINATURA; admin do cliente só a própria', async () => {
    const time = await entrarComTimers('time@macuxi.com.br');
    const r = await chamar('GET', ROTAS_PORTAL.assinatura(UMA), null, time);
    expect(r.status).toBe(200);
    const f = FichaAssinaturaSchema.parse(await r.json());
    expect(f.plano.codigo).toBe('pme');
    expect(f.licencas.find((l) => l.item === 'vendedor')).toEqual({ item: 'vendedor', contratadas: 20, em_uso: 14 });
    const sem = await chamar('GET', ROTAS_PORTAL.assinatura(CARACARAI), null, time);
    expect(sem.status).toBe(404);
    expect((await sem.json()).codigo).toBe('SEM_ASSINATURA');

    const admin = await entrarComTimers('admin@uma.com.br');
    expect((await chamar('GET', ROTAS_PORTAL.assinatura(UMA), null, admin)).status).toBe(200);
    expect((await chamar('GET', ROTAS_PORTAL.assinatura(NORTE), null, admin)).status).toBe(403);
    expect((await chamar('PUT', ROTAS_PORTAL.assinatura(UMA), { plano: 'enterprise', pedido_id: PEDIDO }, admin)).status).toBe(403);
  });

  it('PUT assinatura: troca válida devolve a ficha nova; abaixo do uso = 422 PLANO_ABAIXO_DO_USO; plano desconhecido = 422', async () => {
    const time = await entrarComTimers('time@macuxi.com.br');
    const abaixo = await chamar('PUT', ROTAS_PORTAL.assinatura(UMA), { plano: 'light', ciclo: 'mensal', adicionais: [], pedido_id: PEDIDO }, time);
    expect(abaixo.status).toBe(422);
    const corpo = await abaixo.json();
    expect(corpo.codigo).toBe('PLANO_ABAIXO_DO_USO');
    expect(corpo.detalhes.problemas.length).toBeGreaterThan(0);
    expect((await chamar('PUT', ROTAS_PORTAL.assinatura(UMA), { plano: 'premium', pedido_id: PEDIDO }, time)).status).toBe(422);

    const ok = await chamar('PUT', ROTAS_PORTAL.assinatura(UMA), { plano: 'enterprise', ciclo: 'anual', adicionais: [{ adicional: 'promotor', quantidade: 3 }, { adicional: 'pesquisa', quantidade: 10 }], pedido_id: PEDIDO }, time);
    expect(ok.status).toBe(200);
    const f = FichaAssinaturaSchema.parse(await ok.json());
    expect([f.plano.codigo, f.ciclo, f.valor.ciclo]).toEqual(['enterprise', 'anual', 'anual']);
    const lida = FichaAssinaturaSchema.parse(await (await chamar('GET', ROTAS_PORTAL.assinatura(UMA), null, time)).json());
    expect(lida.plano.codigo).toBe('enterprise');
    expect((await chamar('PUT', ROTAS_PORTAL.assinatura(CARACARAI), { plano: 'pme', pedido_id: PEDIDO }, time)).status).toBe(404);
  });

  it('POST empresas-com-plano: simular não grava; criar grava a empresa e a ficha em teste; admin do cliente = 403', async () => {
    const time = await entrarComTimers('time@macuxi.com.br');
    const sim = await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova({ simular: true }), time);
    expect(sim.status).toBe(200);
    const s = CriarEmpresaComPlanoRespostaSchema.parse(await sim.json());
    expect([s.resultado, s.assinatura, s.simulado, s.tenant_id]).toEqual(['criado', 'simulada', true, null]);

    const r = await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova(), time);
    expect(r.status).toBe(201);
    const c = CriarEmpresaComPlanoRespostaSchema.parse(await r.json());
    expect([c.resultado, c.assinatura]).toEqual(['criado', 'criada']);
    expect(c.teste_ate).not.toBeNull();
    const f = FichaAssinaturaSchema.parse(await (await chamar('GET', ROTAS_PORTAL.assinatura(c.tenant_id ?? ''), null, time)).json());
    expect([f.plano.codigo, f.paga, f.teste_ate]).toEqual(['pme', false, c.teste_ate]);
    // o mesmo código de novo: a empresa já existe (idempotente), a assinatura também
    const deNovo = CriarEmpresaComPlanoRespostaSchema.parse(await (await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova({ simular: true }), time)).json());
    expect(deNovo.resultado).not.toBe('criado');

    expect((await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova({ codigo: 'am4822', plano: 'premium' }), time)).status).toBe(422);
    const baixado = await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova({ codigo: 'am4823', cnpj: CNPJS_GATILHO_FALSO.baixado }), time);
    expect([baixado.status, (await baixado.json()).codigo]).toEqual([422, 'CNPJ_INATIVO']);
    expect((await chamar('POST', ROTAS_PORTAL.empresaComPlano, { codigo: 'am4824' }, time)).status).toBe(400);
    const admin = await entrarComTimers('admin@uma.com.br');
    expect((await chamar('POST', ROTAS_PORTAL.empresaComPlano, corpoNova({ codigo: 'am4825' }), admin)).status).toBe(403);
  });

  it('POST cnpj: encontrado e ativo; gatilhos 404 e 503; baixado vem com a situação; dígito errado = 400', async () => {
    for (const c of Object.values(CNPJS_GATILHO_FALSO)) expect(cnpjValido(c)).toBe(true);
    const time = await entrarComTimers('time@macuxi.com.br');
    const ok = await chamar('POST', ROTAS_PORTAL.cnpj, { cnpj: '11.444.777/0001-61' }, time);
    expect(ok.status).toBe(200);
    expect(ConsultaCnpjRespostaSchema.parse(await ok.json()).situacao_cadastral).toBe('ativa');
    const nao = await chamar('POST', ROTAS_PORTAL.cnpj, { cnpj: CNPJS_GATILHO_FALSO.naoEncontrado }, time);
    expect([nao.status, (await nao.json()).codigo]).toEqual([404, 'CNPJ_NAO_ENCONTRADO']);
    const fora = await chamar('POST', ROTAS_PORTAL.cnpj, { cnpj: CNPJS_GATILHO_FALSO.receitaFora }, time);
    expect([fora.status, (await fora.json()).codigo]).toEqual([503, 'CNPJ_FONTE_FORA']);
    const baixado = await chamar('POST', ROTAS_PORTAL.cnpj, { cnpj: CNPJS_GATILHO_FALSO.baixado }, time);
    expect(ConsultaCnpjRespostaSchema.parse(await baixado.json()).situacao_cadastral).toBe('baixada');
    const invalido = await chamar('POST', ROTAS_PORTAL.cnpj, { cnpj: '11444777000162' }, time);
    expect([invalido.status, (await invalido.json()).codigo]).toEqual([400, 'CNPJ_INVALIDO']);
  });

  async function entrarComTimers(email: string) {
    const p = entrar(email);
    await vi.runAllTimersAsync();
    return p;
  }
});
