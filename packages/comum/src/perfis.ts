/**
 * RD-0014 (T-0111): FONTE ÚNICA do nome dos 7 perfis padrão, o mesmo no BKO, no portal, no login e nos apps. Puro, sem
 * dependência: o `@macuxi/platform-sdk` (`ROTULO_PERFIL`) e o kit `@macuxi/ui` (`comum/perfis.ts`) reexportam daqui.
 * Spec: docs/design/perfis-de-acesso.md §0.1.
 *
 * - **Curto**: o nome do perfil em toda tela (chip, coluna, seletor, mensagem do login, auditoria).
 * - **Longo**: só onde o perfil é apresentado uma vez, com espaço (cabeçalho do Perfil no app, dica do chip, convite).
 * O código (`vendedor`, `admin`…) nunca aparece na tela.
 */

/** Os 7 perfis padrão, na ordem de tela. Igual a `PERFIS` do platform-sdk (o teste do SDK confere). */
export const ORDEM_PERFIL_PADRAO = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
export type PerfilPadrao = (typeof ORDEM_PERFIL_PADRAO)[number];

/** Nome do perfil em toda tela (1 palavra, cabe num chip de 360 dp). */
export const ROTULO_PERFIL_CURTO: Readonly<Record<PerfilPadrao, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente',
  admin: 'Admin',
};

/** Nome por extenso, para apresentar o perfil uma vez. */
export const ROTULO_PERFIL_LONGO: Readonly<Record<PerfilPadrao, string>> = {
  vendedor: 'Vendedor de campo',
  promotor: 'Promotor de trade marketing',
  supervisor: 'Supervisor de vendas',
  gerente: 'Gerente comercial',
  analista: 'Analista comercial',
  assistente: 'Assistente de backoffice',
  admin: 'Administrador da empresa',
};
