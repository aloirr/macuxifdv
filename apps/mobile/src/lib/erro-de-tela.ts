/**
 * Erro que derrubaria o app (relato do dono do produto, 08/11: "Novo pedido" fechava o app e o Android avisava "Macuxi Campo
 * está travando com frequência"). No build sem Metro não há tela vermelha: erro de render sem tela de erro, ou erro fatal
 * fora do React, encerra o processo. Agora as telas de módulo e a raiz têm tela de erro (`components/tela-de-erro.tsx`) e o
 * último erro fica no aparelho para o Diagnóstico do Perfil. Puro (roda em Node).
 * Sem dado pessoal: só a mensagem técnica do erro e o começo da pilha (nomes de função e arquivo do bundle), truncados.
 */

/** Chave no AsyncStorage (fora do prefixo do usuário: vale para o aparelho, inclusive antes do login). */
export const CHAVE_ULTIMO_ERRO = 'fv:diagnostico:ultimo_erro';

const MAX_MENSAGEM = 300;
const MAX_LINHAS_PILHA = 6;

export type OrigemDoErro = 'tela' | 'raiz' | 'fatal' | 'nao-fatal';

export interface ErroRegistrado {
  /** ISO 8601 (UTC). */
  quando: string;
  origem: OrigemDoErro;
  /** Rota onde aconteceu (`/m/novo-pedido`), quando se sabe. */
  onde: string | null;
  mensagem: string;
  pilha: string | null;
}

/** Monta o registro de um erro qualquer (Error, texto ou objeto lançado). */
export function registroDoErro(e: unknown, origem: OrigemDoErro, agora: Date, onde: string | null = null): ErroRegistrado {
  const err = e instanceof Error ? e : null;
  const nome = err?.name && err.name !== 'Error' ? `${err.name}: ` : '';
  const bruta = err ? `${nome}${err.message}` : typeof e === 'string' ? e : (() => {
    try {
      return JSON.stringify(e) ?? String(e);
    } catch {
      return String(e);
    }
  })();
  const mensagem = bruta.length > MAX_MENSAGEM ? `${bruta.slice(0, MAX_MENSAGEM - 1)}…` : bruta || 'Erro sem mensagem';
  const pilha = err?.stack
    ? err.stack
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !(err.message && l.includes(err.message)))
        .slice(0, MAX_LINHAS_PILHA)
        .join('\n') || null
    : null;
  return { quando: agora.toISOString(), origem, onde, mensagem, pilha };
}

/** Linha do Diagnóstico do Perfil. `data` formata o instante no fuso do tenant. */
export function textoDoUltimoErro(r: ErroRegistrado | null, data: (iso: string) => string): string {
  if (!r) return 'Nenhum erro de tela registrado neste aparelho.';
  const origem: Record<OrigemDoErro, string> = { tela: 'tela', raiz: 'app', fatal: 'fatal', 'nao-fatal': 'em segundo plano' };
  return `Último erro (${origem[r.origem]}): ${data(r.quando)}${r.onde ? ` · ${r.onde}` : ''}\n${r.mensagem}${r.pilha ? `\n${r.pilha}` : ''}`;
}
