/**
 * Planos e licenças no portal (ADR 0047; desenho docs/desenho/planos-e-licencas.md) sem banco real: desligado por padrão,
 * permissões (super-admin; admin do cliente só a própria empresa), a criação com plano pelo mesmo fluxo do passo Empresa, o
 * `simular` sem gravar a assinatura, a ficha no contrato do SDK com o valor anual e a recusa da troca abaixo do uso
 * (RN-PLA-05). As funções `sa_*` de verdade são testadas no CI (`*.db.test.ts` do banco-dados).
 */
import {
  FichaAssinaturaSchema,
  ITENS_CONTADOS,
  type AcessoPortalAutenticado,
  type Plano,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { EntradaAssinatura, EntradaTrocaDePlano, FontePlanosPortal } from '../src/planos-portal';
import { fontePlataformaNoBanco, type EntradaProvisionarPlataforma, type FontePlataforma, type LinhaAuditoriaPlataforma, type SenhaDoPortal } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const EMPRESA = '0a000000-0000-4000-8000-000000000001';
const OUTRA = '0a000000-0000-4000-8000-000000000002';
const NOVA = '0a000000-0000-4000-8000-0000000000aa';
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: EMPRESA, usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const PEDIDO = '9b000000-0000-4000-8000-000000000001';

/** Números de teste: os reais vêm do seed do banco-dados (catálogo é dado). */
const PME: Plano = {
  id: '9a000000-0000-4000-8000-000000000002',
  codigo: 'pme',
  nome: 'PME',
  ordem: 2,
  preco_mensal_centavos: 50_000,
  licencas: { vendedor: 5, gestor: 1, bko: 2, promotor: 0 },
  modulos: ['catalogo', 'vendedor', 'gestor'],
  adicionais: [
    { adicional: 'promotor', preco_unitario_centavos: 5_000, incluidos: 0 },
    { adicional: 'pesquisa', preco_unitario_centavos: 1_000, incluidos: 0 },
  ],
  meses_gratis_anual: 2,
  dias_teste: 14,
  ativo: true,
};
const LIGHT: Plano = { ...PME, id: '9a000000-0000-4000-8000-000000000001', codigo: 'light', nome: 'Light', ordem: 1, preco_mensal_centavos: 20_000, licencas: { vendedor: 2, gestor: 1, bko: 1, promotor: 0 }, adicionais: [] };

const senhaPortal: SenhaDoPortal = {
  normalizarEmail: (e) => e.trim().toLowerCase(),
  validar: () => null,
  hash: async () => '$argon2id$v=19$m=19456,t=2,p=1$c2Fs$HASH',
  gerarTemporaria: () => 'Tmp#Senha2026x',
};

const uso = (em: Partial<Record<string, number>> = {}) => ITENS_CONTADOS.map((item) => ({ item, contratadas: null, em_uso: em[item] ?? 0 }));
const fichaCrua = (tenant: string, em: Partial<Record<string, number>> = {}) => ({
  tenant_id: tenant,
  plano: PME,
  ciclo: 'anual',
  adicionais: [{ adicional: 'promotor', quantidade: 2 }],
  teste_ate: '2026-11-27',
  paga: false,
  // fora de ordem de propósito: a API ordena por ITENS_CONTADOS
  licencas: [...uso(em)].reverse(),
  desde: '2026-11-14T12:00:00+00:00',
  atualizada_em: '2026-11-14T12:00:00+00:00',
});

function montar(op: { ligado?: boolean; emUso?: Partial<Record<string, number>>; semAssinatura?: boolean } = {}) {
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const provisionados: { entrada: EntradaProvisionarPlataforma; simular: boolean }[] = [];
  const gravadas: { tenant: string; e: EntradaAssinatura }[] = [];
  const trocas: { tenant: string; e: EntradaTrocaDePlano }[] = [];
  const plataforma: FontePlataforma = {
    ...fontePlataformaNoBanco,
    auditar: async (l) => void auditoria.push(l),
    provisionar: async (_q, entrada, simular) => {
      provisionados.push({ entrada, simular });
      return { tenant_id: simular ? null : NOVA, resultado: 'criado', modulos_adicionados: entrada.modulos.map((m) => m.modulo), parametros_gravados: [], avisos: [], admin: 'criado' };
    },
  };
  const fontePlanos: FontePlanosPortal = {
    listar: async () => ({ itens: [PME, LIGHT] }),
    gravarAssinatura: async (_sid, tenant, e) => {
      gravadas.push({ tenant, e });
      return { resultado: 'criada', teste_ate: e.teste_ate };
    },
    assinatura: async (_sid, tenant) => {
      if (op.semAssinatura) throw Object.assign(new Error('sem'), { code: 'P0002' });
      return fichaCrua(tenant, op.emUso);
    },
    trocar: async (_sid, tenant, e) => void trocas.push({ tenant, e }),
  };
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma,
      senhaPortal,
      fontePlanos,
      relogio: () => new Date('2026-11-14T15:00:00Z'),
      ...(op.ligado === false ? {} : { planosPortal: true }),
    }),
  );
  return { app, auditoria, provisionados, gravadas, trocas };
}

const sa = { 'x-quem': 'sa' };
const cli = { 'x-quem': 'cli' };
const corpoEmpresa = (simular = false) => ({
  codigo: 'distrib-nova',
  razao_social: 'Distribuidora Nova',
  cnpj: '11222333000181',
  admin: { email: 'admin@nova.com.br', nome: 'Admin Nova', senha: 'Senha#2026x' },
  assinatura: { plano: 'pme', ciclo: 'anual', adicionais: [{ adicional: 'pesquisa', quantidade: 3 }], pedido_id: PEDIDO },
  simular,
});

describe('Portal › Planos e licenças (ADR 0047)', () => {
  it('desligado por padrão: sem planosPortal, as rotas não existem (404)', async () => {
    const { app } = montar({ ligado: false });
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/planos', headers: sa })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: sa })).statusCode).toBe(404);
  });

  it('catálogo: super-admin e admin do cliente, na ordem do plano; sem sessão = 401', async () => {
    const { app, auditoria } = montar();
    for (const h of [sa, cli]) {
      const r = await app.inject({ method: 'GET', url: '/v1/plataforma/planos', headers: h });
      expect(r.statusCode).toBe(200);
      expect(r.json().itens.map((p: Plano) => p.codigo)).toEqual(['light', 'pme']);
    }
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'admin_cliente', status: 200 });
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/planos' })).statusCode).toBe(401);
  });

  it('ficha: contrato do SDK, licenças na ordem de ITENS_CONTADOS e valor anual = 10× o mensal', async () => {
    const { app } = montar({ emUso: { vendedor: 3 } });
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: sa });
    expect(r.statusCode).toBe(200);
    const f = FichaAssinaturaSchema.parse(r.json());
    expect(f.licencas.map((l) => l.item)).toEqual([...ITENS_CONTADOS]);
    expect(f.licencas[0]).toEqual({ item: 'vendedor', contratadas: null, em_uso: 3 });
    expect(f.valor).toEqual({ mensal_centavos: 60_000, por_ciclo_centavos: 600_000, ciclo: 'anual' });
  });

  it('ficha: admin do cliente vê a própria empresa; a de outra = 403; sem assinatura = 404 SEM_ASSINATURA', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: cli })).statusCode).toBe(200);
    const outra = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${OUTRA}/assinatura`, headers: cli });
    expect([outra.statusCode, outra.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect((await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura` })).statusCode).toBe(401);
    const sem = montar({ semAssinatura: true });
    const r = await sem.app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: sa });
    expect([r.statusCode, r.json().codigo]).toEqual([404, 'SEM_ASSINATURA']);
  });

  it('criar com plano: só super-admin; provisiona com os módulos do plano e grava a assinatura com o teste de 14 dias', async () => {
    const { app, provisionados, gravadas, auditoria } = montar();
    const negado = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas-com-plano', headers: cli, payload: corpoEmpresa() });
    expect(negado.statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas-com-plano', headers: sa, payload: corpoEmpresa() });
    expect(r.statusCode).toBe(201);
    expect(provisionados).toHaveLength(1);
    expect(provisionados[0]?.simular).toBe(false);
    expect(provisionados[0]?.entrada.modulos.map((m) => m.modulo).sort()).toEqual(['catalogo', 'core', 'gestor', 'integracao', 'pesquisa', 'vendedor']);
    expect(provisionados[0]?.entrada.modulos.every((m) => m.licencas === null)).toBe(true);
    expect(gravadas).toEqual([
      { tenant: NOVA, e: { plano: 'pme', ciclo: 'anual', adicionais: [{ adicional: 'pesquisa', quantidade: 3 }], teste_ate: '2026-11-27', paga: false, pedido_id: PEDIDO } },
    ]);
    expect(r.json()).toMatchObject({
      tenant_id: NOVA,
      resultado: 'criado',
      assinatura: 'criada',
      teste_ate: '2026-11-27',
      admin: 'criado',
      simulado: false,
      valor: { mensal_centavos: 53_000, por_ciclo_centavos: 530_000, ciclo: 'anual' },
    });
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'super_admin', status: 201 });
  });

  it('criar com plano: simular não grava a assinatura; adicional fora do plano e plano desconhecido = 422', async () => {
    const { app, provisionados, gravadas } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas-com-plano', headers: sa, payload: corpoEmpresa(true) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ assinatura: 'simulada', simulado: true, teste_ate: '2026-11-27' });
    expect(provisionados[0]?.simular).toBe(true);
    expect(gravadas).toEqual([]);
    const fora = { ...corpoEmpresa(), assinatura: { plano: 'light', adicionais: [{ adicional: 'pesquisa', quantidade: 1 }], pedido_id: PEDIDO } };
    const r2 = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas-com-plano', headers: sa, payload: fora });
    expect([r2.statusCode, r2.json().codigo]).toEqual([422, 'ADICIONAL_FORA_DO_PLANO']);
    const nenhum = { ...corpoEmpresa(), assinatura: { plano: 'ouro', pedido_id: PEDIDO } };
    const r3 = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas-com-plano', headers: sa, payload: nenhum });
    expect([r3.statusCode, r3.json().codigo]).toEqual([422, 'PLANO_DESCONHECIDO']);
    expect(provisionados).toHaveLength(1);
  });

  it('troca abaixo do uso = 422 PLANO_ABAIXO_DO_USO com os problemas, sem chamar a sa_trocar_plano', async () => {
    const { app, trocas } = montar({ emUso: { vendedor: 4 } });
    const r = await app.inject({ method: 'PUT', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: sa, payload: { plano: 'light', pedido_id: PEDIDO } });
    expect([r.statusCode, r.json().codigo]).toEqual([422, 'PLANO_ABAIXO_DO_USO']);
    expect(r.json().mensagem).toBe('O plano Light tem 2 licenças de vendedor e a empresa usa 4.');
    expect(trocas).toEqual([]);
  });

  it('troca que cabe: só super-admin; liga os módulos do plano e devolve a ficha nova', async () => {
    const { app, trocas } = montar({ emUso: { vendedor: 2 } });
    const corpo = { plano: 'pme', ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 1 }], pedido_id: PEDIDO };
    const negado = await app.inject({ method: 'PUT', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: cli, payload: corpo });
    expect(negado.statusCode).toBe(403);
    const r = await app.inject({ method: 'PUT', url: `/v1/plataforma/empresas/${EMPRESA}/assinatura`, headers: sa, payload: corpo });
    expect(r.statusCode).toBe(200);
    expect(FichaAssinaturaSchema.safeParse(r.json()).success).toBe(true);
    expect(trocas).toEqual([
      { tenant: EMPRESA, e: { plano: 'pme', ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 1 }], pedido_id: PEDIDO, modulos: ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'integracao'] } },
    ]);
  });
});
