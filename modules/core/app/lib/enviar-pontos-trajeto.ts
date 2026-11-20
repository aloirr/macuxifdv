/**
 * Envio dos pontos do rastreamento (T-0156; RN-CORE-13; desenho `tracking.md` §3.4). O shell grava os pontos em
 * `core__ponto_trajeto` com `enviado_em` nulo; esta rotina os envia direto pelo transporte do sync (`push`), sem passar
 * pela fila do motor (o rastreamento é interno: não aparece na fila nem na contagem do vendedor) e marca `enviado_em`.
 * Se o app cair entre o envio e a marca, o ponto vai de novo e o servidor não duplica (id).
 * Antes de cada passada apaga todo ponto capturado há mais de `TRAJETO_DIAS_MAX` dias, enviado ou não, pois o servidor
 * o recusaria como antigo (`docs/banco/aparelho-sqlite.md` §11).
 * Nenhuma coordenada vai para log nem para mensagem de erro (§9).
 */
import { CODIGOS_RETENTAVEIS, MAX_ITENS_PUSH, type DriverSqlite, type ItemPush, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema, TRAJETO_DIAS_MAX } from '../../contracts';

export type BancoDoTrajeto = Pick<DriverSqlite, 'rodar' | 'todas'>;

const MS_POR_DIA = 86_400_000;

/**
 * Códigos de rejeição que não são defeito do ponto (`CODIGOS_RETENTAVEIS` do SDK): o ponto fica pendente.
 * Só a recusa do próprio ponto (PAYLOAD_INVALIDO, OPERACAO_NAO_SUPORTADA) é marcada e contada.
 */
const ehRetentavel = (codigo: string): boolean => CODIGOS_RETENTAVEIS.includes(codigo);

export interface DependenciasEnvioDoTrajeto {
  /** SQLite do usuário (o mesmo em que o shell grava os pontos). */
  db: BancoDoTrajeto;
  /** `TransporteSync.push` do shell. */
  push: (itens: ItemPush[]) => Promise<ResultadoItemPush[]>;
  agora: () => Date;
  /** Só contagens, nunca coordenada. */
  registrar?: (mensagem: string) => void;
}

export interface ResultadoEnvioDoTrajeto {
  /** Aceitos pelo servidor, ou que o servidor já tinha (conflito pelo mesmo id). */
  enviados: number;
  /** Recusados pelo servidor: marcados como enviados para não repetir. */
  rejeitados: number;
  /** Não passaram no schema: marcados sem envio. */
  invalidos: number;
  /** Apagados do aparelho por terem sido capturados há mais de `TRAJETO_DIAS_MAX` dias, enviados ou não. */
  podados: number;
  /** Houve falha (transporte ou banco): o restante fica para o próximo sync. */
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
const PODAR = 'DELETE FROM core__ponto_trajeto WHERE capturado_em < ?';

const semTabela = (e: unknown): boolean => /no such table/i.test(e instanceof Error ? e.message : String(e));

async function marcar(db: BancoDoTrajeto, ids: readonly string[], quando: string): Promise<void> {
  if (ids.length === 0) return;
  await db.rodar(`UPDATE core__ponto_trajeto SET enviado_em = ? WHERE id IN (${ids.map(() => '?').join(', ')})`, [quando, ...ids]);
}

/** Chame depois de cada envio do motor (ver docs/modulos/core/rastreamento.md, "Envio dos pontos"). Nunca lança. */
export async function enviarPontosDoTrajeto(d: DependenciasEnvioDoTrajeto): Promise<ResultadoEnvioDoTrajeto> {
  const r: ResultadoEnvioDoTrajeto = { enviados: 0, rejeitados: 0, invalidos: 0, podados: 0, erro: false };
  const resumo = () =>
    `${r.enviados} enviados, ${r.rejeitados} rejeitados, ${r.invalidos} inválidos, ${r.podados} podados`;
  // Poda antes do envio: o ponto velho (enviado ou não) nem chega ao servidor, que o recusaria como antigo.
  try {
    const limite = new Date(d.agora().getTime() - TRAJETO_DIAS_MAX * MS_POR_DIA).toISOString();
    const { alteradas } = await d.db.rodar(PODAR, [limite]);
    r.podados = alteradas;
  } catch (e) {
    if (semTabela(e)) return r;
    r.erro = true;
    d.registrar?.(`trajeto: falha ao apagar pontos antigos (${resumo()})`);
  }
  try {
    for (;;) {
      const lote = await d.db.todas<LinhaPonto>(LER_PENDENTES, [MAX_ITENS_PUSH]);
      if (lote.length === 0) break;
      const quando = d.agora().toISOString();
      const itens: ItemPush[] = [];
      const invalidos: string[] = [];
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
          invalidos.push(l.id);
          continue;
        }
        itens.push({ entidade: ENTIDADE_PONTO_TRAJETO, id: p.data.id, operacao: 'upsert', payload: p.data });
      }
      if (invalidos.length > 0) {
        await marcar(d.db, invalidos, quando);
        r.invalidos += invalidos.length;
      }
      if (itens.length === 0) continue;
      let resposta: ResultadoItemPush[];
      try {
        resposta = await d.push(itens);
      } catch {
        r.erro = true;
        d.registrar?.(`trajeto: envio falhou, restante fica pendente (${resumo()})`);
        break;
      }
      const tratados: string[] = [];
      for (const x of resposta) {
        if (!itens.some((i) => i.id === x.id)) continue;
        // Recusa que vem da plataforma, não do ponto: fica pendente, sem marcar, para o próximo sync.
        if (x.status === 'rejeitado' && ehRetentavel(x.codigo)) continue;
        tratados.push(x.id);
        if (x.status === 'rejeitado') r.rejeitados++;
        else r.enviados++; // 'aceito' ou 'conflito' (o servidor já tinha o ponto)
      }
      await marcar(d.db, tratados, quando);
      if (tratados.length === 0) {
        // nenhum item resolvido (sem resposta ou tudo retentável): parar evita laço
        r.erro = true;
        d.registrar?.(`trajeto: servidor não resolveu nenhum ponto, restante fica pendente (${resumo()})`);
        break;
      }
    }
  } catch (e) {
    if (semTabela(e)) return { enviados: 0, rejeitados: 0, invalidos: 0, podados: 0, erro: false };
    r.erro = true;
    d.registrar?.(`trajeto: falha ao ler ou marcar pontos (${resumo()})`);
  }
  return r;
}
