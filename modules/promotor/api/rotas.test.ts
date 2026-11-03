import { criarRelogio } from '@macuxi/comum/relogio';
import { criarPermissoes, ErroHttpModulo, PERFIS, promotorBarradoNaRota, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { FiltroRelatorio, RelatorioRupturaApi, RelatorioShareApi } from '../contracts';
import { CATEGORIA, criarCtx, fabrica, LOJA, OUTRO_PROMOTOR, PROMOTOR, SUPERVISOR, T1, T2, uuid } from './apoio-teste';
import { criarModuloApiPromotor, PERFIS_RELATORIO, periodoDoFiltro, repositorioMemoria } from './index';

// 10:00 em Manaus: as visitas do teste ficam no mesmo dia civil do tenant
const relogio = criarRelogio({ agora: '2026-11-03T14:00:00Z' });
const f = fabrica(relogio);

let api: ReturnType<typeof criarModuloApiPromotor>;
let repo: ReturnType<typeof repositorioMemoria>;
const rota = (metodo: string, caminho: string): RotaModulo => api.rotas!.find((r) => r.metodo === metodo && r.caminho === caminho)!;

beforeEach(() => {
  repo = repositorioMemoria();
  repo.definirCategoria(T1, CATEGORIA, 'Massas');
  api = criarModuloApiPromotor({ repositorio: repo });
});

describe('permissões e licença das rotas (regra 6)', () => {
  const quem = (acao: string, ativos: readonly string[] = ['core', 'promotor']): Perfil[] =>
    PERFIS.filter((perfil) => criarPermissoes([manifest]).pode(acao, { perfil, modulosAtivos: ativos as never }));

  it('toda rota de escrita tem ação do manifesto que só o promotor executa', () => {
    // cadastros/* (BKO, escrita por analista/admin) ficam de fora: são cobertos em rotas-cadastros.test.ts (RN-PRO-01 lá também)
    const escrita = api.rotas!.filter((r) => r.metodo !== 'GET' && !r.caminho.startsWith('cadastros/'));
    expect(escrita.length).toBe(11);
    for (const r of escrita) expect(quem(r.acao!), `${r.metodo} ${r.caminho}`).toEqual(['promotor']);
  });

  it('RN-CORE-02: com o Promotor inativo ninguém executa as ações das coletas', () => {
    for (const r of api.rotas!.filter((x) => x.acao)) expect(quem(r.acao!, ['core']), r.caminho).toEqual([]);
  });

  it('relatórios: só supervisor, gerente, analista e admin (perfis do módulo)', () => {
    for (const c of ['relatorios/share', 'relatorios/ruptura']) expect(rota('GET', c).perfis).toEqual([...PERFIS_RELATORIO]);
  });

  it('RN-PRO-01: nenhuma rota do Promotor é de pedido nem barrada como tal', () => {
    for (const r of api.rotas!) {
      expect(r.caminho).not.toMatch(/pedido/);
      expect(promotorBarradoNaRota(r)).toBe(false);
    }
  });

  it('a visita de loja declara o cliente para a plataforma conferir a carteira (RN-CORE-04)', () => {
    const r = rota('POST', 'visitas-loja');
    expect(typeof r.carteira).toBe('function');
    expect((r.carteira as (e: unknown) => string)({ corpo: f.visita(uuid(1)), query: {}, params: {} })).toBe(LOJA);
  });
});

describe('rotas REST das coletas', () => {
  it('visita, foto e gôndola pela API: criada, repetida e checkout', async () => {
    const c = criarCtx(relogio);
    const v = f.visita(uuid(20));
    expect(await rota('POST', 'visitas-loja').executar(c.rota({ corpo: v }))).toEqual({ id: v.id, situacao: 'criada' });
    expect(await rota('POST', 'visitas-loja').executar(c.rota({ corpo: v }))).toEqual({ id: v.id, situacao: 'repetida' });
    const a = f.foto(v.id, 3);
    const d = f.foto(v.id, 4);
    for (const x of [a, d]) await rota('POST', 'coletas/fotos').executar(c.rota({ corpo: x }));
    const g = f.gondola(v.id, a.id, d.id);
    expect(await rota('POST', 'coletas/gondola').executar(c.rota({ corpo: g }))).toEqual({ id: g.id, situacao: 'criada' });
    expect(await rota('POST', 'visitas-loja').executar(c.rota({ corpo: f.fechar(v, 25) }))).toEqual({ id: v.id, situacao: 'checkout' });
    expect(c.eventos.map((e) => e.nome)).toEqual(['promotor.gondola.registrada@1', 'promotor.visita_loja.concluida@1']);
  });

  it('recusas viram o status HTTP da regra (404 sem check-in, 422 RN-PRO-02, 409 conflito)', async () => {
    const c = criarCtx(relogio);
    const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ErroHttpModulo);
    const semVisita = await erro(rota('POST', 'coletas/ruptura').executar(c.rota({ corpo: f.ruptura(uuid(21), 'presente') })));
    expect(semVisita).toMatchObject({ status: 404, codigo: 'VISITA_LOJA_NAO_ENCONTRADA' });
    const v = f.visita(uuid(22));
    await rota('POST', 'visitas-loja').executar(c.rota({ corpo: v }));
    await rota('POST', 'visitas-loja').executar(c.rota({ corpo: f.fechar(v, 15) }));
    expect(await erro(rota('POST', 'coletas/share').executar(c.rota({ corpo: f.share(v.id, 1, 2, 16) })))).toMatchObject({ status: 422, codigo: 'RN-PRO-02' });
    expect(await erro(rota('POST', 'visitas-loja').executar(c.rota({ corpo: f.fechar(v, 16) })))).toMatchObject({ status: 409, codigo: 'CONFLITO' });
  });
});

describe('relatórios do BKO de trade (RF-PRO-12)', () => {
  /** Duas visitas que contam (promotor e outro promotor) e uma curta (6 min), com share e ruptura. */
  async function semear() {
    const p1 = criarCtx(relogio, { usuario: PROMOTOR });
    const p2 = criarCtx(relogio, { usuario: OUTRO_PROMOTOR });
    const v1 = f.visita(uuid(30));
    const v2 = f.visita(uuid(31), { visita_id: uuid(0xd2) });
    const curta = f.visita(uuid(32), { visita_id: uuid(0xd3) });
    await rota('POST', 'visitas-loja').executar(p1.rota({ corpo: v1 }));
    await rota('POST', 'coletas/share').executar(p1.rota({ corpo: f.share(v1.id, 12, 40, 5) }));
    await rota('POST', 'coletas/ruptura').executar(p1.rota({ corpo: f.ruptura(v1.id, 'ruptura_total', 6) }));
    await rota('POST', 'coletas/ruptura').executar(p1.rota({ corpo: f.ruptura(v1.id, 'presente', 7) }));
    await rota('POST', 'visitas-loja').executar(p1.rota({ corpo: f.fechar(v1, 40) }));
    await rota('POST', 'visitas-loja').executar(p2.rota({ corpo: v2 }));
    await rota('POST', 'coletas/share').executar(p2.rota({ corpo: f.share(v2.id, 20, 40, 8) }));
    await rota('POST', 'visitas-loja').executar(p2.rota({ corpo: f.fechar(v2, 30) }));
    await rota('POST', 'visitas-loja').executar(p1.rota({ corpo: curta }));
    await rota('POST', 'coletas/share').executar(p1.rota({ corpo: f.share(curta.id, 40, 40, 2) }));
    await rota('POST', 'visitas-loja').executar(p1.rota({ corpo: f.fechar(curta, 6) }));
    return { v1, v2 };
  }

  it('analista (tenant): share × meta com a última medição válida; visita curta fica fora (RN-PRO-07)', async () => {
    await semear();
    const a = criarCtx(relogio, { usuario: uuid(0xb9), perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    const r = RelatorioShareApi.parse(await rota('GET', 'relatorios/share').executar(a.rota({ query: FiltroRelatorio.parse({}) })));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ cliente_id: LOJA, cliente_nome: 'Mercado Bom Preço', categoria_nome: 'Massas', share_pct: 50, meta_pct: 40, situacao: 'atingiu' });
    expect(r).toMatchObject({ de: '2026-10-05', ate: '2026-11-03' });
  });

  it('RN-CORE-04: supervisor vê só os promotores da equipe', async () => {
    await semear();
    const s = criarCtx(relogio, { usuario: SUPERVISOR, perfil: 'supervisor', carteira: 'tenant', usuarios: new Set([SUPERVISOR, PROMOTOR]) });
    const r = RelatorioShareApi.parse(await rota('GET', 'relatorios/share').executar(s.rota({ query: {} })));
    expect(r.linhas.map((l) => l.share_pct)).toEqual([30]);
  });

  it('RN-PRO-05: ruptura por loja na última visita válida', async () => {
    const { v2 } = await semear();
    const a = criarCtx(relogio, { usuario: uuid(0xb9), perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    const r = RelatorioRupturaApi.parse(await rota('GET', 'relatorios/ruptura').executar(a.rota({ query: {} })));
    // a v2 é a mais recente, mas não conferiu o mix: vale a v1
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ cliente_id: LOJA, cliente_nome: 'Mercado Bom Preço', total: 2, ruptura_total: 1, ruptura_pct: 50 });
    expect(r.linhas[0]!.visita_loja_id).not.toBe(v2.id);
  });

  it('multi-tenant: o analista do tenant 2 não vê nada do tenant 1', async () => {
    await semear();
    const outro = criarCtx(relogio, { tenant: T2, usuario: uuid(0xb9), perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    expect(RelatorioShareApi.parse(await rota('GET', 'relatorios/share').executar(outro.rota({ query: {} }))).linhas).toEqual([]);
    expect(RelatorioRupturaApi.parse(await rota('GET', 'relatorios/ruptura').executar(outro.rota({ query: {} }))).linhas).toEqual([]);
  });

  it('filtro: período fora das visitas e loja que não é a das coletas devolvem vazio', async () => {
    await semear();
    const a = criarCtx(relogio, { usuario: uuid(0xb9), perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    expect(RelatorioShareApi.parse(await rota('GET', 'relatorios/share').executar(a.rota({ query: { de: '2026-10-01', ate: '2026-10-31' } }))).linhas).toEqual([]);
    expect(RelatorioShareApi.parse(await rota('GET', 'relatorios/share').executar(a.rota({ query: { cliente_id: uuid(0xc9) } }))).linhas).toEqual([]);
  });

  it('período padrão: 30 dias civis até hoje no fuso do tenant; data final antes da inicial é inválida', () => {
    const tarde = criarRelogio({ agora: '2026-11-04T02:00:00Z' }); // 22:00 de 03/11 em Manaus
    expect(periodoDoFiltro({ agora: () => tarde.agora(), fuso: () => tarde.fuso }, {})).toEqual({ de: '2026-10-05', ate: '2026-11-03' });
    expect(FiltroRelatorio.safeParse({ de: '2026-11-03', ate: '2026-11-01' }).success).toBe(false);
  });
});
