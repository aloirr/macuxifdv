/** Grava a massa de volume do Catálogo num Postgres local ou de teste, numa transação e idempotente (T-0192). Uso: db/seeds/volume/LEIA-ME.md. */
import type { ClientBase } from 'pg';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { TABELAS_VOLUME, type MassaCatalogoVolume } from './catalogo-volume';
import { gravarEmLote } from './massa';

export interface ResultadoCargaVolume {
  tenantCriado: boolean;
  /** Linhas novas por tabela (0 na segunda carga da mesma massa). */
  inseridas: Record<string, number>;
}

export async function carregarCatalogoVolume(admin: ClientBase, massa: MassaCatalogoVolume): Promise<ResultadoCargaVolume> {
  exigirBancoLocal(hostDoCliente(admin), 'massa de volume do Catálogo');
  await admin.query('begin');
  try {
    const existe = await admin.query('select 1 from plataforma.tenant where id = $1', [massa.tenant.id]);
    let tenantCriado = false;
    if (existe.rowCount === 0) {
      if (!massa.tenant.codigo) throw new Error(`tenant ${massa.tenant.id} não existe (com tenantId informado, crie o tenant antes)`);
      await admin.query("insert into plataforma.tenant (id, codigo, nome, fuso) values ($1, $2, $3, 'America/Manaus')", [massa.tenant.id, massa.tenant.codigo, massa.tenant.nome]);
      tenantCriado = true;
    }
    const inseridas: Record<string, number> = {};
    for (const [tabela, chave] of TABELAS_VOLUME) inseridas[tabela] = await gravarEmLote(admin, tabela, massa[chave]);
    await admin.query('commit');
    return { tenantCriado, inseridas };
  } catch (e) {
    await admin.query('rollback').catch(() => undefined);
    throw e;
  }
}
