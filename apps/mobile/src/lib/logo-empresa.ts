/**
 * Logo da empresa (o cliente que licenciou) guardada no aparelho (T-0182; desenho docs/desenho/T-0182-logo-cliente.md §3.3;
 * spec docs/design/telas/logo-cliente.md §1, §3 e §5). Parte pura: a decisão e a orquestração, com o disco e a rede numa porta
 * (`PortaLogoEmpresa`, ligada em `services/logo-empresa.ts`).
 * - O aparelho sabe da logo pelos parâmetros do Core (`empresa_logo`, `empresaDosParametros` do SDK), que chegam a cada
 *   sincronização e ficam guardados (valem offline).
 * - Baixa só quando o sha256 muda (`GET /v1/me/empresa/logo/:sha256`), confere os bytes (`conferirLogo`, a mesma da API) e grava em
 *   `<documentos>/empresa/<tenant>/logo-<sha256>.<png|jpg>`; a anterior sai. Logo removida no portal = a cópia sai.
 * - Falha no download (sem sinal, 404, bytes inválidos): mantém o que tinha e tenta na próxima sincronização.
 * - Registro sem o arquivo (a pasta saiu por fora): vale como sem cópia e a logo é baixada de novo.
 * - A logo de um tenant nunca aparece em outro: a tela só usa a cópia do tenant da sessão (`logoDoTenant`); entrar em outra
 *   empresa apaga a pasta da anterior.
 */
import { conferirLogo, EXTENSAO_POR_TIPO, rotaLogoDoAparelho, type EmpresaDoAparelho, type LogoDoAparelho, type TipoLogo } from '@macuxi/platform-sdk';

/** Chave do registro da cópia no AsyncStorage (fora das chaves por usuário: a logo é da empresa). */
export const CHAVE_LOGO_EMPRESA = 'fv:empresa:logo';
/** Pasta das logos dentro dos documentos do app. */
export const PASTA_EMPRESA = 'empresa';

/** O que fica guardado da cópia: o suficiente para mostrar (caminho e proporção) e para decidir a próxima troca. */
export interface LogoGuardada {
  tenant_id: string;
  sha256: string;
  tipo: TipoLogo;
  largura_px: number;
  altura_px: number;
  /** Relativo aos documentos do app: `empresa/<tenant>/logo-<sha256>.<ext>`. */
  caminho: string;
}

export function caminhoDaLogo(tenantId: string, logo: Pick<LogoDoAparelho, 'sha256' | 'tipo'>): string {
  return `${PASTA_EMPRESA}/${tenantId}/logo-${logo.sha256}.${EXTENSAO_POR_TIPO[logo.tipo]}`;
}

/** Só a cópia do tenant da sessão vale (multi-tenant: a de outro nunca aparece). */
export function logoDoTenant(guardada: LogoGuardada | null, tenantId: string | null | undefined): LogoGuardada | null {
  return guardada && tenantId && guardada.tenant_id === tenantId ? guardada : null;
}

export type AcaoLogo = { tipo: 'manter' } | { tipo: 'apagar' } | { tipo: 'baixar'; logo: LogoDoAparelho };

/**
 * O que fazer com a cópia depois de uma sincronização. `empresa = null` (servidor anterior à T-0182 ou parâmetros ainda não
 * recebidos): nada muda, menos a cópia de outro tenant, que sai.
 */
export function acaoDaLogo(guardada: LogoGuardada | null, tenantId: string, empresa: EmpresaDoAparelho | null): AcaoLogo {
  const deOutro = guardada !== null && guardada.tenant_id !== tenantId;
  if (!empresa) return deOutro ? { tipo: 'apagar' } : { tipo: 'manter' };
  if (!empresa.logo) return guardada ? { tipo: 'apagar' } : { tipo: 'manter' };
  if (!deOutro && guardada?.sha256 === empresa.logo.sha256) return { tipo: 'manter' };
  return { tipo: 'baixar', logo: empresa.logo };
}

/** Disco, registro e rede (services/logo-empresa.ts); os testes passam uma em memória. */
export interface PortaLogoEmpresa {
  lerRegistro(): Promise<LogoGuardada | null>;
  gravarRegistro(l: LogoGuardada | null): Promise<void>;
  /** Bytes da rota do aparelho; `null` = vazio ou acima do limite. Lança sem sinal ou com erro do servidor. */
  baixar(rota: string): Promise<Uint8Array | null>;
  gravarArquivo(caminho: string, bytes: Uint8Array): Promise<void>;
  /** Apaga a pasta das logos inteira e o registro (troca de empresa, logo removida). */
  apagarTudo(): Promise<void>;
  apagarArquivo(caminho: string): Promise<void>;
  /** A cópia ainda está no disco e não está vazia? (a pasta pode ter saído por fora: aparelho bloqueado, RN-CORE-15). */
  existeArquivo(caminho: string): Promise<boolean>;
}

/**
 * Aplica a decisão e devolve a cópia que vale para o tenant (ou `null`). Nunca lança: falha de rede ou de disco mantém a
 * cópia que havia (se for do tenant) e a próxima sincronização tenta de novo.
 */
export async function atualizarLogoDaEmpresa(
  porta: PortaLogoEmpresa,
  p: { tenantId: string; empresa: EmpresaDoAparelho | null; online: boolean },
): Promise<LogoGuardada | null> {
  let guardada: LogoGuardada | null = null;
  try {
    guardada = await porta.lerRegistro();
    // registro sem o arquivo (a pasta saiu por fora, ex.: aparelho bloqueado): vale como sem cópia e a logo volta a ser baixada
    if (guardada && !(await porta.existeArquivo(guardada.caminho))) {
      await porta.gravarRegistro(null);
      guardada = null;
    }
    const acao = acaoDaLogo(guardada, p.tenantId, p.empresa);
    if (acao.tipo === 'manter') return logoDoTenant(guardada, p.tenantId);
    if (acao.tipo === 'apagar') {
      await porta.apagarTudo();
      return null;
    }
    // a de outro tenant sai antes de qualquer download (nunca fica à vista de quem entrou em outra empresa)
    if (guardada && guardada.tenant_id !== p.tenantId) {
      await porta.apagarTudo();
      guardada = null;
    }
    if (!p.online) return logoDoTenant(guardada, p.tenantId);
    const bytes = await porta.baixar(rotaLogoDoAparelho(acao.logo.sha256));
    if (!bytes || !conferirLogo(bytes, acao.logo.tipo).ok) return logoDoTenant(guardada, p.tenantId);
    const nova: LogoGuardada = {
      tenant_id: p.tenantId,
      sha256: acao.logo.sha256,
      tipo: acao.logo.tipo,
      largura_px: acao.logo.largura_px,
      altura_px: acao.logo.altura_px,
      caminho: caminhoDaLogo(p.tenantId, acao.logo),
    };
    await porta.gravarArquivo(nova.caminho, bytes);
    await porta.gravarRegistro(nova);
    if (guardada && guardada.caminho !== nova.caminho) await porta.apagarArquivo(guardada.caminho).catch(() => undefined);
    return nova;
  } catch {
    return logoDoTenant(guardada, p.tenantId);
  }
}

/** Data URI da cópia (o PDF embute a logo assim): `data:image/png;base64,…`. */
export function dataUriDaLogo(tipo: TipoLogo, base64: string): string {
  return `data:${tipo};base64,${base64}`;
}

/**
 * Item 15 (teste de campo do Campo v1.0.16): com `empresa_ocultar_marca_macuxi` ligada no portal e a logo da empresa no aparelho,
 * as telas mostram só a logo do cliente no lugar da do Macuxi. Sem a logo (ou antes da primeira cópia), a do Macuxi continua.
 */
export function soLogoDoCliente(ocultarMarcaMacuxi: boolean, temLogoDoCliente: boolean): boolean {
  return ocultarMarcaMacuxi && temLogoDoCliente;
}
