/**
 * Rota `superAdmin: 'aceita'` do Core, superfície `bko`, usada pelos testes do portal (T-0091, T-0093, T-0176) para provar
 * tenant, sessão, empresa escolhida, filial e licença: `POST /v1/core/apps/download` (T-0190, RN-CORE-67, ADR 0065).
 * Desde a v1.0.22 a Equipe por CSV saiu (integração só por Conector ou API) e ela é a única rota `'aceita'` do Core.
 *
 * Para responder 200 sem S3, a API sobe com `PACOTES_DE_TESTE` (link fixo do Campo, sem bucket) e o corpo pede o Campo, que
 * os tenants A e B da fixture licenciam (Vendedor e Promotor). Toda recusa do portal (401, 403, 409, 400) vem antes da rota.
 */
import type { ServicoPacotes } from '@macuxi/platform-sdk';

export const ROTA_ACEITA_CORE = '/v1/core/apps/download';
export const CORPO_ROTA_ACEITA = Object.freeze({ variante: 'campo' as const });

/** Porta dos pacotes em memória: sempre o mesmo link fictício (nenhum dado do tenant). */
export const PACOTES_DE_TESTE: ServicoPacotes = {
  disponivel: () => true,
  linkDoUltimo: async () => ({
    versao: '1.0.22',
    arquivo: 'Campo-Teste-v1.0.22.apk',
    url: 'https://pacotes.teste.macuxi.invalid/campo/Campo-Teste-v1.0.22.apk?assinatura=ficticia',
    expira_em: new Date(Date.now() + 300_000).toISOString(),
  }),
};
