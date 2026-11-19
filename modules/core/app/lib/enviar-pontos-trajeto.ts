/**
 * Envio dos pontos do rastreamento (T-0156; RN-CORE-13; desenho `tracking.md` §3.4). O shell grava os pontos em
 * `core__ponto_trajeto` com `enviado_em` nulo; esta rotina os põe na fila do motor (entidade `ponto_trajeto`, só inserção)
 * e marca `enviado_em`. Se o app cair entre o enfileirar e a marca, o ponto vai de novo e o servidor não duplica (id).
 * Nenhuma coordenada vai para log nem para mensagem de erro (§9).
 */
import type { DriverSqlite, NovoItemOutbox } from '@macuxi/platform-sdk';
import { ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema } from '../../contracts';

/** Pontos lidos do SQLite por vez; o SDK já corta o envio em lotes de MAX_ITENS_PUSH. */
const PONTOS_POR_LEITURA = 500;

export type BancoDoTrajeto = Pick<DriverSqlite, 'rodar' | 'todas'>;

export interface DependenciasEnvioDoTrajeto {
  /** SQLite do usuário (o mesmo em que o shell grava os pontos). */
  db: BancoDoTrajeto;
  /** `motor.enfileirar` do SDK. */
  enfileirar: (novo: NovoItemOutbox) => Promise<unknown>;
  agora: () => Date;
  /** Só contagens, nunca coordenada. */
  registrar?: (mensagem: string) => void;
}

export interface ResultadoEnvioDoTrajeto {
  enfileirados: number;
  invalidos: number;
  /** Houve falha (banco ou fila): o restante fica para o próximo sync. */
  erro: boolean;
}

interface LinhaPonto {
  id: string;
  capturado_em: string;
  latitude: number;
  longitude: number;
  precisao_m: number | null;
  velocidade_ms: number | null;
}

const LER_PENDENTES =
  'SELECT id, capturado_em, latitude, longitude, precisao_m, velocidade_ms FROM core__ponto_trajeto WHERE enviado_em IS NULL ORDER BY capturado_em LIMIT ?';

const semTabela = (e: unknown): boolean => /no such table/i.test(e instanceof Error ? e.message : String(e));

async function marcar(db: BancoDoTrajeto, ids: readonly string[], quando: string): Promise<void> {
  if (ids.length === 0) return;
  await db.rodar(`UPDATE core__ponto_trajeto SET enviado_em = ? WHERE id IN (${ids.map(() => '?').join(', ')})`, [quando, ...ids]);
}

/** Chame antes de cada envio da fila (ver docs/modulos/core/rastreamento.md, "Envio dos pontos"). Nunca lança. */
export async function enfileirarPontosDoTrajeto(d: DependenciasEnvioDoTrajeto): Promise<ResultadoEnvioDoTrajeto> {
  const r: ResultadoEnvioDoTrajeto = { enfileirados: 0, invalidos: 0, erro: false };
  try {
    for (;;) {
      const lote = await d.db.todas<LinhaPonto>(LER_PENDENTES, [PONTOS_POR_LEITURA]);
      if (lote.length === 0) return r;
      const tratados: string[] = [];
      let falhou = false;
      for (const l of lote) {
        const p = PontoTrajetoSchema.safeParse({
          id: l.id,
          capturado_em: l.capturado_em,
          latitude: l.latitude,
          longitude: l.longitude,
          precisao_m: l.precisao_m,
          velocidade_ms: l.velocidade_ms,
        });
        if (!p.success) {
          r.invalidos++;
          tratados.push(l.id);
          continue;
        }
        try {
          await d.enfileirar({ id: p.data.id, entidade: ENTIDADE_PONTO_TRAJETO, operacao: 'upsert', payload: p.data });
        } catch {
          falhou = true;
          break;
        }
        r.enfileirados++;
        tratados.push(l.id);
      }
      await marcar(d.db, tratados, d.agora().toISOString());
      if (falhou) {
        r.erro = true;
        d.registrar?.(`trajeto: falha ao enfileirar pontos (${r.enfileirados} enfileirados, ${r.invalidos} inválidos)`);
        return r;
      }
    }
  } catch (e) {
    if (semTabela(e)) return { enfileirados: 0, invalidos: 0, erro: false };
    r.erro = true;
    d.registrar?.(`trajeto: falha ao ler ou marcar pontos (${r.enfileirados} enfileirados, ${r.invalidos} inválidos)`);
    return r;
  }
}
