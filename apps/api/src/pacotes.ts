/**
 * Adaptador S3 da porta `ServicoPacotes` do SDK (T-0098; ADR 0037): pacotes publicados para download por link temporário
 * (hoje o instalador do Conector on-premise, baixado pelo portal).
 *
 * No bucket privado das fotos, sob `MACUXI_PACOTES_PREFIXO` (padrão `pacotes/`):
 *   `<prefixo><produto>/<arquivo>`      — o pacote (ex.: `pacotes/conector/macuxi-conector-1.3.0-win-x64.zip`);
 *   `<prefixo><produto>/ultimo.json`    — o manifesto do último publicado (`PacotePublicadoSchema`), gravado DEPOIS do pacote.
 * Publicação: `pnpm --filter api publicar-pacote -- conector <arquivo> <versao>` (`cli/publicar-pacote.ts`).
 *
 * `linkDoUltimo` lê o manifesto com a chave da API e devolve um GET pré-assinado (SigV4 por query string) do pacote, com
 * validade `MACUXI_PACOTES_VALIDADE_S` (padrão 300 s, de 60 a 900) e `Content-Disposition: attachment` com o nome do arquivo.
 * Só existe com `MACUXI_ARQUIVOS_DRIVER=s3`; no disco (dev, CI) a porta fica desligada e a rota responde 503.
 * Log: só status HTTP e código S3/da porta; nunca a URL assinada, a chave, o segredo nem o conteúdo do manifesto.
 */
import {
  chaveDoPacote,
  chaveUltimoPacote,
  erroArmazenamentoIndisponivel,
  PacotePublicadoSchema,
  PRODUTOS_PACOTE,
  SERVICO_PACOTES_DESLIGADO,
  VALIDADE_LINK_PACOTE_S,
  type LogRota,
  type ServicoPacotes,
} from '@macuxi/platform-sdk';
import { codigoDoErro, criarClienteS3, lerConfigS3DoAmbiente, PREFIXO_S3_RE, type ClienteS3 } from './armazenamento-s3';

/** Teto do manifesto `ultimo.json` (é um objeto de poucos campos). */
export const BYTES_MAX_MANIFESTO_PACOTE = 4096;
export const PREFIXO_PACOTES_PADRAO = 'pacotes/';

export interface OpcoesPacotesS3 {
  /** Prefixo dentro do bucket (termina em `/`). */
  prefixo: string;
  /** Validade do link em segundos (`VALIDADE_LINK_PACOTE_S`). */
  validadeS: number;
  log?: Pick<LogRota, 'warn'>;
}

export function criarPacotesS3(cliente: ClienteS3, op: OpcoesPacotesS3): ServicoPacotes {
  if (!PREFIXO_S3_RE.test(op.prefixo)) throw new Error('MACUXI_PACOTES_PREFIXO inválido (ex.: pacotes/)');
  const { min, max } = VALIDADE_LINK_PACOTE_S;
  if (!(Number.isInteger(op.validadeS) && op.validadeS >= min && op.validadeS <= max))
    throw new Error(`MACUXI_PACOTES_VALIDADE_S fora de ${min} a ${max} segundos`);
  const avisar = (dados: Record<string, unknown>) => op.log?.warn({ ...dados, operacao: 'pacote' }, 'pacote para download indisponível');

  return {
    disponivel: () => true,
    async linkDoUltimo(produto) {
      if (!(PRODUTOS_PACOTE as readonly string[]).includes(produto)) throw new Error('produto de pacote inválido');
      let r: Response;
      try {
        r = await cliente.chamar('GET', op.prefixo + chaveUltimoPacote(produto));
      } catch (e) {
        avisar({ produto, erro: e instanceof Error ? e.name : 'desconhecido' });
        throw erroArmazenamentoIndisponivel();
      }
      if (r.status === 404) {
        await r.body?.cancel();
        return null;
      }
      if (!r.ok) {
        avisar({ produto, status: r.status, codigo_s3: await codigoDoErro(r) });
        throw erroArmazenamentoIndisponivel();
      }
      const bytes = new Uint8Array(await r.arrayBuffer());
      let manifesto: unknown = null;
      if (bytes.byteLength <= BYTES_MAX_MANIFESTO_PACOTE) {
        try {
          manifesto = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          manifesto = null;
        }
      }
      const p = PacotePublicadoSchema.safeParse(manifesto);
      if (!p.success) {
        avisar({ produto, codigo: 'PACOTE_MANIFESTO_INVALIDO' });
        throw erroArmazenamentoIndisponivel();
      }
      const { url, expiraEm } = cliente.urlPreAssinada(op.prefixo + chaveDoPacote(produto, p.data.arquivo), op.validadeS, {
        'response-content-disposition': `attachment; filename="${p.data.arquivo}"`,
      });
      return { ...p.data, url, expira_em: expiraEm.toISOString() };
    },
  };
}

/**
 * Porta pelo ambiente (`servidor.ts`): com `MACUXI_ARQUIVOS_DRIVER=s3`, o mesmo bucket e a mesma credencial das fotos
 * (`MACUXI_S3_*`), prefixo `MACUXI_PACOTES_PREFIXO` e validade `MACUXI_PACOTES_VALIDADE_S`, conferidos AQUI (valor inválido =
 * a API não sobe; a mensagem leva só o NOME da variável). Sem S3 = `SERVICO_PACOTES_DESLIGADO` (a rota responde 503).
 * `criar(log)` monta a porta com o log do app.
 */
export function lerPacotesDoAmbiente(env: NodeJS.ProcessEnv): { criar: (log?: Pick<LogRota, 'warn'>) => ServicoPacotes; descricao: string } {
  const driver = (env.MACUXI_ARQUIVOS_DRIVER ?? 'disco').trim().toLowerCase() || 'disco';
  if (driver !== 's3') return { criar: () => SERVICO_PACOTES_DESLIGADO, descricao: 'desligado (sem S3)' };
  const prefixo = env.MACUXI_PACOTES_PREFIXO?.trim() || PREFIXO_PACOTES_PADRAO;
  const bruto = env.MACUXI_PACOTES_VALIDADE_S?.trim();
  const validadeS = bruto ? Number(bruto) : VALIDADE_LINK_PACOTE_S.padrao;
  const cfg = lerConfigS3DoAmbiente(env);
  if (cfg.prefixo === prefixo) throw new Error('MACUXI_PACOTES_PREFIXO igual a MACUXI_S3_PREFIXO: use pastas diferentes (ex.: pacotes/)');
  const cliente = criarClienteS3(cfg);
  criarPacotesS3(cliente, { prefixo, validadeS }); // confere prefixo e validade já na subida
  return { criar: (log) => criarPacotesS3(cliente, { prefixo, validadeS, log }), descricao: `s3 ${cfg.bucket}/${prefixo} (link ${validadeS} s)` };
}
