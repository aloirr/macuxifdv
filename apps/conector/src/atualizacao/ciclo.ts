/**
 * Ligação da atualização automática ao executor (T-0116). Uma passada: lê a política do Hub guardada, e se ela oferece um pacote
 * mais novo chama `atualizarConector`. Guarda o último resultado em `meta` (o `conector status` mostra) e registra no log só
 * códigos e versões. Nunca lança: o executor isola as tarefas, mas a atualização não pode derrubar a leitura do ERP.
 * Desligada por padrão (`atualizacao.ativa`); ligada sem as dependências (download da T-0098, extrator, serviço, saúde) só avisa.
 */
import type { Contexto } from '../contexto';
import { lerPolitica } from '../politica';
import { VERSAO_CONECTOR } from '../versao';
import { atualizarConector } from './atualizador';
import { ResultadoAtualizacao } from './resultado';

const CHAVE_ULTIMA = 'atualizacao_ultimo_resultado';

export type SituacaoCicloAtualizacao = 'desligada' | 'sem_dependencias' | 'sem_politica' | 'executada' | 'falhou';

export function ultimoResultadoAtualizacao(store: { meta(chave: string): string | null }): ResultadoAtualizacao | null {
  const bruto = store.meta(CHAVE_ULTIMA);
  if (!bruto) return null;
  try {
    const r = ResultadoAtualizacao.safeParse(JSON.parse(bruto));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function cicloAtualizacao(ctx: Contexto): Promise<SituacaoCicloAtualizacao> {
  const cfg = ctx.config.atualizacao;
  if (!cfg?.ativa || !cfg.pasta) return 'desligada';
  if (!ctx.atualizacao) {
    ctx.log.aviso('atualizacao_sem_dependencias', { dica: 'a atualização automática está ligada, mas o download do pacote não está disponível nesta instalação; nada será trocado' });
    return 'sem_dependencias';
  }
  const politica = lerPolitica(ctx.store)?.politica;
  if (!politica) return 'sem_politica';
  try {
    const r = await atualizarConector(
      { pasta: cfg.pasta, versaoAtual: ctx.versao ?? VERSAO_CONECTOR, pacote: politica.pacote, limiteSaudeMs: cfg.limiteSaudeSegundos * 1000 },
      { relogio: ctx.relogio, log: ctx.log, ...ctx.atualizacao },
    );
    // "já atualizado" e "sem pacote" são o normal de toda verificação: não sobrescrevem o último fato relevante nem poluem o log
    const rotina = r.resultado === 'mantido' && (r.motivo === 'sem_pacote' || r.motivo === 'ja_atualizado');
    if (!rotina) {
      ctx.store.definirMeta(CHAVE_ULTIMA, JSON.stringify(r));
      const nivel = r.resultado === 'atualizado' ? 'info' : 'aviso';
      ctx.log[nivel]('atualizacao_resultado', { resultado: r.resultado, ...('motivo' in r ? { motivo: r.motivo } : {}), mensagem: r.mensagem });
    }
    return 'executada';
  } catch (e) {
    ctx.log.aviso('atualizacao_falhou', { erro: e instanceof Error ? e.message.split('\n')[0]?.slice(0, 200) : 'erro desconhecido' });
    return 'falhou';
  }
}
