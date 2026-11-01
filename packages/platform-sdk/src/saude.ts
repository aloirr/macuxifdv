/**
 * Identificação do servidor Macuxi (`GET /v1/saude`, R-20261101-023742-alexandre, segurança).
 *
 * O app só salva um endereço de servidor, e só envia o login, se `<endereço>/saude` responder 200 com JSON neste
 * contrato: `servico === "macuxi-api"`. Um domínio digitado errado que responde qualquer coisa (HTML, 404, JSON de
 * outro serviço) falha, e as credenciais não saem do aparelho.
 *
 * Limite conhecido: a identificação evita erro de digitação e site de terceiro; não prova a identidade contra quem
 * copiar a resposta de propósito (isso é papel do https e, no futuro, de uma lista de domínios do tenant).
 */
import { z } from 'zod';

/** Valor fixo de `servico` na resposta de saúde da API (e do mock-api da Fase M, que imita a API). */
export const SERVICO_API_MACUXI = 'macuxi-api' as const;

/** Rota de saúde da API, relativa à base `/v1` (o app testa `<endereço digitado>/saude`). */
export const CAMINHO_SAUDE = '/saude';

export const SaudeRespostaSchema = z
  .object({
    ok: z.literal(true),
    servico: z.literal(SERVICO_API_MACUXI),
    /** Versão da API (`package.json` de apps/api ou `MACUXI_VERSAO`). */
    versao: z.string().min(1),
    /** Módulos instalados na API (só informativo). */
    modulos: z.array(z.string()).optional(),
  })
  .passthrough();
export type SaudeResposta = z.infer<typeof SaudeRespostaSchema>;
