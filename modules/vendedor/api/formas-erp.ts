/**
 * Forma de pagamento e prazo que chegam do ERP pelo Hub (T-0089, RN-VEN-24; consumidores de `integracao.forma_pagamento.atualizado@1`
 * e `integracao.prazo_pagamento.atualizado@1`). A adoção segue o P7 do desenho: o tenant já nasce com a forma e o prazo `AVISTA`
 * (external_id nulo). Chegando a forma `AVISTA` do ERP, ela ADOTA a linha viva pelo código (grava o external_id e atualiza) em vez de
 * inserir outra (o código é único vivo no tenant: inserir daria 23505 e o evento voltaria em laço). A `AVISTA` apagada não é
 * reaproveitada: insere linha nova. O prazo médio é CALCULADO aqui (`prazoMedioDias`); o informado pelo ERP é só conferência.
 *
 * Funções sobre o banco (`ClienteBanco`), testadas com banco de mentira; os consumidores de `integracao.forma_pagamento.atualizado@1`
 * e `integracao.prazo_pagamento.atualizado@1` (leitura tolerante) ficam no fim e são registrados em `apiVendedor`.
 */
import { definirConsumidor, eventoTolerante, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_ERP_FORMA_PAGAMENTO_ATUALIZADO, EVENTO_ERP_PRAZO_PAGAMENTO_ATUALIZADO, FormaPagamentoPayload, PrazoPagamentoPayload } from '../../integracao/contracts';
import { descricaoPrazo, prazoMedioDias } from '../domain/pagamento';

export interface FormaDoErp {
  external_id: string;
  codigo: string;
  nome: string;
  ordem?: number | null;
  ativo?: boolean | null;
}

export interface PrazoDoErp {
  external_id: string;
  forma_external_id: string;
  codigo: string;
  descricao?: string | null;
  parcelas_dias: number[];
  /** informativo: o Macuxi calcula; divergente = aviso no monitor do Hub, nunca erro */
  prazo_medio_dias?: number | null;
  ordem?: number | null;
  ativo?: boolean | null;
  /** RN-VEN-46: Desc./Acrésc. (%) do prazo vindo do ERP (2 casas, negativo = desconto); ausente = 0 */
  percentual_ajuste?: number | null;
}

export type AcaoDaLinha = 'inserida' | 'atualizada' | 'adotada';

/** `referencia_ausente` (RN-INT-04): a forma do prazo ainda não chegou; o evento é reprocessado depois. */
export class ReferenciaAusente extends Error {
  readonly codigo = 'referencia_ausente';
  constructor(mensagem: string) {
    super(mensagem);
  }
}

async function achar(db: ClienteBanco, tabela: 'forma_pagamento' | 'prazo_pagamento', externalId: string, codigo: string): Promise<{ id: string; adotar: boolean } | null> {
  const porExterno = (await db.query<{ id: string }>(`select id from vendedor.${tabela} where external_id = $1 and deleted_at is null`, [externalId])).rows[0];
  if (porExterno) return { id: porExterno.id, adotar: false };
  // sem external_id igual: a linha viva com o mesmo código e external_id nulo (a AVISTA semeada) é adotada; a apagada não volta
  const porCodigo = (await db.query<{ id: string }>(`select id from vendedor.${tabela} where codigo = $1 and external_id is null and deleted_at is null`, [codigo])).rows[0];
  return porCodigo ? { id: porCodigo.id, adotar: true } : null;
}

export async function aplicarFormaDoErp(db: ClienteBanco, f: FormaDoErp): Promise<{ id: string; acao: AcaoDaLinha }> {
  const codigo = f.codigo.trim().toUpperCase();
  const achada = await achar(db, 'forma_pagamento', f.external_id, codigo);
  const ativo = f.ativo ?? true;
  if (achada) {
    await db.query('update vendedor.forma_pagamento set external_id = $2, codigo = $3, nome = $4, ativo = $5, ordem = coalesce($6, ordem) where id = $1', [achada.id, f.external_id, codigo, f.nome.trim(), ativo, f.ordem ?? null]);
    return { id: achada.id, acao: achada.adotar ? 'adotada' : 'atualizada' };
  }
  const r = await db.query<{ id: string }>(
    'insert into vendedor.forma_pagamento (tenant_id, external_id, codigo, nome, ativo, ordem) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5) returning id',
    [f.external_id, codigo, f.nome.trim(), ativo, f.ordem ?? 0],
  );
  return { id: r.rows[0]!.id, acao: 'inserida' };
}

export async function aplicarPrazoDoErp(db: ClienteBanco, p: PrazoDoErp): Promise<{ id: string; acao: AcaoDaLinha; prazo_medio_dias: number }> {
  const forma = (await db.query<{ id: string }>('select id from vendedor.forma_pagamento where external_id = $1 and deleted_at is null', [p.forma_external_id])).rows[0];
  if (!forma) throw new ReferenciaAusente(`Forma de pagamento ${p.forma_external_id} ainda não chegou; o prazo ${p.codigo} será reprocessado.`);
  const codigo = p.codigo.trim().toUpperCase();
  const medio = prazoMedioDias(p.parcelas_dias);
  const descricao = p.descricao?.trim() || descricaoPrazo(p.parcelas_dias);
  const ativo = p.ativo ?? true;
  const percentual = p.percentual_ajuste ?? 0;
  const achada = await achar(db, 'prazo_pagamento', p.external_id, codigo);
  if (achada) {
    await db.query(
      `update vendedor.prazo_pagamento set external_id = $2, forma_pagamento_id = $3, codigo = $4, descricao = $5, parcelas_dias = $6::int[],
          prazo_medio_dias = $7, ativo = $8, ordem = coalesce($9, ordem), percentual_ajuste = $10 where id = $1`,
      [achada.id, p.external_id, forma.id, codigo, descricao, p.parcelas_dias, medio, ativo, p.ordem ?? null, percentual],
    );
    return { id: achada.id, acao: achada.adotar ? 'adotada' : 'atualizada', prazo_medio_dias: medio };
  }
  const r = await db.query<{ id: string }>(
    `insert into vendedor.prazo_pagamento (tenant_id, external_id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem, percentual_ajuste)
     values (plataforma.tenant_atual(), $1, $2, $3, $4, $5::int[], $6, $7, $8, $9) returning id`,
    [p.external_id, forma.id, codigo, descricao, p.parcelas_dias, medio, ativo, p.ordem ?? 0, percentual],
  );
  return { id: r.rows[0]!.id, acao: 'inserida', prazo_medio_dias: medio };
}

export const EventoIntegracaoFormaPagamentoAtualizado = eventoTolerante(EVENTO_ERP_FORMA_PAGAMENTO_ATUALIZADO);
export const EventoIntegracaoPrazoPagamentoAtualizado = eventoTolerante(EVENTO_ERP_PRAZO_PAGAMENTO_ATUALIZADO);

/** `inativado` pelo ERP = `ativo = false` (o pedido antigo guarda o retrato); ausente ou inválido no registro = ignora. */
async function inativarPorExternalId(db: ClienteBanco, tabela: 'forma_pagamento' | 'prazo_pagamento', externalId: string): Promise<void> {
  await db.query(`update vendedor.${tabela} set ativo = false where external_id = $1 and deleted_at is null`, [externalId]);
}

export function criarConsumidorFormaPagamentoDoErp(): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoFormaPagamentoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      if (p.acao === 'inativado') return inativarPorExternalId(ctx.db, 'forma_pagamento', p.external_id);
      const r = p.registro === undefined ? undefined : FormaPagamentoPayload.safeParse(p.registro);
      if (!r?.success) return;
      await aplicarFormaDoErp(ctx.db, { external_id: p.external_id, codigo: r.data.codigo, nome: r.data.nome, ordem: r.data.ordem, ativo: r.data.ativo });
    },
  });
}

export function criarConsumidorPrazoPagamentoDoErp(): ConsumidorEvento {
  return definirConsumidor({
    evento: EventoIntegracaoPrazoPagamentoAtualizado,
    async executar(p, ctx: ContextoConsumo) {
      if (p.acao === 'inativado') return inativarPorExternalId(ctx.db, 'prazo_pagamento', p.external_id);
      const r = p.registro === undefined ? undefined : PrazoPagamentoPayload.safeParse(p.registro);
      if (!r?.success) return;
      // forma ausente lança ReferenciaAusente: a transação do consumo desfaz e a outbox repete com espera crescente (RN-INT-04)
      await aplicarPrazoDoErp(ctx.db, {
        external_id: p.external_id,
        forma_external_id: r.data.forma_external_id,
        codigo: r.data.codigo,
        descricao: r.data.descricao,
        parcelas_dias: r.data.parcelas_dias,
        prazo_medio_dias: r.data.prazo_medio_dias,
        ordem: r.data.ordem,
        ativo: r.data.ativo,
        percentual_ajuste: r.data.percentual_ajuste ?? 0,
      });
    },
  });
}
