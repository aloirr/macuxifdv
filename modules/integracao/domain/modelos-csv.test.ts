import { describe, expect, it } from 'vitest';
import { ENTIDADES, SCHEMA_REGISTRO, Texto, VendedorPayload, type Entidade } from '../contracts';
import { converterCsvParaLote, lerCsv } from './carga-arquivo';
import { validarEnvelope } from './envelope';
import { ordemDeCargaDoPortal } from './portal-carga';
import { dicionarioDaEntidade, ENTIDADES_ORDEM_CARGA, gerarModeloCsv, RESUMO_MODELOS } from './modelos-csv';
import { DEPENDENCIAS } from './ordem';

const AGORA = '2026-11-06T12:00:00.000Z';

describe('RF-INT-03: modelos CSV gerados do contrato', () => {
  it.each(ENTIDADES)('RF-INT-03: o modelo de "%s" passa pelo parser e pela validação por linha do Hub (delta e completo)', (entidade) => {
    const { csv } = gerarModeloCsv(entidade);
    for (const modo of ['delta', 'completo'] as const) {
      const r = converterCsvParaLote({ entidade, modo, texto: csv, agora: AGORA, sessaoId: '11111111-1111-4111-8111-111111111111' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.linhasInvalidas).toEqual([]);
      expect(r.registros).toHaveLength(2);
      const env = validarEnvelope(r.envelope, { limiteRegistros: 5000, versoesSuportadas: ['v1'] });
      expect(env.ok).toBe(true);
      for (const reg of r.registros) {
        const v = SCHEMA_REGISTRO[entidade].safeParse(reg);
        expect(v.success, JSON.stringify(v.success ? null : v.error.issues)).toBe(true);
      }
    }
  });

  it.each(ENTIDADES)('RF-INT-03: "%s" começa com BOM, usa ";" e CRLF, e o cabeçalho põe os obrigatórios antes dos opcionais', (entidade) => {
    const { csv, campos } = gerarModeloCsv(entidade);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lido = lerCsv(csv);
    expect(lido.ok && lido.separador).toBe(';');
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')).toHaveLength(4); // cabeçalho + 2 linhas + fim
    const flags = campos.map((c) => c.obrigatorio);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(flags[0]).toBe(true);
    const nomes = campos.map((c) => c.campo);
    expect(nomes).toContain('alterado_em');
    expect(nomes).toContain('ativo');
    expect(nomes.indexOf('external_id')).toBe(0);
    expect(nomes).not.toContain('contatos');
    expect(nomes).not.toContain('paradas');
  });

  it.each(ENTIDADES)('RF-INT-03: o dicionário de "%s" cobre exatamente as colunas do cabeçalho, na mesma ordem', (entidade) => {
    const { csv, campos } = gerarModeloCsv(entidade);
    const lido = lerCsv(csv);
    expect(lido.ok && lido.cabecalho).toEqual(campos.map((c) => c.campo));
    const d = dicionarioDaEntidade(entidade);
    expect(d.campos).toEqual(campos);
    expect(d.arquivo).toBe(`${entidade}.csv`);
  });

  it('RF-INT-03: tipos, limites e formatos vêm do contrato', () => {
    const cliente = Object.fromEntries(dicionarioDaEntidade('cliente').campos.map((c) => [c.campo, c]));
    expect(cliente.razao_social).toMatchObject({ obrigatorio: true, tipo: 'texto', tamanho_max: 160 });
    expect(cliente.limite_credito_cents?.tipo).toBe('centavos');
    expect(cliente.bloqueado?.tipo).toBe('sim/não');
    expect(cliente['endereco.uf']).toMatchObject({ tamanho_max: 2, obrigatorio: false });
    expect(cliente.latitude?.formato).toContain('-90');
    const produto = Object.fromEntries(dicionarioDaEntidade('produto').campos.map((c) => [c.campo, c]));
    expect(produto.ean?.formato).toBe('8, 12, 13 ou 14 dígitos');
    expect(produto.embalagem_medida?.observacao).toContain('embalagem_quantidade');
    const preco = Object.fromEntries(dicionarioDaEntidade('preco').campos.map((c) => [c.campo, c]));
    expect(preco.vigencia_inicio).toMatchObject({ tipo: 'data', formato: 'AAAA-MM-DD', exemplo: '2026-11-01' });
    expect(preco.vigencia_fim?.observacao).toContain('vigencia_inicio');
    expect(dicionarioDaEntidade('vendedor').campos.find((c) => c.campo === 'alterado_em')).toMatchObject({ tipo: 'data-hora', obrigatorio: false });
    const titulo = Object.fromEntries(dicionarioDaEntidade('titulo').campos.map((c) => [c.campo, c]));
    expect(titulo.situacao).toMatchObject({ tipo: 'enum', exemplo: 'aberto' });
    expect(titulo.situacao?.formato).toContain('baixado');
    const no = Object.fromEntries(dicionarioDaEntidade('catalogo_no').campos.map((c) => [c.campo, c]));
    expect(no.nivel?.formato).toBe('inteiro de 1 a 8');
    expect(dicionarioDaEntidade('transportadora').campos.find((c) => c.campo === 'documento')?.formato).toBe('14 dígitos');
    expect(dicionarioDaEntidade('produto_unidade').campos.find((c) => c.campo === 'unidade')?.formato).toBe('1 a 4 letras maiúsculas');
  });

  it('RF-INT-03: mudar o contrato muda o cabeçalho e o dicionário (campo novo e campo que passa a ser obrigatório)', () => {
    const base = gerarModeloCsv('vendedor');
    const novo = gerarModeloCsv('vendedor', VendedorPayload.extend({ apelido: Texto(30) }));
    expect(base.campos.map((c) => c.campo)).not.toContain('apelido');
    const apelido = novo.campos.find((c) => c.campo === 'apelido');
    expect(apelido).toMatchObject({ obrigatorio: true, tipo: 'texto', tamanho_max: 30 });
    expect(novo.campos.findIndex((c) => c.campo === 'apelido')).toBeLessThan(novo.campos.findIndex((c) => c.campo === 'email'));
    expect(novo.csv.split('\r\n')[0]).toContain('apelido');
    expect(novo.csv).not.toBe(base.csv);

    const exigeEmail = gerarModeloCsv('vendedor', VendedorPayload.extend({ email: Texto(160) }));
    expect(base.campos.find((c) => c.campo === 'email')?.obrigatorio).toBe(false);
    expect(exigeEmail.campos.find((c) => c.campo === 'email')?.obrigatorio).toBe(true);
  });

  it('RF-INT-03: célula com ";" ou aspas vai entre aspas duplas e volta igual no parser', () => {
    const { csv } = gerarModeloCsv('vendedor', VendedorPayload.extend({ apelido: Texto(30) }), { apelido: ['Zé; "o" Rápido', 'Ana'] });
    const lido = lerCsv(csv);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    const i = lido.cabecalho.indexOf('apelido');
    expect(lido.linhas[0]?.celulas[i]).toBe('Zé; "o" Rápido');
  });

  it('RN-INT-04: a ordem de carga é a do portal (vendedor primeiro, 12 entidades, dependências antes, mesmos opcional/depende_de)', () => {
    const portal = ordemDeCargaDoPortal();
    expect(ENTIDADES_ORDEM_CARGA[0]).toBe('vendedor');
    expect([...ENTIDADES_ORDEM_CARGA]).toEqual(portal.map((i) => i.entidade));
    expect([...ENTIDADES_ORDEM_CARGA].sort()).toEqual([...ENTIDADES].sort());
    ENTIDADES_ORDEM_CARGA.forEach((e, i) => {
      for (const dep of DEPENDENCIAS[e]) expect(ENTIDADES_ORDEM_CARGA.indexOf(dep)).toBeLessThan(i);
    });
    expect(RESUMO_MODELOS.map((r) => ({ entidade: r.entidade, ordem: r.ordem, depende_de: r.depende_de, opcional: r.opcional }))).toEqual(
      portal.map((i) => ({ entidade: i.entidade, ordem: i.posicao, depende_de: i.depende_de, opcional: i.opcional })),
    );
    const cli = RESUMO_MODELOS.find((r) => r.entidade === 'cliente');
    expect(cli).toMatchObject({ arquivo: 'cliente.csv', depende_de: ['vendedor'], opcional: false });
  });

  it('RF-INT-03: as referências dos exemplos são coerentes com a ordem de carga (VEN-001 existe em vendedor e é usada em cliente)', () => {
    const idsDe = (e: Entidade) => (lerCsv(gerarModeloCsv(e).csv) as { ok: true; linhas: { celulas: string[] }[] }).linhas.map((l) => l.celulas[0]);
    expect(idsDe('vendedor')).toContain('VEN-001');
    const { csv } = gerarModeloCsv('cliente');
    expect(csv).toContain('VEN-001');
  });
});
