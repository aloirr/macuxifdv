/**
 * Matriz de permissões perfil × ação (doc 03 §2) como função pura. RN-PRO-01: o promotor nunca cria, edita,
 * cancela, duplica nem exclui pedido, valendo pelo PERFIL (mesmo que ganhe o módulo Vendedor).
 * A API revalida sempre; o app só esconde. Ação desconhecida = negada (falha fechada).
 */
import {
  matrizDeFabrica,
  perfilDeFabrica,
  podeEntrar,
  resolverPerfil,
  type AppComLogin,
  type LugarDeAcesso,
  type MatrizFabrica,
  type Perfil,
  type PerfilDaRequisicao,
} from '@macuxi/platform-sdk';
import { manifest } from '../manifest';

export type Acesso = 'total' | 'leitura' | 'negado';
export type EscopoMatriz = 'proprio' | 'carteira' | 'equipe' | 'tenant' | 'em_nome' | 'alcada' | 'acima_da_alcada';

export interface Decisao {
  acesso: Acesso;
  escopo: EscopoMatriz | null;
}

type Celula = readonly [Acesso, EscopoMatriz | null];
type Linha = Readonly<Record<Perfil, Celula>>;
const N: Celula = ['negado', null];
const T = (e: EscopoMatriz | null = null): Celula => ['total', e];
const L = (e: EscopoMatriz | null = null): Celula => ['leitura', e];

const linha = (v: Celula, p: Celula, s: Celula, g: Celula, an: Celula, as: Celula, ad: Celula): Linha => ({
  vendedor: v,
  promotor: p,
  supervisor: s,
  gerente: g,
  analista: an,
  assistente: as,
  admin: ad,
});

/** Uma linha por ação. Supervisor e gerente compartilham a coluna do doc 03. */
const MATRIZ: Readonly<Record<string, Linha>> = {
  'cliente.ver_360': linha(L('carteira'), L('carteira'), L('equipe'), L('equipe'), L('tenant'), L('tenant'), L('tenant')),
  'pedido.criar': linha(T('proprio'), N, T('em_nome'), T('em_nome'), T(), T(), N),
  'pedido.editar': linha(T('proprio'), N, T('em_nome'), T('em_nome'), T(), T(), N),
  'pedido.duplicar': linha(T('proprio'), N, T('em_nome'), T('em_nome'), T(), T(), N),
  'pedido.cancelar': linha(T('proprio'), N, T('equipe'), T('equipe'), T(), T(), N),
  'pedido.excluir': linha(T('proprio'), N, T('proprio'), T('proprio'), T(), T(), N),
  'pedido.ver': linha(L('proprio'), L('carteira'), L('equipe'), L('equipe'), L('tenant'), L('tenant'), L('tenant')),
  'desconto.aprovar': linha(N, N, T('alcada'), T('alcada'), T('acima_da_alcada'), N, N),
  'trade.coletar': linha(N, T(), L(), L(), L(), L(), N),
  'trade.cadastrar': linha(N, N, N, N, T(), N, T()),
  'pesquisa.responder': linha(T(), T(), T(), T(), N, N, N),
  'pesquisa.criar': linha(N, N, N, N, T(), N, T()),
  'modulo.gerir_licencas': linha(N, N, N, N, N, N, T()),
  // Usuários no BKO (RF-CORE-02): leitura recortada pelo escopo (gerente = equipes abaixo; o supervisor não usa o BKO, RN-CORE-33); a gestão (criar, editar, desativar, senha) é do motor de permissões (ADR 0033)
  'usuario.ver': linha(N, N, N, L('equipe'), N, N, L('tenant')),
};

export const ACOES_DA_MATRIZ: readonly string[] = Object.keys(MATRIZ);

/** Ações de pedido que o promotor nunca executa, mesmo que não estejam na matriz (RN-PRO-01). */
const ehPedido = (acao: string) => /^pedido(_[a-z0-9_]+)?\./.test(acao);
const LEITURA_DE_PEDIDO = new Set(['pedido.ver', 'pedido.listar']);

export function decisao(perfil: Perfil, acao: string): Decisao {
  if (perfil === 'promotor' && ehPedido(acao) && !LEITURA_DE_PEDIDO.has(acao)) return { acesso: 'negado', escopo: null };
  const l = MATRIZ[acao];
  if (!l) return { acesso: 'negado', escopo: null };
  const [acesso, escopo] = l[perfil];
  return { acesso, escopo };
}

/** Pode EXECUTAR (não só ler) a ação? */
export function podeExecutar(perfil: Perfil, acao: string): boolean {
  return decisao(perfil, acao).acesso === 'total';
}

/** Pode ver (executar ou apenas ler)? */
export function podeVer(perfil: Perfil, acao: string): boolean {
  return decisao(perfil, acao).acesso !== 'negado';
}

/**
 * ADR 0033: perfil de fábrica resolvido (sem sobreposição do tenant) para quem ainda não tem os perfis da requisição: rotas públicas
 * (login, esqueci a senha) e tarefas de fundo. A matriz leva as ações do próprio Core (ex.: `usuario.filial_editar`, RN-CORE-39), senão
 * o admin de fábrica não passaria na checagem da filial ao criar usuário.
 */
const MATRIZ_DE_ACESSO = matrizDeFabrica([manifest]);
export const perfisDeFabrica = (perfil: Perfil, matriz: MatrizFabrica = MATRIZ_DE_ACESSO): PerfilDaRequisicao[] => [resolverPerfil(perfilDeFabrica(perfil), matriz)];

/** Lugar de acesso (`acesso.*`) de cada app do login: o BKO entra como `web` no login e `bko` no motor. */
export const lugarDoApp = (app: AppComLogin): LugarDeAcesso => (app === 'web' ? 'bko' : app);
/** RN-CORE-33/35: os perfis dão acesso a este app? Quem decide é a chave `acesso.*`, não o nome do perfil. */
export const podeUsarApp = (perfis: readonly PerfilDaRequisicao[], app: AppComLogin): boolean => podeEntrar(perfis, lugarDoApp(app));
/** RN-CORE-33: entra no BKO (chave `acesso.bko`); vendedor, promotor e supervisor ficam fora na fábrica. */
export const podeAcessarBko = (perfis: readonly PerfilDaRequisicao[]): boolean => podeEntrar(perfis, 'bko');
