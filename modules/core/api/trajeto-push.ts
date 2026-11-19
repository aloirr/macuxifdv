/**
 * Push do rastreamento (T-0156; ADR 0061; desenho `tracking.md` §5.2 e §5.3). RN-CORE-13, RN-CORE-37 e RN-CORE-46.
 * - `aceite_termo_rastreamento`: "Li e estou ciente" na versão vigente; idempotente pelo id (e pelo único vivo do usuário na versão);
 *   a versão tem de existir no tenant. O motor chama a entidade do aceite antes da dos pontos.
 * - `ponto_trajeto`: cada ponto passa pelo portão (`triarPontoRecebido`) e o que está fora dele é descartado sem gravar e sem travar a
 *   fila (a resposta é `aceito`: o aparelho apaga o lote inteiro). Depois de gravar, recalcula o dia inteiro de cada (usuário, data
 *   no fuso do tenant) e faz upsert em `core.deslocamento_dia` (`origem = 'rastreamento'`).
 * - `pausa_trajeto`: só início e fim (sem motivo); o fim chega depois, no mesmo id.
 * O usuário vem sempre da sessão. Nenhuma coordenada vai para log, erro ou resposta (§9): só ids e contagens.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import type { ClienteBanco, ContextoBase, ItemPush, ResultadoItemPush } from '@macuxi/platform-sdk';
import { AceiteTermoRastreamentoSchema, PARAMETRO_RASTREAMENTO, PausaTrajetoSchema, PontoTrajetoSchema, TRAJETO_DIAS_MAX, type PontoTrajeto as PontoPush } from '../contracts';
import { PARAMETRO_FERIADOS } from '../contracts/inicio-parametros';
import { idDoPayloadConfere } from '../domain/idempotencia';
import { metrosDoTrajeto } from '../domain/performance/trajeto';
import { feriadosDasLinhas, parametrosRastreamentoDasLinhas, triarPontoRecebido, type BaseTriagem } from '../domain/trajeto-ponto';
import { lerParametrosCore } from './parametro-tenant';

const aceito = (id: string): ResultadoItemPush => ({ id, status: 'aceito' });
const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });
const SO_INSERCAO = 'Este registro não pode ser removido pelo aparelho.';

/** Valida o item (operação, id e payload) e devolve o payload ou a resposta de rejeição. */
function conferir<T>(item: ItemPush, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, mensagem: string): { ok: true; dado: T } | { ok: false; resposta: ResultadoItemPush } {
  if (item.operacao === 'remover') return { ok: false, resposta: rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', SO_INSERCAO) };
  if (!idDoPayloadConfere(item.id, item.payload as { id?: unknown })) return { ok: false, resposta: rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.') };
  const v = schema.safeParse(item.payload);
  if (!v.success) return { ok: false, resposta: rejeitado(item.id, 'PAYLOAD_INVALIDO', mensagem) };
  return { ok: true, dado: v.data };
}

// ---- Aceite do termo ----
export async function receberAceitesTermo(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    const c = conferir(item, AceiteTermoRastreamentoSchema, 'Os dados do aceite do termo estão incompletos. Atualize o app e tente de novo.');
    if (!c.ok) {
      saida.push(c.resposta);
      continue;
    }
    const a = c.dado;
    const agora = ctx.agora();
    // a hora do aparelho vale, sem passar do relógio do servidor (relógio adiantado não antecipa o aceite)
    const aceitoEm = new Date(Math.min(Date.parse(a.aceito_em), agora.getTime())).toISOString();
    saida.push(
      await ctx.comTenant(async (db) => {
        const existe = await db.query('select 1 from core.termo_rastreamento where versao = $1 and deleted_at is null', [a.termo_versao]);
        if (existe.rows.length === 0) return rejeitado(item.id, 'TERMO_INEXISTENTE', 'Essa versão do termo não existe mais. Abra o app para atualizar e aceite a versão atual.');
        await db.query(
          `insert into core.aceite_termo_rastreamento (id, tenant_id, usuario_id, termo_versao, aceito_em)
           values ($1, plataforma.tenant_atual(), $2, $3, $4::timestamptz) on conflict do nothing`,
          [a.id, ctx.usuario.id, a.termo_versao, aceitoEm],
        );
        return aceito(item.id);
      }),
    );
  }
  return saida;
}

// ---- Pausa ----
export async function receberPausasTrajeto(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    const c = conferir(item, PausaTrajetoSchema, 'Os dados da pausa estão incompletos. Atualize o app e tente de novo.');
    if (!c.ok) {
      saida.push(c.resposta);
      continue;
    }
    const p = c.dado;
    const limite = ctx.agora().getTime() - TRAJETO_DIAS_MAX * 86_400_000;
    // pausa sem duração ou fora da retenção não vale registro (o CHECK do banco exige fim > início); não trava a fila
    if (Date.parse(p.inicio) < limite || (p.fim !== null && Date.parse(p.fim) <= Date.parse(p.inicio))) {
      saida.push(aceito(item.id));
      continue;
    }
    await ctx.comTenant((db) =>
      db.query(
        `insert into core.pausa_trajeto (id, tenant_id, usuario_id, inicio, fim) values ($1, plataforma.tenant_atual(), $2, $3::timestamptz, $4::timestamptz)
         on conflict (id) do update set fim = excluded.fim
           where core.pausa_trajeto.usuario_id = excluded.usuario_id and core.pausa_trajeto.fim is null and excluded.fim is not null`,
        [p.id, ctx.usuario.id, p.inicio, p.fim],
      ),
    );
    saida.push(aceito(item.id));
  }
  return saida;
}

// ---- Pontos ----
/** O cadastro de que o portão precisa para o usuário da sessão (uma leitura por lote). */
async function baseDoPortao(db: ClienteBanco, usuarioId: string, perfil: string, fuso: string): Promise<BaseTriagem> {
  const linhas = await lerParametrosCore(db, [PARAMETRO_RASTREAMENTO, PARAMETRO_FERIADOS]);
  const param = parametrosRastreamentoDasLinhas(linhas);
  const termo = (await db.query<{ versao: number | null }>('select max(versao)::int as versao from core.termo_rastreamento where deleted_at is null')).rows[0]?.versao ?? null;
  const aceite =
    termo === null
      ? null
      : ((
          await db.query<{ versao: number; aceito_em: string }>(
            `select termo_versao as versao, to_char(aceito_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as aceito_em
               from core.aceite_termo_rastreamento where usuario_id = $1 and termo_versao = $2 and deleted_at is null`,
            [usuarioId, termo],
          )
        ).rows[0] ?? null);
  const ausencias = (
    await db.query<{ de: string; ate: string }>(
      `select to_char(de, 'YYYY-MM-DD') as de, to_char(ate, 'YYYY-MM-DD') as ate from core.ausencia_usuario where usuario_id = $1 and deleted_at is null`,
      [usuarioId],
    )
  ).rows;
  return { ativo: param.ativo, termoVigente: termo, cargo: perfil, aceite, expediente: param.expediente, feriados: feriadosDasLinhas(linhas), ausencias, fuso };
}

/** Recalcula o dia inteiro do usuário (data no fuso do tenant) e grava o resumo; idempotente (§5.3). */
export async function recalcularDeslocamentoDia(db: ClienteBanco, usuarioId: string, data: string, fuso: string): Promise<{ metros: number; pontos: number }> {
  const linhas = (
    await db.query<{ capturado_em: string; latitude: string; longitude: string; precisao_m: number | null }>(
      `select to_char(capturado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as capturado_em, latitude::text as latitude, longitude::text as longitude, precisao_m
         from core.ponto_trajeto
        where usuario_id = $1 and deleted_at is null
          and capturado_em >= ($2::date)::timestamp at time zone $3 and capturado_em < (($2::date) + 1)::timestamp at time zone $3
        order by capturado_em`,
      [usuarioId, data, fuso],
    )
  ).rows;
  const pontos = linhas.map((l) => ({ capturado_em: l.capturado_em, latitude: Number(l.latitude), longitude: Number(l.longitude), precisao_m: l.precisao_m }));
  const r = metrosDoTrajeto(pontos);
  const primeiro = pontos[0]?.capturado_em ?? null;
  const ultimo = pontos[pontos.length - 1]?.capturado_em ?? null;
  await db.query(
    `insert into core.deslocamento_dia (tenant_id, usuario_id, data, metros, pontos, primeiro_ponto_em, ultimo_ponto_em, origem)
     values (plataforma.tenant_atual(), $1, $2::date, $3, $4, $5::timestamptz, $6::timestamptz, 'rastreamento')
     on conflict (tenant_id, usuario_id, data) where deleted_at is null do update
       set metros = excluded.metros, pontos = excluded.pontos, primeiro_ponto_em = excluded.primeiro_ponto_em, ultimo_ponto_em = excluded.ultimo_ponto_em
     where (core.deslocamento_dia.metros, core.deslocamento_dia.pontos, core.deslocamento_dia.primeiro_ponto_em, core.deslocamento_dia.ultimo_ponto_em)
           is distinct from (excluded.metros, excluded.pontos, excluded.primeiro_ponto_em, excluded.ultimo_ponto_em)`,
    [usuarioId, data, r.metros, r.pontos, primeiro, ultimo],
  );
  return r;
}

export async function receberPontosTrajeto(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saida = new Map<string, ResultadoItemPush>();
  const validos: PontoPush[] = [];
  for (const item of itens) {
    const c = conferir(item, PontoTrajetoSchema, 'Os dados do ponto estão incompletos. Atualize o app e tente de novo.');
    if (c.ok) validos.push(c.dado);
    else saida.set(item.id, c.resposta);
  }
  if (validos.length > 0) {
    const fuso = ctx.fuso();
    const agora = ctx.agora().toISOString();
    const descartes = await ctx.comTenant(async (db) => {
      const base = await baseDoPortao(db, ctx.usuario.id, ctx.usuario.perfil, fuso);
      const passam = validos.filter((p) => triarPontoRecebido(p, agora, base) === null);
      if (passam.length > 0) {
        await db.query(
          `insert into core.ponto_trajeto (id, tenant_id, usuario_id, capturado_em, latitude, longitude, precisao_m, velocidade_ms)
           select p.id, plataforma.tenant_atual(), $1, p.capturado_em, p.latitude, p.longitude, p.precisao_m, p.velocidade_ms
             from unnest($2::uuid[], $3::timestamptz[], $4::numeric[], $5::numeric[], $6::int[], $7::numeric[]) as p(id, capturado_em, latitude, longitude, precisao_m, velocidade_ms)
           on conflict (id) do nothing`,
          [
            ctx.usuario.id,
            passam.map((p) => p.id),
            passam.map((p) => p.capturado_em),
            passam.map((p) => p.latitude),
            passam.map((p) => p.longitude),
            passam.map((p) => Math.round(p.precisao_m)),
            passam.map((p) => p.velocidade_ms),
          ],
        );
        const dias = [...new Set(passam.map((p) => localIsoDate(p.capturado_em, fuso)))].sort();
        for (const dia of dias) await recalcularDeslocamentoDia(db, ctx.usuario.id, dia, fuso);
      }
      return validos.length - passam.length;
    });
    // só contagem (nunca coordenada, §9)
    if (descartes > 0) ctx.log.info({ descartados: descartes, recebidos: validos.length }, 'rastreamento: pontos fora do portão descartados');
    for (const p of validos) saida.set(p.id, aceito(p.id));
  }
  return itens.map((i) => saida.get(i.id) ?? rejeitado(i.id, 'PAYLOAD_INVALIDO', 'Os dados do ponto estão incompletos. Atualize o app e tente de novo.'));
}
