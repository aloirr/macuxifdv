/**
 * T-0166 (RN-CORE-36; RD-0170, RD-0177, RD-0179): parte PURA da "falta no campo, só na tentativa". Spec:
 * docs/design/formulario-pendencias.md §0.0 e docs/design/pedido-v4.md §6.1.
 * - Campo obrigatório vazio é estado normal até a tentativa (o toque no botão que conclui, ou sair da aba pelo Avançar).
 * - Valor inválido digitado aparece ao sair do campo (perder o foco), sem esperar a tentativa.
 * - A marca é a borda `danger` de 2 dp no próprio campo e um texto curto embaixo ("Obrigatório", "CNPJ inválido", "Máx. 10,0%").
 * Sem regra de negócio: QUAL falta existe e o texto dela são do `domain` do módulo; aqui só quando ela aparece e a leitura.
 * Sem react-native: roda em Node (Vitest) e é reexportada por `@macuxi/ui/mobile/puro`.
 */
import { colors } from './tokens';

/** Texto do obrigatório vazio (o mais comum). Os outros vêm do domain: "Saiu da lista", "CNPJ inválido", "Máx. 10,0%". */
export const FALTA_OBRIGATORIO = 'Obrigatório';

/**
 * - `vazio`: obrigatório sem valor → só depois da tentativa;
 * - `invalido`: valor digitado que não vale → ao sair do campo ou na tentativa;
 * - `imediata`: limite que o vendedor precisa ver ao digitar (ex.: acima do desconto máximo do produto, RD-0177) → sempre.
 */
export type QuandoMostrarFalta = 'vazio' | 'invalido' | 'imediata';

export interface FaltaDoCampo {
  /** Curto, sem ponto, inicial maiúscula: "Obrigatório", "Acima do prazo médio". */
  texto: string;
  quando: QuandoMostrarFalta;
}

export interface EstadoDoCampo {
  /** O vendedor tocou no botão que conclui (ou saiu da aba pelo Avançar) com falta. Fica ligado até salvar ou descartar. */
  tentou: boolean;
  /** O campo já perdeu o foco depois de editado (vale para `invalido`). */
  saiu?: boolean;
}

/** O texto que aparece embaixo do campo agora, ou null (campo no estado normal). */
export function faltaVisivel(falta: FaltaDoCampo | null | undefined, estado: EstadoDoCampo): string | null {
  if (!falta) return null;
  const texto = falta.texto.trim();
  if (!texto) return null;
  if (falta.quando === 'imediata') return texto;
  if (estado.tentou) return texto;
  return falta.quando === 'invalido' && estado.saiu ? texto : null;
}

/** TalkBack do campo marcado: "Transportadora, Obrigatório" · sem falta, só o rótulo (e o valor, se houver). */
export function leituraDoCampoComFalta(rotulo: string, valor: string | null | undefined, falta: string | null | undefined): string {
  const partes = [rotulo.trim(), (valor ?? '').trim(), (falta ?? '').trim()].filter((p) => p !== '');
  return partes.join(', ');
}

/** Medidas da marca: borda de 2 dp e texto 12,5/600 em `danger` (6,4:1 no fundo e no branco), ícone 14, 4 dp abaixo do campo. */
export const MARCA_DA_FALTA = {
  cor: colors.danger,
  larguraBorda: 2,
  tamanhoFonte: 12.5,
  alturaLinha: 16,
  icone: 14,
  respiro: 4,
} as const;
