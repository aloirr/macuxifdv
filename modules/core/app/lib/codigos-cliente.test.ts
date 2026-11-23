import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClienteSync } from '../../contracts';
import { ROTULO_BUSCA_CLIENTE } from '../../domain';
import { subtituloDaFicha } from '../components/cliente360';
import { listarClientesLocais } from './cliente360-local';
import { codigosDoCliente, codigosParaBusca, textoDosCodigos } from './codigos-cliente';
import { entidadesCliente } from './entidades-cliente';
import { sobreporPreCadastros } from './pre-cadastro-local';

const ler = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
const ID = '3f1c2a52-3c1e-4f0a-9d49-7c4a5c0e1a11';
const cliente = (o: Partial<ClienteSync>): ClienteSync => ({
  id: ID, updated_at: '2026-11-23T00:00:00.000Z', deleted_at: null, external_id: null, documento: '11222333000181', razao_social: 'Mercado Boa Vista', nome_fantasia: null, segmento: null,
  telefone: null, email: null, logradouro: null, numero: null, bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: null, latitude: null, longitude: null, ativo: true, ...o,
});

describe('códigos do cliente: Código ERP e Código FDV (ADR 0069 item 10, v1.0.30)', () => {
  it('RN-CORE-78: sigla + valor, ERP primeiro; código vazio não aparece (sem sigla, traço ou texto)', () => {
    expect(textoDosCodigos({ external_id: 'C5007', codigo_fdv: '00012' })).toBe('ERP C5007 · FDV 00012');
    expect(textoDosCodigos({ external_id: null, codigo_fdv: '00012' })).toBe('FDV 00012');
    expect(textoDosCodigos({ external_id: '  ', codigo_fdv: undefined })).toBe('');
    expect(codigosDoCliente({ codigo_fdv: '00012', external_id: 'C5007' }).map((c) => c.sigla)).toEqual(['ERP', 'FDV']);
  });

  it('RN-CORE-78: subtítulo da ficha (Campo e Gestão) = códigos · bairro · cidade/UF; antes do 1º sync, só bairro e cidade', () => {
    expect(subtituloDaFicha(cliente({ external_id: 'C5007', codigo_fdv: '00012' }))).toBe('ERP C5007 · FDV 00012 · Centro · Boa Vista/RR');
    expect(subtituloDaFicha(cliente({ codigo_fdv: '00012' }))).toBe('FDV 00012 · Centro · Boa Vista/RR');
    expect(subtituloDaFicha(cliente({}))).toBe('Centro · Boa Vista/RR');
  });

  it('RN-CORE-47: a busca da Carteira do app casa pelo Código FDV e pelo Código ERP, com o mesmo rótulo; a linha da lista não ganha código', () => {
    const base = { clientes: [cliente({ codigo_fdv: '00012' }), cliente({ id: '4f1c2a52-3c1e-4f0a-9d49-7c4a5c0e1a12', external_id: 'C5007', codigo_fdv: '00031', razao_social: 'Padaria', documento: '98765432000110' })], financeiros: [], titulos: [], historico: [] };
    expect(listarClientesLocais(base, '2026-11-23', { q: '00012' }).map((c) => c.razao_social)).toEqual(['Mercado Boa Vista']);
    expect(listarClientesLocais(base, '2026-11-23', { q: 'c5007' }).map((c) => c.razao_social)).toEqual(['Padaria']);
    expect(listarClientesLocais(base, '2026-11-23', { q: 'padaria 00031' })).toHaveLength(1);
    expect(listarClientesLocais(base, '2026-11-23', { q: 'padaria 00012' })).toHaveLength(0);
    // uma palavra nunca tem espaço: unir os códigos não cria casamento entre os dois
    expect(codigosParaBusca({ external_id: 'C5007', codigo_fdv: '00012' })).toBe('C5007 00012');
    expect(ROTULO_BUSCA_CLIENTE).toBe('Código, CNPJ ou nome');
    const lista = ler('../telas/clientes.tsx');
    expect(lista).not.toMatch(/codigo_fdv|textoDosCodigos/);
  });

  it('RN-CORE-78: o banco local guarda o codigo_fdv do pull (dados da entidade cliente) e a correção na fila o mantém', () => {
    const ent = entidadesCliente.find((e) => e.nome === 'cliente')!;
    expect((ent.schema.parse(cliente({ codigo_fdv: '00012' })) as ClienteSync).codigo_fdv).toBe('00012');
    const fila = [{ id: ID, situacao: 'pendente', payload: { id: ID, origem: 'campo', razao_social: 'Mercado Boa Vista', documento: '11222333000181' } }];
    const [sobreposto] = sobreporPreCadastros([cliente({ codigo_fdv: '00012', status_cadastro: 'recusado' })], fila as never, '2026-11-23T01:00:00.000Z');
    expect(sobreposto!.codigo_fdv).toBe('00012');
  });

  it('RN-CORE-78: a correção do pré-cadastro mostra só "FDV nnnnn" no subtítulo (nada no Novo cliente nem sem código)', () => {
    const tela = ler('../telas/novo-cliente.tsx');
    expect(tela).toContain('subtitulo={textoDosCodigos({ codigo_fdv: codigoFdv }) || undefined}');
    expect(tela).toContain('setCodigoFdv(atual.codigo_fdv ?? null)');
  });
});
