import { describe, expect, it } from 'vitest';
import { DicionarioModelo } from '../../contracts';
import { dicionarioDaEntidade, gerarModeloCsv } from '../../domain';
import { conferirArquivoEscolhido, corpoDaParte, dicionarioParaCsv, novaChaveDeCarga, planejarEnvio, BYTES_MAX_ARQUIVO } from './carga';

describe('T-0100: carga por arquivo no BKO (lógica da tela)', () => {
  it('T-0100: só aceita .csv, não vazio e até o teto; a mensagem diz a ação seguinte', () => {
    expect(conferirArquivoEscolhido({ nome: 'clientes.CSV', tamanho: 10 })).toEqual({ ok: true });
    const xlsx = conferirArquivoEscolhido({ nome: 'clientes.xlsx', tamanho: 10 });
    expect(xlsx.ok).toBe(false);
    expect(!xlsx.ok && xlsx.mensagem).toContain('Baixe o modelo');
    expect(conferirArquivoEscolhido({ nome: 'a.csv', tamanho: 0 }).ok).toBe(false);
    expect(conferirArquivoEscolhido({ nome: 'a.csv', tamanho: BYTES_MAX_ARQUIVO + 1 }).ok).toBe(false);
  });

  it('RN-INT-12: a chave de idempotência é uma por arquivo (prefixo bko, 16 a 128 caracteres seguros)', () => {
    const k = novaChaveDeCarga(() => '3f0c6b1e-6d55-4c38-9b1f-1d1f0e8f0a01');
    expect(k).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
    expect(novaChaveDeCarga()).not.toBe(novaChaveDeCarga());
  });

  it('RF-INT-03: o modelo baixado do contrato é planejado em uma parte e vira o corpo simples (sem campos de sessão)', () => {
    const csv = gerarModeloCsv('cliente').csv;
    const plano = planejarEnvio(csv);
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.partes).toHaveLength(1);
    const parte = plano.partes[0]!;
    const corpo = corpoDaParte({ entidade: 'cliente', modo: 'delta', chave: 'bko-chave-0123456789', sessaoId: null, parte });
    expect(corpo).toEqual({ entidade: 'cliente', modo: 'delta', conteudo: parte.texto, chave_idempotencia: 'bko-chave-0123456789' });
  });

  it('RN-INT-06: arquivo acima de 5.000 linhas vira partes da mesma sessão, com a mesma chave e a linha inicial no original', () => {
    const cab = 'a;b';
    const texto = [cab, ...Array.from({ length: 5001 }, (_, i) => `x${i};y`)].join('\n');
    const plano = planejarEnvio(texto);
    expect(plano.ok && plano.partes.length).toBe(2);
    if (!plano.ok) return;
    const corpos = plano.partes.map((parte) => corpoDaParte({ entidade: 'cliente', modo: 'completo', chave: 'bko-chave-0123456789', sessaoId: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a01', parte }));
    expect(corpos.map((c) => c.parte)).toEqual([1, 2]);
    expect(new Set(corpos.map((c) => c.chave_idempotencia)).size).toBe(1);
    expect(corpos[1]?.linha_inicial).toBe(5002);
  });

  it('T-0100: arquivo só com cabeçalho é recusado antes de enviar, em português', () => {
    const r = planejarEnvio('a;b\n');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.mensagem).toContain('sem nenhuma linha de dados');
  });

  it('T-0100: o dicionário em CSV tem BOM, `;`, CRLF e protege célula que começa com fórmula (protegerFormula)', () => {
    const d = DicionarioModelo.parse(dicionarioDaEntidade('cliente'));
    const csv = dicionarioParaCsv({ ...d, campos: [{ ...d.campos[0]!, exemplo: '=SOMA(A1)', observacao: '-1+1' }] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=SOMA(A1)");
    expect(csv).toContain("'-1+1");
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe('﻿campo;obrigatorio;tipo;tamanho_max;formato;exemplo;observacao');
    expect(dicionarioParaCsv(d).split('\r\n')).toHaveLength(d.campos.length + 2);
  });
});
