/**
 * Comando `pnpm tenant:codigo-licenca` (ADR 0048, migração 0068 §6; R-20261114-204500-alexandre): dá o código da licença
 * (UF + 4 dígitos) às empresas com o código de antes. Banco FALSO e consulta de CNPJ FALSA: a função
 * `plataforma.atribuir_codigo_licenca` é do banco-dados e o teste dela roda no CI com Postgres.
 * Aqui: filtro dos legados, máscara do CNPJ, montagem da linha, motivo sem mudança, `--simular` e saída sem CNPJ em claro.
 */
import { describe, expect, it } from 'vitest';
import {
  cnpjDoTenant,
  ehCodigoLicenca,
  executarCodigoLicenca,
  filtrarLegados,
  mascararCnpj,
  type BancoCodigoLicenca,
  type TenantDoBanco,
} from '../src/cli/codigo-licenca';
import type { ConsultaCnpj, ResultadoConsultaCnpj } from '../src/consulta-cnpj';

const CNPJ_RS = '11222333000181';
const CNPJ_AM = '00000000000191';

function tenant(p: Partial<TenantDoBanco> & { codigo: string }): TenantDoBanco {
  return { id: `00000000-0000-4000-8000-${String(p.codigo.length).padStart(12, '0')}`, status: 'ativo', excluido: false, documento: null, cnpj_filial: null, ...p };
}

const THATHYANY = tenant({ id: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b', codigo: 'thathyany', documento: CNPJ_AM });

function dados(cnpj: string, uf: string | null) {
  return {
    cnpj,
    razao_social: 'EMPRESA',
    nome_fantasia: null,
    endereco: { logradouro: null, numero: null, complemento: null, bairro: null },
    municipio: null,
    uf,
    cep: null,
    situacao_cadastral: 'ativa',
    cnae_principal: null,
    telefone: null,
    email: null,
    fonte: 'brasilapi',
  } as const;
}

/** Consulta falsa: UF por CNPJ; `fora`/`nao_encontrado`/`sem_uf` pelo mapa. */
function consultaFalsa(mapa: Record<string, string | 'fora' | 'nao_encontrado' | 'sem_uf'>): ConsultaCnpj & { pedidos: string[] } {
  const pedidos: string[] = [];
  return {
    pedidos,
    async consultar(cnpj) {
      pedidos.push(cnpj);
      const base = { cache: false, tentativas: [] };
      const v = mapa[cnpj];
      if (v === undefined || v === 'nao_encontrado') return { resultado: 'nao_encontrado', ...base };
      if (v === 'fora') return { resultado: 'fora', ...base };
      return { resultado: 'ok', dados: dados(cnpj, v === 'sem_uf' ? null : v), ...base } as ResultadoConsultaCnpj;
    },
  };
}

function bancoFalso(tenants: TenantDoBanco[], o: { falha?: unknown } = {}) {
  const chamadas: { tenantId: string; uf: string; simular: boolean }[] = [];
  let fechou = 0;
  const banco: BancoCodigoLicenca = {
    async buscarPorCodigo(codigo) {
      return tenants.find((t) => t.codigo.toLowerCase() === codigo.toLowerCase()) ?? null;
    },
    async listarTenants() {
      return tenants;
    },
    async atribuir(tenantId, uf, { simular }) {
      chamadas.push({ tenantId, uf, simular });
      if (o.falha) throw o.falha;
      const t = tenants.find((x) => x.id === tenantId)!;
      return { tenant_id: tenantId, codigo_anterior: t.codigo, codigo: `${uf}4821`, resultado: 'atribuido' };
    },
    async fechar() {
      fechou++;
    },
  };
  return { banco, chamadas, fechou: () => fechou };
}

async function rodar(args: string[], tenants: TenantDoBanco[], consulta: ConsultaCnpj, o: { falha?: unknown } = {}) {
  const b = bancoFalso(tenants, o);
  const saida: string[] = [];
  const erro: string[] = [];
  const codigo = await executarCodigoLicenca(args, {
    consulta,
    abrirBanco: async () => b.banco,
    saida: (l) => saida.push(l),
    erro: (l) => erro.push(l),
  });
  return { codigo, linhas: saida.map((l) => JSON.parse(l) as Record<string, unknown>), saida, erro, chamadas: b.chamadas, fechou: b.fechou() };
}

describe('código da licença (partes puras)', () => {
  it('ehCodigoLicenca: só UF válida em maiúsculas + 4 dígitos (CODIGO_EMPRESA_REGEX do core, sem a flag i; o CHECK da 0068)', () => {
    expect(ehCodigoLicenca('AM4821')).toBe(true);
    expect(ehCodigoLicenca('RS0000')).toBe(true);
    expect(ehCodigoLicenca('am4821')).toBe(false);
    expect(ehCodigoLicenca('XX4821')).toBe(false);
    expect(ehCodigoLicenca('AM482')).toBe(false);
    expect(ehCodigoLicenca('AM48210')).toBe(false);
    expect(ehCodigoLicenca('thathyany')).toBe(false);
    expect(ehCodigoLicenca('demo')).toBe(false);
  });

  it('filtrarLegados: só tenant vivo (nem encerrado nem excluído) com código fora do formato UF+4', () => {
    const lista = [
      tenant({ codigo: 'thathyany' }),
      tenant({ codigo: 'AM4821' }),
      tenant({ codigo: 'velha', status: 'encerrado' }),
      tenant({ codigo: 'apagada', excluido: true }),
      tenant({ codigo: 'suspensa', status: 'suspenso' }),
    ];
    expect(filtrarLegados(lista).map((t) => t.codigo)).toEqual(['thathyany', 'suspensa']);
  });

  it('mascararCnpj: só a raiz inicial e a ordem do estabelecimento; fora do formato = ***', () => {
    expect(mascararCnpj('63476142000140')).toBe('63.***.***/0001-**');
    expect(mascararCnpj('63.476.142/0001-40')).toBe('63.***.***/0001-**');
    expect(mascararCnpj('123')).toBe('***');
  });

  it('cnpjDoTenant: plataforma.tenant.documento primeiro; sem ele (ou inválido), o CNPJ da filial (core.filial)', () => {
    expect(cnpjDoTenant(tenant({ codigo: 'a', documento: CNPJ_AM, cnpj_filial: CNPJ_RS }))).toEqual({ cnpj: CNPJ_AM, origem: 'tenant.documento' });
    expect(cnpjDoTenant(tenant({ codigo: 'a', documento: null, cnpj_filial: CNPJ_RS }))).toEqual({ cnpj: CNPJ_RS, origem: 'filial' });
    expect(cnpjDoTenant(tenant({ codigo: 'a', documento: '11222333000182', cnpj_filial: CNPJ_RS }))).toEqual({ cnpj: CNPJ_RS, origem: 'filial' });
    expect(cnpjDoTenant(tenant({ codigo: 'a', documento: '  ', cnpj_filial: null }))).toBeNull();
  });
});

describe('tenant:codigo-licenca', () => {
  it('--codigo: lê o CNPJ do banco, consulta a UF e chama atribuir_codigo_licenca; uma linha JSON com o CNPJ mascarado', async () => {
    const consulta = consultaFalsa({ [CNPJ_AM]: 'AM' });
    const r = await rodar(['--codigo', 'thathyany'], [THATHYANY], consulta);
    expect(r.codigo).toBe(0);
    expect(consulta.pedidos).toEqual([CNPJ_AM]);
    expect(r.chamadas).toEqual([{ tenantId: THATHYANY.id, uf: 'AM', simular: false }]);
    expect(r.linhas).toEqual([
      { codigo_anterior: 'thathyany', codigo: 'AM4821', resultado: 'atribuido', uf: 'AM', cnpj: '00.***.***/0001-**', origem_cnpj: 'tenant.documento' },
    ]);
    expect(r.saida.join('\n')).not.toContain(CNPJ_AM);
    expect(r.fechou).toBe(1);
  });

  it('--simular: a mesma chamada numa transação desfeita, e a linha diz simulado', async () => {
    const r = await rodar(['--codigo', 'THATHYANY', '--simular'], [THATHYANY], consultaFalsa({ [CNPJ_AM]: 'AM' }));
    expect(r.codigo).toBe(0);
    expect(r.chamadas).toEqual([{ tenantId: THATHYANY.id, uf: 'AM', simular: true }]);
    expect(r.linhas[0]).toMatchObject({ resultado: 'atribuido', simulado: true });
  });

  it('--todos-legados: um por tenant legado vivo, na ordem do banco; quem já tem o código da licença não entra', async () => {
    const b = tenant({ id: '11111111-1111-4111-8111-111111111111', codigo: 'demo', documento: null, cnpj_filial: CNPJ_RS });
    const r = await rodar(['--todos-legados'], [THATHYANY, tenant({ codigo: 'SP1234', documento: CNPJ_RS }), b], consultaFalsa({ [CNPJ_AM]: 'AM', [CNPJ_RS]: 'RS' }));
    expect(r.codigo).toBe(0);
    expect(r.chamadas.map((c) => c.uf)).toEqual(['AM', 'RS']);
    expect(r.linhas.map((l) => [l.codigo_anterior, l.codigo, l.origem_cnpj])).toEqual([
      ['thathyany', 'AM4821', 'tenant.documento'],
      ['demo', 'RS4821', 'filial'],
    ]);
  });

  it('--todos-legados sem nenhum legado: nenhuma linha, aviso no erro e saída 0', async () => {
    const r = await rodar(['--todos-legados'], [tenant({ codigo: 'AM4821' })], consultaFalsa({}));
    expect(r).toMatchObject({ codigo: 0, saida: [], chamadas: [] });
    expect(r.erro.join('\n')).toContain('nenhum tenant');
  });

  it('sem CNPJ, CNPJ não encontrado, fontes fora e sem UF: nada muda, o motivo vai no resultado e a saída é 4', async () => {
    const tenants = [
      tenant({ codigo: 'sem-cnpj' }),
      tenant({ codigo: 'nao-acha', documento: CNPJ_RS }),
      tenant({ codigo: 'fora-do-ar', documento: CNPJ_AM }),
    ];
    for (const [t, mapa, resultado] of [
      [tenants[0]!, {}, 'sem_cnpj'],
      [tenants[1]!, { [CNPJ_RS]: 'nao_encontrado' }, 'cnpj_nao_encontrado'],
      [tenants[2]!, { [CNPJ_AM]: 'fora' }, 'consulta_fora'],
      [tenants[2]!, { [CNPJ_AM]: 'sem_uf' }, 'sem_uf'],
    ] as const) {
      const r = await rodar(['--codigo', t.codigo], tenants, consultaFalsa(mapa));
      expect(r.codigo).toBe(4);
      expect(r.chamadas).toEqual([]);
      expect(r.linhas).toHaveLength(1);
      expect(r.linhas[0]).toMatchObject({ codigo_anterior: t.codigo, codigo: t.codigo, resultado });
      expect(typeof r.linhas[0]!.motivo).toBe('string');
      expect(r.saida.join('\n')).not.toMatch(/\d{14}/);
    }
  });

  it('--codigo de quem já tem o código da licença: sem_mudanca, sem consultar nem gravar', async () => {
    const consulta = consultaFalsa({ [CNPJ_AM]: 'AM' });
    const r = await rodar(['--codigo', 'am4821'], [tenant({ codigo: 'AM4821', documento: CNPJ_AM })], consulta);
    expect(r.codigo).toBe(0);
    expect(consulta.pedidos).toEqual([]);
    expect(r.chamadas).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ codigo_anterior: 'AM4821', codigo: 'AM4821', resultado: 'sem_mudanca' });
  });

  it('--codigo de tenant encerrado: nada muda (resultado encerrado, saída 4)', async () => {
    const r = await rodar(['--codigo', 'velha'], [tenant({ codigo: 'velha', status: 'encerrado', documento: CNPJ_AM })], consultaFalsa({ [CNPJ_AM]: 'AM' }));
    expect(r.codigo).toBe(4);
    expect(r.chamadas).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ resultado: 'encerrado' });
  });

  it('--codigo inexistente: saída 3, nenhuma linha', async () => {
    const r = await rodar(['--codigo', 'nao-existe'], [THATHYANY], consultaFalsa({}));
    expect(r.codigo).toBe(3);
    expect(r.saida).toEqual([]);
    expect(r.erro.join('\n')).toContain('nao-existe');
    expect(r.fechou).toBe(1);
  });

  it('erro do banco: linha com resultado erro e só o código do Postgres (sem CNPJ), saída 1; os outros seguem', async () => {
    const r = await rodar(['--todos-legados'], [THATHYANY], consultaFalsa({ [CNPJ_AM]: 'AM' }), {
      falha: Object.assign(new Error(`falhou para ${CNPJ_AM}`), { code: '55000' }),
    });
    expect(r.codigo).toBe(1);
    expect(r.linhas[0]).toMatchObject({ codigo_anterior: 'thathyany', codigo: 'thathyany', resultado: 'erro' });
    expect(r.saida.join('\n')).not.toContain(CNPJ_AM);
  });

  it('resposta do banco fora do combinado (0068 §6) = erro', async () => {
    const b = bancoFalso([THATHYANY]);
    b.banco.atribuir = async () => ({ qualquer: 1 });
    const saida: string[] = [];
    const codigo = await executarCodigoLicenca(['--codigo', 'thathyany'], {
      consulta: consultaFalsa({ [CNPJ_AM]: 'AM' }),
      abrirBanco: async () => b.banco,
      saida: (l) => saida.push(l),
      erro: () => undefined,
    });
    expect(codigo).toBe(1);
    expect(JSON.parse(saida[0]!)).toMatchObject({ resultado: 'erro' });
  });

  it('uso errado = 2 sem abrir o banco: nenhum, os dois, código vazio ou argumento solto', async () => {
    for (const args of [[], ['--codigo', 'x', '--todos-legados'], ['--codigo', ''], ['solto'], ['--outra']]) {
      let abriu = 0;
      const codigo = await executarCodigoLicenca(args, {
        consulta: consultaFalsa({}),
        abrirBanco: async () => {
          abriu++;
          return bancoFalso([]).banco;
        },
        saida: () => undefined,
        erro: () => undefined,
      });
      expect(codigo).toBe(2);
      expect(abriu).toBe(0);
    }
  });
});
