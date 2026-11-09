/**
 * T-0098 — download do Conector on-premise por link temporário (presign de bucket privado), na aba Integração do portal.
 * Contrato proposto ao engenheiro-software (R-20261108-234517): `POST /v1/integracao/conector/download` com o token do portal
 * e `x-macuxi-tenant`, auditado no servidor, devolve `{ url, expira_em, versao, arquivo, tamanho_bytes?, sha256? }`.
 * Até a rota existir neste servidor (404 de rota, 501/503 sem storage, 404 `CONECTOR_SEM_PACOTE`), a tela segue com "em breve".
 * Campo opcional: só `url` (https) é obrigatório; o resto aparece quando vier. O link nunca é guardado: cada clique gera outro.
 * Puro (roda em Node); a tela é `components/portal/aba-integracao.tsx`.
 */
import { ehRotaAusente, ErroPortal, mensagemDoErro } from './portal-api';

export interface LinkDownloadConector {
  url: string;
  /** ISO 8601 (UTC). */
  expira_em: string | null;
  versao: string | null;
  arquivo: string | null;
  tamanho_bytes: number | null;
  sha256: string | null;
}

const texto = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** Só https (presign do bucket); `http://localhost` vale só fora da produção (desenvolvimento). */
export function urlDeDownloadValida(url: string, producao = process.env.NODE_ENV === 'production'): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return !producao && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Validação da resposta (o `chamarPortal` aceita qualquer objeto com `safeParse`); a do contrato entra quando sair. */
export const LinkDownloadConectorResposta = {
  safeParse(x: unknown): { success: true; data: LinkDownloadConector } | { success: false } {
    if (!x || typeof x !== 'object') return { success: false };
    const o = x as Record<string, unknown>;
    const url = texto(o.url);
    if (!url || !urlDeDownloadValida(url)) return { success: false };
    const expira = texto(o.expira_em);
    const tamanho = typeof o.tamanho_bytes === 'number' && Number.isFinite(o.tamanho_bytes) && o.tamanho_bytes > 0 ? o.tamanho_bytes : null;
    return {
      success: true,
      data: {
        url,
        expira_em: expira && Number.isFinite(Date.parse(expira)) ? expira : null,
        versao: texto(o.versao),
        arquivo: texto(o.arquivo),
        tamanho_bytes: tamanho,
        sha256: texto(o.sha256),
      },
    };
  },
};

/** "12,3 MB" / "850 KB". */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`;
}

/** "Versão 1.0.0 · macuxi-conector-1.0.0-win-x64.zip · 12,3 MB" (só o que veio). */
export function textoDoPacote(l: LinkDownloadConector): string | null {
  const partes = [l.versao ? `Versão ${l.versao}` : null, l.arquivo, l.tamanho_bytes ? tamanhoLegivel(l.tamanho_bytes) : null].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** "O link vale até 01:30. Depois disso, gere outro." `hora` formata no fuso de quem vê. */
export function textoDaValidade(l: LinkDownloadConector, hora: (iso: string) => string): string {
  return l.expira_em ? `O link vale até ${hora(l.expira_em)}. Depois disso, gere outro.` : 'O link vale por pouco tempo. Se não baixar, gere outro.';
}

export type FalhaDoDownload = { tipo: 'em-breve' } | { tipo: 'aviso'; texto: string } | { tipo: 'erro'; texto: string };

export const TEXTOS_DOWNLOAD_CONECTOR = Object.freeze({
  botao: 'Gerar o link do Conector',
  gerando: 'Gerando o link…',
  baixar: (arquivo: string | null) => (arquivo ? `Baixar ${arquivo}` : 'Baixar o Conector'),
  emBreve: 'o pacote será publicado aqui em breve.',
  espera: 'Muitos links seguidos. Espere um minuto e tente de novo.',
  semAcesso: 'Só quem administra a empresa no portal baixa o Conector.',
});

/** O que a tela mostra quando gerar o link falha. */
export function falhaDoDownload(e: unknown): FalhaDoDownload {
  if (ehRotaAusente(e)) return { tipo: 'em-breve' };
  if (e instanceof ErroPortal) {
    if (e.status === 404 && e.codigo === 'CONECTOR_SEM_PACOTE') return { tipo: 'em-breve' };
    if (e.status === 501 || e.status === 503) return { tipo: 'em-breve' };
    if (e.status === 429) return { tipo: 'aviso', texto: TEXTOS_DOWNLOAD_CONECTOR.espera };
    if (e.status === 403) return { tipo: 'erro', texto: TEXTOS_DOWNLOAD_CONECTOR.semAcesso };
  }
  return { tipo: 'erro', texto: mensagemDoErro(e) };
}
