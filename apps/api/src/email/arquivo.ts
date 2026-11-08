/**
 * Transporte `arquivo` (T-0094): a "caixa" da demo e dos testes. Grava o `.eml` completo (abre no Outlook/Thunderbird) em
 * `MACUXI_EMAIL_PASTA`, com nome `<AAAAMMDDTHHMMSSZ>-<idEnvio>.eml` e permissão 0o600 (pasta 0o700).
 *
 * O log leva só `id_envio`, `modelo`, o caminho do arquivo e a versão de log do corpo (senha mascarada, nome e e-mail como
 * marcadores; RN-CORE-34). Com `mascararSenha`, o próprio arquivo sai com a senha mascarada (nome e login reais).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogRota, MensagemEmail, ResultadoTransporteEmail, TransporteEmail } from '@macuxi/platform-sdk';
import { montarMime } from './mime';

export interface OpcoesTransporteArquivo {
  pasta: string;
  log: LogRota;
  agora?: () => Date;
  /** O `.eml` sai com a senha mascarada (usa `msg.semSenha`). */
  mascararSenha?: boolean;
}

/** `2026-11-07T12:00:00.000Z` → `20261107T120000Z` (sem `:`, válido no Windows). */
export function carimboArquivo(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

export function criarTransporteArquivo(op: OpcoesTransporteArquivo): TransporteEmail {
  const agora = op.agora ?? (() => new Date());
  return {
    nome: 'arquivo',
    async entregar(msg: MensagemEmail): Promise<ResultadoTransporteEmail> {
      const instante = agora();
      const conteudo = op.mascararSenha && msg.semSenha ? msg.semSenha : undefined;
      const { bruto, messageId } = montarMime(msg, { agora: instante, ...(conteudo ? { conteudo } : {}) });
      const idLimpo = msg.idEnvio.replace(/[^0-9a-zA-Z-]/g, '');
      await mkdir(op.pasta, { recursive: true, mode: 0o700 });
      const caminho = join(op.pasta, `${carimboArquivo(instante)}-${idLimpo}.eml`);
      await writeFile(caminho, bruto, { encoding: 'utf8', mode: 0o600 });
      op.log.info(
        {
          tipo: 'email',
          transporte: 'arquivo',
          id_envio: msg.idEnvio,
          modelo: msg.modelo,
          arquivo: caminho,
          senha_mascarada_no_arquivo: Boolean(conteudo),
          ...(msg.paraLog ? { assunto: msg.paraLog.assunto, corpo: msg.paraLog.texto } : {}),
        },
        'e-mail gravado em arquivo',
      );
      return { idMensagem: messageId };
    },
  };
}
