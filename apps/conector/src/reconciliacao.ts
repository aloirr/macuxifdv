/** Reconciliação diária (RF-INT-06, RN-INT-07): contagem de ativos e soma de controle por entidade, vistas do ERP. */
import { CAMPO_SOMA_CONTROLE, VERSAO_CONTRATO, type ReconciliacaoEnvio } from '@macuxi/integracao/contracts';
import { ORDEM_CARGA, type Entidade } from './config/entidades';
import { type Contexto, resumoErro } from './contexto';

export function dataLocal(ms: number): string {
  const d = new Date(ms);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Já passou da hora configurada hoje e ainda não foi feita hoje? */
export function reconciliacaoVencida(ctx: Contexto): boolean {
  const agora = ctx.relogio.agora();
  const d = new Date(agora);
  const [h, m] = ctx.config.reconciliacaoHora.split(':').map(Number) as [number, number];
  const minutos = d.getHours() * 60 + d.getMinutes();
  return minutos >= h * 60 + m && ctx.store.meta('ultima_reconciliacao') !== dataLocal(agora);
}

export async function reconciliarEntidade(ctx: Contexto, entidade: Entidade, dataReferencia: string): Promise<ReconciliacaoEnvio | null> {
  const cfg = ctx.config.entidades[entidade]?.reconciliacao;
  if (!cfg) return null;
  const linhas = await ctx.erp.consultar(cfg.consulta, {});
  const l = linhas[0] ?? {};
  const pega = (nome: string) => {
    const k = Object.keys(l).find((x) => x.toLowerCase() === nome);
    return k ? l[k] : undefined;
  };
  const contagem = Number(pega('contagem') ?? 0);
  const brutaSoma = pega('soma');
  const usaSoma = CAMPO_SOMA_CONTROLE[entidade] !== null;
  const soma = usaSoma && brutaSoma !== null && brutaSoma !== undefined && Number.isFinite(Number(brutaSoma)) ? Number(brutaSoma) : null;
  const envio: ReconciliacaoEnvio = { versao_contrato: VERSAO_CONTRATO, entidade, data_referencia: dataReferencia, contagem: Math.max(0, Math.trunc(contagem)), soma };
  await ctx.hub.enviarReconciliacao(envio);
  return envio;
}

/** Envia a reconciliação de todas as entidades configuradas; só marca o dia como feito se todas forem. */
export async function reconciliarTudo(ctx: Contexto): Promise<{ enviadas: number; falhas: number }> {
  const dia = dataLocal(ctx.relogio.agora());
  let enviadas = 0;
  let falhas = 0;
  for (const e of ORDEM_CARGA) {
    if (!ctx.config.entidades[e]?.reconciliacao) continue;
    try {
      if (await reconciliarEntidade(ctx, e, dia)) enviadas++;
    } catch (err) {
      falhas++;
      ctx.log.aviso('reconciliacao_falhou', { entidade: e, erro: resumoErro(err) });
    }
  }
  if (falhas === 0) ctx.store.definirMeta('ultima_reconciliacao', dia);
  return { enviadas, falhas };
}
