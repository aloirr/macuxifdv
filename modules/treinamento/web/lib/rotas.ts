/**
 * Caminhos do Treinamento no BKO. As páginas abrem em `/<caminho>` do shell web (ADR 0003) e a API é chamada pelo
 * cliente `api()` do platform-sdk, cuja base já termina em `/v1` (`ROTAS_TREINAMENTO` é relativo a ela).
 */
import { ROTAS_TREINAMENTO } from '../../contracts';

export const CAMINHO_TRILHAS = 'trilhas';
export const CAMINHO_TRILHA_EDITAR = 'trilha-editar';

export const apiTreinamento = ROTAS_TREINAMENTO;

export const hrefTrilhas = (aba?: string) => `/${CAMINHO_TRILHAS}${aba ? `?aba=${aba}` : ''}`;
export const hrefEditarTrilha = (id?: string) => `/${CAMINHO_TRILHA_EDITAR}${id ? `?id=${encodeURIComponent(id)}` : ''}`;
