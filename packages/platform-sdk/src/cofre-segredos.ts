/// <reference types="node" />
/**
 * Cofre de segredos por tenant (ADR 0066; desenho `docs/desenho/integracao-modelos-erp.md` §2.2; RN-INT-18 proposta): guarda
 * a credencial do ERP da busca pela API (Conector tipo `nuvem`). Usa `node:crypto`: exportado SÓ pelo subcaminho
 * `@macuxi/platform-sdk/cofre-segredos` (o web e o app nunca o importam).
 *
 * - **Cifra:** AES-256-GCM, IV aleatório de 12 bytes por cifra, tag de 16 bytes. O AAD é `tenant_id|conector_id`: o texto
 *   cifrado copiado para outro tenant ou outro Conector não decifra.
 * - **Chave-mestra:** `MACUXI_CHAVE_SEGREDOS_v<n>` no ambiente (secret do `PRODUCAO`, D7), 32 bytes em base64 ou hex. A maior
 *   versão carregada cifra; as menores só decifram, até a recifra zerar a contagem delas. A chave nunca vai ao banco, ao log
 *   nem à mensagem de erro.
 * - **Formato da linha** (`integracao.credencial_erp`, F2): `cifrado`, `iv`, `tag` e `chave_versao`.
 * - Quem decifra é só o worker, na coleta, e a rota "Testar conexão", em memória. Nenhuma rota devolve o segredo.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const TAM_CHAVE = 32;
const TAM_IV = 12;
const TAM_TAG = 16;

/** Prefixo da variável de ambiente da chave-mestra; a versão vem logo depois (`MACUXI_CHAVE_SEGREDOS_v1`). */
export const PREFIXO_CHAVE_SEGREDOS = 'MACUXI_CHAVE_SEGREDOS_v';

/** `v` ou `V`: o GitHub guarda o nome do secret em maiúsculas (`MACUXI_CHAVE_SEGREDOS_V1`). */
const NOME_RE = /^MACUXI_CHAVE_SEGREDOS_[vV]([1-9]\d{0,5})$/;

export type CodigoErroCofre = 'COFRE_SEM_CHAVE' | 'COFRE_CHAVE_INVALIDA' | 'COFRE_VERSAO_AUSENTE' | 'COFRE_NAO_DECIFRA' | 'COFRE_ENTRADA_INVALIDA';

/** Erro do cofre: a mensagem nunca traz chave, segredo nem texto cifrado. */
export class ErroCofre extends Error {
  constructor(
    readonly codigo: CodigoErroCofre,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCofre';
  }
}

/** Chaves-mestras carregadas, por versão. `atual` = a maior, a que cifra. */
export interface ChavesSegredos {
  readonly atual: number;
  readonly versoes: readonly number[];
  chave(versao: number): Buffer | undefined;
}

/** O que amarra o segredo ao dono dele. */
export interface AadSegredo {
  tenant_id: string;
  conector_id: string;
}

/** Colunas da linha cifrada. */
export interface SegredoCifrado {
  cifrado: Buffer;
  iv: Buffer;
  tag: Buffer;
  chave_versao: number;
}

function lerChave(nome: string, valor: string): Buffer {
  const v = valor.trim();
  const bytes = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : /^[A-Za-z0-9+/]{43}=$/.test(v) ? Buffer.from(v, 'base64') : null;
  if (!bytes || bytes.length !== TAM_CHAVE)
    throw new ErroCofre('COFRE_CHAVE_INVALIDA', `${nome} precisa ter 32 bytes em base64 (44 caracteres) ou hex (64 caracteres)`);
  return bytes;
}

/**
 * Lê as chaves `MACUXI_CHAVE_SEGREDOS_v<n>` do ambiente. Sem nenhuma, `COFRE_SEM_CHAVE` (a API e o worker não sobem a busca
 * na API do ERP sem ela). Chave com tamanho errado, `COFRE_CHAVE_INVALIDA` com o nome da variável e sem o valor.
 */
export function carregarChavesSegredos(env: Readonly<Record<string, string | undefined>>): ChavesSegredos {
  const mapa = new Map<number, Buffer>();
  for (const [nome, valor] of Object.entries(env)) {
    const m = NOME_RE.exec(nome);
    if (!m || valor === undefined || valor.trim() === '') continue;
    const versao = Number(m[1]);
    const chave = lerChave(nome, valor);
    const outra = mapa.get(versao);
    if (outra && !outra.equals(chave)) throw new ErroCofre('COFRE_CHAVE_INVALIDA', `duas chaves diferentes para a versão ${versao} (v e V)`);
    mapa.set(versao, chave);
  }
  if (mapa.size === 0)
    throw new ErroCofre('COFRE_SEM_CHAVE', `falta a chave-mestra do cofre: defina ${PREFIXO_CHAVE_SEGREDOS}1 (32 bytes em base64) no .env`);
  const versoes = [...mapa.keys()].sort((a, b) => a - b);
  return { atual: versoes[versoes.length - 1]!, versoes, chave: (v) => mapa.get(v) };
}

const aadDe = (a: AadSegredo) => {
  const t = a.tenant_id.trim().toLowerCase();
  const c = a.conector_id.trim().toLowerCase();
  if (!t || !c || t.includes('|') || c.includes('|')) throw new ErroCofre('COFRE_ENTRADA_INVALIDA', 'tenant_id e conector_id são obrigatórios');
  return Buffer.from(`${t}|${c}`, 'utf8');
};

export interface Cofre {
  /** Versão da chave que cifra agora. */
  readonly versaoAtual: number;
  cifrar(texto: string, aad: AadSegredo): SegredoCifrado;
  /** `COFRE_VERSAO_AUSENTE` se a versão saiu do ambiente; `COFRE_NAO_DECIFRA` se o AAD, a tag ou o texto não batem. */
  decifrar(s: SegredoCifrado, aad: AadSegredo): string;
  /** A linha está numa versão menor que a atual. */
  precisaRecifrar(s: Pick<SegredoCifrado, 'chave_versao'>): boolean;
  /** Recifra v<n> → versão atual (rotação da chave-mestra); devolve a mesma linha se já está na atual. */
  recifrar(s: SegredoCifrado, aad: AadSegredo): SegredoCifrado;
}

export function criarCofre(chaves: ChavesSegredos): Cofre {
  const chaveDa = (versao: number) => {
    const k = chaves.chave(versao);
    if (!k) throw new ErroCofre('COFRE_VERSAO_AUSENTE', `a chave-mestra v${versao} não está carregada (${PREFIXO_CHAVE_SEGREDOS}${versao})`);
    return k;
  };
  const cifrar = (texto: string, aad: AadSegredo): SegredoCifrado => {
    if (typeof texto !== 'string' || texto.length === 0) throw new ErroCofre('COFRE_ENTRADA_INVALIDA', 'segredo vazio');
    const iv = randomBytes(TAM_IV);
    const c = createCipheriv(ALGORITMO, chaveDa(chaves.atual), iv, { authTagLength: TAM_TAG });
    c.setAAD(aadDe(aad));
    const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return { cifrado, iv, tag: c.getAuthTag(), chave_versao: chaves.atual };
  };
  const decifrar = (s: SegredoCifrado, aad: AadSegredo): string => {
    const k = chaveDa(s.chave_versao);
    const a = aadDe(aad);
    if (s.iv.length !== TAM_IV || s.tag.length !== TAM_TAG) throw new ErroCofre('COFRE_NAO_DECIFRA', 'segredo em formato desconhecido');
    try {
      const d = createDecipheriv(ALGORITMO, k, s.iv, { authTagLength: TAM_TAG });
      d.setAAD(a);
      d.setAuthTag(s.tag);
      return Buffer.concat([d.update(s.cifrado), d.final()]).toString('utf8');
    } catch {
      throw new ErroCofre('COFRE_NAO_DECIFRA', 'o segredo não decifra (outro tenant, outro Conector ou adulterado)');
    }
  };
  return {
    versaoAtual: chaves.atual,
    cifrar,
    decifrar,
    precisaRecifrar: (s) => s.chave_versao < chaves.atual,
    recifrar: (s, aad) => (s.chave_versao === chaves.atual ? s : cifrar(decifrar(s, aad), aad)),
  };
}
