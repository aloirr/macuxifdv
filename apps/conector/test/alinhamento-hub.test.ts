/**
 * T-0027 — Conector ↔ Hub: alinhamento (divergências D-1 a D-4 da seção 16 do hub-api.md).
 * O Hub falso simula a inativação da carga completa como o domain (`idsDaSessaoNoLote` + `calcularInativacao`): registro que veio
 * inválido nunca é inativado, linha sem id impede a inativação. Aqui o que se prova é que o CONECTOR manda o que o Hub precisa.
 */
import { EXTERNAL_ID_MAX, LoteEnvelope } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { Executor } from '../src/executor';
import { ErroHubVersao, lerRecusaVersao } from '../src/hub/cliente';
import { mapearEValidar } from '../src/mapeamento';
import { cicloPedidos } from '../src/pedidos';
import { lerPolitica } from '../src/politica';
import { reconciliarTudo } from '../src/reconciliacao';
import { processarFila } from '../src/remetente';
import { porLoteNaCargaCompleta, sincronizarEntidade } from '../src/sincronizador';
import { montarStatus } from '../src/status';
import { VERSAO_CONECTOR } from '../src/versao';
import { type Ambiente, CAMPOS_CLIENTE, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente;
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined as unknown as Ambiente;
});

const hora = (seg: number) => `2026-03-01T10:${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}Z`;
const ruim = (id: string, seg: number) => ({ ...cliente(id, hora(seg)), razao_social: null });
const bom = (id: string, seg: number) => cliente(id, hora(seg));

/** O Hub já tem estes clientes ativos (de uma carga anterior). */
function hubJaTem(a: Ambiente, ids: string[]) {
  const m = new Map<string, Record<string, unknown>>();
  for (const id of ids) m.set(id, { external_id: id, alterado_em: '2026-01-01T00:00:00.000Z', razao_social: `Cliente ${id}`, ativo: true });
  a.hub.registros.set('cliente', m);
}
async function rodar(a: Ambiente, voltas = 6) {
  for (let i = 0; i < 3; i++) await sincronizarEntidade(a.ctx, 'cliente');
  for (let i = 0; i < voltas; i++) {
    await processarFila(a.ctx);
    a.relogio.avancar(6_000);
  }
}
const lotesPost = (a: Ambiente) => a.hub.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes')).length;

describe('T-0027 🔴 (D-1): carga completa — o Hub nunca inativa um registro que veio como inválido', () => {
  it('RN-INT-06: carga completa com 1 linha inválida — ela vai em linhas_invalidas com o external_id e NÃO é inativada; o ausente de verdade é', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    amb.hub.simularInativacao = true;
    hubJaTem(amb, ['c1', 'c2', 'c3', 'c4']);
    amb.erp.definir('cliente', [bom('c1', 1), ruim('c2', 2), bom('c3', 3)]); // c4 saiu do ERP
    await rodar(amb);
    const env = amb.hub.envelopes[0] as LoteEnvelope;
    expect(env).toMatchObject({ modo: 'completo', sessao: { parte: 1, ultimo: true } });
    expect(env.linhas_invalidas?.map((l) => l.external_id)).toEqual(['c2']);
    expect([...(amb.hub.inativados.get('cliente') ?? [])]).toEqual(['c4']);
    expect(amb.ctx.store.estado('cliente')).toMatchObject({ fase: 'delta', bloqueio: null });
  });

  it('RN-INT-06: na carga completa as inválidas vão MESMO com linhasInvalidas=descartar (o descarte só vale no delta)', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    (amb.ctx.config.entidades.cliente as { linhasInvalidas: string }).linhasInvalidas = 'descartar';
    amb.hub.simularInativacao = true;
    hubJaTem(amb, ['c1', 'c2', 'c3']);
    amb.erp.definir('cliente', [bom('c1', 1), ruim('c2', 2), bom('c3', 3)]);
    await rodar(amb);
    expect(amb.hub.envelopes[0]?.linhas_invalidas?.map((l) => l.external_id)).toEqual(['c2']);
    expect(amb.hub.inativados.get('cliente')?.size ?? 0).toBe(0);
  });

  it('RN-INT-01/06 (D-2): página do MEIO da carga só com inválidas vira parte própria (registros vazio) — antes ela sumia e o Hub inativaria c3 e c4', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 2 } });
    amb.hub.simularInativacao = true;
    hubJaTem(amb, ['c1', 'c2', 'c3', 'c4', 'c5']);
    amb.erp.definir('cliente', [bom('c1', 1), bom('c2', 2), ruim('c3', 3), ruim('c4', 4), bom('c5', 5)]);
    await rodar(amb);
    const partes = amb.hub.envelopes.map((e) => ({ parte: e.sessao?.parte, ultimo: e.sessao?.ultimo, registros: e.registros.length, invalidas: e.linhas_invalidas?.map((l) => l.external_id) ?? [] }));
    expect(partes).toEqual([
      { parte: 1, ultimo: false, registros: 2, invalidas: [] },
      { parte: 2, ultimo: false, registros: 0, invalidas: ['c3', 'c4'] },
      { parte: 3, ultimo: true, registros: 1, invalidas: [] },
    ]);
    expect([...amb.hub.lotes.values()].map((l) => l.status)).toEqual(['concluido', 'concluido_com_erros', 'concluido']);
    expect(amb.hub.inativados.get('cliente')?.size ?? 0).toBe(0);
    expect(amb.ctx.store.estado('cliente')).toMatchObject({ fase: 'delta', bloqueio: null, confirmado: { external_id: 'c5' } });
  });

  it('RN-INT-01/06: a ÚLTIMA página só com inválidas fecha a sessão (ultimo: true) — a carga não fica aberta para sempre', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 2 } });
    amb.hub.simularInativacao = true;
    hubJaTem(amb, ['c1', 'c2', 'c3', 'c9']);
    amb.erp.definir('cliente', [bom('c1', 1), bom('c2', 2), ruim('c3', 3)]);
    await rodar(amb);
    expect(amb.hub.envelopes.at(-1)).toMatchObject({ registros: [], sessao: { parte: 2, ultimo: true } });
    expect([...(amb.hub.inativados.get('cliente') ?? [])]).toEqual(['c9']);
    expect(amb.logs.join('\n')).not.toContain('sessao_nao_fechada');
  });

  it('RN-INT-03/06: na carga completa nenhuma inválida é omitida — 520 vão em 500 + 20 (a 2ª parte só de inválidas); nada só em contagem', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 5000 } });
    amb.hub.simularInativacao = true;
    hubJaTem(amb, ['ok1', 'fora']);
    amb.erp.definir('cliente', [bom('ok1', 0), ...Array.from({ length: 520 }, (_, i) => ruim(`r${String(i).padStart(3, '0')}`, i + 1))]);
    await rodar(amb);
    const [p1, p2] = amb.hub.envelopes;
    expect(p1).toMatchObject({ sessao: { parte: 1, ultimo: false } });
    expect(p1?.registros).toHaveLength(1);
    expect(p1?.linhas_invalidas).toHaveLength(500);
    expect(p2).toMatchObject({ registros: [], sessao: { parte: 2, ultimo: true } });
    expect(p2?.linhas_invalidas).toHaveLength(20);
    expect(amb.hub.envelopes.every((e) => e.linhas_invalidas_omitidas === undefined)).toBe(true);
    expect([...(amb.hub.inativados.get('cliente') ?? [])]).toEqual(['fora']);
  });

  it('RN-INT-06: lote.maxLinhasInvalidas=0 ("só a contagem") não vale na carga completa; o teto por lote é 500', () => {
    expect(porLoteNaCargaCompleta(0)).toBe(500);
    expect(porLoteNaCargaCompleta(2)).toBe(2);
    expect(porLoteNaCargaCompleta(4000)).toBe(500);
  });

  it('RN-INT-06: o lote com as inválidas continua dentro de lote.maxBytes (o espaço delas é reservado)', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 5000, maxBytes: 20_000 } });
    amb.erp.definir('cliente', [...Array.from({ length: 200 }, (_, i) => bom(`b${String(i).padStart(3, '0')}`, i)), ...Array.from({ length: 60 }, (_, i) => ruim(`r${i}`, 300 + i))]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    await processarFila(amb.ctx);
    expect(amb.hub.envelopes.length).toBeGreaterThan(1);
    for (const e of amb.hub.envelopes) expect(Buffer.byteLength(JSON.stringify(e))).toBeLessThanOrEqual(20_000);
  });

  it('RN-INT-06: linha cujo mapeamento quebra (JSON inválido em outra coluna) ainda leva o external_id ao Hub', () => {
    const cfg = { ativa: true, consulta: 'x', linhasInvalidas: 'enviar' as const, campos: { ...CAMPOS_CLIENTE, contatos: { coluna: 'contatos', transformar: 'json' as const } } };
    const m = mapearEValidar('cliente', cfg as never, [{ ...bom('c7', 1), contatos: '{quebrado' }]);
    expect(m.linhasInvalidas).toEqual([expect.objectContaining({ external_id: 'c7', campo: '(linha)', codigo: 'formato_invalido' })]);
  });
});

describe('T-0027 (D-3): external_id com até 200 caracteres nos dois lados', () => {
  it('RN-INT-09: registro com external_id de 200 caracteres é aceito no Conector e no Hub (antes o limite era 100)', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    const id200 = 'K'.repeat(EXTERNAL_ID_MAX);
    amb.erp.definir('cliente', [cliente(id200, hora(1), 'Cliente com chave longa')]);
    await rodar(amb, 3);
    expect(amb.hub.envelopes[0]?.registros).toHaveLength(1);
    expect(amb.hub.linhasDe('cliente').map((r) => r.external_id)).toEqual([id200]);
  });

  it('RN-INT-09: external_id acima de 200 vira linha inválida SEM id (nunca cortado) e o envelope continua válido', async () => {
    amb = await criarAmbiente({ lote: { maxLinhas: 10 } });
    const id201 = 'K'.repeat(EXTERNAL_ID_MAX + 1);
    amb.erp.definir('cliente', [bom('c1', 1), cliente(id201, hora(2), 'Cliente com chave longa demais')]);
    await rodar(amb, 3);
    const env = amb.hub.envelopes[0] as LoteEnvelope;
    expect(LoteEnvelope.safeParse(env).success).toBe(true);
    expect(env.linhas_invalidas).toEqual([expect.objectContaining({ external_id: null, campo: 'external_id' })]);
    expect(env.cursor).toBeUndefined(); // o cursor declarado (informativo) não leva o id longo
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
  });
});

describe('T-0027 (D-4): HTTP 426 é PAUSA, não recusa definitiva', () => {
  const emDelta = (a: Ambiente) => a.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });

  it('RN-INT-11: 426 em POST /lotes não bloqueia a entidade; guarda a mínima informada, para de enviar, segue com o sinal e volta sozinho', async () => {
    amb = await criarAmbiente();
    emDelta(amb);
    amb.erp.definir('cliente', [bom('c1', 1)]);
    await sincronizarEntidade(amb.ctx, 'cliente'); // lote na fila local
    // um Conector que ainda não recebeu a política pelo sinal; o Hub passa a exigir 9.0.0 nas rotas de dados
    amb.hub.exigirVersao = { minima: '9.0.0' };
    const r = await processarFila(amb.ctx);
    expect(r).toMatchObject({ recusados: 0, adiados: 1 });
    expect(r.interrompido).toMatch(/426.*9\.0\.0/);
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
    expect(amb.ctx.store.contarLotes('cliente', ['pendente'])).toBe(1);
    expect(lerPolitica(amb.ctx.store)?.politica).toMatchObject({ versao_minima: '9.0.0', versao_recomendada: '9.0.0' });
    expect(montarStatus(amb.ctx.store, amb.ctx.config, VERSAO_CONECTOR).versao).toMatchObject({ situacao: 'abaixo_da_minima', deveParar: true });
    expect(amb.logs.join('\n')).toContain('hub_recusou_versao');

    // parado por versão: nada de dados sai, o sinal avisa o Hub
    const antes = lotesPost(amb);
    amb.relogio.avancar(120_000);
    const exec = new Executor(amb.ctx);
    await exec.ciclo();
    expect(lotesPost(amb)).toBe(antes);
    expect(amb.hub.sinais.at(-1)).toMatchObject({ parado_por_versao: true });

    // o Hub baixa a exigência (política do sinal): o lote que esperava sai, sem perda
    amb.hub.exigirVersao = null;
    amb.hub.politicaVersao = { versao_minima: '1.0.0', versao_recomendada: VERSAO_CONECTOR };
    amb.relogio.avancar(61_000);
    await exec.ciclo();
    for (let i = 0; i < 3; i++) {
      amb.relogio.avancar(20_000);
      await processarFila(amb.ctx);
    }
    expect(amb.hub.linhasDe('cliente').map((x) => x.external_id)).toEqual(['c1']);
    expect(amb.ctx.store.estado('cliente')).toMatchObject({ bloqueio: null, confirmado: { external_id: 'c1' } });
  });

  it('RN-INT-11: 426 sem detalhes também é pausa (sem política inventada); o lote espera com backoff', async () => {
    amb = await criarAmbiente();
    emDelta(amb);
    amb.erp.definir('cliente', [bom('c1', 1)]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.exigirVersao = { minima: '9.0.0', informarMinima: false };
    expect((await processarFila(amb.ctx)).recusados).toBe(0);
    expect(lerPolitica(amb.ctx.store)).toBeNull();
    expect(amb.ctx.store.estado('cliente')?.bloqueio).toBeNull();
    expect(amb.ctx.store.contarLotes('cliente', ['pendente'])).toBe(1);
  });

  it('RN-INT-11: 426 ao pedir o cursor, nos pedidos e na reconciliação também é pausa (nada vira recusado nem bloqueado)', async () => {
    amb = await criarAmbiente({
      pedidos: { gravacao: { cabecalho: '/*cab*/ INSERT INTO p VALUES (:pedido_uuid)', numeroErp: '/*num*/ SELECT 1' }, status: { consulta: '/*st*/ SELECT 1', mapaStatus: { I: 'integrado' } } },
      entidades: { cliente: { consulta: '/*cliente*/ SELECT * FROM t WHERE a > :cursor_alterado_em AND b > :cursor_external_id LIMIT :limite', campos: CAMPOS_CLIENTE, reconciliacao: { consulta: '/*rec*/ SELECT 1 AS contagem' } } },
    });
    amb.hub.exigirVersao = { minima: '9.0.0', informarMinima: false };
    expect(await sincronizarEntidade(amb.ctx, 'cliente')).toMatchObject({ adiado: expect.stringContaining('426') });
    expect(amb.ctx.store.estado('cliente')).toBeNull(); // nem começou a carga: vai perguntar de novo depois
    amb.ctx.store.enfileirarRetorno('11111111-1111-4111-8111-111111111111', 'integrado|x', JSON.stringify({ versao_contrato: 'v1', pedido_uuid: '11111111-1111-4111-8111-111111111111', status: 'integrado', numero_erp: 'N1', ocorrido_em: '2026-03-10T12:00:00Z' }), amb.relogio.agora());
    const p = await cicloPedidos(amb.ctx);
    expect(p.retornosRecusados).toBe(0);
    expect(amb.ctx.store.retornosProntos(amb.relogio.agora() + 3_600_000)).toHaveLength(1);
    expect(await reconciliarTudo(amb.ctx)).toEqual({ enviadas: 0, falhas: 1 });
    expect(amb.ctx.store.meta('ultima_reconciliacao')).toBeNull();
  });

  it('lerRecusaVersao lê detalhes.versao_minima (ou minima) e nunca lança com corpo estranho', () => {
    expect(lerRecusaVersao({ codigo: 'versao_conector_nao_suportada', mensagem: 'Atualize.', detalhes: { versao_minima: '1.3.0' } })).toEqual({ versaoMinima: '1.3.0', mensagem: 'Atualize.' });
    expect(lerRecusaVersao({ detalhes: { minima: ' 2.0.0 ' } }).versaoMinima).toBe('2.0.0');
    expect(lerRecusaVersao(null)).toEqual({ versaoMinima: null, mensagem: null });
    expect(lerRecusaVersao('x')).toEqual({ versaoMinima: null, mensagem: null });
    expect(new ErroHubVersao('m', null, null)).toBeInstanceOf(Error);
  });
});
