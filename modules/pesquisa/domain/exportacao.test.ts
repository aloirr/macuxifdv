import { describe, expect, it } from 'vitest';
import type { RespostaPesquisa } from '../contracts';
import { celulaCsv, exportarRespostasCsv, nomeDoArquivoCsv } from './exportacao';
import { codigo, data, foto, item, multipla, numero, publicada, QUEST, sim_nao, TENANT, texto, u, unica } from './util-teste';

const v1 = publicada({ perguntas: [sim_nao(1, { enunciado: 'Tem ponto extra?' }), unica(2), multipla(3), numero(4), texto(5), data(6), foto(7), codigo(8)] });
const v2 = publicada({ id: u(702), numero: 2, perguntas: [sim_nao(1, { enunciado: 'Tem ponto extra hoje?' }), escalaNova()] });
function escalaNova() {
  return { id: u(9), tipo: 'escala' as const, enunciado: 'Nota da loja', obrigatoria: false, minimo: 1, maximo: 5 };
}

const resposta = (extra: Partial<RespostaPesquisa>): RespostaPesquisa => ({
  id: u(5000),
  questionario_id: QUEST,
  versao_id: v1.id,
  cliente_id: u(51),
  visita_id: null,
  respondida_em: '2026-10-31T13:05:00Z',
  itens: [],
  tenant_id: TENANT,
  usuario_id: u(31),
  equipe_id: null,
  recebida_em: '2026-10-31T13:06:00Z',
  suspeita: false,
  motivos_suspeita: [],
  ...extra,
});

describe('RF-PES-06: exportação CSV (Excel pt-BR)', () => {
  it('RF-PES-06: BOM UTF-8, separador ";", cabeçalho com as perguntas e datas no fuso do tenant', () => {
    const csv = exportarRespostasCsv({
      versoes: [v1],
      respostas: [
        resposta({
          itens: [item.simNao(1, true), item.unica(2, 102), item.multipla(3, [201, 203]), item.numero(4, 12.5), item.texto(5, 'ok'), item.data(6, '2026-10-30'), item.foto(7, [10, 11]), item.codigo(8, '789')],
        }),
      ],
      fuso: 'America/Manaus',
    });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [cab, linha] = csv.slice(1).split('\r\n');
    expect(cab!.split(';').slice(0, 10)).toEqual(['resposta_id', 'versao', 'respondida_em', 'recebida_em', 'usuario_id', 'equipe_id', 'cliente_id', 'visita_id', 'suspeita', 'motivos_suspeita']);
    expect(cab).toContain('Tem ponto extra?');
    const cel = linha!.split(';');
    expect(cel.slice(1, 4)).toEqual(['1', '31/10/2026 09:05', '31/10/2026 09:06']);
    expect(cel.slice(10)).toEqual(['Sim', 'Opção 102', 'Opção 201 | Opção 203', '12,5', 'ok', '30/10/2026', `${u(10)} | ${u(11)}`, '789']);
  });

  it('RN-PES-01: consolida colunas pelo id estável da pergunta (enunciado da versão mais nova) e deixa vazio o que a versão não tem', () => {
    const csv = exportarRespostasCsv({
      versoes: [v1, v2],
      respostas: [resposta({ itens: [item.simNao(1, false)] }), resposta({ id: u(5001), versao_id: v2.id, itens: [item.simNao(1, true), item.escala(9, 4)] })],
      fuso: 'America/Manaus',
    });
    const linhas = csv.slice(1).trimEnd().split('\r\n');
    const cab = linhas[0]!.split(';');
    expect(cab.filter((c) => c.startsWith('Tem ponto extra'))).toEqual(['Tem ponto extra hoje?']);
    const iNota = cab.indexOf('Nota da loja');
    expect(linhas[1]!.split(';')[iNota]).toBe('');
    expect(linhas[2]!.split(';')[iNota]).toBe('4');
  });

  it('RN-PES-04: a suspeita e os motivos vão para o arquivo', () => {
    const csv = exportarRespostasCsv({ versoes: [v1], respostas: [resposta({ suspeita: true, motivos_suspeita: ['APOS_A_VIGENCIA'], itens: [item.simNao(1, true)] })], fuso: 'America/Manaus' });
    expect(csv).toContain(';sim;APOS_A_VIGENCIA;');
  });

  it('segurança: aspas, separador, quebra de linha e fórmula (=, +, -, @) são neutralizados', () => {
    expect(celulaCsv('a;b')).toBe('"a;b"');
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""');
    expect(celulaCsv('linha\nnova')).toBe('"linha\nnova"');
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celulaCsv('+55')).toBe("'+55");
    expect(celulaCsv('-3')).toBe("'-3");
    expect(celulaCsv('-1+1')).toBe("'-1+1");
    expect(celulaCsv('=1+1')).toBe("'=1+1");
  });

  it('RF-PES-06: nome do arquivo com o dia no fuso do tenant e sem caracteres estranhos', () => {
    expect(nomeDoArquivoCsv('Gôndola / Mês', '2026-11-01T02:00:00Z', 'America/Manaus')).toBe('pesquisa-gondola-mes-2026-10-31.csv');
  });

  it('sem respostas: só o cabeçalho', () => {
    const csv = exportarRespostasCsv({ versoes: [v1], respostas: [], fuso: 'America/Manaus' });
    expect(csv.slice(1).trimEnd().split('\r\n')).toHaveLength(1);
  });
});
