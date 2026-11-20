/**
 * T-0182 — logo da empresa no aparelho (desenho docs/desenho/T-0182-logo-cliente.md §3.3): baixa só quando o sha256 muda, guarda
 * em `empresa/<tenant>/logo-<sha>.<ext>`, apaga a anterior, vale offline, mantém a cópia quando o download falha e nunca mostra
 * a logo de um tenant em outro.
 */
import type { EmpresaDoAparelho } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import {
  acaoDaLogo,
  atualizarLogoDaEmpresa,
  caminhoDaLogo,
  dataUriDaLogo,
  logoDoTenant,
  soLogoDoCliente,
  type LogoGuardada,
  type PortaLogoEmpresa,
} from './logo-empresa';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SHA_1 = 'a'.repeat(64);
const SHA_2 = 'b'.repeat(64);

function pngFalso(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  return b;
}

const empresa = (sha: string | null, tipo: 'image/png' | 'image/jpeg' = 'image/png'): EmpresaDoAparelho => ({
  nome: 'Exemplo Norte',
  logo: sha ? { sha256: sha, tipo, largura_px: 600, altura_px: 240 } : null,
});
const guardada = (tenant: string, sha: string): LogoGuardada => ({
  tenant_id: tenant,
  sha256: sha,
  tipo: 'image/png',
  largura_px: 600,
  altura_px: 240,
  caminho: caminhoDaLogo(tenant, { sha256: sha, tipo: 'image/png' }),
});

/** Porta em memória: registro, arquivos e as rotas baixadas. */
function portaFalsa(inicial: LogoGuardada | null, resposta: Uint8Array | null | Error = pngFalso(600, 240)) {
  const estado = { registro: inicial, arquivos: new Set<string>(inicial ? [inicial.caminho] : []), baixadas: [] as string[], apagouTudo: 0 };
  const porta: PortaLogoEmpresa = {
    lerRegistro: async () => estado.registro,
    gravarRegistro: async (l) => {
      estado.registro = l;
    },
    baixar: async (rota) => {
      estado.baixadas.push(rota);
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
    gravarArquivo: async (c) => {
      estado.arquivos.add(c);
    },
    apagarTudo: async () => {
      estado.apagouTudo++;
      estado.arquivos.clear();
      estado.registro = null;
    },
    apagarArquivo: async (c) => {
      estado.arquivos.delete(c);
    },
    existeArquivo: async (c) => estado.arquivos.has(c),
  };
  return { porta, estado };
}

describe('caminho e leitura', () => {
  it('documentos/empresa/<tenant>/logo-<sha>.<png|jpg>', () => {
    expect(caminhoDaLogo(TENANT_A, { sha256: SHA_1, tipo: 'image/png' })).toBe(`empresa/${TENANT_A}/logo-${SHA_1}.png`);
    expect(caminhoDaLogo(TENANT_A, { sha256: SHA_1, tipo: 'image/jpeg' })).toBe(`empresa/${TENANT_A}/logo-${SHA_1}.jpg`);
  });
  it('só a cópia do tenant da sessão vale', () => {
    const g = guardada(TENANT_A, SHA_1);
    expect(logoDoTenant(g, TENANT_A)).toBe(g);
    expect(logoDoTenant(g, TENANT_B)).toBeNull();
    expect(logoDoTenant(g, null)).toBeNull();
  });
  it('data URI', () => {
    expect(dataUriDaLogo('image/jpeg', 'QUJD')).toBe('data:image/jpeg;base64,QUJD');
  });
});

describe('decisão depois da sincronização', () => {
  it('mesmo sha do mesmo tenant: nada a fazer; sha novo: baixar', () => {
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_A, empresa(SHA_1))).toEqual({ tipo: 'manter' });
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_A, empresa(SHA_2)).tipo).toBe('baixar');
    expect(acaoDaLogo(null, TENANT_A, empresa(SHA_1)).tipo).toBe('baixar');
  });
  it('logo removida no portal: apagar; sem nada guardado: nada', () => {
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_A, empresa(null))).toEqual({ tipo: 'apagar' });
    expect(acaoDaLogo(null, TENANT_A, empresa(null))).toEqual({ tipo: 'manter' });
  });
  it('servidor sem as chaves (empresa = null): mantém a do tenant e apaga a de outro', () => {
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_A, null)).toEqual({ tipo: 'manter' });
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_B, null)).toEqual({ tipo: 'apagar' });
  });
  it('outro tenant com o mesmo sha: baixa de novo (a cópia é por tenant)', () => {
    expect(acaoDaLogo(guardada(TENANT_A, SHA_1), TENANT_B, empresa(SHA_1)).tipo).toBe('baixar');
  });
});

describe('atualizarLogoDaEmpresa', () => {
  it('primeira vez: baixa pela rota do aparelho, grava e registra', async () => {
    const { porta, estado } = portaFalsa(null);
    const l = await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_1), online: true });
    expect(estado.baixadas).toEqual([`/v1/me/empresa/logo/${SHA_1}`]);
    expect(l).toEqual(guardada(TENANT_A, SHA_1));
    expect(estado.registro).toEqual(l);
    expect([...estado.arquivos]).toEqual([`empresa/${TENANT_A}/logo-${SHA_1}.png`]);
  });

  it('mesmo sha: não baixa de novo', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_1), online: true })).toEqual(guardada(TENANT_A, SHA_1));
    expect(estado.baixadas).toEqual([]);
  });

  it('troca: grava a nova e apaga a anterior', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    const l = await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_2), online: true });
    expect(l?.sha256).toBe(SHA_2);
    expect([...estado.arquivos]).toEqual([`empresa/${TENANT_A}/logo-${SHA_2}.png`]);
  });

  it('sem sinal: usa a cópia guardada e não baixa', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_2), online: false })).toEqual(guardada(TENANT_A, SHA_1));
    expect(estado.baixadas).toEqual([]);
  });

  it('download falha (rede, 404) ou bytes inválidos: mantém a que tinha', async () => {
    for (const resposta of [new Error('sem sinal'), null, new Uint8Array([1, 2, 3]), pngFalso(600, 120)]) {
      const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1), resposta);
      expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_2), online: true })).toEqual(guardada(TENANT_A, SHA_1));
      expect(estado.registro).toEqual(guardada(TENANT_A, SHA_1));
    }
  });

  it('logo removida no portal: apaga a cópia e o registro', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(null), online: true })).toBeNull();
    expect(estado.registro).toBeNull();
    expect(estado.arquivos.size).toBe(0);
  });

  it('multi-tenant: entrar na empresa B nunca devolve a logo da A, nem sem sinal nem com o download falhando', async () => {
    for (const p of [{ online: false, resposta: pngFalso(600, 240) }, { online: true, resposta: new Error('sem sinal') }]) {
      const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1), p.resposta);
      expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_B, empresa: empresa(SHA_1), online: p.online })).toBeNull();
      // a pasta da A saiu
      expect(estado.registro).toBeNull();
      expect(estado.apagouTudo).toBe(1);
    }
  });

  it('pasta apagada por fora (aparelho bloqueado) e o registro ficou: a mesma logo volta no próximo login', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    estado.arquivos.clear();
    const l = await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_1), online: true });
    expect(estado.baixadas).toEqual([`/v1/me/empresa/logo/${SHA_1}`]);
    expect(l).toEqual(guardada(TENANT_A, SHA_1));
    expect([...estado.arquivos]).toEqual([`empresa/${TENANT_A}/logo-${SHA_1}.png`]);
  });

  it('pasta apagada por fora e sem sinal: sem logo (nunca aponta para arquivo que não existe), registro limpo', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    estado.arquivos.clear();
    expect(await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_A, empresa: empresa(SHA_1), online: false })).toBeNull();
    expect(estado.registro).toBeNull();
    expect(estado.baixadas).toEqual([]);
  });

  it('multi-tenant: B com logo própria baixa a dela, na pasta dela', async () => {
    const { porta, estado } = portaFalsa(guardada(TENANT_A, SHA_1));
    const l = await atualizarLogoDaEmpresa(porta, { tenantId: TENANT_B, empresa: empresa(SHA_2), online: true });
    expect(l).toEqual(guardada(TENANT_B, SHA_2));
    expect([...estado.arquivos]).toEqual([`empresa/${TENANT_B}/logo-${SHA_2}.png`]);
  });
});

describe('Item 15 (v1.0.17): ocultar a logomarca do Macuxi', () => {
  it('só com a chave ligada e a logo do cliente no aparelho a tela mostra só a do cliente', () => {
    expect(soLogoDoCliente(true, true)).toBe(true);
  });
  it('sem a logo do cliente, a do Macuxi continua, com a chave ligada ou não', () => {
    expect(soLogoDoCliente(true, false)).toBe(false);
    expect(soLogoDoCliente(false, false)).toBe(false);
  });
  it('chave desligada (o padrão, também no servidor anterior à 0091): as duas, como na T-0182', () => {
    expect(soLogoDoCliente(false, true)).toBe(false);
  });
});
