/**
 * Erro que derrubaria o app (relato do dono do produto, 08/11: "Novo pedido" fechava o app e o Android avisava "Macuxi Campo
 * está travando com frequência"). No build sem Metro não há tela vermelha: erro de render sem tela de erro, ou erro fatal
 * fora do React, encerra o processo. Agora as telas de módulo e a raiz têm tela de erro (`components/tela-de-erro.tsx`) e o
 * último erro fica no aparelho para o Diagnóstico do Perfil. Puro (roda em Node).
 * Sem dado pessoal: só a mensagem técnica do erro e o começo da pilha (nomes de função e arquivo do bundle), truncados, com a
 * máscara única de dado pessoal (`mascararDadoPessoal` do `@macuxi/comum`, a mesma do Conector; R-20261109-034101).
 */
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import { cabecalhoDoUltimoErro, TEXTO_SEM_ERRO_REGISTRADO, type OrigemDoErroRegistrado } from '@macuxi/ui/mobile/puro';

/** Chave no AsyncStorage (fora do prefixo do usuário: vale para o aparelho, inclusive antes do login). */
export const CHAVE_ULTIMO_ERRO = 'fv:diagnostico:ultimo_erro';

const MAX_MENSAGEM = 300;
const MAX_LINHAS_PILHA = 6;

/** As mesmas origens do kit (`OrigemDoErroRegistrado`): tela de módulo, raiz, fatal fora do React, não fatal. */
export type OrigemDoErro = OrigemDoErroRegistrado;

export interface ErroRegistrado {
  /** ISO 8601 (UTC). */
  quando: string;
  origem: OrigemDoErro;
  /** Rota onde aconteceu (`/m/novo-pedido`), quando se sabe. */
  onde: string | null;
  mensagem: string;
  pilha: string | null;
}

/**
 * Objeto lançado que não é `Error` (ex.: o corpo de uma resposta da API) pode trazer nome, CNPJ ou e-mail do cliente: fica só
 * o tipo e os nomes das chaves, nunca os valores ("Objeto lançado {codigo, status}"; revisão R-20261108-215731, regra 8).
 */
function descricaoSemValores(e: unknown): string {
  if (e === null || e === undefined) return `Valor lançado: ${String(e)}`;
  if (typeof e !== 'object') return `Valor lançado do tipo ${typeof e}`;
  const chaves = Object.keys(e).slice(0, 10);
  return `Objeto lançado {${chaves.join(', ')}}`;
}

/** Monta o registro de um erro qualquer (Error, texto ou objeto lançado). */
export function registroDoErro(e: unknown, origem: OrigemDoErro, agora: Date, onde: string | null = null): ErroRegistrado {
  const err = e instanceof Error ? e : null;
  const nome = err?.name && err.name !== 'Error' ? `${err.name}: ` : '';
  const bruta = err ? `${nome}${err.message}` : typeof e === 'string' ? e : descricaoSemValores(e);
  const limpa = mascararDadoPessoal(bruta);
  const mensagem = limpa.length > MAX_MENSAGEM ? `${limpa.slice(0, MAX_MENSAGEM - 1)}…` : limpa || 'Erro sem mensagem';
  const pilha = err?.stack
    ? mascararDadoPessoal(
        err.stack
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !(err.message && l.includes(err.message)))
          .slice(0, MAX_LINHAS_PILHA)
          .join('\n'),
      ) || null
    : null;
  return { quando: agora.toISOString(), origem, onde, mensagem, pilha };
}

/**
 * O erro não fatal (`ErrorUtils` com `fatal` falso) não apaga a causa de um fechamento ou de uma tela de erro que o vendedor
 * ainda não viu no Diagnóstico: só grava sem registro ou por cima de outro não fatal. Tela, raiz e fatal sempre gravam.
 */
export function deveGravarErro(existente: Pick<ErroRegistrado, 'origem'> | null, origem: OrigemDoErro): boolean {
  return origem !== 'nao-fatal' || existente === null || existente.origem === 'nao-fatal';
}

/**
 * Texto do "Enviar o detalhe ao suporte" da tela de erro (Share do sistema), no padrão da T-0088: 1ª linha
 * "Macuxi Campo 1.0.1 · Não foi possível mostrar esta tela", depois quando e onde, a mensagem e a pilha, sem dado pessoal.
 */
export function mensagemDoErroParaSuporte(r: ErroRegistrado, c: { app: string; titulo: string }): string {
  return [`${c.app} · ${c.titulo}`, `${r.quando}${r.onde ? ` · ${r.onde}` : ''}`, mascararDadoPessoal(r.mensagem), r.pilha ? mascararDadoPessoal(r.pilha) : null]
    .filter(Boolean)
    .join('\n');
}

/**
 * Linha do Diagnóstico do Perfil, com os textos do kit (`cabecalhoDoUltimoErro`, `TEXTO_SEM_ERRO_REGISTRADO`): "Último erro do
 * app: hoje 17:15 · o app fechou · /m/novo-pedido", e embaixo a mensagem e a pilha. `data` formata no fuso do tenant.
 */
export function textoDoUltimoErro(r: ErroRegistrado | null, data: (iso: string) => string): string {
  if (!r) return TEXTO_SEM_ERRO_REGISTRADO;
  return `${cabecalhoDoUltimoErro(r.origem, data(r.quando), r.onde)}\n${r.mensagem}${r.pilha ? `\n${r.pilha}` : ''}`;
}
