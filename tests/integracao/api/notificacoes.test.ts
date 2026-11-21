/**
 * Validação da T-0019 (central de notificações, RF-CORE-09; desenho T-0016 §5.5) pelo agente `testes`, de ponta a ponta:
 * o recado nasce no servidor (`POST /v1/core/notificacoes`, como a página Recados do BKO), chega ao app Campo no próximo
 * sync (motor REAL do platform-sdk com `entidades-notificacao` do Core e a caixa montada por `montarCaixa`, a mesma
 * função da tela), é lido sem sinal (`notificacao_leitura` na fila, `comandoDeLeitura`) e a leitura sobe na volta.
 * `createApp` REAL × Postgres como `macuxi_app` (RLS). Cenários S1-060..S1-066 de tests/plano/sprint-1.md.
 * O push real (Expo) não entra aqui: depende do build EAS e do despachante (T-0022) — roteiro manual no plano.
 */
import { randomUUID } from 'node:crypto';
import { NotificacaoSyncSchema, type NotificacaoSync } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ItemPush, LinhaSync, ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comandoDeLeitura, contarNaoLidas, montarCaixa } from '../../../modules/core/app/lib/notificacoes';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';

const U = A.usuarios;

describe.skipIf(semBanco())('T-0019 — notificação do servidor ao app no próximo sync (createApp real × motor real × Postgres)', () => {
  let api: ApiDeTeste;
  let supervisor: string;
  let gerente: string;
  let adminB: string;

  const enviar = (token: string | null, corpo: Record<string, unknown>) => api.chamar(token, { method: 'POST', url: '/v1/core/notificacoes', payload: corpo });
  const recado = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), titulo: 'Visitar o c1 hoje', corpo: 'Cliente pediu retorno sobre a tabela nova.', ...extra });
  const doEnvio = async (envio: string) =>
    (await api.admin.query('select * from core.notificacao where envio_id = $1 order by usuario_id', [envio])).rows as Array<Record<string, unknown> & { id: string; usuario_id: string }>;
  const caixa = async (ap: AparelhoCampo) => montarCaixa(await ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao'), ap.motor.sobreposicao(['notificacao_leitura']), new Date());
  const pushLeitura = async (token: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const leitura = (notificacao_id: string, lida_em = new Date().toISOString()): ItemPush => {
    const id = randomUUID();
    return { id, entidade: 'notificacao_leitura', operacao: 'upsert', payload: { id, notificacao_id, lida_em } };
  };

  beforeAll(async () => {
    api = await subirApi();
    supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    await esperarHorizonte();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S1-060 critério 1: recado do supervisor aparece no app no próximo sync; lido sem sinal, a leitura sobe na volta e fica lida (servidor e aparelho)', async () => {
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    const antes = await caixa(ap);
    const naoLidasAntes = contarNaoLidas(antes);

    const corpo = recado({ usuario_ids: [U.vendedor1], prioridade: 'alta', link: '/m/rota' });
    const r = await enviar(supervisor, corpo);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ criadas: 1, ja_existentes: 0 });
    const [linha] = await doEnvio(corpo.id);
    expect(linha).toMatchObject({ usuario_id: U.vendedor1, tipo: 'recado', autor_id: U.supervisor, prioridade: 'alta', link: '/m/rota', lida_em: null });

    // antes do sync o aparelho não tem; no próximo sync aparece no topo (não lida, alta prioridade)
    expect(antes.map((n) => n.id)).not.toContain(linha!.id);
    await esperarHorizonte();
    expect(await ap.sincronizar()).toBe(true);
    const depois = await caixa(ap);
    expect(depois[0]).toMatchObject({ id: linha!.id, titulo: corpo.titulo, corpo: corpo.corpo, prioridade: 'alta', lida_em: null, leituraPendente: false, link: '/m/rota' });
    NotificacaoSyncSchema.parse((await ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao')).find((n) => n.id === linha!.id));
    expect(contarNaoLidas(depois)).toBe(naoLidasAntes + 1);

    // lida em modo avião: a caixa mostra lida na hora (fila), o servidor ainda não sabe
    ap.online.valor = false;
    const cmd = comandoDeLeitura(linha!.id, new Date(), randomUUID);
    await ap.motor.enfileirar({ id: cmd.id, entidade: 'notificacao_leitura', payload: cmd, rotulo: 'Leitura de aviso' });
    const offline = await caixa(ap);
    expect(offline.find((n) => n.id === linha!.id)).toMatchObject({ lida_em: cmd.lida_em, leituraPendente: true });
    expect(contarNaoLidas(offline)).toBe(naoLidasAntes);
    expect((await doEnvio(corpo.id))[0]!.lida_em).toBeNull();
    expect(await ap.sincronizar()).toBe(false);

    // sinal de volta: a leitura sobe com a hora do aparelho
    ap.online.valor = true;
    expect(await ap.sincronizar()).toBe(true);
    expect(ap.motor.estado().fila).toEqual([]);
    expect(new Date((await doEnvio(corpo.id))[0]!.lida_em as Date).toISOString()).toBe(cmd.lida_em);
    const minhas = await api.chamar(ap.token.valor, { method: 'GET', url: '/v1/core/notificacoes?nao_lidas=false' });
    expect((minhas.json() as { itens: Array<{ id: string; lida_em: string | null }> }).itens.find((n) => n.id === linha!.id)?.lida_em).toBeTruthy();
  });

  // D-3 (corrigido, ADR 0009 adendo §3): a leitura aceita sai da fila mas fica em `estado.aceitos`, sobreposta pela
  // `motor.sobreposicao(['notificacao_leitura'])` até o pull trazer `lida_em` (helper `caixa` acima, como a tela).
  it('S1-065 D-3: logo depois que a leitura é aceita pelo servidor, a caixa do aparelho continua mostrando lida', async () => {
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    const outra = recado({ usuario_ids: [U.vendedor1] });
    expect((await enviar(supervisor, outra)).statusCode).toBe(200);
    const [segunda] = await doEnvio(outra.id);
    await esperarHorizonte();
    expect(await ap.sincronizar()).toBe(true);
    const cmd2 = comandoDeLeitura(segunda!.id, new Date(), randomUUID);
    await ap.motor.enfileirar({ id: cmd2.id, entidade: 'notificacao_leitura', payload: cmd2 });
    await ap.motor.enviar();
    expect(ap.motor.estado().fila).toEqual([]);
    expect((await doEnvio(outra.id))[0]!.lida_em).not.toBeNull();
    const logoDepois = (await caixa(ap)).find((n) => n.id === segunda!.id);
    expect(logoDepois?.lida_em, 'a leitura aceita volta a "não lida" no aparelho até o próximo pull').toBeTruthy();
    expect(ap.motor.estado().aceitos.map((i) => i.id)).toEqual([cmd2.id]);
    // o pull depois do horizonte traz a linha lida: o aceito sai e a caixa continua lida, agora pela linha do servidor
    await esperarHorizonte();
    expect(await ap.sincronizar()).toBe(true);
    expect(ap.motor.estado().aceitos).toEqual([]);
    expect((await ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao')).find((n) => n.id === segunda!.id)?.lida_em).toBeTruthy();
    expect((await caixa(ap)).find((n) => n.id === segunda!.id)).toMatchObject({ leituraPendente: false, lida_em: expect.any(String) });
  });

  it('S1-060b critério 1: no sync seguinte a linha chega lida do servidor (sem depender da fila)', async () => {
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br');
    expect(await ap.sincronizar()).toBe(true);
    const corpo = recado({ usuario_ids: [U.vendedor1] });
    expect((await enviar(supervisor, corpo)).statusCode).toBe(200);
    const [linha] = await doEnvio(corpo.id);
    await esperarHorizonte();
    expect(await ap.sincronizar()).toBe(true);
    const item = leitura(linha!.id);
    await ap.motor.enfileirar({ id: item.id, entidade: 'notificacao_leitura', payload: item.payload });
    expect(await ap.sincronizar()).toBe(true);
    await esperarHorizonte();
    expect(await ap.sincronizar()).toBe(true);
    expect((await caixa(ap)).find((n) => n.id === linha!.id)).toMatchObject({ leituraPendente: false, lida_em: expect.any(String) });
    expect((await ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao')).find((n) => n.id === linha!.id)!.lida_em).toBeTruthy();
  });

  it('S1-061 critério 2 (escopo por usuário e tenant): só o destinatário recebe — nem o colega, nem quem enviou, nem o tenant B; cada aparelho só tem as próprias', async () => {
    const corpo = recado({ usuario_ids: [U.vendedor1] });
    expect((await enviar(supervisor, corpo)).statusCode).toBe(200);
    const [linha] = await doEnvio(corpo.id);
    await esperarHorizonte();
    const aparelhos = {
      vendedor1: await aparelhoCampo(api, 'vendedor@exemplo.com.br'),
      promotor: await aparelhoCampo(api, 'promotor@exemplo.com.br'),
      vendedor2: await aparelhoCampo(api, 'vendedor2@exemplo.com.br'),
      supervisor: await aparelhoCampo(api, 'supervisor@exemplo.com.br'),
      vendedorB: await aparelhoCampo(api, 'vendedor@exemplo.com.br', { tenant: B }),
    };
    const idsA = new Set((await api.admin.query<{ id: string }>('select id from core.notificacao where tenant_id = $1', [A.tenantId])).rows.map((x) => x.id));
    for (const [quem, ap] of Object.entries(aparelhos)) {
      expect(await ap.sincronizar(), quem).toBe(true);
      const linhas = await ap.motor.linhas<NotificacaoSync & LinhaSync>('notificacao');
      expect(linhas.length, `${quem} tem a própria notificação da fixture`).toBeGreaterThan(0);
      expect(new Set(linhas.map((n) => n.usuario_id)), quem).toEqual(new Set([ap.sessao.usuario.id]));
      expect(linhas.some((n) => n.id === linha!.id), quem).toBe(quem === 'vendedor1');
      if (quem === 'vendedorB') expect(linhas.filter((n) => idsA.has(n.id))).toEqual([]);
    }
    // caixa online (BKO/Gestão): também só as próprias
    for (const [token, eu] of [
      [supervisor, U.supervisor],
      [adminB, B.usuarios.admin],
    ] as const) {
      const r = await api.chamar(token, { method: 'GET', url: '/v1/core/notificacoes' });
      expect(r.statusCode, r.body).toBe(200);
      const itens = (r.json() as { itens: Array<{ id: string; usuario_id: string }> }).itens;
      expect(new Set(itens.map((i) => i.usuario_id))).toEqual(new Set([eu]));
      expect(itens.map((i) => i.id)).not.toContain(linha!.id);
    }
    // ler a de outro usuário (push ou BKO) responde como inexistente; nada muda
    const v2 = aparelhos.vendedor2;
    expect((await pushLeitura(v2.token.valor, [leitura(linha!.id)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'NOTIFICACAO_NAO_ENCONTRADA' });
    const bko = await api.chamar(v2.token.valor, { method: 'POST', url: `/v1/core/notificacoes/${linha!.id}/lida` });
    expect([bko.statusCode, erroDe(bko).codigo]).toEqual([404, 'NOTIFICACAO_NAO_ENCONTRADA']);
    expect((await pushLeitura(aparelhos.vendedorB.token.valor, [leitura(linha!.id)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'NOTIFICACAO_NAO_ENCONTRADA' });
    const bkoB = await api.chamar(adminB, { method: 'POST', url: `/v1/core/notificacoes/${linha!.id}/lida` });
    expect(bkoB.statusCode).toBe(404);
    expect((await doEnvio(corpo.id))[0]!.lida_em).toBeNull();
  });

  it('S1-062 envio fora da equipe → 403 FORA_DO_ESCOPO e nada é gravado; só supervisor, gerente, analista e admin enviam', async () => {
    const casos: Array<[string, string, Record<string, unknown>]> = [
      ['supervisor → vendedor-2 (equipe 2)', supervisor, { usuario_ids: [U.vendedor2] }],
      ['supervisor → vendedor-1 e vendedor-2 (um fora)', supervisor, { usuario_ids: [U.vendedor1, U.vendedor2] }],
      ['supervisor → equipe 2', supervisor, { equipe_id: A.equipes.equipe2 }],
      ['supervisor → usuário do tenant B', supervisor, { usuario_ids: [B.usuarios.vendedor] }],
      ['supervisor → equipe do tenant B', supervisor, { equipe_id: B.equipes.equipe }],
      ['admin B → vendedor-1 de A', adminB, { usuario_ids: [U.vendedor1] }],
      ['supervisor → usuário inexistente', supervisor, { usuario_ids: [randomUUID()] }],
    ];
    for (const [nome, token, destino] of casos) {
      const corpo = recado(destino);
      const r = await enviar(token, corpo);
      expect(r.statusCode, `${nome}: ${r.body}`).toBeGreaterThanOrEqual(403);
      expect(r.statusCode, nome).toBeLessThan(500);
      if (!nome.includes('equipe do tenant B')) expect([r.statusCode, erroDe(r).codigo], nome).toEqual([403, 'FORA_DO_ESCOPO']);
      expect(r.body, nome).not.toMatch(/Vendedor Dois|Vendedor Beta|Alfa|Beta/);
      expect(await doEnvio(corpo.id), nome).toEqual([]);
    }
    for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br', 'assistente@exemplo.com.br']) {
      const t = (await api.sessao(email)).access_token;
      const corpo = recado({ usuario_ids: [U.vendedor1] });
      const r = await enviar(t, corpo);
      expect([r.statusCode, erroDe(r).codigo], email).toEqual([403, 'PERFIL_SEM_ACESSO']);
      expect(await doEnvio(corpo.id)).toEqual([]);
    }
    expect((await enviar(null, recado({ usuario_ids: [U.vendedor1] }))).statusCode).toBe(401);
    // dentro do escopo: gerente → equipe 2 (abaixo dele); supervisor → a própria equipe
    const ger = recado({ equipe_id: A.equipes.equipe2 });
    expect((await enviar(gerente, ger)).json()).toEqual({ criadas: 1, ja_existentes: 0 });
    expect((await doEnvio(ger.id)).map((n) => n.usuario_id)).toEqual([U.vendedor2]);
    const sup = recado({ equipe_id: A.equipes.equipe1 });
    const rs = await enviar(supervisor, sup);
    expect(rs.statusCode, rs.body).toBe(200);
    expect((await doEnvio(sup.id)).map((n) => n.usuario_id)).toEqual(expect.arrayContaining([U.vendedor1, U.promotor]));
    expect((await doEnvio(sup.id)).map((n) => n.usuario_id)).not.toContain(U.vendedor2);
  });

  it('S1-063 idempotência: reenviar o mesmo envio não duplica notificação, evento nem auditoria; ler duas vezes mantém a 1ª hora', async () => {
    const corpo = recado({ usuario_ids: [U.vendedor1, U.promotor] });
    expect((await enviar(supervisor, corpo)).json()).toEqual({ criadas: 2, ja_existentes: 0 });
    for (let i = 0; i < 2; i++) {
      const r = await enviar(supervisor, corpo);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ criadas: 0, ja_existentes: 2 });
    }
    const linhas = await doEnvio(corpo.id);
    expect(linhas).toHaveLength(2);
    const eventos = await api.admin.query<{ agregado_id: string; payload: Record<string, unknown> }>(
      "select agregado_id, payload from plataforma.evento where nome = 'core.notificacao.criada@1' and agregado_id = any($1::uuid[])",
      [linhas.map((l) => l.id)],
    );
    expect(eventos.rows).toHaveLength(2);
    // o evento não leva título nem corpo (dado pessoal fica no banco)
    for (const e of eventos.rows) expect(Object.keys(e.payload).sort()).toEqual(['notificacao_id', 'prioridade', 'tipo', 'usuario_id']);
    const aud = await api.admin.query("select count(*)::int as n from plataforma.auditoria where acao = 'notificacao.enviar' and entidade_id = $1", [corpo.id]);
    expect(aud.rows[0].n).toBe(1);

    // leitura: o mesmo comando reenviado e um 2º comando depois mantêm a PRIMEIRA hora
    const t = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    const minha = linhas.find((l) => l.usuario_id === U.vendedor1)!;
    // hora-fixa-ok: horas de leitura nunca comparadas com o relógio
    const [PRIMEIRA_HORA, SEGUNDA_HORA] = ['2026-10-31T13:00:00.000Z', '2026-10-31T15:00:00.000Z'];
    const primeira = leitura(minha.id, PRIMEIRA_HORA);
    for (let i = 0; i < 2; i++) expect((await pushLeitura(t, [primeira]))[0]).toMatchObject({ status: 'aceito' });
    expect((await pushLeitura(t, [leitura(minha.id, SEGUNDA_HORA)]))[0]).toMatchObject({ status: 'aceito' });
    expect(new Date((await doEnvio(corpo.id)).find((l) => l.id === minha.id)!.lida_em as Date).toISOString()).toBe(PRIMEIRA_HORA);
    // a do promotor segue não lida
    expect((await doEnvio(corpo.id)).find((l) => l.usuario_id === U.promotor)!.lida_em).toBeNull();
  });

  it('S1-064 token de push: só grava no aparelho da própria sessão; aparelho de outro usuário ou de B → 404', async () => {
    const DISP = '0d000000-0000-4000-8000-0000000019a1';
    const login = await api.entrar('vendedor@exemplo.com.br', { dispositivo_id: DISP });
    const t = (login.json() as { access_token: string }).access_token;
    const gravar = (token: string, dispositivo_id: string) =>
      api.chamar(token, { method: 'PUT', url: '/v1/core/dispositivos/atual/push', payload: { dispositivo_id, token: 'ExponentPushToken[teste-19]', plataforma: 'android' } });
    const ok = await gravar(t, DISP);
    expect(ok.statusCode, ok.body).toBe(200);
    const linha = (await api.admin.query('select push_token, push_plataforma from core.dispositivo where id = $1', [DISP])).rows[0];
    expect(linha).toEqual({ push_token: 'ExponentPushToken[teste-19]', push_plataforma: 'android' });
    const v2 = (await api.sessao('vendedor2@exemplo.com.br')).access_token;
    expect((await gravar(v2, DISP)).statusCode).toBe(404);
    const vB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    expect((await gravar(vB, DISP)).statusCode).toBe(404);
    expect((await api.admin.query('select push_token from core.dispositivo where id = $1', [DISP])).rows[0].push_token).toBe('ExponentPushToken[teste-19]');
  });
}, 180_000);
