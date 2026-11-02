/**
 * T-0059 (R-20261102-090915, decisão do Alexandre): durante a carga o usuário não vê módulo nem entidade. A tela mostra
 * UMA frase por vez, desta lista, escolhida pelo perfil (Campo: vendedor/promotor; Gestão: supervisor/gerente) e
 * pelos módulos efetivos: nenhuma frase cita o que o tenant não licenciou (ex.: "pedido" só com o Vendedor ativo) e o
 * promotor nunca lê frase de pedido (RN-PRO-01 vale pelo perfil). Puro (roda em Node nos testes).
 */
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';

import type { Variante } from './variante-tipo';

/** Troca de frase durante a carga (~3–4 s). */
export const INTERVALO_FRASE_MS = 3_500;

interface Frase {
  texto: string;
  /** Só para estes perfis (ausente = qualquer perfil da variante, inclusive sem perfil conhecido). */
  perfis?: readonly Perfil[];
  /** Só com TODOS estes módulos efetivos. */
  modulos?: readonly ModuloId[];
  /** Só nesta variante do app (ausente = Campo e Gestão). */
  variante?: Variante;
  /** Dados de que a frase fala (T-0059): vem primeiro quando o motor está baixando um destes módulos (`carga.modulo`). */
  foco?: readonly ModuloId[];
}

const CAMPO: readonly Perfil[] = ['vendedor', 'promotor'];
const GESTAO: readonly Perfil[] = ['supervisor', 'gerente'];

/** Ordem de exibição. A primeira e a última valem para todos: a lista nunca fica vazia. */
const FRASES: readonly Frase[] = [
  { texto: 'Preparando tudo para o seu dia de trabalho' },
  { texto: 'Preparando tudo para você bater sua meta hoje', perfis: ['vendedor'] },
  { texto: 'Sincronizando os dados da sua rota', perfis: CAMPO, foco: ['core'] },
  { texto: 'Baixando seus clientes e a tabela de preços', perfis: ['vendedor'], modulos: ['catalogo'], foco: ['core', 'catalogo'] },
  { texto: 'Trazendo seus pedidos recentes para consultar sem sinal', perfis: ['vendedor'], modulos: ['vendedor'], foco: ['vendedor'] },
  { texto: 'Separando as lojas que você vai visitar', perfis: ['promotor'], modulos: ['promotor'], foco: ['core', 'promotor'] },
  { texto: 'Preparando as checagens de gôndola, preço e validade', perfis: ['promotor'], modulos: ['promotor'], foco: ['promotor'] },
  { texto: 'Trazendo os produtos para consultar sem sinal', modulos: ['catalogo'], foco: ['catalogo'] },
  { texto: 'Aguarde mais um pouco. Já planejou sua rota de hoje?', perfis: CAMPO },
  { texto: 'Trazendo as pesquisas que você vai aplicar', perfis: CAMPO, modulos: ['pesquisa'], foco: ['pesquisa'] },
  { texto: 'Separando os treinamentos disponíveis para você', modulos: ['treinamento'], foco: ['treinamento'] },
  { texto: 'Juntando os números da sua equipe', perfis: GESTAO, variante: 'gestao', foco: ['gestor'] },
  { texto: 'Preparando a carteira de clientes do seu time', perfis: GESTAO, variante: 'gestao', foco: ['core'] },
  { texto: 'Trazendo os pedidos que aguardam a sua aprovação', perfis: GESTAO, modulos: ['vendedor'], variante: 'gestao', foco: ['vendedor'] },
  { texto: 'Atualizando metas e alertas da equipe', perfis: GESTAO, modulos: ['gestor'], variante: 'gestao', foco: ['gestor'] },
  { texto: 'Reunindo o que a equipe registrou nas lojas', perfis: GESTAO, modulos: ['promotor'], variante: 'gestao', foco: ['promotor'] },
  { texto: 'Quase lá: deixando tudo pronto para funcionar sem sinal' },
];

/**
 * Frases da carga para este usuário, na ordem de exibição. Com `moduloAtual` (o `carga.modulo` do motor, T-0059), as
 * frases que falam dos dados desse módulo vêm primeiro e as de outros módulos saem (ficam as gerais); sem frase do
 * módulo atual, vale a lista inteira. O id do módulo nunca vai para a tela: só escolhe a frase.
 */
export function frasesDaCarga(
  variante: Variante,
  perfil: Perfil | null | undefined,
  modulosAtivos: readonly ModuloId[],
  moduloAtual?: ModuloId | null,
): string[] {
  const ativos = new Set(modulosAtivos);
  const doUsuario = FRASES.filter((f) => {
    if (f.variante && f.variante !== variante) return false;
    if (f.perfis && (!perfil || !f.perfis.includes(perfil))) return false;
    if (f.modulos && !f.modulos.every((m) => ativos.has(m))) return false;
    return true;
  });
  const doModulo = moduloAtual ? doUsuario.filter((f) => f.foco?.includes(moduloAtual)) : [];
  if (doModulo.length === 0) return doUsuario.map((f) => f.texto);
  return [...doModulo, ...doUsuario.filter((f) => !f.foco)].map((f) => f.texto);
}

/** Aviso fixo da carga inicial (ADR 0017 §2): ela só roda com o app aberto e, se ele fechar, continua de onde parou. */
export const AVISO_APP_ABERTO = 'Mantenha o app aberto até terminar. Se ele fechar, continuamos de onde parou.';
/** A passada continuou uma carga interrompida (`carga.retomada`). */
export const FRASE_RETOMADA = 'Continuando de onde parou';

/** Todas as frases possíveis (para os testes conferirem que nenhuma traz nome técnico). */
export const TODAS_AS_FRASES: readonly string[] = FRASES.map((f) => f.texto);

/** Mensagem amigável quando a carga para (o detalhe técnico vai para o log e para o Diagnóstico do Perfil). */
export function mensagemDeErroDaCarga(offline: boolean): string {
  return offline
    ? 'Você está no modo sem sinal. Desligue o modo sem sinal para baixar seus dados.'
    : 'Não conseguimos baixar seus dados. Confira o sinal e tente de novo.';
}
