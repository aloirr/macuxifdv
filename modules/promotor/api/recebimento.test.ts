import { criarRelogio } from '@macuxi/comum/relogio';
import { SYNC_NAO_IMPLEMENTADO, type ItemPush, type ProvedorSync } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENTIDADES_COLETA, VisitaLoja } from '../contracts';
import { criarCtx, fabrica, LOJA_FORA, OUTRO_PROMOTOR, PROMOTOR, SUPERVISOR, T1, T2, uuid, type CtxTeste } from './apoio-teste';
import { criarModuloApiPromotor, repositorioMemoria } from './index';

const relogio = criarRelogio({ agora: '2026-11-03T13:00:00Z' });
const f = fabrica(relogio);

let api: ReturnType<typeof criarModuloApiPromotor>;
const prov = (entidade: string): ProvedorSync => api.sync!.find((p) => p.entidade.nome === entidade)!;

/** Envia pelo push como a plataforma faria: valida o payload pelo schema da entidade e chama o provedor. */
async function enviar(c: CtxTeste, entidade: string, payload: { id: string } & Record<string, unknown>, operacao: ItemPush['operacao'] = 'upsert') {
  const p = prov(entidade);
  const dados = p.entidade.schema.parse(payload);
  const [r] = await p.receber!(c.ctx, [{ entidade, id: payload.id, operacao, payload: dados }]);
  return r!;
}

beforeEach(() => {
  api = criarModuloApiPromotor({ repositorio: repositorioMemoria() });
});

describe('push da visita de loja (check-in e checkout)', () => {
  it('check-in aceito; checkout aceito e publica promotor.visita_loja.concluida@1 com a permanência recalculada (RN-PRO-07)', async () => {
    const c = criarCtx(relogio);
    const v = f.visita(uuid(1));
    expect(await enviar(c, 'visita_loja', v)).toEqual({ id: v.id, status: 'aceito' });
    const foto = f.foto(v.id, 5, { latitude: null, longitude: null, sem_gps: true });
    expect(await enviar(c, 'foto_coleta', foto)).toMatchObject({ status: 'aceito' });
    expect(await enviar(c, 'visita_loja', f.fechar(v, 42, { permanencia_min: 42.3 }))).toEqual({ id: v.id, status: 'aceito' });
    expect(c.eventos).toEqual([
      {
        nome: 'promotor.visita_loja.concluida@1',
        agregado: v.id,
        payload: expect.objectContaining({ visita_loja_id: v.id, promotor_id: PROMOTOR, permanencia_min: 42, fotos_total: 1, fotos_sem_gps: 1, desfecho: 'realizada' }),
      },
    ]);
  });

  it('reenvio idêntico é aceito sem duplicar o evento; mudar o checkout depois é conflito', async () => {
    const c = criarCtx(relogio);
    const v = f.visita(uuid(2));
    await enviar(c, 'visita_loja', v);
    const fechada = f.fechar(v, 30);
    await enviar(c, 'visita_loja', fechada);
    expect(await enviar(c, 'visita_loja', fechada)).toMatchObject({ status: 'aceito' });
    expect(c.eventos).toHaveLength(1);
    expect(await enviar(c, 'visita_loja', f.fechar(v, 31))).toMatchObject({ status: 'conflito' });
  });

  it('RN-PRO-06: checkout de visita realizada com etapa obrigatória pendente é recusado; loja fechada passa', async () => {
    const c = criarCtx(relogio);
    const v = f.visita(uuid(3));
    await enviar(c, 'visita_loja', v);
    await enviar(c, 'checklist_resposta', f.resposta(v.id, uuid(0x99), true, false));
    expect(await enviar(c, 'visita_loja', f.fechar(v, 20))).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-06' });
    const fachada = f.foto(v.id, 15, { tipo: 'fachada' });
    await enviar(c, 'foto_coleta', fachada);
    expect(await enviar(c, 'visita_loja', f.fechar(v, 20, { desfecho: 'loja_fechada', foto_fachada_id: fachada.id }))).toMatchObject({ status: 'aceito' });
  });

  it('RN-CORE-04: loja fora da carteira é recusada', async () => {
    const c = criarCtx(relogio);
    expect(await enviar(c, 'visita_loja', f.visita(uuid(4), { cliente_id: LOJA_FORA }))).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
  });

  it('doc 03 §2: supervisor não registra visita de loja nem coleta (só lê)', async () => {
    const c = criarCtx(relogio, { usuario: SUPERVISOR, perfil: 'supervisor', carteira: 'tenant' });
    expect(await enviar(c, 'visita_loja', f.visita(uuid(5)))).toMatchObject({ status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
    expect(await enviar(c, 'ruptura_item', f.ruptura(uuid(5), 'presente'))).toMatchObject({ status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
  });

  it('o id do item tem de ser o id do payload; remover não existe', async () => {
    const c = criarCtx(relogio);
    const v = f.visita(uuid(6));
    const p = prov('visita_loja');
    expect((await p.receber!(c.ctx, [{ entidade: 'visita_loja', id: uuid(7), operacao: 'upsert', payload: VisitaLoja.parse(v) }]))[0]).toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
    expect(await enviar(c, 'visita_loja', v, 'remover')).toMatchObject({ codigo: 'OPERACAO_NAO_SUPORTADA' });
  });
});

describe('push das coletas', () => {
  async function abrir(c: CtxTeste, n: number) {
    const v = f.visita(uuid(n));
    await enviar(c, 'visita_loja', v);
    return v;
  }

  it('gôndola, share, preço, ruptura e tarefa publicam o evento @1 validado (agregado = id da coleta)', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 10);
    const antes = f.foto(v.id, 3);
    const depois = f.foto(v.id, 4, { tipo: 'gondola_depois' });
    for (const x of [antes, depois]) expect(await enviar(c, 'foto_coleta', x)).toMatchObject({ status: 'aceito' });
    const coletas = [
      ['gondola_registro', f.gondola(v.id, antes.id, depois.id)],
      ['medicao_share', f.share(v.id, 12, 40)],
      ['coleta_preco', f.preco(v.id, 1090)],
      ['ruptura_item', f.ruptura(v.id, 'ruptura_total')],
      ['tarefa_execucao', f.tarefa(v.id, [depois.id])],
      ['validade_item', { id: f.novo(), visita_loja_id: v.id, produto_id: uuid(0xe2), tipo: 'validade', validade: '2026-11-10', lote: null, quantidade: 3, motivo_avaria: null, foto_id: null, registrado_em: f.em(12) }],
      ['acao_concorrencia', { id: f.novo(), visita_loja_id: v.id, concorrente_id: uuid(0xe9), tipo: 'promocao', descricao: 'Leve 3 pague 2', foto_id: null, registrado_em: f.em(13) }],
    ] as const;
    for (const [e, p] of coletas) expect(await enviar(c, e, p), e).toMatchObject({ status: 'aceito' });
    expect(c.eventos.map((e) => e.nome)).toEqual([
      'promotor.gondola.registrada@1',
      'promotor.share.medido@1',
      'promotor.preco.coletado@1',
      'promotor.ruptura.registrada@1',
      'promotor.tarefa.concluida@1',
    ]);
    expect(c.eventos[1]).toMatchObject({ agregado: coletas[1][1].id, payload: { share_pct: 30, atingimento_pct: 75, cliente_id: v.cliente_id, promotor_id: PROMOTOR } });
    // ADR 0010: cada foto registrou o arquivo da visita de loja, com o cliente para o escopo do GET
    expect(c.arquivos).toEqual([
      { id: antes.id, finalidade: 'gondola_antes', entidade: 'visita_loja', entidade_id: v.id, cliente_id: v.cliente_id },
      { id: depois.id, finalidade: 'gondola_depois', entidade: 'visita_loja', entidade_id: v.id, cliente_id: v.cliente_id },
    ]);
  });

  it('RN-PRO-02: coleta sem a visita de loja no servidor fica na fila (retentável), não se perde', async () => {
    const c = criarCtx(relogio);
    const r = await enviar(c, 'ruptura_item', f.ruptura(uuid(11), 'presente'));
    expect(r).toMatchObject({ status: 'rejeitado', codigo: SYNC_NAO_IMPLEMENTADO });
    expect(c.eventos).toEqual([]);
  });

  it('RN-PRO-02: coleta feita depois do checkout é recusada; feita antes e enviada depois é aceita (offline)', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 12);
    await enviar(c, 'visita_loja', f.fechar(v, 30));
    expect(await enviar(c, 'ruptura_item', f.ruptura(v.id, 'presente', 31))).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-02' });
    expect(await enviar(c, 'ruptura_item', f.ruptura(v.id, 'presente', 29))).toMatchObject({ status: 'aceito' });
  });

  it('RN-PRO-02: foto que ainda não chegou deixa a gôndola na fila; foto de outra visita é recusada', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 13);
    const outra = await abrir(c, 14);
    const fotoOutra = f.foto(outra.id, 3);
    await enviar(c, 'foto_coleta', fotoOutra);
    const depois = f.foto(v.id, 4);
    expect(await enviar(c, 'gondola_registro', f.gondola(v.id, uuid(0x777), depois.id))).toMatchObject({ status: 'rejeitado', codigo: SYNC_NAO_IMPLEMENTADO });
    await enviar(c, 'foto_coleta', depois);
    expect(await enviar(c, 'gondola_registro', f.gondola(v.id, fotoOutra.id, depois.id))).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-02' });
  });

  it('RN-PRO-04: preço que variou além do limite precisa de confirmação; limite vem do parâmetro do tenant', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 15);
    expect(await enviar(c, 'coleta_preco', f.preco(v.id, 59900, 599))).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-04' });
    expect(await enviar(c, 'coleta_preco', f.preco(v.id, 59900, 599, true))).toMatchObject({ status: 'aceito' });
    const rigido = criarCtx(relogio, { parametros: { variacao_preco_max_pct: 10 } });
    expect(await enviar(rigido, 'coleta_preco', f.preco(v.id, 1200, 1000))).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-04' });
  });

  it('idempotência: reenvio idêntico aceito sem 2º evento; mesmo id com outro conteúdo é conflito', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 16);
    const r = f.ruptura(v.id, 'ruptura_total');
    await enviar(c, 'ruptura_item', r);
    expect(await enviar(c, 'ruptura_item', r)).toMatchObject({ status: 'aceito' });
    expect(c.eventos).toHaveLength(1);
    expect(await enviar(c, 'ruptura_item', { ...r, status: 'presente' })).toMatchObject({ status: 'conflito' });
  });

  it('RN-CORE-04: outro promotor não usa a visita de loja nem o id de coleta alheios', async () => {
    const c = criarCtx(relogio);
    const v = await abrir(c, 17);
    const r = f.ruptura(v.id, 'presente');
    await enviar(c, 'ruptura_item', r);
    const outro = criarCtx(relogio, { usuario: OUTRO_PROMOTOR });
    expect(await enviar(outro, 'ruptura_item', f.ruptura(v.id, 'presente'))).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_LOJA_NAO_ENCONTRADA' });
    expect(await enviar(outro, 'ruptura_item', r)).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
  });

  it('multi-tenant: a visita do tenant 1 não existe no tenant 2 (mesmo id)', async () => {
    const c1 = criarCtx(relogio, { tenant: T1 });
    const v = await abrir(c1, 18);
    const c2 = criarCtx(relogio, { tenant: T2 });
    expect(await enviar(c2, 'ruptura_item', f.ruptura(v.id, 'presente'))).toMatchObject({ status: 'rejeitado', codigo: SYNC_NAO_IMPLEMENTADO });
    expect(await enviar(c2, 'visita_loja', v)).toMatchObject({ status: 'aceito' }); // mesmo id, outro tenant: registro independente
  });

  it('RN-PRO-01: nenhuma entidade de push do Promotor é de pedido e todas têm provedor', () => {
    expect(api.sync!.map((p) => p.entidade.nome).sort()).toEqual(Object.keys(ENTIDADES_COLETA).sort());
    for (const p of api.sync!) expect(p.entidade.nome).not.toMatch(/pedido/);
  });
});

describe('API sem repositório (só o manifesto)', () => {
  it('sem repositório: só o manifesto (push volta SYNC_NAO_IMPLEMENTADO pela plataforma e as coletas ficam no aparelho)', () => {
    const a = criarModuloApiPromotor({ repositorio: null });
    expect(a.rotas ?? []).toEqual([]);
    expect(a.sync ?? []).toEqual([]);
  });
});
