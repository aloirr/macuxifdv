/**
 * Rótulos e textos da página "Perfis de acesso" (ADR 0073): nome curto da permissão, do nível e do módulo, e as frases de uma recusa 422.
 * A REGRA (cadeado, teto, licença) vem da API e do domain; aqui só há texto.
 */
import { ALVO_TODOS_PERFIS } from '@macuxi/ui/web';

export { ALVO_TODOS_PERFIS };

/** Descrição do manifesto até o primeiro " (" ou ";" (os rótulos curados ficam em `ROTULO_DA_PERMISSAO`, em `acesso.ts`). */
export function rotuloDaChave(chave: string, descricao: string): string {
  const corte = descricao.search(/ \(|;/);
  return (corte > 0 ? descricao.slice(0, corte) : descricao).trim() || chave;
}

const NIVEIS_ESCOPO_ROTULO: Readonly<Record<string, string>> = {
  proprio: 'Só o que é dele',
  carteira: 'Carteira própria',
  equipe: 'Equipe',
  equipes_abaixo: 'Equipes abaixo',
  tenant: 'Toda a empresa',
};
const NIVEIS_ALCADA_ROTULO: Readonly<Record<string, string>> = { ate_alcada: 'Até a alçada', acima_alcada: 'Acima da alçada' };
export const rotuloDoNivel = (nivel: string): string => NIVEIS_ESCOPO_ROTULO[nivel] ?? NIVEIS_ALCADA_ROTULO[nivel] ?? nivel;

/** Frases do resumo para uma recusa 422 (no máximo 3 e "e mais N"; nunca JSON, §7.2). */
export function frasesDaRecusa(detalhes: unknown, mensagem: string): string[] {
  const v = (detalhes as { violacoes?: { mensagem?: string }[] } | null)?.violacoes;
  const frases = [...new Set((v ?? []).map((x) => x.mensagem).filter((m): m is string => !!m))];
  if (frases.length === 0) return [mensagem];
  return frases.length <= 3 ? frases : [...frases.slice(0, 3), `e mais ${frases.length - 3}`];
}

const NOME_DO_MODULO: Readonly<Record<string, string>> = {
  core: 'Core',
  catalogo: 'Catálogo',
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  gestor: 'Gestor',
  pesquisa: 'Pesquisa',
  treinamento: 'Treinamento',
  integracao: 'Integração com o ERP',
};
/** Nome do módulo para a tela (nunca o código). */
export const rotuloDoModulo = (m: string): string => NOME_DO_MODULO[m] ?? m;
