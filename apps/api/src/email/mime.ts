/**
 * Montagem da mensagem MIME (RFC 5322/2045/2047) do e-mail transacional (T-0094): `multipart/alternative` com texto e
 * HTML em UTF-8 e base64 (linhas de 76), `Subject` e nomes em RFC 2047 quando não-ASCII, `Date` em UTC, `Message-ID`
 * determinístico `<idEnvio@dominio-do-remetente>` (a mesma mensagem reenviada numa nova tentativa tem o mesmo id, e o
 * provedor pode deduplicar). Sem `node:*` além do `Buffer` global.
 */
import type { EnderecoEmail, EmailParaEnvio } from '@macuxi/platform-sdk';

const CRLF = '\r\n';
/** Bytes por encoded-word: 45 bytes → 60 caracteres base64; `=?UTF-8?B?` + 60 + `?=` = 72 ≤ 75 (RFC 2047 §2). */
const BYTES_POR_PALAVRA = 45;

/** Quebra em linhas de 76 com CRLF (RFC 2045 §6.8). */
export function base64EmLinhas(conteudo: string): string {
  const b64 = Buffer.from(conteudo, 'utf8').toString('base64');
  return (b64.match(/.{1,76}/g) ?? []).join(CRLF) + CRLF;
}

/** RFC 2047 (B): texto não-ASCII vira uma ou mais encoded-words, cortadas sem partir caractere UTF-8. ASCII sai igual. */
export function codificarCabecalho(texto: string): string {
  if (/^[\x20-\x7e]*$/.test(texto)) return texto;
  const palavras: string[] = [];
  let atual = '';
  for (const ch of texto) {
    if (Buffer.byteLength(atual + ch, 'utf8') > BYTES_POR_PALAVRA) {
      palavras.push(atual);
      atual = '';
    }
    atual += ch;
  }
  if (atual) palavras.push(atual);
  return palavras.map((p) => `=?UTF-8?B?${Buffer.from(p, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

/** `Nome <email>`: nome ASCII vai entre aspas (com escape); não-ASCII em RFC 2047. */
export function formatarEndereco(e: EnderecoEmail): string {
  const email = e.email.replace(/[\r\n<>]/g, '');
  const nome = e.nome?.replace(/[\r\n]/g, ' ').trim();
  if (!nome) return `<${email}>`;
  const exibicao = /^[\x20-\x7e]*$/.test(nome) ? `"${nome.replace(/(["\\])/g, '\\$1')}"` : codificarCabecalho(nome);
  return `${exibicao} <${email}>`;
}

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dois = (n: number) => String(n).padStart(2, '0');

/** Data RFC 5322 em UTC: `Sat, 07 Nov 2026 12:00:00 +0000`. */
export function dataRfc5322(d: Date): string {
  return (
    `${DIAS[d.getUTCDay()]}, ${dois(d.getUTCDate())} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())} +0000`
  );
}

export function dominioDoEmail(email: string): string {
  const d = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return /^[a-z0-9.-]+$/.test(d) && d.length > 0 ? d : 'macuxi.invalid';
}

export interface MimeMontado {
  /** Mensagem completa com CRLF (cabeçalhos + corpo), pronta para o DATA (antes do dot-stuffing) ou para o `.eml`. */
  bruto: string;
  messageId: string;
}

/** Monta a mensagem. `conteudo` permite trocar o corpo (ex.: versão sem senha no arquivo da demo). */
export function montarMime(
  msg: EmailParaEnvio,
  opcoes: { agora: Date; conteudo?: { assunto: string; texto: string; html: string } },
): MimeMontado {
  const c = opcoes.conteudo ?? msg;
  const idLimpo = msg.idEnvio.replace(/[^0-9a-zA-Z-]/g, '');
  const messageId = `<${idLimpo}@${dominioDoEmail(msg.de.email)}>`;
  // `=_` não aparece em base64 nem nos cabeçalhos das partes: fronteira segura
  const fronteira = `=_macuxi_${idLimpo.replace(/-/g, '')}`;
  const cabecalhos = [
    `From: ${formatarEndereco(msg.de)}`,
    `To: ${formatarEndereco(msg.para)}`,
    `Subject: ${codificarCabecalho(c.assunto)}`,
    `Date: ${dataRfc5322(opcoes.agora)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${fronteira}"`,
  ];
  const parte = (tipo: string, conteudo: string) =>
    `--${fronteira}${CRLF}Content-Type: ${tipo}; charset=utf-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64EmLinhas(conteudo)}`;
  const bruto =
    cabecalhos.join(CRLF) +
    CRLF +
    CRLF +
    parte('text/plain', c.texto) +
    parte('text/html', c.html) +
    `--${fronteira}--${CRLF}`;
  return { bruto, messageId };
}

/** Dot-stuffing do DATA (RFC 5321 §4.5.2) e normalização de quebras para CRLF. Termina com CRLF. */
export function prepararData(bruto: string): string {
  const normal = bruto.replace(/\r?\n/g, CRLF);
  const comPonto = normal.replace(/(^|\r\n)\./g, '$1..');
  return comPonto.endsWith(CRLF) ? comPonto : comPonto + CRLF;
}
