/**
 * Textos da aba Venda e da aba Entrega do Novo pedido (RF-VEN-11, T-0136; spec docs/design/pedido-v2.md §1.2 e §1.4).
 * Cada frase sai de uma função com teste: a tela não escreve texto próprio. Quais alertas valem é do domain (`alertasDaVenda`).
 */
import { formatBRL } from '@macuxi/comum';

import type { ModeloDoCredito } from './credito-cliente';

export const ROTULO_CREDITO = 'Crédito do cliente';
export const TEXTO_SEM_DADOS_DE_CREDITO = 'Sem dados de crédito deste cliente.';
export const TEXTO_CREDITO_INDISPONIVEL = 'Crédito indisponível agora. Sincronize o aparelho.';
export const ROTULO_ENDERECO_ENTREGA = 'Endereço de entrega';
export const TEXTO_ENDERECO_DO_CADASTRO = 'Endereço do cadastro';

export interface LinhaDoCredito {
  id: 'limite' | 'disponivel' | 'prazo';
  rotulo: string;
  /** já formatado; "—" = sem dado */
  valor: string;
}
export interface TabelaDoCredito {
  /** `carregando`: barras no lugar dos valores; `indisponivel`: sem tabela, só o apoio; `tabela`: as 3 linhas */
  estado: 'carregando' | 'indisponivel' | 'tabela';
  linhas: LinhaDoCredito[];
  /** frase de 12 `ink2` abaixo da tabela (ou no lugar dela) */
  apoio: string | null;
}

const SEM_DADO = '—';
/** Dinheiro com sinal "−" (U+2212) para o negativo: "−R$ 1.200,00". */
const dinheiroComSinal = (cents: number) => (cents < 0 ? `−${formatBRL(-cents)}` : formatBRL(cents));

/**
 * RN-VEN-12 / RF-VEN-11 (T-0141 A, docs/design/pedido-v3.md §A): o crédito da aba Venda em tabela. `credito`: `undefined` = lendo do
 * aparelho (barras, nunca "R$ 0,00"); `null` = consulta indisponível (sem tabela); `vazio` = Limite e Disponível com "—" e a
 * frase de apoio. O Prazo médio sem dado também fica com "—": a forma da tabela não muda de um cliente para outro.
 */
export function tabelaDoCredito(c: ModeloDoCredito | null | undefined, prazoMedioDias: number | null | undefined): TabelaDoCredito {
  const prazo = textoDoPrazoMedio(prazoMedioDias) ?? SEM_DADO;
  if (c === null) return { estado: 'indisponivel', linhas: [], apoio: TEXTO_CREDITO_INDISPONIVEL };
  const dados = c?.tipo === 'dados' ? c : null;
  const linhas: LinhaDoCredito[] = [
    { id: 'limite', rotulo: 'Limite', valor: dados ? formatBRL(dados.limite_cents) : SEM_DADO },
    { id: 'disponivel', rotulo: 'Disponível', valor: dados ? dinheiroComSinal(dados.disponivel_cents) : SEM_DADO },
    { id: 'prazo', rotulo: 'Prazo médio', valor: prazo },
  ];
  if (c === undefined) return { estado: 'carregando', linhas, apoio: null };
  return { estado: 'tabela', linhas, apoio: dados ? null : TEXTO_SEM_DADOS_DE_CREDITO };
}

/** "45 dias" / "1 dia"; `null` = o cadastro não traz prazo médio (a linha some). */
export function textoDoPrazoMedio(dias: number | null | undefined): string | null {
  if (typeof dias !== 'number' || !Number.isFinite(dias) || dias < 0) return null;
  const d = Math.trunc(dias);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

// ---------- Resumo (RF-VEN-11, T-0137; docs/design/pedido-v2.md §2.1) ----------
export const TEXTO_OBS_VAZIA = '—';

/** Linha OBS.: a observação; vazia = "—". */
export function linhaDaObsNoResumo(obs: string | undefined | null): string {
  return (obs ?? '').trim() || TEXTO_OBS_VAZIA;
}
