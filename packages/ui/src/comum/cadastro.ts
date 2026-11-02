/**
 * T-0060 (RN-CORE-17): textos e montagem da etiqueta "Cadastro incompleto" e do bloco Observações do cliente, comuns ao
 * kit mobile (Campo e Gestão) e ao kit web (BKO). Puro (roda em Node nos testes).
 *
 * A REGRA (quais campos faltam, o texto da linha automática) é do domain do Core (`cadastroCompleto`,
 * `observacaoComCadastro`): a tela do Core calcula e entrega aqui só o que exibir. O kit nunca grava nem recalcula nada.
 */

export const ROTULO_CADASTRO_INCOMPLETO = 'Cadastro incompleto';

/** Leitura em voz alta da etiqueta (leitor de tela): diz o efeito, não só o estado. */
export const DESCRICAO_CADASTRO_INCOMPLETO = 'Cadastro incompleto: pedido só como orçamento até o cadastro ser completado no ERP.';

export const TITULO_OBSERVACOES = 'Observações';
export const OBSERVACOES_VAZIAS = 'Sem observações.';

export interface BlocosObservacao {
  /** Linha automática do cadastro incompleto (RN-CORE-17), destacada no topo. */
  automatica: string | null;
  /** Texto do ERP, intacto (só sem as linhas vazias das pontas). */
  texto: string | null;
  vazio: boolean;
}

const preenchido = (s: string | null | undefined): string | null => {
  if (typeof s !== 'string') return null;
  const semPontas = s.replace(/^\s*\n/g, '').replace(/\n\s*$/g, '');
  return semPontas.trim() === '' ? null : semPontas;
};

/**
 * Separa o que o bloco Observações mostra: a linha automática (quando o cadastro está incompleto) e o texto do ERP.
 * Se a tela entregar o texto já montado pelo Core (`observacaoComCadastro`), a linha automática repetida no começo do
 * texto sai dele (ela aparece uma vez só, em destaque).
 */
export function blocosDeObservacao(automatica: string | null | undefined, texto: string | null | undefined): BlocosObservacao {
  const linha = preenchido(automatica)?.trim() ?? null;
  let corpo = preenchido(texto);
  if (linha && corpo && corpo.trimStart().startsWith(linha)) corpo = preenchido(corpo.trimStart().slice(linha.length));
  return { automatica: linha, texto: corpo, vazio: linha === null && corpo === null };
}
