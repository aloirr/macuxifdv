export class ReferenciaAusenteErp extends Error {
    entidade;
    constructor(entidade, quantidade = 1) {
        super(`referencia_ausente: ${String(quantidade)} registro(s) de ${entidade} ainda não chegaram do ERP; a entrega será repetida (RN-INT-04)`);
        this.entidade = entidade;
        this.name = 'ReferenciaAusenteErp';
    }
}
/**
 * FK de medida (`*_medida_fk`, 0018): sigla não cadastrada em `core.medida` (a consulta `core.medidas@1` estava fora do ar
 * quando o Hub aplicou o lote, RN-INT-14). Vira `ReferenciaAusenteErp('medida')`: a transação desfaz e a outbox repete.
 */
export async function comMedidaAusente(gravar) {
    try {
        return await gravar();
    }
    catch (e) {
        const err = e;
        if (err.code === '23503' && typeof err.constraint === 'string' && err.constraint.endsWith('medida_fk'))
            throw new ReferenciaAusenteErp('medida');
        throw e;
    }
}
export async function usuarioPorExternalId(db, externalId) {
    const r = await db.query('select id from core.usuario where external_id = $1 and deleted_at is null', [externalId]);
    return r.rows[0]?.id ?? null;
}
export async function clientePorExternalId(db, externalId) {
    const r = await db.query('select id from core.cliente where external_id = $1 and deleted_at is null', [externalId]);
    return r.rows[0]?.id ?? null;
}
/** Saldo em aberto do financeiro = soma dos saldos dos títulos abertos vivos (Cliente 360). Só atualiza se o financeiro existe. */
export async function recalcularSaldoFinanceiro(db, clienteId) {
    await db.query(`update core.cliente_financeiro set saldo_aberto_cents =
       (select coalesce(sum(saldo_cents), 0) from core.titulo where cliente_id = $1 and situacao = 'aberto' and deleted_at is null)
     where cliente_id = $1 and deleted_at is null`, [clienteId]);
}
