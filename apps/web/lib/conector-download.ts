/**
 * T-0098 — download do Conector on-premise por link temporário (presign de bucket privado), na aba Integração do portal.
 * Contrato do Integração (`LinkDownloadConectorSchema`, ADR 0037; R-20261109-083700): `POST /v1/integracao/conector/download`
 * com o token do portal e `x-macuxi-tenant`, auditado no servidor, devolve `{ url, expira_em, versao, arquivo, tamanho_bytes?,
 * sha256? }`. Sem a rota neste servidor (404 de rota, 501/503 sem storage, 404 `CONECTOR_SEM_PACOTE`), a tela mostra
 * `TEXTO_INDISPONIVEL`. O link nunca é guardado: cada clique gera outro. Puro (roda em Node); a tela é `components/portal/aba-integracao.tsx`.
 */
import { CODIGO_CONECTOR_SEM_PACOTE, LinkDownloadConectorSchema, type LinkDownloadConector } from '@macuxi/integracao/contracts';

import { ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from './portal-api';

export type { LinkDownloadConector };

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

/** Validação da resposta: o schema do contrato e, por cima, só link https (o `chamarPortal` aceita qualquer `safeParse`). */
export const LinkDownloadConectorResposta = LinkDownloadConectorSchema.refine((l) => urlDeDownloadValida(l.url));

/** "12,3 MB" / "850 KB". */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`;
}

/** "38 MB": só o tamanho (a versão e o nome do arquivo já estão no link "Baixar {arquivo}", spec portal-config-enxuto §10.2, P6). */
export function textoDoPacote(l: LinkDownloadConector): string | null {
  return l.tamanho_bytes ? tamanhoLegivel(l.tamanho_bytes) : null;
}

/** "O link vale até 01:30. Depois disso, gere outro." `hora` formata no fuso de quem vê (o contrato sempre manda `expira_em`). */
export function textoDaValidade(l: LinkDownloadConector, hora: (iso: string) => string): string {
  return `O link vale até ${hora(l.expira_em)}. Depois disso, gere outro.`;
}

export type FalhaDoDownload = { tipo: 'em-breve' } | { tipo: 'aviso'; texto: string } | { tipo: 'erro'; texto: string };

export const TEXTOS_DOWNLOAD_CONECTOR = Object.freeze({
  botao: 'Gerar o link do Conector',
  gerando: 'Gerando o link…',
  baixar: (arquivo: string | null) => (arquivo ? `Baixar ${arquivo}` : 'Baixar o Conector'),
  emBreve: TEXTO_INDISPONIVEL,
  espera: 'Muitos links seguidos. Espere um minuto e tente de novo.',
  semAcesso: 'Só quem administra a empresa no portal baixa o Conector.',
});

/** O que a tela mostra quando gerar o link falha. */
export function falhaDoDownload(e: unknown): FalhaDoDownload {
  if (ehRotaAusente(e)) return { tipo: 'em-breve' };
  if (e instanceof ErroPortal) {
    if (e.status === 404 && e.codigo === CODIGO_CONECTOR_SEM_PACOTE) return { tipo: 'em-breve' };
    if (e.status === 501 || e.status === 503) return { tipo: 'em-breve' };
    if (e.status === 429) return { tipo: 'aviso', texto: TEXTOS_DOWNLOAD_CONECTOR.espera };
    if (e.status === 403) return { tipo: 'erro', texto: TEXTOS_DOWNLOAD_CONECTOR.semAcesso };
  }
  return { tipo: 'erro', texto: mensagemDoErro(e) };
}
