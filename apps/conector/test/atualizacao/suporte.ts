/**
 * Dublês da atualização automática (T-0116): pacote falso (JSON com os arquivos, no lugar do `.zip`), extrator que o
 * escreve na pasta, serviço que "roda" o `conector.mjs` da pasta e saúde que responde com a versão dele.
 * O `conector.mjs` falso é `versao=<semver>` (sobe e responde), `quebrado` (sobe e não responde) ou `nao-sobe`.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PacoteConector } from '@macuxi/integracao/contracts';
import type {
  BaixadorPacote,
  DependenciasAtualizacao,
  ExtratorPacote,
  ServicoConector,
  VerificadorSaude,
} from '../../src/atualizacao';
import { sha256Hex } from '../../src/atualizacao';

export const VERSAO_ATUAL = '1.2.1';
export const VERSAO_NOVA = '1.3.0';

export function chavesEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privada: privateKey, publicaPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

export function chavesRsa(bits: number) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return { privada: privateKey, publicaPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

/** Pacote falso: os bytes são um JSON `{ caminho: conteúdo }`. */
export function bytesDoPacote(arquivos: Record<string, string>): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(arquivos)));
}

export function assinar(bytes: Uint8Array, privada: KeyObject): string {
  const algoritmo = privada.asymmetricKeyType === 'ed25519' ? null : 'sha256';
  return sign(algoritmo, bytes, privada).toString('base64');
}

export function anunciar(
  bytes: Uint8Array,
  privada: KeyObject,
  extra: Partial<PacoteConector> = {},
): PacoteConector {
  return {
    versao: VERSAO_NOVA,
    url: 'https://pacotes.exemplo.invalid/conector-1.3.0.zip?token=segredo-de-url',
    sha256: sha256Hex(bytes),
    assinatura: assinar(bytes, privada),
    chave_publica_id: 'teste',
    ...extra,
  };
}

/** Pasta de instalação com a versão atual, a fila em `dados/` e a configuração. */
export function criarInstalacao(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'macuxi-atualizacao-'));
  writeFileSync(join(pasta, 'conector.mjs'), `versao=${VERSAO_ATUAL}`);
  writeFileSync(join(pasta, 'node.exe'), 'node-24.7');
  mkdirSync(join(pasta, 'exemplos'));
  writeFileSync(join(pasta, 'exemplos', 'views.sql'), 'select 1 -- antigo');
  mkdirSync(join(pasta, 'dados'));
  writeFileSync(join(pasta, 'dados', 'fila.db'), 'fila');
  writeFileSync(join(pasta, 'conector.json'), '{"hub":{}}');
  return pasta;
}

export const ler = (pasta: string, caminho: string) => readFileSync(join(pasta, caminho), 'utf8');

export class Mundo {
  /** Versão em execução (`null` = parado). */
  rodando: string | null = null;
  respondendo = false;
  chamadas: string[] = [];
  tempo = 0;
  falharDownload = false;
  falharParada = false;
  falharExtracao = false;
  /** Faz a saúde responder com outra versão (ex.: o processo antigo que não morreu). */
  saudeForcada: string | null = null;

  constructor(
    readonly pasta: string,
    readonly bytes: Uint8Array,
  ) {
    this.subir();
  }

  private subir(): void {
    const conteudo = existsSync(join(this.pasta, 'conector.mjs'))
      ? ler(this.pasta, 'conector.mjs')
      : 'nao-sobe';
    if (conteudo === 'nao-sobe') throw new Error(`falhou ao iniciar o serviço em ${this.pasta}`);
    this.rodando = conteudo.startsWith('versao=') ? conteudo.slice('versao='.length) : 'desconhecida';
    this.respondendo = conteudo !== 'quebrado';
  }

  readonly baixador: BaixadorPacote = {
    baixar: async () => {
      this.chamadas.push('baixar');
      if (this.falharDownload)
        throw new Error('ECONNRESET ao baixar https://pacotes.exemplo.invalid/?token=segredo-de-url');
      return this.bytes;
    },
  };

  readonly extrator: ExtratorPacote = {
    extrair: async (arquivo, destino) => {
      this.chamadas.push('extrair');
      if (this.falharExtracao) throw new Error('zip corrompido');
      const arquivos = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, string>;
      for (const [caminho, conteudo] of Object.entries(arquivos)) {
        mkdirSync(dirname(join(destino, caminho)), { recursive: true });
        writeFileSync(join(destino, caminho), conteudo);
      }
    },
  };

  readonly servico: ServicoConector = {
    parar: async () => {
      this.chamadas.push('parar');
      if (this.falharParada) throw new Error('acesso negado ao parar o serviço');
      this.rodando = null;
      this.respondendo = false;
    },
    iniciar: async () => {
      this.chamadas.push('iniciar');
      this.subir();
    },
  };

  readonly saude: VerificadorSaude = {
    consultar: async (limiteMs) => {
      this.chamadas.push('saude');
      this.tempo += Math.min(limiteMs, 100);
      if (this.saudeForcada) return { versao: this.saudeForcada };
      return this.rodando && this.respondendo ? { versao: this.rodando } : null;
    },
  };

  deps(chaves: Record<string, string>): DependenciasAtualizacao {
    return {
      baixador: this.baixador,
      extrator: this.extrator,
      servico: this.servico,
      saude: this.saude,
      chaves,
      relogio: { agora: () => this.tempo },
      esperar: async (ms) => {
        this.tempo += ms;
      },
    };
  }
}
