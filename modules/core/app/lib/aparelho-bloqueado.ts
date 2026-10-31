/**
 * RN-CORE-15 no app: aparelho bloqueado vale para o tenant inteiro. Na próxima conexão (login ou refresh) a API
 * responde 423 `DISPOSITIVO_BLOQUEADO`; o app apaga os dados locais do tenant E a fila não enviada, mostra o aviso
 * e volta ao login. Puro: o shell entrega as ações (apagar, avisar, ir ao login) — ele guarda os dados e a sessão.
 * Perder a fila é intencional (aparelho perdido/roubado: nada do que estava nele pode sair depois do bloqueio).
 */
import { AVISO_APARELHO_LIMPO, CODIGO_DISPOSITIVO_BLOQUEADO } from '../../contracts';

/** O erro de transporte é o 423 de aparelho bloqueado? (`codigo` da API ou `code` do `HttpError` do app). */
export function ehAparelhoBloqueado(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { codigo?: unknown; code?: unknown };
  return x.codigo === CODIGO_DISPOSITIVO_BLOQUEADO || x.code === CODIGO_DISPOSITIVO_BLOQUEADO;
}

export interface AcoesAparelhoBloqueado {
  /** Apaga TODOS os dados locais do tenant (linhas, módulos, cursores) e a fila de itens e de arquivos. */
  apagarDadosLocais(): Promise<void>;
  /** Encerra a sessão guardada (tokens) neste aparelho. */
  encerrarSessao(): Promise<void>;
  /** Aviso na tela (precisa continuar visível no login). */
  avisar(mensagem: string): void;
  irParaLogin(): void;
}

/**
 * Se o erro é de aparelho bloqueado, limpa o aparelho, avisa e volta ao login; devolve `true`. Qualquer outro erro
 * devolve `false` e não toca em nada. A limpeza roda ANTES do aviso: se falhar, o erro sobe e a tela não finge que limpou.
 */
export async function tratarAparelhoBloqueado(erro: unknown, acoes: AcoesAparelhoBloqueado): Promise<boolean> {
  if (!ehAparelhoBloqueado(erro)) return false;
  await acoes.apagarDadosLocais();
  await acoes.encerrarSessao();
  acoes.avisar(AVISO_APARELHO_LIMPO);
  acoes.irParaLogin();
  return true;
}
