/**
 * Armazenamento do motor de sync do usuário (T-0088; desenho docs/desenho/T-0088.md; ADR 0003, adendo de 2026-11-06).
 *
 * - SQLite do aparelho, um arquivo por usuário e tenant (`macuxi-u-<usuario>-t-<tenant|demo>.db`), com UMA instância por
 *   arquivo no processo: o app aberto (`state/plataforma.tsx`, motor e lease) e a tarefa em segundo plano
 *   (`services/segundo-plano.ts`, ADR 0017) chamam `abrirArmazenamentoDoUsuario` e recebem a mesma promessa.
 * - Na 1ª abertura depois da atualização, a passagem do AsyncStorage antigo (`macuxi:u:<id>:*`) roda ANTES do motor, com o
 *   progresso para a tela "Atualizando os dados do aparelho…"; o espelho `fv:u:<id>:armazenamento` vai para o
 *   AsyncStorage e a origem sai quando a regra do SDK deixa (marcador concluído e 1 sync completo, ou 7 dias).
 * - Reserva: sem o SQLite no APK, sessão sem id de usuário, a trava `EXPO_PUBLIC_ARMAZENAMENTO=asyncstorage` ou a passagem
 *   abortada (sem espelho) = o adaptador AsyncStorage abaixo, como antes da T-0088.
 * A regra é do SDK (`criarArmazenamentosDoAparelho`); aqui fica só a ligação com o expo-sqlite e o AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  chaveEspelhoArmazenamento,
  criarArmazenamentosDoAparelho,
  type AberturaArmazenamento,
  type ArmazenamentosDoAparelho,
  type ArmazenamentoSync,
  type EspelhoArmazenamento,
  type ProgressoPassagem,
} from '@macuxi/platform-sdk';

import { criarSistemaSqlite, forcarAsyncStorage, opcoesDoAdaptador } from '@/lib/armazenamento-aparelho';
import { shellDaVariante } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';

import { abrirDriverExpo, apagarBancoExpoOuLancar, expoSqliteDisponivel, listarBancosExpo } from './sqlite-expo';
import { readJson, writeJson } from './storage';

/**
 * Adaptador do motor sobre o AsyncStorage, isolado por usuário (`macuxi:u:<id>:`): origem da passagem para o SQLite e
 * reserva da sessão (desenho §4).
 */
export function armazenamentoDoUsuario(userId: string): ArmazenamentoSync {
  const prefixo = `macuxi:u:${userId}:`;
  return {
    ler: (chave) => readJson(prefixo + chave),
    gravar: (chave, valor) => writeJson(prefixo + chave, valor),
    remover: (chave) => writeJson(prefixo + chave, null),
    async chaves(p) {
      try {
        const todas = await AsyncStorage.getAllKeys();
        return todas.filter((k) => k.startsWith(prefixo + p)).map((k) => k.slice(prefixo.length));
      } catch {
        return [];
      }
    },
  };
}

/** Log técnico do armazenamento: o SDK só manda nomes de chave, contagens e a mensagem do erro (nada digitado). */
const registrarErro = (mensagem: string) => console.warn(`[armazenamento] ${mensagem}`);

let aparelhoDoProcesso: ArmazenamentosDoAparelho | null = null;

/** Os armazenamentos SQLite deste processo (criados na 1ª abertura: o shell da variante já está montado). */
function aparelho(): ArmazenamentosDoAparelho {
  aparelhoDoProcesso ??= criarArmazenamentosDoAparelho({
    sistema: criarSistemaSqlite({ abrir: abrirDriverExpo, nomes: listarBancosExpo, apagar: apagarBancoExpoOuLancar }, registrarErro),
    sqliteDisponivel: expoSqliteDisponivel(),
    forcarAsyncStorage: forcarAsyncStorage(process.env.EXPO_PUBLIC_ARMAZENAMENTO),
    opcoes: opcoesDoAdaptador(shellDaVariante(varianteAtual()), registrarErro),
    registrarErro,
  });
  return aparelhoDoProcesso;
}

export interface UsuarioDoArmazenamento {
  usuarioId: string;
  /** Tenant da sessão v1; sem tenant (demonstração) = `demo`. */
  tenantId?: string | null;
  /** Fuso do tenant (versão dos documentos de busca conferida antes da carga). */
  fuso?: string;
  /** Tela "Atualizando os dados do aparelho…" (só na 1ª abertura com dados a passar). */
  aoProgredir?: (p: ProgressoPassagem) => void;
}

/**
 * Escolha, abertura (uma instância por arquivo), passagem, espelho e remoção do AsyncStorage antigo. Aberturas
 * simultâneas do mesmo usuário e tenant (app, lease, tarefa em segundo plano) recebem a mesma promessa.
 * `erro` (com o espelho já gravado, o arquivo não abriu): a tela pede "Tentar de novo", nunca cai no AsyncStorage.
 */
export function abrirArmazenamentoDoUsuario(u: UsuarioDoArmazenamento): Promise<AberturaArmazenamento> {
  const chave = chaveEspelhoArmazenamento(u.usuarioId);
  return aparelho().abrir({
    usuarioId: u.usuarioId,
    tenantId: u.tenantId ?? null,
    asyncStorage: armazenamentoDoUsuario(u.usuarioId),
    espelho: { ler: () => readJson<EspelhoArmazenamento>(chave), gravar: (e) => writeJson(chave, e) },
    ...(u.fuso ? { fuso: u.fuso } : {}),
    ...(u.aoProgredir ? { aoProgredir: u.aoProgredir } : {}),
  });
}

/** Logout e troca de usuário: fecha sem apagar (espera as escritas da fila do adaptador); o próximo login reabre. */
export async function fecharArmazenamentoDoUsuario(arquivo: string | null): Promise<void> {
  if (!arquivo || !aparelhoDoProcesso) return;
  await aparelhoDoProcesso.fechar(arquivo);
}

/**
 * Aparelho bloqueado (RN-CORE-15): fecha tudo e apaga os bancos de TODOS os usuários da pasta (pela
 * `ARQUIVO_DE_USUARIO_RE` do SDK). As chaves `macuxi:u:`/`fv:u:` (inclui o espelho) saem pela varredura do shell.
 */
export async function apagarBancosDoAparelho(): Promise<string[]> {
  if (!expoSqliteDisponivel()) return [];
  return aparelho().apagarTodos();
}
