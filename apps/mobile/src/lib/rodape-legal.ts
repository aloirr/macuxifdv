/**
 * Rodapé legal da tela Entrar (docs/design/telas/rodape-legal.md §2; R-20261114-221000-alexandre): monta as até três
 * linhas a partir dos dados legais (rota pública `/v1/publico/dados-legais`), da versão do app e do ano do aparelho.
 * Função pura. Campo em branco não aparece; sem versão, a linha 3 fica só com o site.
 * Pendência: a spec põe esta montagem no kit (`packages/ui/src/comum/legal.ts`, designer-ux); quando o kit tiver
 * `linhasDoRodapeLegal`, o shell passa a usar a dele e este arquivo sai.
 */
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

/** Máscara `00.000.000/0000-00` (só com 14 dígitos; senão devolve os dígitos como vieram). */
export function mascaraCnpj(digitos: string): string {
  const d = digitos.replace(/\D/g, '');
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Site como o rodapé mostra; vazio ou inválido vira o padrão. */
export function siteDoRodape(bruto: string | null | undefined): string {
  const s = normalizarSite(bruto ?? '');
  return s && siteValido(s) ? s : SITE_PADRAO;
}

export function linhasDoRodapeLegal({ dados, versao, ano }: { dados: DadosDoRodape | null; versao: string | null | undefined; ano: number }): LinhasDoRodapeLegal {
  const razaoSocial = dados?.razao_social?.trim() || null;
  const digitos = dados?.cnpj?.replace(/\D/g, '') ?? '';
  const cnpj = digitos ? `CNPJ${NBSP}${mascaraCnpj(digitos)}` : null;
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
