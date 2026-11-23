/**
 * Interruptores da busca na API do ERP (ADR 0066, D7): TUDO NASCE DESLIGADO.
 *  1. global: `MACUXI_BUSCA_ERP` (só `1`/`true`/`sim` liga);
 *  2. do tenant: parâmetro `buscaErpLigada` do módulo `integracao` (só `true` liga);
 *  3. chave-mestra `MACUXI_CHAVE_SEGREDOS_v<n>` válida no ambiente (sem ela a busca fica inativa e a API e o worker sobem normais).
 * Nada aqui lança nem devolve a chave: o motivo é um código.
 */
import { carregarChavesSegredos, criarCofre, ErroCofre, type Cofre } from '@macuxi/platform-sdk/cofre-segredos';

export type Ambiente = Readonly<Record<string, string | undefined>>;

export const ENV_BUSCA_ERP = 'MACUXI_BUSCA_ERP';
export const PARAMETRO_BUSCA_TENANT = 'buscaErpLigada';

export type MotivoBuscaDesligada = 'global_desligado' | 'sem_chave_mestra' | 'chave_mestra_invalida' | 'tenant_desligado';

const ligado = (v: string | undefined) => ['1', 'true', 'sim'].includes((v ?? '').trim().toLowerCase());

/** Interruptor global do ambiente (padrão desligado). */
export const buscaErpGlobalLigada = (env: Ambiente): boolean => ligado(env[ENV_BUSCA_ERP]);

/** Interruptor do tenant (padrão desligado): só o booleano `true` do parâmetro liga. */
export const buscaErpDoTenantLigada = (parametros: Readonly<Record<string, unknown>>): boolean => parametros[PARAMETRO_BUSCA_TENANT] === true;

export type Cofrinho = { cofre: Cofre } | { cofre: null; motivo: 'sem_chave_mestra' | 'chave_mestra_invalida' };

/** Cofre do ambiente; sem chave ou com chave inválida devolve `null` com o motivo (nunca lança, nunca devolve o valor). */
export function abrirCofre(env: Ambiente): Cofrinho {
  try {
    return { cofre: criarCofre(carregarChavesSegredos(env)) };
  } catch (e) {
    if (e instanceof ErroCofre && e.codigo === 'COFRE_SEM_CHAVE') return { cofre: null, motivo: 'sem_chave_mestra' };
    return { cofre: null, motivo: 'chave_mestra_invalida' };
  }
}

export type SituacaoBusca = { ligada: true; cofre: Cofre } | { ligada: false; motivo: MotivoBuscaDesligada; cofre: Cofre | null };

/** A busca roda neste tenant? Precisa do global, da chave-mestra e do tenant ligados (nessa ordem de motivo). */
export function situacaoDaBusca(env: Ambiente, parametros: Readonly<Record<string, unknown>>): SituacaoBusca {
  if (!buscaErpGlobalLigada(env)) return { ligada: false, motivo: 'global_desligado', cofre: null };
  const c = abrirCofre(env);
  if (c.cofre === null) return { ligada: false, motivo: c.motivo, cofre: null };
  if (!buscaErpDoTenantLigada(parametros)) return { ligada: false, motivo: 'tenant_desligado', cofre: c.cofre };
  return { ligada: true, cofre: c.cofre };
}
