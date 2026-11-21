/**
 * v1.0.17 (PR #537, R-20261120-062210), valor × regra da busca de clientes: cada palavra do termo casa só com código
 * (external_id), CNPJ (3 dígitos ou mais, com ou sem máscara), razão social ou nome fantasia, e todas precisam casar
 * (v1.0.18, "JOAO 0103", R-20261120-101755); cidade e bairro não entram na busca.
 * Matriz: `docs/testes/v1017-busca-clientes.md`.
 */
import { ClienteListaRespostaSchema, type ClienteSync } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarClientesLocais } from '../../../modules/core/app/lib/cliente360-local';
import { clienteDaCarteira, type ClienteDaCarteira } from '../../../modules/core/web/lib/rotas-api';
import { searchWallet } from '../../../modules/core/web/lib/routes';
import { filterCustomers } from '../../../modules/vendedor/app/lib/catalog';
import { clienteResumo } from '../../../modules/vendedor/app/lib/pull';
import { A, puxarTudo, subirApi, type ApiDeTeste } from '../apoio/api';
import { esperarHorizonte } from '../apoio/campo';

const HOJE = '2026-11-20';
/**
 * Clientes do ensaio na carteira do vendedor-1. X e Y: cidade e bairro de um são o nome/código do outro (a armadilha).
 * J1, J2 e J3: J1 casa as duas palavras; J2 tem JOAO no nome e 0103 só no bairro; J3 tem 0103 no código e outro nome.
 */
const CLIENTES = [
  { id: '0c000000-1017-4000-8000-000000000001', external_id: 'QX-7781', documento: '47111222000133', razao_social: 'Quimera Distribuidora Ltda', nome_fantasia: 'Zafira Atacado', bairro: 'Ypsilonvale', cidade: 'Xapurilandia' },
  { id: '0c000000-1017-4000-8000-000000000002', external_id: 'WK-0310', documento: '58999000000144', razao_social: 'Ypsilonvale Comercio Ltda', nome_fantasia: 'Xapurilandia Pecas', bairro: 'Zafira', cidade: 'Quimera' },
  { id: '0c000000-1018-4000-8000-000000000001', external_id: '0103', documento: '61222333000155', razao_social: 'JOAO MATERIAIS LTDA', nome_fantasia: 'Casa do Joao', bairro: 'Centro', cidade: 'Manaus' },
  { id: '0c000000-1018-4000-8000-000000000002', external_id: '0207', documento: '62444555000166', razao_social: 'JOAO FERRAGENS LTDA', nome_fantasia: 'Ferragens Rio Negro', bairro: 'Conjunto 0103', cidade: 'Manaus' },
  { id: '0c000000-1018-4000-8000-000000000003', external_id: '01030', documento: '63777888000177', razao_social: 'MARIA TINTAS LTDA', nome_fantasia: 'Tintas Taruma', bairro: 'Centro', cidade: 'Manaus' },
] as const;
type Cliente = (typeof CLIENTES)[number];
const [X, Y, J1, J2, J3] = CLIENTES;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digitos = (s: string) => s.replace(/\D/g, '');
/** A regra, independente do código de produção: cada palavra num dos 4 campos; todas precisam casar. */
const casaPelaRegra = (c: Cliente, termo: string): boolean =>
  semAcento(termo)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => [c.external_id, c.razao_social, c.nome_fantasia].some((campo) => semAcento(campo).includes(p)) || (digitos(p).length >= 3 && c.documento.includes(digitos(p))));
const esperado = (termo: string) => CLIENTES.filter((c) => casaPelaRegra(c, termo)).map((c) => c.id).sort();

/** Termos que casam por um dos 4 campos, e só por ele. */
const POSITIVOS: ReadonlyArray<{ campo: string; termo: string; ids: string[] }> = [
  { campo: 'código', termo: 'QX-7781', ids: [X.id] },
  { campo: 'código (caixa baixa)', termo: 'wk-0310', ids: [Y.id] },
  { campo: 'CNPJ com máscara', termo: '47.111.222/0001-33', ids: [X.id] },
  { campo: 'CNPJ sem máscara', termo: '58999000000144', ids: [Y.id] },
  { campo: 'CNPJ em parte', termo: '111.222', ids: [X.id] },
  { campo: 'razão social', termo: 'Quimera Distribuidora', ids: [X.id] },
  { campo: 'nome fantasia', termo: 'Zafira Atacado', ids: [X.id] },
];
/** Termo que é cidade ou bairro de um cliente (não o traz) e nome do outro (traz só o outro). */
const NEGATIVOS: ReadonlyArray<{ campo: string; termo: string; ids: string[] }> = [
  { campo: 'cidade de X (razão/fantasia de Y)', termo: 'Xapurilandia', ids: [Y.id] },
  { campo: 'bairro de X (razão social de Y)', termo: 'Ypsilonvale', ids: [Y.id] },
  { campo: 'bairro de Y (fantasia de X)', termo: 'Zafira', ids: [X.id] },
  { campo: 'cidade de Y (razão social de X)', termo: 'Quimera', ids: [X.id] },
];
/** Todas as palavras precisam casar; "JOAO" e "0103" sozinhos provam as armadilhas de J2 e J3. */
const DUAS_PALAVRAS: ReadonlyArray<{ campo: string; termo: string; ids: string[] }> = [
  { campo: 'nome + código', termo: 'JOAO 0103', ids: [J1.id] },
  { campo: 'nome com acento e caixa baixa + código', termo: 'joão 0103', ids: [J1.id] },
  { campo: 'código + nome (ordem trocada)', termo: '0103 JOAO', ids: [J1.id] },
  { campo: 'nome + CNPJ em parte', termo: 'JOAO 222.333', ids: [J1.id] },
  { campo: 'nome + código que ninguém tem', termo: 'JOAO 9999', ids: [] },
  { campo: 'só o nome (J1 e J2)', termo: 'JOAO', ids: [J1.id, J2.id] },
  { campo: 'só o código (J1 e o 01030 do J3)', termo: '0103', ids: [J1.id, J3.id] },
];
const TERMOS = [...POSITIVOS, ...NEGATIVOS, ...DUAS_PALAVRAS];

describe.skipIf(semBanco())('v1.0.17 busca de clientes: só código, CNPJ, razão social e nome fantasia (valor × regra)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', admin: '' };
  let pull: ClienteSync[] = [];
  let carteiraBko: ClienteDaCarteira[] = [];
  const nossos = (ids: Iterable<string>) => [...ids].filter((id) => CLIENTES.some((c) => c.id === id)).sort();

  beforeAll(async () => {
    api = await subirApi();
    for (const c of CLIENTES) {
      await api.admin.query(
        "insert into core.cliente (id, tenant_id, external_id, documento, razao_social, nome_fantasia, bairro, cidade, uf) values ($1, $2, $3, $4, $5, $6, $7, $8, 'AM')",
        [c.id, A.tenantId, c.external_id, c.documento, c.razao_social, c.nome_fantasia, c.bairro, c.cidade],
      );
      await api.admin.query("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, 'vendedor')", [A.tenantId, c.id, A.usuarios.vendedor1]);
    }
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    await esperarHorizonte();
    pull = (await puxarTudo<ClienteSync>(api, tk.vendedor, 'cliente')).filter((c) => c.deleted_at === null);
    const r = await api.chamar(tk.admin, { method: 'GET', url: `/v1/core/usuarios/${A.usuarios.vendedor1}/clientes` });
    expect(r.statusCode, r.body).toBe(200);
    carteiraBko = (r.json() as { itens: ClienteDaCarteira[] }).itens;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('o oráculo concorda com a tabela do ensaio (positivos pelos 4 campos; cidade e bairro nunca; duas palavras)', () => {
    for (const t of TERMOS) expect(esperado(t.termo), `${t.campo}: ${t.termo}`).toEqual([...t.ids].sort());
    expect(nossos(pull.map((c) => c.id))).toEqual(CLIENTES.map((c) => c.id).sort());
  });

  it.each(TERMOS)('API (Campo online e BKO) — $campo: $termo', async ({ termo }) => {
    for (const [quem, token] of Object.entries(tk)) {
      const r = await api.chamar(token, { method: 'GET', url: `/v1/core/clientes?q=${encodeURIComponent(termo)}` });
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(200);
      expect(nossos(ClienteListaRespostaSchema.parse(r.json()).itens.map((i) => i.id)), quem).toEqual(esperado(termo));
    }
  });

  it('API: o filtro de cidade continua separado da busca (cidade=Xapurilandia traz X)', async () => {
    const r = await api.chamar(tk.vendedor, { method: 'GET', url: '/v1/core/clientes?cidade=Xapurilandia' });
    expect(nossos(ClienteListaRespostaSchema.parse(r.json()).itens.map((i) => i.id))).toEqual([X.id]);
  });

  it.each(TERMOS)('Campo offline, Clientes (listarClientesLocais) — $campo: $termo', ({ termo }) => {
    const base = { clientes: pull, financeiros: [], titulos: [], historico: [] };
    expect(nossos(listarClientesLocais(base, HOJE, { q: termo }).map((c) => c.id))).toEqual(esperado(termo));
  });

  it.each(TERMOS)('Campo, Novo Pedido (filterCustomers do Vendedor) — $campo: $termo', ({ termo }) => {
    const resumos = pull.map((c) => clienteResumo(c, null, { id: A.usuarios.vendedor1, name: 'Vendedor' }));
    expect(nossos(filterCustomers(resumos, termo, []).map((c) => c.id))).toEqual(esperado(termo));
  });

  it.each(TERMOS)('BKO, editor de rota (searchWallet) — $campo: $termo', ({ termo }) => {
    const carteira = carteiraBko.map((c) => clienteDaCarteira(c, HOJE));
    expect(nossos(searchWallet(carteira, termo, new Set(), 1_000).map((c) => c.id))).toEqual(esperado(termo));
  });
});
