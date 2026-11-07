/**
 * Armazenamentos SQLite do aparelho (desenho T-0088 §1, §3 e §4; ADR 0003, adendo de 2026-11-06). TS puro: o sistema de
 * arquivos do SQLite é injetado (expo-sqlite no shell, `node:sqlite` nos testes).
 *
 * - Um arquivo por usuário e tenant (`arquivoDoUsuario`) e UMA instância do adaptador por arquivo no processo: o motor do
 *   app, a tarefa em segundo plano (ADR 0017) e a leitura do lease usam a mesma (uma fila de escrita só, sem
 *   `database is locked`). Aberturas simultâneas do mesmo arquivo esperam a mesma promessa (a passagem roda uma vez).
 * - Escolha (§4, `escolherArmazenamento`): com o espelho `sqlite` gravado, o AsyncStorage NUNCA volta a ser fonte daquele
 *   usuário (a fila verdadeira está no SQLite): falha vira `erro` (tela "Tentar de novo"), não reserva.
 * - Passagem (`passarDoAsyncStorage`) antes de devolver o armazenamento; abortada sem espelho = reserva no AsyncStorage
 *   nesta sessão; concluída = espelho gravado e a origem removida quando a regra deixa (`apagarOrigemSePossivel`).
 * - Logout: `fechar(arquivo)` fecha sem apagar (a fila fica para o próximo login). Bloqueio do aparelho (RN-CORE-15):
 *   `apagarTodos()` fecha tudo e apaga os bancos de TODOS os usuários (`bancosDeUsuario`).
 */
import type { ArmazenamentoSync } from '../motor-sync';
import { criarArmazenamentoSqlite, type ArmazenamentoSqlite, type OpcoesArmazenamentoSqlite } from './armazenamento';
import { arquivoDoUsuario, bancosDeUsuario } from './arquivo';
import type { DriverSqlite } from './driver';
import {
  apagarOrigemSePossivel,
  ORIGEM_VAZIA,
  passarDoAsyncStorage,
  type MarcadorPassagem,
  type ProgressoPassagem,
} from './passagem';

/** Pasta do SQLite do aparelho (no shell: `openDatabaseAsync`, a listagem da pasta e `deleteDatabaseAsync`). */
export interface SistemaSqlite {
  abrir(arquivo: string): Promise<DriverSqlite>;
  /** Nomes dos arquivos na pasta (com os anexos `-wal`/`-shm`). */
  listar(): Promise<readonly string[]>;
  /** Apaga o banco e os anexos dele. */
  apagar(arquivo: string): Promise<void>;
}

/** Espelho fora do SQLite (AsyncStorage, `chaveEspelhoArmazenamento`): gravado depois da passagem concluída. */
export interface EspelhoArmazenamento {
  arquivo: string;
  desde: string;
}

export interface GuardaEspelho {
  ler(): Promise<EspelhoArmazenamento | null>;
  gravar(e: EspelhoArmazenamento): Promise<void>;
}

/** Chave global do shell no AsyncStorage (sai no bloqueio junto com as `fv:u:`). */
export const chaveEspelhoArmazenamento = (usuarioId: string) => `fv:u:${usuarioId}:armazenamento`;

/** Por que a sessão ficou no AsyncStorage (o Diagnóstico mostra "armazenamento: AsyncStorage (reserva)"). `ids_invalidos`: sessão sem id de usuário (qualquer id não vazio vira nome de arquivo, `arquivoDoUsuario`). */
export type MotivoReserva = 'sem_sqlite' | 'ids_invalidos' | 'forcado' | 'abertura_falhou' | 'passagem_abortada';

export type EscolhaArmazenamento =
  | { tipo: 'sqlite'; arquivo: string }
  | { tipo: 'asyncstorage'; motivo: MotivoReserva }
  | { tipo: 'erro'; detalhe: string };

/** Tabela do §4 do desenho, sem efeito colateral. */
export function escolherArmazenamento(c: {
  sqliteDisponivel: boolean;
  arquivo: string | null;
  forcarAsyncStorage?: boolean;
  espelho: EspelhoArmazenamento | null;
}): EscolhaArmazenamento {
  if (c.espelho) {
    // já passou: a trava de emergência não vale e não há reserva
    if (!c.sqliteDisponivel) return { tipo: 'erro', detalhe: 'os dados deste usuário estão no SQLite, indisponível neste APK' };
    if (!c.arquivo) return { tipo: 'erro', detalhe: 'sessão sem id de usuário, com os dados já no SQLite' };
    return { tipo: 'sqlite', arquivo: c.arquivo };
  }
  if (!c.sqliteDisponivel) return { tipo: 'asyncstorage', motivo: 'sem_sqlite' };
  if (!c.arquivo) return { tipo: 'asyncstorage', motivo: 'ids_invalidos' };
  if (c.forcarAsyncStorage) return { tipo: 'asyncstorage', motivo: 'forcado' };
  return { tipo: 'sqlite', arquivo: c.arquivo };
}

export type AberturaArmazenamento =
  | {
      tipo: 'sqlite';
      arquivo: string;
      armazenamento: ArmazenamentoSqlite;
      /** Marcador `concluida` (contagens; `pull: 'refazer'` = a tela de carga pede conexão se não houver dados). */
      passagem: MarcadorPassagem;
      /** A origem no AsyncStorage já pôde sair (marcador concluído e sync completo depois, ou 7 dias). */
      origemApagada: boolean;
    }
  | { tipo: 'asyncstorage'; motivo: MotivoReserva; armazenamento: ArmazenamentoSync; detalhe?: string }
  | { tipo: 'erro'; arquivo: string | null; detalhe: string };

export interface UsuarioDoAparelho {
  usuarioId: string;
  /** Sem tenant (demonstração) = `demo`. */
  tenantId?: string | null;
  /** Adaptador AsyncStorage do usuário (`macuxi:u:<id>:`): origem da passagem e reserva. */
  asyncStorage: ArmazenamentoSync;
  espelho: GuardaEspelho;
  fuso?: string;
  aoProgredir?: (p: ProgressoPassagem) => void;
}

export interface OpcoesArmazenamentosDoAparelho {
  sistema: SistemaSqlite;
  /** Do shell: `migracoesModulos`, `entidades`, `indicesBusca`, `registrarErro`, `buscaSemEsperarIndexacao: true`. */
  opcoes: OpcoesArmazenamentoSqlite;
  /** `expoSqliteDisponivel()` no shell. */
  sqliteDisponivel: boolean;
  /** `EXPO_PUBLIC_ARMAZENAMENTO=asyncstorage`: só para quem ainda não passou (sem espelho). */
  forcarAsyncStorage?: boolean;
  registrarErro?: (mensagem: string) => void;
  agora?: () => Date;
}

export interface ArmazenamentosDoAparelho {
  /** Escolha, abertura (uma instância por arquivo), passagem, espelho e remoção da origem. */
  abrir(u: UsuarioDoAparelho): Promise<AberturaArmazenamento>;
  /** Logout / troca de usuário: fecha sem apagar (espera as escritas da fila do adaptador). */
  fechar(arquivo: string): Promise<void>;
  fecharTodos(): Promise<void>;
  /** Bloqueio do aparelho (RN-CORE-15): fecha tudo e apaga os bancos de todos os usuários. Devolve os apagados. */
  apagarTodos(): Promise<string[]>;
  /** Arquivos com instância aberta (ou abrindo) neste processo. */
  abertos(): string[];
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function criarArmazenamentosDoAparelho(o: OpcoesArmazenamentosDoAparelho): ArmazenamentosDoAparelho {
  const agora = o.agora ?? (() => new Date());
  const log = o.registrarErro ?? o.opcoes.registrarErro ?? (() => {});
  /** Arquivo → instância (promessa: duas aberturas ao mesmo tempo recebem a mesma). */
  const instancias = new Map<string, Promise<{ bruto: ArmazenamentoSqlite; envolto: ArmazenamentoSqlite }>>();
  /** Arquivo → abertura completa (passagem incluída). Só fica guardada a que deu `sqlite`. */
  const aberturas = new Map<string, Promise<AberturaArmazenamento>>();

  const esquecer = (arquivo: string) => {
    instancias.delete(arquivo);
    aberturas.delete(arquivo);
  };

  const fechar = async (arquivo: string) => {
    const p = instancias.get(arquivo);
    esquecer(arquivo);
    if (!p) return;
    const i = await p.catch(() => null);
    await i?.bruto.fechar().catch((e: unknown) => log(`fechar o banco local falhou: ${mensagem(e)}`));
  };

  const instancia = (arquivo: string): Promise<ArmazenamentoSqlite> => {
    const existente = instancias.get(arquivo);
    if (existente) return existente.then((i) => i.envolto);
    const p = (async () => {
      const bruto = criarArmazenamentoSqlite(await o.sistema.abrir(arquivo), o.opcoes);
      try {
        await bruto.pronto;
      } catch (e) {
        await bruto.fechar().catch(() => undefined);
        throw e;
      }
      // `fechar()` de quem usa também tira a instância do registro (a próxima abertura cria outra)
      const envolto: ArmazenamentoSqlite = { ...bruto, fechar: () => fechar(arquivo) };
      return { bruto, envolto };
    })();
    instancias.set(arquivo, p);
    p.catch(() => {
      if (instancias.get(arquivo) === p) instancias.delete(arquivo);
    });
    return p.then((i) => i.envolto);
  };

  const abrirSqlite = async (u: UsuarioDoAparelho, arquivo: string, espelho: EspelhoArmazenamento | null) => {
    const falhou = (motivo: MotivoReserva, detalhe: string): AberturaArmazenamento =>
      espelho ? { tipo: 'erro', arquivo, detalhe } : { tipo: 'asyncstorage', motivo, armazenamento: u.asyncStorage, detalhe };
    let a: ArmazenamentoSqlite;
    try {
      a = await instancia(arquivo);
    } catch (e) {
      log(`abrir o banco local falhou: ${mensagem(e)}`);
      return falhou('abertura_falhou', mensagem(e));
    }
    // espelho de outro arquivo (mesmo usuário, outro tenant): a origem já foi passada para lá
    const origem = espelho && espelho.arquivo !== arquivo ? ORIGEM_VAZIA : u.asyncStorage;
    const r = await passarDoAsyncStorage({ origem, destino: a, fuso: u.fuso, aoProgredir: u.aoProgredir, registrarErro: log, agora });
    if (r.desfecho === 'abortada') {
      await fechar(arquivo);
      return falhou('passagem_abortada', `${r.etapa}: ${r.erro}`);
    }
    if (!espelho)
      try {
        await u.espelho.gravar({ arquivo, desde: agora().toISOString() });
      } catch (e) {
        // o marcador `concluida` já impede recopiar; o espelho é gravado de novo na próxima abertura
        log(`gravar o espelho do armazenamento falhou: ${mensagem(e)}`);
      }
    let origemApagada = false;
    try {
      origemApagada = await apagarOrigemSePossivel({ origem: u.asyncStorage, destino: a, agora });
    } catch (e) {
      log(`remover os dados antigos do AsyncStorage falhou (tenta de novo na próxima abertura): ${mensagem(e)}`);
    }
    return { tipo: 'sqlite', arquivo, armazenamento: a, passagem: r.marcador, origemApagada } satisfies AberturaArmazenamento;
  };

  return {
    async abrir(u) {
      const arquivo = arquivoDoUsuario(u);
      const espelho = await u.espelho.ler().catch(() => null);
      const escolha = escolherArmazenamento({
        sqliteDisponivel: o.sqliteDisponivel,
        arquivo,
        forcarAsyncStorage: o.forcarAsyncStorage,
        espelho,
      });
      if (escolha.tipo === 'asyncstorage') return { tipo: 'asyncstorage', motivo: escolha.motivo, armazenamento: u.asyncStorage };
      if (escolha.tipo === 'erro') return { tipo: 'erro', arquivo, detalhe: escolha.detalhe };
      const emCurso = aberturas.get(escolha.arquivo);
      if (emCurso) return emCurso;
      const p = abrirSqlite(u, escolha.arquivo, espelho);
      aberturas.set(escolha.arquivo, p);
      void p.then(
        (r) => {
          if (r.tipo !== 'sqlite' && aberturas.get(escolha.arquivo) === p) aberturas.delete(escolha.arquivo);
        },
        () => {
          if (aberturas.get(escolha.arquivo) === p) aberturas.delete(escolha.arquivo);
        },
      );
      return p;
    },
    fechar,
    async fecharTodos() {
      for (const arquivo of [...instancias.keys()]) await fechar(arquivo);
    },
    async apagarTodos() {
      for (const arquivo of [...instancias.keys()]) await fechar(arquivo);
      const bancos = bancosDeUsuario(await o.sistema.listar());
      for (const b of bancos) await o.sistema.apagar(b);
      return bancos;
    },
    abertos: () => [...instancias.keys()].sort(),
  };
}
