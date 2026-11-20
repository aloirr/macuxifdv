/**
 * Trajeto do dia da equipe no mapa do Gestor (T-0156; docs/desenho/tracking.md §9). Função pura: o aparelho e o navegador
 * desenham a linha com estas coordenadas de tela; nenhum provedor de mapa recebe o trajeto (nem pelo servidor).
 * RN-CORE-13: sem pontos (tracking desligado de fábrica, sem termo ou fora do expediente) o resultado é `vazio`.
 * A coordenada nunca vai para log nem para mensagem de erro (§9): este módulo não registra nada.
 */
import { formatHHMM } from '@macuxi/comum/fuso';
import { perfilUsaApp } from '@macuxi/platform-sdk';
import { projetarPontos, type PontoDoTrajeto } from '@macuxi/core/contracts';
import type { MembroEquipe } from '../contracts';

/** RN-CORE-13: texto do app e do BKO quando o dia não tem pontos (tracking desligado, sem termo ou fora do expediente). */
export const TEXTO_SEM_TRAJETO = 'Nada registrado';

export interface PontoDesenhado {
  x: number;
  y: number;
  /** HH:mm no fuso do tenant. */
  hora: string;
}
export interface TrajetoDesenhado {
  vazio: boolean;
  /** Pontos em ordem de `capturado_em`, já em coordenadas de tela. */
  linha: { x: number; y: number }[];
  primeiro: PontoDesenhado | null;
  ultimo: PontoDesenhado | null;
  total: number;
}
export interface OpcoesDesenho {
  largura: number;
  altura: number;
  margem: number;
  /** Fuso IANA do tenant, só para a hora exibida. */
  fuso: string;
}

/**
 * Ordena por `capturado_em`, projeta e marca as horas com as funções do Core (`projetarPontos`): a mesma projeção
 * do Core.
 */
export function desenharTrajeto(pontos: readonly PontoDoTrajeto[], o: OpcoesDesenho): TrajetoDesenhado {
  if (pontos.length === 0) return { vazio: true, linha: [], primeiro: null, ultimo: null, total: 0 };
  const ordem = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const linha = projetarPontos(ordem, o.largura, o.altura, o.margem);
  const marca = (i: number): PontoDesenhado => ({ ...linha[i]!, hora: formatHHMM(ordem[i]!.capturado_em, o.fuso) });
  return { vazio: false, linha, primeiro: marca(0), ultimo: marca(ordem.length - 1), total: ordem.length };
}

/**
 * Quem o gestor escolhe para ver o trajeto do dia (RN-CORE-13, RN-CORE-37; T-0187 §1.2): vendedores e promotores ativos do escopo e,
 * para o gerente, também os supervisores das equipes abaixo. O usuário da sessão nunca entra (o próprio trajeto não aparece).
 * Ordem alfabética por nome, com o id como desempate. A API do Core confere de novo escopo e permissão.
 */
export function pessoasDoTrajeto(e: { viewer: { id: string; perfil: MembroEquipe['perfil'] }; membros: readonly MembroEquipe[] }): MembroEquipe[] {
  const vistos = new Set<string>();
  return e.membros
    .filter((m) => {
      if (m.id === e.viewer.id || !m.ativo || vistos.has(m.id)) return false;
      vistos.add(m.id);
      return perfilUsaApp(m.perfil, 'campo') || (m.perfil === 'supervisor' && e.viewer.perfil === 'gerente');
    })
    .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : a.id < b.id ? -1 : 1));
}
