/**
 * Navegação da Pesquisa dentro do shell: toda tela de módulo abre em `/m/<caminho>` (ADR 0003). Os caminhos batem com
 * `moduloApp.paginas` (index.ts).
 */
import { router } from 'expo-router';

import { CAMINHO_PESQUISAS, CAMINHO_RESPONDER } from './caminhos';

export { CAMINHO_PESQUISAS, CAMINHO_RESPONDER };

const rota = (caminho: string, params: Record<string, string | null | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `/m/${caminho}${qs ? `?${qs}` : ''}`;
};

export interface ParamsResponder {
  questionario: string;
  cliente?: string | null;
  visita?: string | null;
}

export const hrefPesquisas = () => rota(CAMINHO_PESQUISAS);
export const hrefResponder = (p: ParamsResponder) => rota(CAMINHO_RESPONDER, { questionario: p.questionario, cliente: p.cliente, visita: p.visita });

export const irParaPesquisas = () => router.navigate(hrefPesquisas() as never);
export const irParaResponder = (p: ParamsResponder) => router.push(hrefResponder(p) as never);
