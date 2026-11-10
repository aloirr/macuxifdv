/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3 e §9): `POST /v1/diagnosticos` sem banco real. Banco em memória que
 * imita `plataforma.diagnostico` (protocolo global, RLS por tenant) e `plataforma.arquivo`. O RLS, os grants e o expurgo
 * são testados no CI (`*.db.test.ts` do banco-dados).
 */
import { DiagnosticoRespostaSchema, formatarProtocolo, type ClienteBanco, type DiagnosticoEnvio, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { criarArmazenamentoEmMemoria } from '../src/arquivos';
import type { BancoApp } from '../src/banco';
import { mascararDiagnostico } from '../src/diagnosticos';
import { cab, LICENCAS_PADRAO, opcoesDeTeste, usuarios } from './apoio';

const OUTRO_TENANT = '0a000000-0000-4000-8000-000000000002';
const todos: Record<string, UsuarioAutenticado> = { ...usuarios, vendedor_b: { id: '0b000000-0000-4000-8000-0000000000b1', tenant_id: OUTRO_TENANT, perfil: 'vendedor' } };
const ID = (n: number) => `0d1a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRINT = '0d1b0000-0000-4000-8000-000000000001';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

const envio = (id: string, extra: Partial<DiagnosticoEnvio> = {}): DiagnosticoEnvio => ({
  id,
  origem: 'botao',
  ocorrido_em: '2026-11-10T15:00:00.000Z',
  app: 'campo',
  versao_app: '1.0.4',
  build: null,
  aparelho: { fabricante: 'samsung', modelo: 'SM-A155M', android: '14', api: 34 },
  tela: '/m/novo-pedido',
  motivo: null,
  descricao: 'Travou ao salvar',
  erro: null,
  saida_android: null,
  sync: { pendentes: 2, ultimo_sync_em: null },
  print_id: null,
  ...extra,
});

interface LinhaDiag {
  id: string;
  tenant: string;
  usuario_id: string;
  protocolo: number;
  valores: unknown[];
}
interface LinhaArq {
  id: string;
  tenant: string;
  modulo: string;
  finalidade: string;
  enviado_por: string;
  situacao: 'aguardando' | 'recebido';
  sha256: string | null;
  tamanho_bytes: number | null;
  cliente_id: null;
  chave_armazenamento: string | null;
  perfis_leitura: null;
}

/** Banco em memória: só o que a rota usa. O select respeita o tenant da transação (RLS); o id é único globalmente (PK). */
function bancoDiagnostico() {
  const diags: LinhaDiag[] = [];
  const arquivos: LinhaArq[] = [];
  let seq = 0;
  const cliente = (tenant: string): ClienteBanco => ({
    query: async <R>(sql: string, v: unknown[] = []) => {
      const rows = <T>(r: T[]) => ({ rows: r as unknown as R[], rowCount: r.length });
      if (/^select usuario_id, protocolo from plataforma\.diagnostico/.test(sql)) return rows(diags.filter((d) => d.id === v[0] && d.tenant === tenant).map((d) => ({ usuario_id: d.usuario_id, protocolo: String(d.protocolo) })));
      if (/^insert into plataforma\.diagnostico/.test(sql.trim())) {
        if (diags.some((d) => d.id === v[0])) return rows([]);
        const linha = { id: v[0] as string, tenant, usuario_id: v[1] as string, protocolo: ++seq, valores: v };
        diags.push(linha);
        return rows([{ protocolo: String(linha.protocolo) }]);
      }
      if (/^insert into plataforma\.arquivo/.test(sql.trim())) {
        if (!arquivos.some((a) => a.id === v[0]))
          arquivos.push({ id: v[0] as string, tenant, modulo: v[1] as string, finalidade: v[2] as string, enviado_por: v[4] as string, situacao: 'aguardando', sha256: null, tamanho_bytes: null, cliente_id: null, chave_armazenamento: null, perfis_leitura: null });
        return rows([]);
      }
      if (/from plataforma\.arquivo where id = \$1/.test(sql)) return rows(arquivos.filter((a) => a.id === v[0] && a.tenant === tenant));
      if (/^update plataforma\.arquivo/.test(sql.trim())) {
        const a = arquivos.find((x) => x.id === v[0])!;
        Object.assign(a, { situacao: 'recebido', sha256: v[1], tamanho_bytes: v[2], chave_armazenamento: v[6] });
        return rows([]);
      }
      return rows([]);
    },
  });
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (t, fn) => fn(cliente(t)),
    semTenant: async (fn) => fn(cliente('')),
    horizonteSync: async () => new Date('2026-11-10T14:59:58.000Z'),
    instanteSync: async () => new Date('2026-11-10T15:00:00.000Z'),
  };
  return { banco, diags, arquivos };
}

function montar() {
  const b = bancoDiagnostico();
  const app = createApp({
    ...opcoesDeTeste(LICENCAS_PADRAO, { banco: b.banco, arquivos: criarArmazenamentoEmMemoria() }),
    autenticar: async (h) => todos[h['x-teste-usuario'] ?? ''] ?? null,
    // a plataforma não é módulo: o tenant B só com o Core também envia
    licencas: async (u) => ({ ativosNoTenant: u.tenant_id === OUTRO_TENANT ? ['core'] : LICENCAS_PADRAO.tenant, doPerfil: ['core'], removidosDoUsuario: [], parametros: {} }),
  });
  const post = (quem: string, corpo: unknown) => app.inject({ method: 'POST', url: '/v1/diagnosticos', headers: { 'x-teste-usuario': quem }, payload: corpo as object });
  return { app, post, ...b };
}

describe('POST /v1/diagnosticos (T-0158, ADR 0043)', () => {
  it('201 na 1ª vez com protocolo; repetição do mesmo id pelo mesmo usuário = 200 com o mesmo protocolo (idempotente)', async () => {
    const t = montar();
    const r1 = await t.post('vendedor', envio(ID(1)));
    expect(r1.statusCode, r1.body).toBe(201);
    const c1 = DiagnosticoRespostaSchema.parse(r1.json());
    expect(c1).toEqual({ id: ID(1), protocolo: 1, criado: true });
    expect(formatarProtocolo(c1.protocolo)).toBe('0001');
    const r2 = await t.post('vendedor', envio(ID(1), { descricao: 'outra coisa' }));
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ id: ID(1), protocolo: 1, criado: false });
    expect(t.diags).toHaveLength(1);
    // tenant e usuário vêm do token
    expect(t.diags[0]).toMatchObject({ tenant: usuarios.vendedor!.tenant_id, usuario_id: usuarios.vendedor!.id });
    await t.app.close();
  });

  it('mesmo id de outro usuário = 409 DIAGNOSTICO_JA_EXISTE; de outro tenant (invisível pelo RLS) também', async () => {
    const t = montar();
    expect((await t.post('vendedor', envio(ID(2)))).statusCode).toBe(201);
    const outro = await t.post('promotor', envio(ID(2)));
    expect([outro.statusCode, outro.json().codigo]).toEqual([409, 'DIAGNOSTICO_JA_EXISTE']);
    const deB = await t.post('vendedor_b', envio(ID(2)));
    expect([deB.statusCode, deB.json().codigo]).toEqual([409, 'DIAGNOSTICO_JA_EXISTE']);
    await t.app.close();
  });

  it('qualquer perfil, sem licença de módulo além do Core (a plataforma não é módulo); sem sessão = 401', async () => {
    const t = montar();
    expect((await t.post('vendedor_b', envio(ID(3)))).statusCode).toBe(201);
    expect((await t.post('promotor', envio(ID(4)))).statusCode).toBe(201);
    expect((await t.post('analista', envio(ID(5), { app: 'gestao' }))).statusCode).toBe(201);
    expect((await t.app.inject({ method: 'POST', url: '/v1/diagnosticos', payload: envio(ID(6)) })).statusCode).toBe(401);
    await t.app.close();
  });

  it('Zod .strict(): campo extra (tenant_id, usuario_id, email) é recusado com 400 e nada é gravado', async () => {
    const t = montar();
    for (const extra of [{ tenant_id: OUTRO_TENANT }, { usuario_id: usuarios.analista!.id }, { email: 'a@b.com' }]) {
      const r = await t.post('vendedor', { ...envio(ID(7)), ...extra });
      expect([r.statusCode, r.json().codigo]).toEqual([400, 'VALIDACAO']);
    }
    expect((await t.post('vendedor', { ...envio(ID(7)), aparelho: { fabricante: 'x', modelo: 'y', android: '14', api: 34, imei: '123' } })).statusCode).toBe(400);
    expect(t.diags).toHaveLength(0);
    await t.app.close();
  });

  it('LGPD: a máscara de dado pessoal roda no servidor (descrição, erro e saída do Android)', async () => {
    const t = montar();
    const sujo = 'cliente 123.456.789-09 tel (92) 99999-1234 email fulano@exemplo.com';
    const r = await t.post(
      'vendedor',
      envio(ID(8), {
        origem: 'queda',
        motivo: 'crash_nativo',
        descricao: sujo,
        erro: { mensagem: sujo, pilha: sujo, origem: 'tela' },
        saida_android: { motivo: 4, status: 0, importancia: 100, pss_kb: 1, rss_kb: 2, descricao: sujo, pilha: sujo },
      }),
    );
    expect(r.statusCode).toBe(201);
    const gravado = JSON.stringify(t.diags[0]!.valores);
    for (const pedaco of ['123.456.789-09', '99999-1234', 'fulano@exemplo.com']) expect(gravado).not.toContain(pedaco);
    expect(mascararDiagnostico(envio(ID(9), { descricao: null })).descricao).toBeNull();
    await t.app.close();
  });

  it('print: cria a linha aguardando (modulo plataforma) na mesma transação; o PUT sobe sem licença de módulo; o GET pelo tenant dá 404', async () => {
    const t = montar();
    expect((await t.post('vendedor', envio(ID(10), { print_id: PRINT }))).statusCode).toBe(201);
    expect(t.arquivos).toEqual([expect.objectContaining({ id: PRINT, modulo: 'plataforma', finalidade: 'print_diagnostico', enviado_por: usuarios.vendedor!.id, situacao: 'aguardando' })]);
    const put = await t.app.inject({ method: 'PUT', url: `/v1/arquivos/${PRINT}`, headers: { ...cab('vendedor'), 'content-type': 'image/jpeg' }, payload: JPEG });
    expect(put.statusCode, put.body).toBe(201);
    expect(t.arquivos[0]).toMatchObject({ situacao: 'recebido' });
    // ninguém do tenant lê o print (só o portal do super-admin): 404 sem revelar o motivo
    const get = await t.app.inject({ method: 'GET', url: `/v1/arquivos/${PRINT}`, headers: cab('analista') });
    expect(get.statusCode).toBe(404);
    await t.app.close();
  });

  it('20 envios novos por usuário por hora: o 21º = 429 DIAGNOSTICO_LIMITE com Retry-After; a repetição não conta', async () => {
    const t = montar();
    for (let n = 1; n <= 20; n++) expect((await t.post('supervisor', envio(ID(100 + n)))).statusCode).toBe(201);
    expect((await t.post('supervisor', envio(ID(101)))).statusCode).toBe(200);
    const r = await t.post('supervisor', envio(ID(200)));
    expect([r.statusCode, r.json().codigo]).toEqual([429, 'DIAGNOSTICO_LIMITE']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // outro usuário tem a própria janela
    expect((await t.post('vendedor', envio(ID(201)))).statusCode).toBe(201);
    await t.app.close();
  });
});
