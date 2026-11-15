/**
 * Rodapé legal da tela Entrar (docs/design/telas/rodape-legal.md §2; R-20261114-221000-alexandre): monta as até três
 * linhas a partir dos dados legais (rota pública `/v1/publico/dados-legais`), da versão do app e do ano do aparelho.
 * Função pura. Campo em branco não aparece; sem versão, a linha 3 fica só com o site.
 * Pendência (RD-0433): a spec põe esta montagem no kit (`packages/ui/src/comum/legal.ts`, designer-ux); quando o kit tiver
 * `linhasDoRodapeLegal`, o shell passa a usar a dele e este arquivo sai.
 */
import { formatarDocumento, somenteDigitos } from '@macuxi/comum/documento';
import { normalizarSite, SITE_PADRAO, siteValido } from '@macuxi/platform-sdk';

/** Tipo estrutural (compatível com `DadosLegaisSchema`). */
export interface DadosDoRodape {
  razao_social: string | null;
  cnpj: string | null;
  site: string;
}

export interface LinhasDoRodapeLegal {
  /** Linha 1: razão social e/ou "CNPJ 00.000.000/0000-00"; `null` quando os dois estão em branco. */
  empresa: { razaoSocial: string | null; cnpj: string | null; leitor: string } | null;
  /** Linha 2. */
  direitos: { texto: string; leitor: string };
  /** Linha 3: "Versão X.Y.Z" (ou `null`) e o site, só o domínio. */
  versao: string | null;
  site: string;
  url: string;
}

/** Espaço sem quebra entre "CNPJ" e o número. */
const NBSP = ' ';

/** Site como o rodapé mostra; vazio ou inválido vira o padrão. */
export function siteDoRodape(bruto: string | null | undefined): string {
  const s = normalizarSite(bruto ?? '');
  return s && siteValido(s) ? s : SITE_PADRAO;
}

export function linhasDoRodapeLegal({ dados, versao, ano }: { dados: DadosDoRodape | null; versao: string | null | undefined; ano: number }): LinhasDoRodapeLegal {
  const razaoSocial = dados?.razao_social?.trim() || null;
  const digitos = somenteDigitos(dados?.cnpj);
  const cnpj = digitos ? `CNPJ${NBSP}${formatarDocumento(digitos)}` : null;
  const empresa =
    razaoSocial || cnpj
      ? { razaoSocial, cnpj, leitor: [razaoSocial, cnpj?.replace(NBSP, ' ')].filter(Boolean).join(', ') }
      : null;
  const site = siteDoRodape(dados?.site);
  const v = versao?.trim();
  return {
    empresa,
    direitos: { texto: `© ${ano} · Todos os direitos reservados`, leitor: `Copyright ${ano}. Todos os direitos reservados.` },
    versao: v ? `Versão ${v}` : null,
    site,
    url: `https://${site}`,
  };
}
