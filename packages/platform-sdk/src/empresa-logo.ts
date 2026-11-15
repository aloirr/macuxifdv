/**
 * Logo do cliente e nome fantasia (T-0182; desenho `docs/desenho/T-0182-logo-cliente.md`; spec `docs/design/telas/logo-cliente.md`).
 * Atributos do tenant (`plataforma.tenant`, migração 0081), gravados SÓ pelo super-admin no portal (RN-CORE-33):
 *   GET|PUT /v1/plataforma/empresas/:tenant_id/marca         nome fantasia (JSON) e o resumo da logo
 *   GET|PUT|DELETE /v1/plataforma/empresas/:tenant_id/logo   bytes crus `image/png` ou `image/jpeg` (até 1 MiB)
 * O aparelho recebe pelos parâmetros do Core (`empresa_nome`, `empresa_logo`; `empresaDosParametros`) e baixa os bytes por
 * `GET /v1/me/empresa/logo/:sha256`. Puro TypeScript: a mesma conferência (`conferirLogo`) vale na API e no portal.
 */
import { rotuloDaLogo } from '@macuxi/comum/marca';
import { z } from 'zod';
import { detectarTipoImagem, dimensoesImagem } from './imagens';

export const TIPOS_LOGO = ['image/png', 'image/jpeg'] as const;
export type TipoLogo = (typeof TIPOS_LOGO)[number];

/** Limites da logo (spec §2; o lado máximo protege o aparelho e o PDF de imagem gigante, desenho §2.2). */
export const LIMITES_LOGO = { bytes: 1_048_576, alturaMinPx: 200, ladoMaxPx: 4096, tipos: TIPOS_LOGO } as const;
export const MAX_NOME_FANTASIA = 80;

/** Os limites como a pessoa lê (RD-0703): MB inteiro (1 MiB = 1 MB na tela) e px. */
const MB_LOGO = LIMITES_LOGO.bytes / 1_048_576;
/** Linha dos limites no cartão da logo do portal (spec §2). */
export const TEXTO_LIMITES_LOGO = `PNG ou JPG · até ${MB_LOGO} MB · pelo menos ${LIMITES_LOGO.alturaMinPx} px de altura`;

export const CODIGOS_LOGO = {
  /** 415 (Content-Type) ou 422 (assinatura ou cabeçalho). */
  formato: 'LOGO_FORMATO',
  /** 413: acima de `LIMITES_LOGO.bytes`. */
  grande: 'LOGO_GRANDE_DEMAIS',
  /** 422: altura abaixo de `LIMITES_LOGO.alturaMinPx`. */
  altura: 'LOGO_ALTURA_MINIMA',
  /** 422: largura ou altura acima de `LIMITES_LOGO.ladoMaxPx`. */
  lado: 'LOGO_LADO_MAXIMO',
  /** 404: a empresa não tem logo (ou o sha256 pedido não é o atual). */
  naoEncontrada: 'LOGO_NAO_ENCONTRADA',
} as const;
export type CodigoLogo = (typeof CODIGOS_LOGO)[keyof typeof CODIGOS_LOGO];

/** Frases do portal (spec §2), montadas dos limites. */
export const MENSAGENS_LOGO: Readonly<Record<CodigoLogo, string>> = {
  LOGO_FORMATO: 'Use um arquivo PNG ou JPG.',
  LOGO_GRANDE_DEMAIS: `O arquivo passa de ${MB_LOGO} MB. Envie um menor.`,
  LOGO_ALTURA_MINIMA: `A imagem tem menos de ${LIMITES_LOGO.alturaMinPx} px de altura. Envie uma maior.`,
  LOGO_LADO_MAXIMO: `A imagem passa de ${LIMITES_LOGO.ladoMaxPx} px de largura ou altura. Envie uma menor.`,
  LOGO_NAO_ENCONTRADA: 'Esta empresa ainda não tem logo.',
};

export const ehTipoLogo = (t: unknown): t is TipoLogo => typeof t === 'string' && (TIPOS_LOGO as readonly string[]).includes(t);

/** Resultado da conferência dos bytes; o `status` é o HTTP da recusa. */
export type ConferenciaLogo =
  | { ok: true; tipo: TipoLogo; largura_px: number; altura_px: number }
  | { ok: false; status: 413 | 415 | 422; codigo: CodigoLogo };

/**
 * Confere a logo antes de gravar (desenho §2.2, nesta ordem): tipo declarado fora de PNG/JPEG = 415; acima de 1 MiB = 413;
 * assinatura diferente do tipo declarado ou cabeçalho ilegível = 422 `LOGO_FORMATO`; altura < 200 px = 422
 * `LOGO_ALTURA_MINIMA`; maior lado > 4096 px = 422 `LOGO_LADO_MAXIMO`. Só lê o cabeçalho (nada é decodificado).
 */
export function conferirLogo(bytes: Uint8Array, tipoDeclarado: string | null | undefined): ConferenciaLogo {
  const tipo = (tipoDeclarado ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ehTipoLogo(tipo)) return { ok: false, status: 415, codigo: CODIGOS_LOGO.formato };
  if (bytes.length > LIMITES_LOGO.bytes) return { ok: false, status: 413, codigo: CODIGOS_LOGO.grande };
  if (bytes.length === 0 || detectarTipoImagem(bytes) !== tipo) return { ok: false, status: 422, codigo: CODIGOS_LOGO.formato };
  const dim = dimensoesImagem(bytes, tipo);
  if (!dim) return { ok: false, status: 422, codigo: CODIGOS_LOGO.formato };
  if (dim.altura < LIMITES_LOGO.alturaMinPx) return { ok: false, status: 422, codigo: CODIGOS_LOGO.altura };
  if (Math.max(dim.largura, dim.altura) > LIMITES_LOGO.ladoMaxPx) return { ok: false, status: 422, codigo: CODIGOS_LOGO.lado };
  return { ok: true, tipo, largura_px: dim.largura, altura_px: dim.altura };
}

// ---------- rotas ----------
export const rotaMarcaEmpresa = (tenantId: string): string => `/v1/plataforma/empresas/${tenantId}/marca`;
export const rotaLogoEmpresa = (tenantId: string): string => `/v1/plataforma/empresas/${tenantId}/logo`;
/** Bytes da logo para o aparelho e o BKO (sessão do app, tenant do token); o endereço muda com o sha256. */
export const ROTA_ME_EMPRESA_LOGO = '/v1/me/empresa/logo';
export const rotaLogoDoAparelho = (sha256: string): string => `${ROTA_ME_EMPRESA_LOGO}/${sha256}`;

// ---------- contratos ----------
/** sha256 em hex minúsculo: endereço da logo (`rotaLogoDoAparelho`) e parâmetro da rota na API. */
export const Sha256LogoSchema = z.string().regex(/^[0-9a-f]{64}$/);
const Px = z.number().int().min(1).max(LIMITES_LOGO.ladoMaxPx);

export const EmpresaLogoSchema = z
  .object({
    sha256: Sha256LogoSchema,
    tipo: z.enum(TIPOS_LOGO),
    tamanho_bytes: z.number().int().min(1).max(LIMITES_LOGO.bytes),
    largura_px: Px,
    altura_px: Px.min(LIMITES_LOGO.alturaMinPx),
    atualizada_em: z.string().datetime({ offset: true }),
  })
  .strict();
export type EmpresaLogo = z.output<typeof EmpresaLogoSchema>;

/** Resposta das rotas `marca` e `logo` do portal. `razao_social` = `plataforma.tenant.nome`. */
export const MarcaEmpresaSchema = z
  .object({
    tenant_id: z.string().uuid(),
    razao_social: z.string(),
    nome_fantasia: z.string().min(1).max(MAX_NOME_FANTASIA).nullable(),
    logo: EmpresaLogoSchema.nullable(),
  })
  .strict();
export type MarcaEmpresa = z.output<typeof MarcaEmpresaSchema>;

/** Corpo do `PUT .../marca`: vazio ou só espaços = apaga (vale a razão social). */
export const GravarNomeFantasiaSchema = z
  .object({
    nome_fantasia: z
      .string()
      .trim()
      .max(MAX_NOME_FANTASIA, `Use até ${MAX_NOME_FANTASIA} caracteres.`)
      .nullable()
      .transform((s) => (s ? s : null)),
  })
  .strict();
export type GravarNomeFantasia = z.output<typeof GravarNomeFantasiaSchema>;

/** "Licenciado para <x>" (spec §5): o nome fantasia; vazio = a razão social. */
export function nomeDaEmpresa(nomeFantasia: string | null | undefined, razaoSocial: string): string {
  const f = nomeFantasia?.trim();
  return f ? f : razaoSocial;
}

/** "Logo da <nome>" (spec §1): `alt` da logo no portal; a placa do kit usa a mesma função de `@macuxi/comum/marca`. */
export { rotuloDaLogo };

// ---------- no aparelho (parâmetros do Core, desenho §3.1) ----------
/** Chaves reservadas nos parâmetros do Core: a API sempre sobrescreve (uma linha de `plataforma.parametro` com o mesmo nome não vale). */
export const PARAMETRO_EMPRESA_NOME = 'empresa_nome';
export const PARAMETRO_EMPRESA_LOGO = 'empresa_logo';

/** `empresa_logo`: o suficiente para baixar (`rotaLogoDoAparelho(sha256)`), guardar com a extensão e desenhar a placa. */
export const LogoDoAparelhoSchema = z
  .object({ sha256: Sha256LogoSchema, tipo: z.enum(TIPOS_LOGO), largura_px: Px, altura_px: Px })
  .strict();
export type LogoDoAparelho = z.output<typeof LogoDoAparelhoSchema>;

/**
 * Largura ÷ altura da logo: a ÚNICA fonte da proporção (RD-0921). Vem dos px gravados na API (`conferirLogo`), então a placa
 * já nasce do tamanho certo, sem esperar a imagem carregar. O schema garante px ≥ 1.
 */
export const proporcaoDaLogo = (l: Pick<LogoDoAparelho, 'largura_px' | 'altura_px'>): number => l.largura_px / l.altura_px;

export const EmpresaDoAparelhoSchema = z.object({ nome: z.string().min(1), logo: LogoDoAparelhoSchema.nullable() }).strict();
export type EmpresaDoAparelho = z.output<typeof EmpresaDoAparelhoSchema>;

/** Linha do tenant que a API lê (`licencas.ts`) para montar as chaves reservadas. */
export interface LinhaMarcaTenant {
  nome: string;
  nome_fantasia: string | null;
  logo_sha256: string | null;
  logo_tipo: string | null;
  logo_largura_px: number | null;
  logo_altura_px: number | null;
}

/** As duas chaves reservadas do Core, prontas para os parâmetros (API). Logo incompleta ou fora do contrato = `null`. */
export function parametrosDaEmpresa(t: LinhaMarcaTenant): { empresa_nome: string; empresa_logo: LogoDoAparelho | null } {
  const logo = LogoDoAparelhoSchema.safeParse({ sha256: t.logo_sha256, tipo: t.logo_tipo, largura_px: t.logo_largura_px, altura_px: t.logo_altura_px });
  return { empresa_nome: nomeDaEmpresa(t.nome_fantasia, t.nome), empresa_logo: logo.success ? logo.data : null };
}

/**
 * Empresa como o shell guarda (lida dos parâmetros do Core, `ambiente.parametros('core')`). `null` = servidor anterior à
 * T-0182 (sem as chaves) ou nome ausente; logo fora do contrato = sem logo (o aparelho nunca baixa nada inválido).
 */
export function empresaDosParametros(parametrosCore: Readonly<Record<string, unknown>> | null | undefined): EmpresaDoAparelho | null {
  const nome = parametrosCore?.[PARAMETRO_EMPRESA_NOME];
  if (typeof nome !== 'string' || nome.trim() === '') return null;
  const logo = LogoDoAparelhoSchema.safeParse(parametrosCore?.[PARAMETRO_EMPRESA_LOGO]);
  return { nome, logo: logo.success ? logo.data : null };
}
