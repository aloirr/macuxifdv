/**
 * Cargo do perfil de acesso no core (ADR 0049; RN-CORE-53 a RN-CORE-57; migração 0069). A lista fixa, o schema, o cargo de cada
 * base e o que o cadastro pede por cargo (`HIERARQUIA_DO_CARGO`) são do SDK; aqui ficam só o rótulo da tela e os códigos e
 * frases dos erros da hierarquia.
 */
import { type Cargo } from '@macuxi/platform-sdk';

export { CARGOS, CargoSchema, cargoDaBase, HIERARQUIA_DO_CARGO, type Cargo } from '@macuxi/platform-sdk';

export const ROTULO_CARGO: Readonly<Record<Cargo, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  administrativo: 'Administrativo',
};

/** Novo perfil sem cargo (a tela; a API recusa pelo contrato). */
export const MENSAGEM_CARGO_OBRIGATORIO = 'Escolha o cargo.';

/** Códigos de erro da hierarquia (422). Os dois `promotor_*` são também os nomes das restrições do banco (23514 no COMMIT). */
export const CODIGOS_HIERARQUIA = {
  supervisorObrigatorio: 'HIERARQUIA_SUPERVISOR_OBRIGATORIO',
  supervisorInvalido: 'HIERARQUIA_SUPERVISOR_INVALIDO',
  gerenteObrigatorio: 'HIERARQUIA_GERENTE_OBRIGATORIO',
  gerenteInvalido: 'HIERARQUIA_GERENTE_INVALIDO',
  gerenteDoSupervisor: 'HIERARQUIA_GERENTE_DO_SUPERVISOR',
  equipeObrigatoria: 'HIERARQUIA_EQUIPE_OBRIGATORIA',
  codigoErpObrigatorio: 'USUARIO_CODIGO_ERP_OBRIGATORIO',
} as const;

export const MENSAGENS_HIERARQUIA = {
  supervisorObrigatorio: 'Escolha o supervisor.',
  supervisorInvalido: 'Escolha um supervisor da lista.',
  gerenteObrigatorio: 'Escolha o gerente.',
  gerenteInvalido: 'Escolha um gerente da lista.',
  gerenteDoSupervisor: 'O gerente precisa ser o gerente do supervisor escolhido.',
  equipeObrigatoria: 'Informe o nome da equipe.',
  codigoErpObrigatorio: 'Informe o código no ERP.',
} as const;
