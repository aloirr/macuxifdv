/**
 * API do Promotor (`/v1/promotor` e push do sync; T-0056). Rotas declarativas: o `createApp` aplica login, licença,
 * perfil, Zod e carteira; o recebimento revalida as RN-PRO no servidor e publica `promotor.*@1` na mesma transação.
 *
 * Armazenamento atrás de `RepositorioPromotor`. A migração do schema `promotor` (0015, banco-dados) ainda não está no
 * main: até ela chegar, a API de produção NÃO liga o recebimento (sem rotas nem provedores de push). Assim o push das
 * coletas volta `SYNC_NAO_IMPLEMENTADO` (retentável, ADR 0009 §7) e nada se perde: as coletas ficam na fila do aparelho.
 * Os testes montam a API com `criarRepositorioMemoria`. Quando a 0015 entrar: `repositorio: criarRepositorioSql()`.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { criarRecebimento } from './recebimento';
import { criarRepositorioMemoria, type RepositorioPromotor } from './repositorio';
import { criarRotasPromotor } from './rotas';
import { provedoresSyncPromotor } from './sync';

export { criarRecebimento, criarRepositorioMemoria, criarRotasPromotor, provedoresSyncPromotor };
export type { RepositorioPromotor };
export { PERFIS_RELATORIO, periodoDoFiltro } from './rotas';
export { parametrosDoTenant } from './parametros';

/** Monta a API do Promotor sobre um repositório; `null` = só o manifesto (licença, ações e registro de sync valem). */
export function criarModuloApiPromotor(op: { repositorio: RepositorioPromotor | null }): ModuloApi {
  if (!op.repositorio) return definirModuloApi({ manifesto: manifest });
  const recebimento = criarRecebimento(op.repositorio);
  return definirModuloApi({ manifesto: manifest, rotas: criarRotasPromotor(op.repositorio, recebimento), sync: provedoresSyncPromotor(recebimento) });
}

/** Repositório em memória com a data local do check-in no fuso do tenant (testes e desenvolvimento). */
export const repositorioMemoria = (): ReturnType<typeof criarRepositorioMemoria> => criarRepositorioMemoria((instante, fuso) => localIsoDate(instante, fuso));

/** API de produção: sem repositório até a migração 0015 (veja o cabeçalho). */
export const moduloApi: ModuloApi = criarModuloApiPromotor({ repositorio: null });
export default moduloApi;
