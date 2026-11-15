/**
 * RN-CORE-58 (T-0175): vínculo do vendedor do ERP ao usuário do BKO pelo código do ERP (`external_id`).
 * Regra: o vendedor que a carga do ERP criou como usuário PROVISÓRIO (e-mail `@sem-email.invalid`, carteira própria) é ligado
 * pelo admin a um usuário real do mesmo tenant e do mesmo perfil (vendedor com vendedor, promotor com promotor). O real
 * ganha o `external_id` do provisório, recebe a carteira (sem duplicar cliente e papel que já tenha) e as demais referências
 * a `core.usuario`; o provisório é desativado e sai da lista, e cada cliente movido publica `core.cliente.atualizado@1`.
 * Recusa (422): quem não é provisório, provisório sem código, real com outro código, perfis incompatíveis, mesmo usuário,
 * tenants diferentes ou real que também é provisório. Repetir é idempotente. A carga seguinte nunca desfaz o vínculo
 * (casa pelo `external_id`, que agora é do real). Função pura, sem banco.
 */

export const SUFIXO_EMAIL_PROVISORIO = '@sem-email.invalid';

/** Provisório = e-mail gerado pela carga do ERP (`emailDoVendedorErp`) quando o vendedor veio sem e-mail. */
export const ehUsuarioProvisorio = (email: string): boolean => email.trim().toLowerCase().endsWith(SUFIXO_EMAIL_PROVISORIO);

export interface UsuarioDoVinculo {
  id: string;
  tenant_id: string;
  perfil: string;
  email: string;
  external_id: string | null;
  /** O provisório já foi vinculado antes (desativado, ainda com o código): repetir não faz nada. */
  vinculado?: boolean;
}

export interface CarteiraDoVinculo {
  id: string;
  cliente_id: string;
  papel: 'vendedor' | 'promotor';
}

/** Tabelas e colunas que apontam para `core.usuario` e vão para o usuário real no vínculo (levantamento em db/migrations). */
export const REFERENCIAS_DO_VINCULO = [
  { tabela: 'core.carteira', coluna: 'usuario_id' },
  { tabela: 'core.nota_erp', coluna: 'usuario_id' },
  { tabela: 'core.rota', coluna: 'usuario_id' },
  { tabela: 'core.meta', coluna: 'usuario_id' },
  { tabela: 'core.indicador_diario', coluna: 'usuario_id' },
] as const;

export const CODIGOS_VINCULO = {
  naoProvisorio: 'VINCULO_NAO_PROVISORIO',
  semCodigoErp: 'VINCULO_SEM_CODIGO_ERP',
  realComOutroCodigo: 'VINCULO_REAL_COM_OUTRO_CODIGO',
  perfilIncompativel: 'VINCULO_PERFIL_INCOMPATIVEL',
  mesmoUsuario: 'VINCULO_MESMO_USUARIO',
  outroTenant: 'VINCULO_OUTRO_TENANT',
  realProvisorio: 'VINCULO_REAL_PROVISORIO',
} as const;

type CodigoVinculo = (typeof CODIGOS_VINCULO)[keyof typeof CODIGOS_VINCULO];

export type PlanoDoVinculo =
  | { ok: false; codigo: CodigoVinculo; mensagem: string }
  | {
      ok: true;
      ja_vinculado: boolean;
      external_id: string;
      provisorio_id: string;
      real_id: string;
      /** Linhas de carteira do provisório que passam ao real. */
      carteira_mover: string[];
      /** Linhas do provisório cujo cliente e papel o real já tem: só saem do provisório (sem duplicar). */
      carteira_descartar: string[];
      referencias: typeof REFERENCIAS_DO_VINCULO;
      desativar_provisorio: boolean;
      /** Clientes movidos: um `core.cliente.atualizado@1` por item. */
      eventos_cliente: string[];
    };

const recusa = (codigo: CodigoVinculo, mensagem: string): PlanoDoVinculo => ({ ok: false, codigo, mensagem });

export function planejarVinculoErp(e: {
  provisorio: UsuarioDoVinculo;
  real: UsuarioDoVinculo;
  carteiraProvisorio: readonly CarteiraDoVinculo[];
  carteiraReal: readonly Pick<CarteiraDoVinculo, 'cliente_id' | 'papel'>[];
}): PlanoDoVinculo {
  const { provisorio: p, real: r } = e;
  if (p.id === r.id) return recusa(CODIGOS_VINCULO.mesmoUsuario, 'Escolha um usuário diferente do vendedor provisório.');
  if (p.tenant_id !== r.tenant_id) return recusa(CODIGOS_VINCULO.outroTenant, 'Os dois usuários precisam ser da mesma empresa.');
  if (!ehUsuarioProvisorio(p.email)) return recusa(CODIGOS_VINCULO.naoProvisorio, 'Este usuário não é provisório. Só o vendedor criado pela carga do ERP sem e-mail pode ser vinculado.');
  if (ehUsuarioProvisorio(r.email)) return recusa(CODIGOS_VINCULO.realProvisorio, 'Escolha um usuário com e-mail real, não outro provisório.');
  const codigo = p.external_id?.trim() ?? '';
  if (codigo === '') return recusa(CODIGOS_VINCULO.semCodigoErp, 'O vendedor provisório não tem Código no ERP. Confira o cadastro.');
  if (p.perfil !== r.perfil || (r.perfil !== 'vendedor' && r.perfil !== 'promotor')) return recusa(CODIGOS_VINCULO.perfilIncompativel, 'Os perfis não combinam. Vincule vendedor com vendedor e promotor com promotor.');
  const base = { external_id: codigo, provisorio_id: p.id, real_id: r.id, referencias: REFERENCIAS_DO_VINCULO } as const;
  if (r.external_id !== null && r.external_id.trim() !== '') {
    if (r.external_id.trim() === codigo && p.vinculado) return { ok: true, ja_vinculado: true, ...base, carteira_mover: [], carteira_descartar: [], desativar_provisorio: false, eventos_cliente: [] };
    return recusa(CODIGOS_VINCULO.realComOutroCodigo, 'O usuário escolhido já tem outro Código no ERP. Limpe o código dele em Editar antes de vincular.');
  }
  const ja = new Set(e.carteiraReal.map((x) => `${x.cliente_id}|${x.papel}`));
  const mover: string[] = [];
  const descartar: string[] = [];
  const eventos: string[] = [];
  for (const l of e.carteiraProvisorio) {
    if (ja.has(`${l.cliente_id}|${l.papel}`)) {
      descartar.push(l.id);
      continue;
    }
    ja.add(`${l.cliente_id}|${l.papel}`);
    mover.push(l.id);
    if (!eventos.includes(l.cliente_id)) eventos.push(l.cliente_id);
  }
  return { ok: true, ja_vinculado: false, ...base, carteira_mover: mover, carteira_descartar: descartar, desativar_provisorio: true, eventos_cliente: eventos };
}

/**
 * RN-CORE-58: o e-mail que a carga do ERP pode gravar num usuário que já casa pelo `external_id`. Só troca o e-mail PROVISÓRIO
 * por um e-mail real que ninguém usa; nunca troca e-mail real (o do usuário vinculado) e nunca grava o provisório por cima de um real.
 * Devolve `null` quando o e-mail fica como está.
 */
export function emailQueACargaPodeGravar(e: { emailAtual: string; emailDoErp: string; erpProvisorio: boolean; emailLivre: boolean }): string | null {
  if (e.erpProvisorio || !e.emailLivre) return null;
  return ehUsuarioProvisorio(e.emailAtual) ? e.emailDoErp : null;
}
