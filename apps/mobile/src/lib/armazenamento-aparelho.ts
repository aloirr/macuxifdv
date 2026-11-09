/**
 * Ligação do shell com os armazenamentos SQLite do aparelho (T-0088 A1; desenho docs/desenho/T-0088.md §1 a §5 e §9;
 * ADR 0003, adendo de 2026-11-06). A regra (escolha da tabela do §4, uma instância por arquivo, passagem do
 * AsyncStorage, espelho, remoção da origem, logout e bloqueio) está no SDK (`criarArmazenamentosDoAparelho`); aqui fica
 * só o que o shell monta em volta dela, puro (sem React Native nem expo), para o Vitest:
 * - o `SistemaSqlite` sobre a pasta do expo-sqlite (listar sem lançar, apagar registrando o erro);
 * - as opções do adaptador iguais às do app e da tela de medição (`buscaSemEsperarIndexacao: true`);
 * - a trava `EXPO_PUBLIC_ARMAZENAMENTO=asyncstorage`;
 * - o resumo e as linhas do Diagnóstico do Perfil, e a barra da tela "Atualizando os dados do aparelho…".
 */
import {
  MODULOS,
  type AberturaArmazenamento,
  type DriverSqlite,
  type IndiceBusca,
  type MarcadorPassagem,
  type MigracaoAparelho,
  type ModuloId,
  type MotivoReserva,
  type OpcoesArmazenamentoSqlite,
  type ProgressoPassagem,
  type SistemaSqlite,
} from '@macuxi/platform-sdk';
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';

/** Trava de emergência (desenho §4): só vale para quem ainda não passou para o SQLite (sem espelho). */
export function forcarAsyncStorage(valor: string | undefined | null): boolean {
  return (valor ?? '').trim().toLowerCase() === 'asyncstorage';
}

/** O que o adaptador precisa do shell da variante (`shellDaVariante`). */
export interface ShellDoArmazenamento {
  migracoesAparelho: Partial<Record<ModuloId, readonly MigracaoAparelho[]>>;
  registroSync: {
    entidadesAtivas(modulos: readonly ModuloId[]): ReadonlyArray<{ nome: string; modulo: ModuloId }>;
  };
  indicesBusca: readonly IndiceBusca[];
}

/**
 * Opções do adaptador SQLite do shell (desenho §1.3): as mesmas no motor do usuário e na tela oculta de medição. Todas
 * as entidades de todos os módulos (as tabelas existem antes das migrações de cada módulo) e a busca que não espera o
 * L-1 (§5: responde `indexando` e o Catálogo varre até o índice ficar pronto).
 */
export function opcoesDoAdaptador(
  shell: ShellDoArmazenamento,
  registrarErro: (mensagem: string) => void,
): OpcoesArmazenamentoSqlite {
  return {
    migracoesModulos: shell.migracoesAparelho,
    entidades: shell.registroSync.entidadesAtivas(MODULOS).map((e) => ({ nome: e.nome, modulo: e.modulo })),
    indicesBusca: shell.indicesBusca,
    registrarErro,
    buscaSemEsperarIndexacao: true,
  };
}

/** A pasta dos bancos do expo-sqlite, injetada (`services/sqlite-expo.ts`). */
export interface PastaSqlite {
  abrir(arquivo: string): Promise<DriverSqlite>;
  /** Nomes dos arquivos da pasta. Pode lançar (pasta ainda não criada): vira lista vazia. */
  nomes(): readonly string[] | Promise<readonly string[]>;
  apagar(arquivo: string): Promise<void>;
}

/**
 * `SistemaSqlite` do SDK sobre a pasta do expo-sqlite. `listar` nunca lança (sem pasta = nenhum banco). `apagar` registra
 * a falha e segue: no bloqueio do aparelho (RN-CORE-15) um arquivo que não sai não impede os outros de sair.
 */
export function criarSistemaSqlite(p: PastaSqlite, registrarErro: (mensagem: string) => void): SistemaSqlite {
  return {
    abrir: (arquivo) => p.abrir(arquivo),
    async listar() {
      try {
        return [...(await p.nomes())];
      } catch {
        return [];
      }
    },
    async apagar(arquivo) {
      try {
        await p.apagar(arquivo);
      } catch (e) {
        registrarErro(
          `apagar o banco local ${arquivo} falhou: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  };
}

/** O que o Diagnóstico guarda da abertura (sem a instância do armazenamento). */
export type ResumoArmazenamento =
  | { tipo: 'sqlite'; arquivo: string; passagem: MarcadorPassagem; origemApagada: boolean }
  | { tipo: 'asyncstorage'; motivo: MotivoReserva; detalhe?: string }
  | { tipo: 'erro'; arquivo: string | null; detalhe: string };

export function resumoDaAbertura(a: AberturaArmazenamento): ResumoArmazenamento {
  if (a.tipo === 'sqlite')
    return { tipo: 'sqlite', arquivo: a.arquivo, passagem: a.passagem, origemApagada: a.origemApagada };
  if (a.tipo === 'asyncstorage')
    return { tipo: 'asyncstorage', motivo: a.motivo, ...(a.detalhe ? { detalhe: a.detalhe } : {}) };
  return { tipo: 'erro', arquivo: a.arquivo, detalhe: a.detalhe };
}

export const TEXTO_MOTIVO_RESERVA: Readonly<Record<MotivoReserva, string>> = {
  sem_sqlite: 'este APK não tem o SQLite',
  ids_invalidos: 'sessão sem id de usuário',
  forcado: 'forçado pelo build (EXPO_PUBLIC_ARMAZENAMENTO)',
  abertura_falhou: 'o banco local não abriu; tenta de novo na próxima abertura',
  passagem_abortada: 'a passagem dos dados não terminou; tenta de novo na próxima abertura',
};

/** Linhas técnicas do Diagnóstico do Perfil (desenho §4: "armazenamento: AsyncStorage (reserva)" e o marcador). */
export function linhasDoArmazenamento(
  r: ResumoArmazenamento | null,
  quando: (iso: string) => string,
): string[] {
  if (!r) return ['Armazenamento: ainda não aberto nesta sessão'];
  if (r.tipo === 'asyncstorage')
    return [
      `Armazenamento: AsyncStorage (reserva) · ${TEXTO_MOTIVO_RESERVA[r.motivo]}`,
      ...(r.detalhe ? [`  ${r.detalhe}`] : []),
    ];
  if (r.tipo === 'erro')
    return [`Armazenamento: SQLite com erro${r.arquivo ? ` (${r.arquivo})` : ''}`, `  ${r.detalhe}`];
  const m = r.passagem;
  const c = m.contagens;
  return [
    `Armazenamento: SQLite (${r.arquivo})`,
    `  passagem do AsyncStorage: ${m.estado === 'concluida' ? 'concluída' : 'em andamento'}${m.concluida_em ? ` em ${quando(m.concluida_em)}` : ''} · tentativa ${m.tentativas}${m.pull === 'refazer' ? ' · dados de consulta baixados de novo' : ''}`,
    ...(c
      ? [`  copiado: fila e rascunhos ${c.a} · estado ${c.b} · consulta ${c.c} (${c.linhas} linhas)`]
      : []),
    `  dados antigos do AsyncStorage: ${r.origemApagada ? 'removidos' : 'guardados até o 1º sync completo (ou 7 dias)'}`,
  ];
}

/**
 * Barra da tela de preparo (0 a 100): a fila, os rascunhos (A) e o estado (B) são poucos e vêm primeiro (até 20 %); os
 * dados de consulta (C, as linhas do pull) pesam o resto. Sem progresso ainda = 0.
 */
export function percentualDaPassagem(p: ProgressoPassagem | null): number {
  if (!p) return 0;
  const fracao = p.total > 0 ? Math.min(1, Math.max(0, p.feitos / p.total)) : 1;
  const [inicio, peso] = p.grupo === 'A' ? [0, 10] : p.grupo === 'B' ? [10, 10] : [20, 80];
  return Math.round(inicio + peso * fracao);
}

/** Espera antes de mostrar a tela de preparo: a abertura de quem já passou (ou da instalação nova) não pisca a tela. */
export const ESPERA_TELA_PREPARO_MS = 400;

// ---------- textos da tela de preparo e da tela de erro (sem nome de módulo, entidade ou chave) ----------

// Textos neutros para todos os perfis (vendedor, promotor e supervisor; o promotor não faz pedido, RN-PRO-01): "o que
// você registrou". "Nada se perde" é verdade nos três grupos: a passagem retoma na próxima abertura e a origem no
// AsyncStorage fica intacta até o 1º sync completo (confirmado pelo engenheiro-software na revisão da T-0088).
export const TITULO_PREPARO = 'Atualizando os dados do aparelho…';
export const TEXTO_PREPARO =
  'O que você registrou no aparelho continua guardado. Isso acontece uma vez só, depois da atualização do app.';
export const AVISO_PREPARO =
  'Deixe o app aberto até terminar. Se ele fechar, nada se perde: continua na próxima vez que abrir.';
/** Rótulo da barra para o leitor de tela (o número ao lado fica fora do leitor, para não ler duas vezes). */
export const ROTULO_BARRA_PREPARO = 'Progresso da atualização';

/** Frase do passo em andamento. */
export function fraseDaPassagem(p: ProgressoPassagem | null): string {
  if (!p || p.grupo === 'A') return 'Copiando o que você registrou no aparelho';
  if (p.grupo === 'B') return 'Copiando suas configurações';
  return 'Copiando produtos e clientes';
}

export const TITULO_ERRO_ARMAZENAMENTO = 'Não foi possível abrir os dados do aparelho';
export const TEXTO_ERRO_ARMAZENAMENTO =
  'O que você registrou continua guardado neste aparelho. Toque em Tentar de novo. Se não abrir, envie o detalhe abaixo ao suporte.';
/** Linha acima do botão depois de uma nova tentativa que também falhou. */
export const TEXTO_ERRO_DE_NOVO =
  'Ainda não abriu. Tente de novo em instantes ou envie o detalhe ao suporte.';
export const ROTULO_ENVIAR_SUPORTE = 'Enviar o detalhe ao suporte';

/**
 * Texto do "Enviar o detalhe ao suporte" (Share do sistema). Só o título e o detalhe técnico do SDK (que leva, no máximo,
 * o nome do arquivo: UUID ou hash do usuário, id pseudônimo); por garantia, e-mail, CPF, CNPJ e telefone saem mascarados
 * (máscara única `mascararDadoPessoal` do `@macuxi/comum`).
 */
export function mensagemParaSuporte(detalhe: string): string {
  return `Macuxi FDV · ${TITULO_ERRO_ARMAZENAMENTO}\n${mascararDadoPessoal(detalhe)}`;
}

/**
 * Roda `fn` quando a tela fica livre (desenho §5: `busca.finalizar()` depois do `carregar()`, sem `await`). O
 * `InteractionManager.runAfterInteractions` do desenho está obsoleto no RN 0.86 (aviso no console e remoção anunciada);
 * o substituto indicado pelo próprio RN é o `requestIdleCallback`. Sem ele: `setTimeout` 0.
 */
export function agendarSemPressa(
  fn: () => void,
  g: { requestIdleCallback?: unknown; setTimeout?: unknown } = globalThis,
): void {
  if (typeof g.requestIdleCallback === 'function') {
    (g.requestIdleCallback as (this: unknown, f: () => void) => unknown).call(g, fn);
    return;
  }
  (g.setTimeout as (this: unknown, f: () => void, ms: number) => unknown).call(g, fn, 0);
}
