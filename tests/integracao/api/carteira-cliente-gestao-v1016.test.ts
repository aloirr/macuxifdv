/**
 * v1.0.16 (T-0187, "Também na v1.0.16"; corte da T-0186 de 19/11) — tabela Carteira na ficha do cliente do Gestão:
 * `GET /v1/core/clientes/:id/carteira` com a API REAL (createApp × Postgres como macuxi_app × fixture dois-tenants).
 * Regras: RN-CORE-04 (escopo de carteira), RN-CORE-05 (tenant), RN-PRO-01/regra 6 (perfil), T-0168 (nome e telefone de quem atende
 * não vão ao aparelho pelo sync: vêm desta rota, a cada abertura).
 *
 * O que se prova (matriz: docs/testes/T-0187.md, seção "Carteira", K-01..K-06):
 *  K-01 vendedor e promotor recebem 403 (a rota é só de gestão), também no cliente da própria carteira;
 *  K-02 cliente fora da carteira da equipe do supervisor = 404 CLIENTE_NAO_ENCONTRADO, sem vazar quem atende;
 *  K-03 outro tenant não vê nada: o admin de B recebe lista vazia (RLS) e o supervisor de A com o cliente de B, 404;
 *  K-04 o gerente vê quem atende c1, com o telefone como link (contraprova de que a rota devolve o dado);
 *  K-05 o pull do sync (usuario, carteira e todas as entidades do Core) do supervisor no Gestão não leva nome nem telefone
 *       de quem atende;
 *  K-06 a resposta sai com `Cache-Control: no-store`, como diz o contrato (`CarteiraClienteRespostaSchema`).
 *
 * A rota só existe com o branch `nuvem/v1016-carteira-modulo-core` (modulo-core). Sem ela no `main`, a suíte PULA (a constante
 * `ROTAS_CLIENTE360_V2.carteira` é lida sem depender do tipo do main), para o typecheck e o CI do `main` não quebrarem.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROTAS_CLIENTE360_V2 } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';

/** D-K06: liga quando a rota da Carteira declarar `semCache: true` (opção da `RotaModulo` do SDK, v1.0.16, engenheiro-software). */
const ROTA_CARTEIRA_FONTE = join(__dirname, '..', '..', '..', 'modules', 'core', 'api', 'carteira-cliente.ts');
const CARTEIRA_SEM_CACHE = existsSync(ROTA_CARTEIRA_FONTE) && /semCache:\s*true/.test(readFileSync(ROTA_CARTEIRA_FONTE, 'utf8'));
const ROTA = (ROTAS_CLIENTE360_V2 as Readonly<Record<string, string>>).carteira;
const url = (cliente: string) => `/v1/core/${(ROTA ?? '').replace(':id', cliente)}`;
/** Telefone de teste do vendedor-1 (só neste banco efêmero): os dígitos não podem aparecer em nenhum pull. */
const TEL = '92988776655';
const NOME_V1 = 'Vendedor Um';

describe.skipIf(semBanco() || !ROTA)('v1.0.16 — Carteira na ficha do Gestão (GET clientes/:id/carteira, createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', promotor: '', supervisor: '', gerente: '', adminB: '', vendedorB: '' };
  let telAntes: string | null = null;

  beforeAll(async () => {
    api = await subirApi();
    telAntes = (await api.admin.query<{ telefone: string | null }>('select telefone from core.usuario where id = $1', [A.usuarios.vendedor1])).rows[0]?.telefone ?? null;
    await api.admin.query('update core.usuario set telefone = $2 where id = $1', [A.usuarios.vendedor1, TEL]);
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    // o pull só devolve linha abaixo do horizonte (now() − 2 s): espera a margem depois de gravar o telefone
    await new Promise((fim) => setTimeout(fim, 2_500));
  }, 120_000);

  afterAll(async () => {
    if (!api) return;
    await api.admin.query('update core.usuario set telefone = $2 where id = $1', [A.usuarios.vendedor1, telAntes]).catch(() => undefined);
    await api.fechar();
  });

  const ler = (token: string, cliente: string) => api.chamar(token, { method: 'GET', url: url(cliente) });

  it('K-01 (regra 6, RN-PRO-01): vendedor e promotor recebem 403 até no cliente da própria carteira (c1)', async () => {
    for (const [quem, token] of [['vendedor', tk.vendedor], ['promotor', tk.promotor], ['vendedor de B', tk.vendedorB]] as const) {
      const cliente = quem === 'vendedor de B' ? B.clientes.c1 : A.clientes.c1;
      const r = await ler(token, cliente);
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(403);
      expect(['PERFIL_SEM_ACESSO', 'CARTEIRA_SEM_ACESSO'], quem).toContain(erroDe(r).codigo);
      expect(r.body, quem).not.toContain(TEL);
      expect(r.body, quem).not.toContain(NOME_V1);
    }
  });

  it('K-02 (RN-CORE-04): o supervisor da equipe 1 com c2 (carteira do vendedor-2, equipe 2) recebe 404, sem vazar quem atende', async () => {
    const r = await ler(tk.supervisor, A.clientes.c2);
    expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([404, 'CLIENTE_NAO_ENCONTRADO']);
    expect(r.body).not.toContain(A.usuarios.vendedor2);
    expect(r.body).not.toContain('Vendedor Dois');
  });

  it('K-03 (RN-CORE-05): outro tenant não vê nada — admin de B com c1 de A = lista vazia (RLS); supervisor de A com c1 de B = 404', async () => {
    const b = await ler(tk.adminB, A.clientes.c1);
    if (b.statusCode === 200) expect((b.json() as { itens: unknown[] }).itens).toEqual([]);
    else expect(b.statusCode, b.body).toBe(404);
    expect(b.body).not.toContain(A.usuarios.vendedor1);
    expect(b.body).not.toContain(TEL);
    const a = await ler(tk.supervisor, B.clientes.c1);
    expect([a.statusCode, erroDe(a).codigo], a.body).toEqual([404, 'CLIENTE_NAO_ENCONTRADO']);
    expect(a.body).not.toContain(B.usuarios.vendedor);
  });

  it('K-04 (contraprova): o gerente e o supervisor veem quem atende c1, com o telefone do vendedor-1 como link (DDI 55)', async () => {
    for (const token of [tk.gerente, tk.supervisor]) {
      const r = await ler(token, A.clientes.c1);
      expect(r.statusCode, r.body).toBe(200);
      const corpo = r.json() as { rotulo_coluna: string; itens: { usuario_id: string; nome: string; tel: string | null; whatsapp: string | null }[] };
      const v1 = corpo.itens.find((i) => i.usuario_id === A.usuarios.vendedor1);
      expect(v1, r.body).toMatchObject({ nome: NOME_V1, tel: `tel:+55${TEL}`, whatsapp: `https://wa.me/55${TEL}` });
      // c1 tem vendedor-1 e promotor na carteira: duas pessoas, cabeçalho "Pessoa" (spec §6)
      expect(corpo.rotulo_coluna).toBe(corpo.itens.length > 1 ? 'Pessoa' : 'Vendedora');
    }
  });

  it('K-05 (T-0168): o pull do supervisor (Gestão) não leva o nome nem o telefone de quem atende, em nenhuma entidade do Core', async () => {
    const entidades = [...(manifestoCore.sync ?? [])] as string[];
    expect(entidades).toEqual(expect.arrayContaining(['usuario', 'carteira']));
    for (const entidade of entidades) {
      for (let pagina = 0, cursor: string | null = null; pagina < 20; pagina += 1) {
        const r = await api.chamar(tk.supervisor, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}` });
        if (r.statusCode !== 200) break;
        expect(r.body, entidade).not.toContain(TEL);
        const corpo = r.json() as { itens: Record<string, unknown>[]; proximo_cursor: string | null };
        if (entidade === 'usuario' || entidade === 'carteira') {
          for (const l of corpo.itens) {
            expect(Object.keys(l), `${entidade}: chaves da linha`).not.toEqual(expect.arrayContaining(['telefone']));
            expect(Object.keys(l), `${entidade}: chaves da linha`).not.toEqual(expect.arrayContaining(['nome']));
            expect(JSON.stringify(l), entidade).not.toContain(NOME_V1);
          }
        }
        if (!corpo.proximo_cursor || corpo.itens.length === 0) break;
        cursor = corpo.proximo_cursor;
      }
    }
  });

  // K-06: o contrato (`CarteiraClienteRespostaSchema`, modules/core/contracts/cliente360-v2.ts) promete `Cache-Control: no-store`,
  // mas a rota (modules/core/api/carteira-cliente.ts) não manda o cabeçalho. Defeito D-K06 (dono: modulo-core). O SDK já tem
  // `semCache` na `RotaModulo`: o caso liga sozinho quando a rota declarar `semCache: true`, sem deixar o `main` vermelho antes.
  it.runIf(CARTEIRA_SEM_CACHE)('K-06 (T-0168): a resposta sai com Cache-Control no-store (nada guardado no cache HTTP do aparelho)', async () => {
    const r = await ler(tk.gerente, A.clientes.c1);
    expect(r.statusCode, r.body).toBe(200);
    expect(String(r.headers['cache-control'] ?? '')).toContain('no-store');
  });
});
