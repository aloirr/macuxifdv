/**
 * Publica um pacote para download por link temporário (T-0098; ADR 0037), no bucket S3 privado da API:
 *
 *   pnpm --filter api publicar-pacote conector <caminho/macuxi-conector-1.3.0-win-x64.zip> --versao 1.3.0 [--simular]
 *
 * - Usa as mesmas variáveis da API (`MACUXI_S3_*` e `MACUXI_PACOTES_PREFIXO`, padrão `pacotes/`), lidas do ambiente ou do
 *   `.env` da raiz; segredo nunca em argumento.
 * - Ordem: 1º o pacote (`<prefixo><produto>/<arquivo>`), 2º o manifesto `<prefixo><produto>/ultimo.json` com versão, nome,
 *   tamanho e sha256. Quem pede o link no meio da publicação recebe o pacote anterior, nunca um link para objeto ausente.
 * - Republicar a mesma versão regrava os dois (idempotente). Versões antigas ficam no bucket (a limpeza é manual).
 * - Saída: uma linha JSON (produto, versão, arquivo, tamanho, sha256); nunca a chave, o segredo nem URL assinada.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chaveDoPacote, chaveUltimoPacote, PacotePublicadoSchema, PRODUTOS_PACOTE, type PacotePublicado, type ProdutoPacote } from '@macuxi/platform-sdk';
import { codigoDoErro, criarClienteS3, ErroArmazenamentoS3, lerConfigS3DoAmbiente, type ClienteS3 } from '../armazenamento-s3';
import { PREFIXO_PACOTES_PADRAO } from '../pacotes';

const TIPO_POR_EXTENSAO: Readonly<Record<string, string>> = {
  zip: 'application/zip',
  exe: 'application/vnd.microsoft.portable-executable',
  msi: 'application/x-msi',
};

export interface PedidoPublicacao {
  produto: ProdutoPacote;
  arquivo: string;
  versao: string;
  bytes: Uint8Array;
  agora: Date;
}

/** Monta o manifesto (validado) a partir dos bytes. Erro de formato = exceção com a mensagem do schema. */
export function manifestoDoPacote(p: PedidoPublicacao): PacotePublicado {
  return PacotePublicadoSchema.parse({
    versao: p.versao,
    arquivo: p.arquivo,
    tamanho_bytes: p.bytes.byteLength,
    sha256: createHash('sha256').update(p.bytes).digest('hex'),
    publicado_em: p.agora.toISOString(),
  });
}

/** Grava o pacote e depois o `ultimo.json`. Devolve o manifesto gravado. */
export async function publicarPacote(cliente: ClienteS3, prefixo: string, p: PedidoPublicacao): Promise<PacotePublicado> {
  const manifesto = manifestoDoPacote(p);
  const extensao = /\.([a-z0-9]+)$/i.exec(manifesto.arquivo)?.[1]?.toLowerCase() ?? '';
  const gravar = async (chave: string, corpo: Uint8Array, tipo: string) => {
    const r = await cliente.chamar('PUT', prefixo + chave, corpo, tipo);
    if (!r.ok) throw new ErroArmazenamentoS3('pacote', r.status, await codigoDoErro(r));
    await r.body?.cancel();
  };
  await gravar(chaveDoPacote(p.produto, manifesto.arquivo), p.bytes, TIPO_POR_EXTENSAO[extensao] ?? 'application/octet-stream');
  await gravar(chaveUltimoPacote(p.produto), new TextEncoder().encode(JSON.stringify(manifesto)), 'application/json');
  return manifesto;
}

export async function executarPublicarPacote(argv: readonly string[], env: NodeJS.ProcessEnv, agora = new Date()): Promise<PacotePublicado> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { versao: { type: 'string' }, simular: { type: 'boolean', default: false } },
  });
  const [produto, caminho] = positionals;
  if (!produto || !(PRODUTOS_PACOTE as readonly string[]).includes(produto)) throw new Error(`produto inválido: use ${PRODUTOS_PACOTE.join(', ')}`);
  if (!caminho) throw new Error('informe o caminho do arquivo do pacote');
  if (!values.versao) throw new Error('informe --versao X.Y.Z');
  const pedido: PedidoPublicacao = { produto: produto as ProdutoPacote, arquivo: basename(caminho), versao: values.versao, bytes: new Uint8Array(readFileSync(caminho)), agora };
  if (values.simular) return manifestoDoPacote(pedido);
  const prefixo = env.MACUXI_PACOTES_PREFIXO?.trim() || PREFIXO_PACOTES_PADRAO;
  return publicarPacote(criarClienteS3(lerConfigS3DoAmbiente(env)), prefixo, pedido);
}

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  const envRaiz = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envRaiz)) process.loadEnvFile(envRaiz);
  executarPublicarPacote(process.argv.slice(2), process.env).then(
    (m) => console.log(JSON.stringify({ ok: true, ...m })),
    (e: unknown) => {
      // só a mensagem (variável ausente, formato, HTTP + código S3): nunca credencial
      console.error(`[publicar-pacote] erro: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
