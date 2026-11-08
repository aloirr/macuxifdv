/**
 * Troca de versão com backup (T-0116). Layout na pasta do Conector (ex.: `C:\ProgramData\Macuxi\Conector\`):
 *
 *   conector.mjs, node.exe, WinSW-x64.exe, exemplos/ …   ← versão em uso (itens de primeiro nível do pacote)
 *   dados/, conector.json, logs/                          ← NUNCA tocados (fila, cursor, configuração, log)
 *   atualizacao/nova/                                     ← pacote extraído, ainda não em uso
 *   atualizacao/anterior/ + manifesto.json                ← backup da versão substituída (uma só, a última)
 *
 * Só `rename` na mesma pasta (mesmo volume): cada item troca de lugar de uma vez. O manifesto é gravado ANTES de mover
 * (`em_troca`) para a restauração saber o que desfazer mesmo se a troca parou no meio; a restauração é idempotente.
 * O serviço precisa estar PARADO durante a troca (no Windows o `node.exe` em uso não pode ser substituído).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Itens da pasta do Conector que um pacote nunca pode trazer nem substituir (comparação sem caixa, como no Windows). */
export const ITENS_PROTEGIDOS = ['dados', 'conector.json', 'atualizacao', 'logs', 'log', '.env'] as const;
/** O pacote precisa trazer ao menos o Conector empacotado. */
export const ITENS_OBRIGATORIOS = ['conector.mjs'] as const;

export type CodigoErroTroca = 'pacote_invalido' | 'sem_backup' | 'falha_na_troca';

export class ErroTroca extends Error {
  override readonly name = 'ErroTroca';
  constructor(
    readonly codigo: CodigoErroTroca,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface Manifesto {
  versao_anterior: string;
  versao_nova: string;
  estado: 'em_troca' | 'trocada' | 'restaurada';
  /** Itens que existiam e foram para `anterior/`. */
  substituidos: string[];
  /** Itens que só a versão nova tem (saem na restauração). */
  novos: string[];
}

export function pastasAtualizacao(pasta: string) {
  const raiz = join(pasta, 'atualizacao');
  return {
    raiz,
    nova: join(raiz, 'nova'),
    anterior: join(raiz, 'anterior'),
    manifesto: join(raiz, 'anterior', 'manifesto.json'),
    trava: join(raiz, 'trava'),
    arquivoPacote: join(raiz, 'pacote.zip'),
  };
}

const protegido = (nome: string) => (ITENS_PROTEGIDOS as readonly string[]).includes(nome.toLowerCase());

/** Itens de primeiro nível do pacote extraído em `atualizacao/nova/`, validados. */
export function listarItensDoPacote(pastaNova: string): string[] {
  if (!existsSync(pastaNova)) throw new ErroTroca('pacote_invalido', 'pacote não extraído');
  const itens = readdirSync(pastaNova).sort();
  const proibido = itens.find(protegido);
  if (proibido !== undefined)
    throw new ErroTroca('pacote_invalido', 'o pacote traz um item protegido da pasta do Conector');
  const nomes = new Set(itens.map((i) => i.toLowerCase()));
  if (!ITENS_OBRIGATORIOS.every((o) => nomes.has(o)))
    throw new ErroTroca('pacote_invalido', 'o pacote não traz o conector.mjs');
  return itens;
}

const gravarManifesto = (arquivo: string, m: Manifesto) =>
  writeFileSync(arquivo, `${JSON.stringify(m, null, 2)}\n`);

export function lerManifesto(pasta: string): Manifesto | null {
  const { manifesto } = pastasAtualizacao(pasta);
  if (!existsSync(manifesto)) return null;
  return JSON.parse(readFileSync(manifesto, 'utf8')) as Manifesto;
}

/** Põe a versão de `atualizacao/nova/` em uso e guarda a atual em `atualizacao/anterior/`. */
export function trocarVersao(pasta: string, versaoAnterior: string, versaoNova: string): Manifesto {
  const p = pastasAtualizacao(pasta);
  const itens = listarItensDoPacote(p.nova);
  rmSync(p.anterior, { recursive: true, force: true });
  mkdirSync(p.anterior, { recursive: true });
  const substituidos = itens.filter((i) => existsSync(join(pasta, i)));
  const novos = itens.filter((i) => !substituidos.includes(i));
  const m: Manifesto = {
    versao_anterior: versaoAnterior,
    versao_nova: versaoNova,
    estado: 'em_troca',
    substituidos,
    novos,
  };
  gravarManifesto(p.manifesto, m);
  for (const i of substituidos) renameSync(join(pasta, i), join(p.anterior, i));
  for (const i of itens) renameSync(join(p.nova, i), join(pasta, i));
  m.estado = 'trocada';
  gravarManifesto(p.manifesto, m);
  return m;
}

/**
 * Volta a versão de `atualizacao/anterior/` (desfaz `trocarVersao`, completa ou interrompida). Idempotente: o que já
 * voltou fica como está. Não mexe em itens protegidos (o manifesto nunca os lista).
 */
export function restaurarVersao(pasta: string): Manifesto {
  const p = pastasAtualizacao(pasta);
  const m = lerManifesto(pasta);
  if (!m) throw new ErroTroca('sem_backup', 'não há backup da versão anterior');
  for (const i of m.substituidos) {
    const guardado = join(p.anterior, i);
    if (!existsSync(guardado)) continue; // não chegou a sair, ou já voltou
    rmSync(join(pasta, i), { recursive: true, force: true });
    renameSync(guardado, join(pasta, i));
  }
  for (const i of m.novos) rmSync(join(pasta, i), { recursive: true, force: true });
  m.estado = 'restaurada';
  gravarManifesto(p.manifesto, m);
  return m;
}
