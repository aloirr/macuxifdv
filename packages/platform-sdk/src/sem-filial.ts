/**
 * Guarda global do usuário sem filial de cadastro (T-0176, RN-CORE-39; ADR 0056).
 *
 * A regra é do Core: todo usuário, de qualquer perfil, tem 1 filial de cadastro; sem ela fica BLOQUEADO. A plataforma não lê
 * tabela do Core (fronteira): o estado chega no `UsuarioAutenticado.sem_filial` que o serviço `autenticar` do Core já devolve
 * a cada requisição (mesma leitura por chave primária do usuário que confere ativo/bloqueio/sessão; nenhuma consulta a mais).
 *
 * Entradas liberadas a quem está bloqueado:
 * - rotas públicas (login, refresh, logout, saúde): não passam pela autenticação, nada a fazer;
 * - rota do Core marcada `liberadaSemFilial` (só `eu/filial-cadastro`, para o admin/analista se destravar);
 * - sync: novidades e pull SÓ das entidades do Core marcadas `liberadoSemFilial` (a do próprio usuário), com carteira vazia e
 *   equipe = só o próprio; o push responde 403 inteiro (nada é gravado e a fila do aparelho fica pendente, sem perda).
 */

export const CODIGO_USUARIO_SEM_FILIAL = 'USUARIO_SEM_FILIAL';
/** Texto provisório (o mesmo do Core); a simulação aprovada do designer-ux o substitui. */
export const MENSAGEM_USUARIO_SEM_FILIAL = 'Seu usuário está sem filial. Peça ao administrador para informar a filial.';

/**
 * - `livre`: tem filial (ou o emissor não informa o estado: `sem_filial` ausente);
 * - `restrito`: sem filial numa entrada liberada (a rota segue, com o mínimo de dados);
 * - `bloqueado`: sem filial nas demais (403 `USUARIO_SEM_FILIAL`).
 */
export type AcessoSemFilial = 'livre' | 'restrito' | 'bloqueado';

/** RN-CORE-39: decide o acesso de quem chega; `liberada` = a entrada está na lista de exceções. */
export function acessoSemFilial(usuario: { sem_filial?: boolean | undefined }, liberada: boolean): AcessoSemFilial {
  if (usuario.sem_filial !== true) return 'livre';
  return liberada ? 'restrito' : 'bloqueado';
}

/** Só o Core declara exceção à guarda (a regra é dele): rota `liberadaSemFilial` ou provedor `liberadoSemFilial` fora do Core é erro. */
export function problemasLiberadoSemFilial(modulo: string, rotulo: string, marcado: boolean | undefined): string[] {
  if (marcado === undefined) return [];
  if (marcado !== true) return [`${rotulo}: a exceção ao bloqueio sem filial só aceita true`];
  return modulo === 'core' ? [] : [`${rotulo}: só o core libera rota ou entidade ao usuário sem filial (RN-CORE-39)`];
}
