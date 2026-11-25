/**
 * Trava da quantidade fracionária nas rotas de módulo (ADR 0076 D6, RN-VEN-02 v3): uma forma só de ler a porta
 * `ctx.versaoApp` e de variar o escopo do pull. A rota `GET /v1/app/versao` (V3) lê a fonte direto e não passa por aqui.
 */
import {
  clienteAceitaFracao,
  fracaoLiberada,
  type AppDoCabecalho,
  type PortaVersaoApp,
} from './app-versao';

/** `fracaoLiberada` com a publicada do Campo e do Gestão lidas na porta. Sem porta = fechada. */
export async function fracaoLiberadaNaPorta(porta: PortaVersaoApp | undefined, agora: Date): Promise<boolean> {
  if (!porta) return false;
  const [campo, gestao] = await Promise.all([porta.publicada('campo'), porta.publicada('gestao')]);
  return fracaoLiberada({ campo, gestao, agora });
}

/** `variacaoEscopo` do pull: `fracao=1` se o app que chamou lê fração (`clienteAceitaFracao`), senão `fracao=0`. */
export const variacaoFracao = (app: AppDoCabecalho | null): string => `fracao=${clienteAceitaFracao(app) ? 1 : 0}`;
