/**
 * Download por link temporário (presign de bucket privado), no portal: o Conector on-premise (T-0098, aba Integração) e os APKs do
 * Macuxi Campo e do Macuxi Gestão (T-0190, aba Empresa; RN-CORE-67, ADR 0065). Um só fluxo para os três produtos:
 * - Conector: `POST /v1/integracao/conector/download` (`LinkDownloadConectorSchema`, ADR 0037; R-20261109-083700);
 * - Apps: `POST /v1/core/apps/download` com `{ variante }` (`LinkDownloadAppSchema`), só admin e super-admin.
 * Com o token do portal e `x-macuxi-tenant`, auditados no servidor, devolvem `{ url, expira_em, versao, arquivo, tamanho_bytes?,
 * sha256? }`. Sem a rota neste servidor (404 de rota, 501/503 sem storage, 404 do pacote não publicado), a tela mostra "em breve".
 * O link nunca é guardado: cada clique gera outro. Puro (roda em Node); a tela é `components/portal/baixar-conector.tsx`.
 */
import { CODIGO_APP_SEM_LICENCA, CODIGO_APP_SEM_PACOTE, LinkDownloadAppSchema } from '@macuxi/core/contracts';
import { CODIGO_CONECTOR_SEM_PACOTE, LinkDownloadConectorSchema, type LinkDownloadConector } from '@macuxi/integracao/contracts';
import { NOME_APP_VARIANTE, VARIANTES_APP } from '@macuxi/platform-sdk';

import { ehRotaAusente, ErroPortal, mensagemDoErro } from './portal-api';
import { ROTAS_PORTAL } from './portal-rotas';

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
export const LinkDownloadAppResposta = LinkDownloadAppSchema.refine((l) => urlDeDownloadValida(l.url));

/** "12,3 MB" / "850 KB". */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} KB`;
}

/** Embaixo do link, só o tamanho ("12,3 MB"): o nome do arquivo, com a versão, já está no link (spec portal-config-enxuto §10). */
export function textoDoPacote(l: LinkDownloadConector): string | null {
  return l.tamanho_bytes ? tamanhoLegivel(l.tamanho_bytes) : null;
}

/** "O link vale até 01:30. Depois disso, gere outro." `hora` formata no fuso de quem vê (o contrato sempre manda `expira_em`). */
export function textoDaValidade(l: LinkDownloadConector, hora: (iso: string) => string): string {
  return `O link vale até ${hora(l.expira_em)}. Depois disso, gere outro.`;
}

/** Textos de um produto baixável. `nome` abre a linha do "em breve" e a do "sem licença" (`nome: texto`). */
export interface TextosDownload {
  nome: string;
  botao: string;
  gerando: string;
  baixar: (arquivo: string | null) => string;
  emBreve: string;
  espera: string;
  semAcesso: string;
  /** Só nos apps (403 `APP_SEM_LICENCA`). */
  semLicenca?: string;
}

const GERANDO = 'Gerando o link…';
const ESPERA = 'Muitos links seguidos. Espere um minuto e tente de novo.';

export const TEXTOS_DOWNLOAD_CONECTOR: Readonly<TextosDownload> = Object.freeze({
  nome: 'Baixar o Conector',
  botao: 'Gerar o link do Conector',
  gerando: GERANDO,
  baixar: (arquivo: string | null) => (arquivo ? `Baixar ${arquivo}` : 'Baixar o Conector'),
  emBreve: 'o pacote será publicado aqui em breve.',
  espera: ESPERA,
  semAcesso: 'Só quem administra a empresa no portal baixa o Conector.',
});

const textosDoApp = (nome: string): Readonly<TextosDownload> =>
  Object.freeze({
    nome,
    botao: `Gerar o link do ${nome}`,
    gerando: GERANDO,
    baixar: (arquivo: string | null) => (arquivo ? `Baixar ${arquivo}` : `Baixar o ${nome}`),
    emBreve: 'em breve.',
    espera: ESPERA,
    semAcesso: 'Só quem administra a empresa no portal baixa os apps.',
    semLicenca: 'sem licença. Peça ao suporte para ativar o módulo.',
  });

/** Um produto baixável pelo portal: rota, corpo, validação da resposta, código do "sem pacote", textos e prefixo dos testIDs. */
export interface ProdutoDownload {
  rota: string;
  corpo: Record<string, unknown>;
  schema: { safeParse(x: unknown): { success: true; data: LinkDownloadConector } | { success: false } };
  codigoSemPacote: string;
  textos: Readonly<TextosDownload>;
  testId: string;
}

export const DOWNLOAD_CONECTOR: ProdutoDownload = Object.freeze({
  rota: ROTAS_PORTAL.conectorDownload,
  corpo: {},
  schema: LinkDownloadConectorResposta,
  codigoSemPacote: CODIGO_CONECTOR_SEM_PACOTE,
  textos: TEXTOS_DOWNLOAD_CONECTOR,
  testId: 'integracao.baixar-conector',
});

/** Os APKs na ordem do cartão "Apps" (aba Empresa). testIDs: empresa-pagina.baixar-<variante>*. */
export const DOWNLOAD_APPS: readonly ProdutoDownload[] = VARIANTES_APP.map((variante) =>
  Object.freeze({
    rota: ROTAS_PORTAL.appDownload,
    corpo: { variante },
    schema: LinkDownloadAppResposta,
    codigoSemPacote: CODIGO_APP_SEM_PACOTE,
    textos: textosDoApp(NOME_APP_VARIANTE[variante]),
    testId: `empresa-pagina.baixar-${variante}`,
  }),
);

export type FalhaDoDownload = { tipo: 'em-breve' } | { tipo: 'sem-licenca' } | { tipo: 'aviso'; texto: string } | { tipo: 'erro'; texto: string };

/** O que a tela mostra quando gerar o link falha. */
export function falhaDoDownload(e: unknown, produto: ProdutoDownload = DOWNLOAD_CONECTOR): FalhaDoDownload {
  if (ehRotaAusente(e)) return { tipo: 'em-breve' };
  if (e instanceof ErroPortal) {
    if (e.status === 404 && e.codigo === produto.codigoSemPacote) return { tipo: 'em-breve' };
    if (e.status === 501 || e.status === 503) return { tipo: 'em-breve' };
    if (e.status === 429) return { tipo: 'aviso', texto: produto.textos.espera };
    if (e.status === 403 && e.codigo === CODIGO_APP_SEM_LICENCA && produto.textos.semLicenca) return { tipo: 'sem-licenca' };
    if (e.status === 403) return { tipo: 'erro', texto: produto.textos.semAcesso };
  }
  return { tipo: 'erro', texto: mensagemDoErro(e) };
}
