/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3): Portal › Diagnósticos (`GET /v1/plataforma/diagnosticos[/:id[/print]]`)
 * sem banco real: só super-admin, desligado por padrão, contrato do SDK na saída, a chave do armazenamento nunca sai da API e
 * a auditoria da requisição do portal. As funções `sa_*` de verdade são testadas no CI (`db/testes/diagnostico.test.ts`).
 */
import { DiagnosticoDetalheSchema, type AcessoPortalAutenticado, type DiagnosticoFiltro } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarArmazenamentoEmMemoria } from '../src/arquivos';
import type { FonteDiagnosticosPortal } from '../src/diagnosticos-portal';
import { fontePlataformaNoBanco, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: '0a000000-0000-4000-8000-000000000001', usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const ID = '0d1a0000-0000-4000-8000-000000000042';
const SEM_PRINT = '0d1a0000-0000-4000-8000-000000000043';
const CHAVE = `0a000000-0000-4000-8000-000000000001/plataforma/2026-11/0d1b0000-0000-4000-8000-000000000001.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

const item = {
  id: ID,
  protocolo: 42,
  recebido_em: '2026-11-11T19:30:12.000Z',
  ocorrido_em: '2026-11-11T19:29:00.000Z',
  origem: 'queda',
  app: 'campo',
  versao_app: '1.0.5',
  aparelho_modelo: 'SM-A155M',
  android: '14',
  motivo: 'crash_nativo',
  tenant_id: '0a000000-0000-4000-8000-000000000001',
  tenant_nome: 'Distribuidora Teste',
  tem_print: true,
};
const detalhe = (id: string, chave: string | null) => ({
  ...item,
  id,
  tem_print: chave !== null,
  build: null,
  aparelho_fabricante: 'samsung',
  android_api: 34,
  tela: '/m/novo-pedido',
  descricao: 'Travou ao salvar',
  erro: null,
  saida_android: null,
  sync: { pendentes: 1, ultimo_sync_em: null },
  usuario_id: '0b000000-0000-4000-8000-0000000000a1',
  perfil: 'vendedor',
  alerta: { situacao: 'enviado', recado_id: 'R-20261111-153012-diagnostico', em: '2026-11-11T19:31:00.000Z' },
  print_id: chave ? '0d1b0000-0000-4000-8000-000000000001' : null,
  chave_armazenamento: chave,
});

function montar(op: { ligado?: boolean; erro?: string } = {}) {
  const filtros: DiagnosticoFiltro[] = [];
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const fonte: FonteDiagnosticosPortal = {
    listar: async (sid, filtro) => {
      if (op.erro) throw Object.assign(new Error('pg'), { code: op.erro });
      expect(sid).toBe(SA.sessao_id);
      filtros.push(filtro);
      return { itens: [item], cursor: null };
    },
    detalhe: async (_sid, id) => {
      if (id === ID) return detalhe(ID, CHAVE);
      if (id === SEM_PRINT) return detalhe(SEM_PRINT, null);
      throw Object.assign(new Error('não achou'), { code: 'P0002' });
    },
  };
  const arquivos = criarArmazenamentoEmMemoria();
  void arquivos.gravar(CHAVE, JPEG);
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      arquivos,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma: { ...fontePlataformaNoBanco, auditar: async (l) => void auditoria.push(l) },
      fonteDiagnosticos: fonte,
      ...(op.ligado === false ? {} : { diagnosticosPortal: true }),
    }),
  );
  return { app, filtros, auditoria };
}

const sa = { 'x-quem': 'sa' };

describe('Portal › Diagnósticos (T-0158, ADR 0043)', () => {
  it('desligado por padrão: sem diagnosticosPortal, as rotas não existem (404)', async () => {
    const { app } = montar({ ligado: false });
    const r = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos', headers: sa });
    expect(r.statusCode).toBe(404);
  });

  it('lista: só super-admin; filtros pelo contrato; auditoria da requisição', async () => {
    const { app, filtros, auditoria } = montar();
    const r = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos?versao=1.0.5&origem=queda', headers: sa });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ itens: [item], cursor: null });
    expect(filtros).toEqual([{ versao: '1.0.5', origem: 'queda' }]);
    expect(auditoria).toMatchObject([{ ator_tipo: 'super_admin', acao: 'sa.requisicao', rota: '/v1/plataforma/diagnosticos', status: 200 }]);
  });

  it('admin do cliente = 403 (auditado); sem sessão do portal = 401; filtro fora do contrato = 400', async () => {
    const { app, auditoria } = montar();
    const cli = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos', headers: { 'x-quem': 'cli' } });
    expect([cli.statusCode, cli.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'admin_cliente', status: 403 });
    const sem = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos' });
    expect(sem.statusCode).toBe(401);
    const extra = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos?email=a@b.c', headers: sa });
    expect(extra.statusCode).toBe(400);
  });

  it('SQLSTATE da sa_* vira HTTP: 28000 = 401, 42501 = 403, 22023 = 400', async () => {
    for (const [code, status] of [['28000', 401], ['42501', 403], ['22023', 400]] as const) {
      const { app } = montar({ erro: code });
      const r = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos', headers: sa });
      expect(r.statusCode).toBe(status);
    }
  });

  it('detalhe: contrato do SDK; a chave do armazenamento e o print_id não saem da API; inexistente = 404', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/diagnosticos/${ID}`, headers: sa });
    expect(r.statusCode).toBe(200);
    expect(DiagnosticoDetalheSchema.safeParse(r.json()).success).toBe(true);
    expect(r.body).not.toContain('chave_armazenamento');
    expect(r.body).not.toContain('print_id');
    const nada = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos/0d1a0000-0000-4000-8000-000000000099', headers: sa });
    expect([nada.statusCode, nada.json().codigo]).toEqual([404, 'DIAGNOSTICO_NAO_ENCONTRADO']);
    const invalido = await app.inject({ method: 'GET', url: '/v1/plataforma/diagnosticos/nao-e-uuid', headers: sa });
    expect(invalido.statusCode).toBe(400);
  });

  it('print: bytes com no-store só para o super-admin; sem print = 404; admin do cliente = 403', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/diagnosticos/${ID}/print`, headers: sa });
    expect([r.statusCode, r.headers['content-type'], r.headers['cache-control']]).toEqual([200, 'image/jpeg', 'private, no-store']);
    expect(new Uint8Array(r.rawPayload)).toEqual(JPEG);
    const sem = await app.inject({ method: 'GET', url: `/v1/plataforma/diagnosticos/${SEM_PRINT}/print`, headers: sa });
    expect([sem.statusCode, sem.json().codigo]).toEqual([404, 'PRINT_NAO_ENCONTRADO']);
    const cli = await app.inject({ method: 'GET', url: `/v1/plataforma/diagnosticos/${ID}/print`, headers: { 'x-quem': 'cli' } });
    expect(cli.statusCode).toBe(403);
  });
});
