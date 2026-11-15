/**
 * Usuário sem filial de cadastro (T-0176; RN-CORE-39, ADR 0056; spec docs/design/filial-cadastro-venda §4, tela 13).
 *
 * - Login: a API autentica e devolve `usuario.sem_filial: true` na sessão. O app não entra: a sessão recém-criada é
 *   encerrada no servidor e a tela de login continua aberta, com os campos preenchidos e o aviso no lugar do erro.
 * - Já logado: qualquer rota ou o sync responde 403 `USUARIO_SEM_FILIAL`. O app sai da sessão SEM apagar nada (o banco do
 *   usuário e a fila offline ficam no aparelho, como no "Sair") e volta ao login com o mesmo aviso.
 * - Depois que o admin informa a filial, o mesmo "Entrar" funciona e o próximo login reabre o mesmo banco com a fila.
 *
 * Puro (sem React Native): sessão, sync e navegação são injetados por `state/plataforma.tsx`.
 */

/** Código do 403 da guarda global (`CODIGO_USUARIO_SEM_FILIAL` do SDK, ADR 0056). */
export const CODIGO_USUARIO_SEM_FILIAL = 'USUARIO_SEM_FILIAL';

/** Texto aprovado da tela 13 (R-20261115-104500). */
export const AVISO_SEM_FILIAL = 'Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial.';

/** 403 `USUARIO_SEM_FILIAL`, venha do cliente do shell (`HttpError.code`) ou do contrato do SDK (`ErroHttp.codigo`). */
export function ehUsuarioSemFilial(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { status?: unknown; code?: unknown; codigo?: unknown };
  return x.status === 403 && (x.code === CODIGO_USUARIO_SEM_FILIAL || x.codigo === CODIGO_USUARIO_SEM_FILIAL);
}

/**
 * A sessão do login veio com o usuário bloqueado? Leitura tolerante: o campo `sem_filial` entra no contrato da sessão com o
 * branch do Core (T-0176); ausente = emissor antigo = livre.
 */
export function sessaoSemFilial(usuario: object): boolean {
  return (usuario as { sem_filial?: unknown }).sem_filial === true;
}

export interface FontesSemFilial {
  /** Há sessão aberta agora (sem ela, o 403 é de uma chamada que sobrou e nada há a fazer). */
  temSessao(): boolean;
  /** E-mail de quem está logado, para o login reabrir preenchido. */
  email(): string | null;
  /** Espera a sincronização em curso terminar (o motor grava a fila antes de o arquivo fechar). */
  esperarSync(): Promise<unknown>;
  /** "Sair" do shell: fecha a sessão e o banco do usuário SEM apagar dados nem a fila. */
  sair(): Promise<void>;
  /** Liga o aviso da tela 13 no login, com o e-mail de quem saiu. */
  avisar(email: string | null): void;
  irParaLogin(): void;
}

/**
 * Tratador único do shell: várias chamadas recebendo o 403 ao mesmo tempo (fila, pull, módulos, telas) saem UMA vez.
 * Devolve `true` quando o erro era de usuário sem filial.
 */
export function criarTratadorSemFilial(f: FontesSemFilial): (erro: unknown) => Promise<boolean> {
  let emCurso: Promise<boolean> | null = null;
  return (erro) => {
    if (!ehUsuarioSemFilial(erro)) return Promise.resolve(false);
    if (emCurso) return emCurso;
    if (!f.temSessao()) return Promise.resolve(true);
    const email = f.email();
    emCurso = (async () => {
      f.avisar(email);
      await f.esperarSync().catch(() => undefined);
      await f.sair();
      f.irParaLogin();
      return true;
    })().finally(() => {
      emCurso = null;
    });
    return emCurso;
  };
}
