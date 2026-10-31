/**
 * Rotas de sincronização da plataforma (doc 04 "Sincronização offline"; desenho T-0004 §5):
 *   GET  /v1/sync/pull?entidade=<nome>&cursor=<updated_at|id>  → { itens, proximo_cursor }
 *   POST /v1/sync/push { itens }                                → { resultados } (um por item, na ordem)
 *
 * Pull — horizonte seguro: o módulo só devolve linhas com `updated_at < horizonte`, onde
 * `horizonte = least(now() - margem, início da transação aberta mais antiga)` (`BancoApp.horizonteSync`).
 * `updated_at` recebe o `now()` do INÍCIO da transação; sem o horizonte, uma transação longa que confirma depois
 * de um pull gravaria linhas atrás do cursor e o aparelho nunca as veria (desenho T-0002 §6 item 3).
 *
 * Push — RN-CORE-02: item de módulo inativo volta `rejeitado/MODULO_INATIVO` (o motor do app mostra "não enviado —
 * módulo desativado"); RN-PRO-01: item de pedido enviado por promotor volta `rejeitado/RN-PRO-01`.
 */
import {
  codificarCursor,
  compararCursor,
  criarRegistroSync,
  decodificarCursor,
  ErroRegraNegocio,
  PushRequestSchema,
  rejeitarItensInvalidos,
  TAMANHO_PAGINA_SYNC,
  type ItemPush,
  type LinhaSync,
  type PaginaSync,
  type ProvedorSync,
  type ResultadoItemPush,
} from '@macuxi/platform-sdk';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import type { Plataforma } from './tipos';

const PullQuerySchema = z.object({ entidade: z.string().min(1), cursor: z.string().optional() });

/** Entidade de pedido (`pedido`, `pedido_item`…): o promotor nunca envia (RN-PRO-01). */
const ehEntidadeDePedido = (nome: string) => /^pedido(_[a-z0-9_]+)?$/.test(nome);

export function registrarSync(app: FastifyInstance, p: Plataforma): void {
  const provedores = new Map<string, ProvedorSync>();
  const registro = criarRegistroSync(p.manifestos);
  for (const m of p.modulos) {
    for (const prov of m.sync ?? []) {
      registro.registrar(prov.entidade);
      provedores.set(prov.entidade.nome, prov);
    }
  }

  app.get('/v1/sync/pull', async (req): Promise<PaginaSync<LinhaSync>> => {
    const q = PullQuerySchema.safeParse(req.query);
    if (!q.success) throw new ErroHttp(400, 'VALIDACAO', 'Informe a entidade do pull.');
    const prov = provedores.get(q.data.entidade);
    const dono = prov?.entidade.modulo ?? p.manifestos.find((m) => m.sync.includes(q.data.entidade))?.id ?? null;
    const { ctx } = await p.preparar(req, dono);
    if (!dono) throw new ErroHttp(404, 'ENTIDADE_DESCONHECIDA', `Entidade ${q.data.entidade} não é sincronizada.`);
    if (!ctx.usuario.modulos.includes(dono)) {
      throw new ErroHttp(403, 'MODULO_INATIVO', `O módulo ${dono} não está ativo para você. Fale com o administrador da sua empresa.`, { modulo: dono });
    }
    if (!prov?.puxar) throw new ErroHttp(501, 'SYNC_NAO_IMPLEMENTADO', `O pull de ${q.data.entidade} ainda não está disponível.`);
    const desde = q.data.cursor ? decodificarCursor(q.data.cursor) : null;
    if (q.data.cursor && !desde) throw new ErroHttp(400, 'CURSOR_INVALIDO', 'Cursor de sincronização inválido.');
    if (!p.banco) throw new ErroHttp(503, 'BANCO_INDISPONIVEL', 'Banco de dados indisponível. Tente de novo em instantes.');
    const horizonte = await p.banco.horizonteSync();
    const ate = horizonte.toISOString();
    const linhas = await prov.puxar(ctx, { desde, ate, limite: TAMANHO_PAGINA_SYNC + 1 });
    // defesa: mesmo que o módulo erre o SQL, nada acima do horizonte nem atrás do cursor sai daqui
    const limite = Date.parse(ate);
    const validas = linhas
      .filter((l) => Date.parse(l.updated_at) < limite && (!desde || compararCursor(l, desde) > 0))
      .sort(compararCursor);
    const itens = validas.slice(0, TAMANHO_PAGINA_SYNC);
    const ultimo = itens[itens.length - 1];
    return { itens, proximo_cursor: validas.length > TAMANHO_PAGINA_SYNC && ultimo ? codificarCursor(ultimo) : null };
  });

  app.post('/v1/sync/push', async (req): Promise<{ resultados: ResultadoItemPush[] }> => {
    const corpo = PushRequestSchema.safeParse(req.body);
    if (!corpo.success) throw new ErroHttp(400, 'VALIDACAO', `Lote inválido (máx. 500 itens, id UUID do aparelho).`);
    const { ctx, doModulo } = await p.preparar(req, null);
    const { validos, rejeitados } = rejeitarItensInvalidos(corpo.data, registro, ctx.usuario.modulos);
    const porId = new Map<string, ResultadoItemPush>(rejeitados.map((r) => [r.id, r]));
    const grupos = new Map<ProvedorSync, ItemPush[]>();
    for (const item of validos) {
      if (ctx.usuario.perfil === 'promotor' && ehEntidadeDePedido(item.entidade)) {
        porId.set(item.id, { id: item.id, status: 'rejeitado', codigo: 'RN-PRO-01', mensagem: 'Promotor não cria nem altera pedido.' });
        continue;
      }
      const prov = provedores.get(item.entidade)!;
      if (!prov.receber) {
        porId.set(item.id, { id: item.id, status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: `Entidade ${item.entidade} não aceita push` });
        continue;
      }
      grupos.set(prov, [...(grupos.get(prov) ?? []), item]);
    }
    for (const [prov, itens] of grupos) {
      try {
        for (const r of await prov.receber!(doModulo(prov.entidade.modulo), itens)) porId.set(r.id, r);
      } catch (e) {
        if (!(e instanceof ErroRegraNegocio)) throw e; // 5xx: o motor tenta o lote de novo, na mesma ordem
        for (const i of itens) porId.set(i.id, { id: i.id, status: 'rejeitado', codigo: e.codigo, mensagem: e.message });
      }
    }
    const resultados = corpo.data.itens.map(
      (i) => porId.get(i.id) ?? { id: i.id, status: 'rejeitado' as const, codigo: 'SEM_RESULTADO', mensagem: 'O módulo não respondeu por este item.' },
    );
    return { resultados };
  });
}
