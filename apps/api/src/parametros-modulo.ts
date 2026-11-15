/**
 * T-0180 (ADR 0059 §8): `ctx.gravarParametros` — o módulo grava os PRÓPRIOS parâmetros do tenant em `plataforma.parametro`
 * sem SQL em `plataforma.*` (regra 1). `modulo` = o da rota, tenant = o da transação (RLS, `plataforma.tenant_atual()`).
 * Idempotente (o upsert só muda a linha cujo `valor` mudou, comparado em `jsonb`) e auditado (RN-AUD-01, só o que mudou).
 */
import { ACAO_AUDITORIA_PARAMETROS, problemasGravarParametros, type ClienteBanco, type ModuloId, type OpcoesGravarParametros, type RegistroAuditoria } from '@macuxi/platform-sdk';

export interface ResultadoGravarParametros {
  /** Chaves cujo valor mudou (gravadas e auditadas), na ordem recebida. */
  alteradas: string[];
}

/** Lança (erro de programação) se `problemasGravarParametros` acusar algo; chamada antes de abrir transação. */
export function exigirParametrosValidos(modulo: ModuloId | null, valores: Readonly<Record<string, unknown>>): void {
  const problemas = problemasGravarParametros(modulo, valores);
  if (problemas.length > 0) throw new Error(`gravarParametros: ${problemas.join('; ')}`);
}

/**
 * Grava `valores` do `modulo` na transação `db` (já com o tenant). `auditar` = `tx.auditar` da mesma transação (módulo da rota).
 * Valores inválidos = erro de programação (lança antes de tocar no banco).
 */
export async function gravarParametrosDoModulo(
  db: ClienteBanco,
  modulo: ModuloId | null,
  valores: Readonly<Record<string, unknown>>,
  auditar: (r: RegistroAuditoria) => Promise<void>,
  opcoes: OpcoesGravarParametros = {},
): Promise<ResultadoGravarParametros> {
  exigirParametrosValidos(modulo, valores);
  const acao = opcoes.acao?.trim() || ACAO_AUDITORIA_PARAMETROS;
  const chaves = Object.keys(valores);
  const antes = await db.query<{ chave: string; valor: unknown }>(
    `select chave, valor from plataforma.parametro
      where tenant_id = plataforma.tenant_atual() and modulo = $1 and chave = any($2::text[]) and deleted_at is null`,
    [modulo, chaves],
  );
  const anterior = new Map(antes.rows.map((l) => [l.chave, l.valor] as const));
  const alteradas: string[] = [];
  for (const chave of chaves) {
    // o upsert devolve a linha só quando inseriu ou mudou o valor: a mesma conta decide o que entra na auditoria
    const r = await db.query<{ chave: string }>(
      `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), $1, $2, $3::jsonb)
       on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
         where plataforma.parametro.valor is distinct from excluded.valor
       returning chave`,
      [modulo, chave, JSON.stringify(valores[chave])],
    );
    if (r.rows.length > 0) alteradas.push(chave);
  }
  if (alteradas.length > 0)
    await auditar({
      acao,
      entidade: 'parametro',
      entidade_id: null,
      antes: Object.fromEntries(alteradas.map((c) => [c, anterior.has(c) ? anterior.get(c) : null])),
      depois: Object.fromEntries(alteradas.map((c) => [c, valores[c]])),
    });
  return { alteradas };
}
