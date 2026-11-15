import { PARTE_ENVIO_BYTES } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FotoLote } from '../../contracts';
import {
  acoesDoCabecalho,
  avisoLoteRepetido,
  buscaDaTelaFotosLote,
  cartoesVisiveis,
  dataHoraCurta,
  enviarPartes,
  faseDoLote,
  fatiasDoEnvio,
  lerTelaFotosLote,
  limiteDeLotesAtivo,
  mensagemErroDoEnvio,
  progressoDoEnvio,
  progressoDoProcessamento,
  seloDoItem,
  seloDoLote,
  situacoesDoCartao,
  validarArquivoZip,
  valorDoCartao,
} from './fotos-lote';

const MIB = 1024 * 1024;
const totais = { pendente: 0, ligado: 5, sem_produto: 2, ambiguo: 1, recusado: 0, repetido: 0 };
const lote = (p: Partial<FotoLote> = {}): FotoLote => ({
  id: '0ca00000-0000-4000-8000-0000000000d1',
  situacao: 'concluido',
  motivo: null,
  nome_arquivo: 'fotos.zip',
  tamanho_bytes: 340 * MIB,
  total: 8,
  totais,
  duplicado_de: null,
  criado_em: '2026-11-15T13:12:00.000Z',
  concluido_em: null,
  ...p,
});

describe('RN-CAT-14: cartões do relatório (spec fotos em lote §3.4)', () => {
  it('RN-CAT-14: "Repetidas" só aparece com uma ou mais; os outros três sempre', () => {
    expect(cartoesVisiveis(totais)).toEqual(['ligadas', 'pendencias', 'recusadas']);
    expect(cartoesVisiveis({ ...totais, repetido: 1 })).toEqual(['ligadas', 'pendencias', 'recusadas', 'repetidas']);
  });
  it('RN-CAT-14: "Sem produto ou ambíguas" soma as duas situações e filtra pelas duas', () => {
    expect(valorDoCartao('pendencias', totais)).toBe(3);
    expect(situacoesDoCartao('pendencias')).toBe('sem_produto,ambiguo');
    expect(valorDoCartao('ligadas', totais)).toBe(5);
    expect(situacoesDoCartao('ligadas')).toBe('ligado');
    expect(situacoesDoCartao('recusadas')).toBe('recusado');
    expect(situacoesDoCartao('repetidas')).toBe('repetido');
  });
  it('RN-CAT-14: o lote e o cartão marcado vão e voltam pela URL; valor desconhecido é ignorado', () => {
    expect(lerTelaFotosLote('')).toEqual({ lote: null, cartao: null, repetido: false });
    expect(lerTelaFotosLote('?lote=abc&filtro=recusadas&repetido=1')).toEqual({ lote: 'abc', cartao: 'recusadas', repetido: true });
    expect(lerTelaFotosLote('?filtro=xpto').cartao).toBeNull();
    expect(buscaDaTelaFotosLote({ lote: null, cartao: null, repetido: false })).toBe('');
    expect(buscaDaTelaFotosLote({ lote: 'abc', cartao: 'recusadas', repetido: false })).toBe('?lote=abc&filtro=recusadas');
  });
});

describe('RN-CAT-14: fase, selo e ações do lote (spec §3.1, §4, §5)', () => {
  it('RN-CAT-14: aguardando envio vira "Enviando" na aba que envia e "Envio interrompido" nas outras', () => {
    expect(faseDoLote(lote({ situacao: 'aguardando_envio' }), true)).toBe('enviando');
    expect(faseDoLote(lote({ situacao: 'aguardando_envio' }), false)).toBe('interrompido');
    expect(faseDoLote(lote({ situacao: 'processando' }), true)).toBe('processando');
  });
  it('RN-CAT-14: rótulos e tons dos selos do lote e do item são os da spec', () => {
    expect(seloDoLote('enviando')).toEqual({ tom: 'pending', texto: 'Enviando' });
    expect(seloDoLote('interrompido')).toEqual({ tom: 'warning', texto: 'Envio interrompido' });
    expect(seloDoLote('fila')).toEqual({ tom: 'neutral', texto: 'Na fila' });
    expect(seloDoLote('concluido')).toEqual({ tom: 'success', texto: 'Concluído' });
    expect(seloDoLote('recusado')).toEqual({ tom: 'danger', texto: 'Recusado' });
    expect(seloDoLote('falhou')).toEqual({ tom: 'danger', texto: 'Falhou' });
    expect(seloDoItem('ligado')).toEqual({ tom: 'success', texto: 'Ligada' });
    expect(seloDoItem('ambiguo')).toEqual({ tom: 'warning', texto: 'Ambígua' });
    expect(seloDoItem('recusado')).toEqual({ tom: 'danger', texto: 'Recusada' });
    expect(seloDoItem('repetido')).toEqual({ tom: 'neutral', texto: 'Repetida' });
  });
  it('RN-CAT-14: cada fase mostra só as ações da tabela da spec', () => {
    expect(acoesDoCabecalho('enviando')).toEqual({ cancelarEnvio: true, baixarCsv: false, enviarOutro: false });
    expect(acoesDoCabecalho('processando')).toEqual({ cancelarEnvio: false, baixarCsv: false, enviarOutro: false });
    expect(acoesDoCabecalho('concluido')).toEqual({ cancelarEnvio: false, baixarCsv: true, enviarOutro: true });
    expect(acoesDoCabecalho('recusado')).toEqual({ cancelarEnvio: false, baixarCsv: false, enviarOutro: true });
    expect(acoesDoCabecalho('falhou')).toEqual({ cancelarEnvio: false, baixarCsv: false, enviarOutro: true });
    expect(acoesDoCabecalho('interrompido')).toEqual({ cancelarEnvio: false, baixarCsv: false, enviarOutro: true });
  });
});

describe('RN-CAT-14: andamento e textos (spec §3.3, §3.6, §2.2)', () => {
  it('RN-CAT-14: envio mostra MB inteiros e processamento mostra fotos já resolvidas', () => {
    expect(progressoDoEnvio(120 * MIB, 340 * MIB)).toEqual({ valor: 120 * MIB, maximo: 340 * MIB, texto: '120 de 340 MB' });
    expect(progressoDoProcessamento(lote({ situacao: 'processando', total: 3000, totais: { ...totais, pendente: 1760 } }))).toEqual({ valor: 1240, maximo: 3000, texto: '1.240 de 3.000 fotos' });
  });
  it('RN-CAT-14: data curta no fuso do tenant e aviso do ZIP já enviado', () => {
    expect(dataHoraCurta('2026-11-15T13:12:00.000Z', 'America/Manaus')).toBe('15/11 09:12');
    expect(avisoLoteRepetido('2026-11-15T13:12:00.000Z', 'America/Manaus')).toBe('Este ZIP já foi enviado em 15/11 às 09:12. O resultado está abaixo.');
  });
  it('RN-CAT-14: com dois lotes em processamento o envio fica desligado', () => {
    const l = (situacao: FotoLote['situacao']) => lote({ situacao });
    expect(limiteDeLotesAtivo([l('processando'), l('concluido')])).toBe(false);
    expect(limiteDeLotesAtivo([l('processando'), l('enfileirado'), l('concluido')])).toBe(true);
  });
});

describe('RN-CAT-14: conferência do arquivo no navegador (spec §6.1)', () => {
  const limites = { bytesZipMax: 500 * MIB, arquivosMax: 10_000 };
  it('RN-CAT-14: arquivo sem .zip é recusado; ZIP acima do limite usa o texto de zip_grande; ZIP dentro do limite passa', () => {
    expect(validarArquivoZip('fotos.rar', 10, limites)).toEqual({ ok: false, mensagem: 'Escolha um arquivo .zip.' });
    expect(validarArquivoZip('fotos.ZIP', 501 * MIB, limites)).toEqual({ ok: false, mensagem: 'O ZIP passa de 500 MB. Divida as fotos em mais de um ZIP.' });
    expect(validarArquivoZip('fotos.zip', 0, limites)).toEqual({ ok: false, mensagem: 'Escolha um arquivo .zip.' });
    expect(validarArquivoZip('fotos.ZIP', 500 * MIB, limites)).toEqual({ ok: true });
  });
  it('RN-CAT-14: erros do envio viram a frase da spec', () => {
    expect(mensagemErroDoEnvio({ status: 409, code: 'LOTE_EM_ANDAMENTO', message: 'x' })).toBe('Espere um dos lotes em processamento terminar para enviar outro.');
    expect(mensagemErroDoEnvio({ status: 409, code: 'ENVIO_INCOMPLETO', message: 'x' })).toBe('O envio parou. Confira a internet e tente de novo.');
    expect(mensagemErroDoEnvio({ status: 0, code: 'network', message: 'x' })).toBe('O envio parou. Confira a internet e tente de novo.');
    expect(mensagemErroDoEnvio({ status: 422, code: 'RN-CAT-14', message: 'O ZIP passa de 500 MB. Divida as fotos em mais de um ZIP.' })).toBe('O ZIP passa de 500 MB. Divida as fotos em mais de um ZIP.');
  });
});

describe('RN-CAT-14: envio do ZIP em partes de 8 MiB', () => {
  it('RN-CAT-14: o ZIP é fatiado em partes de 8 MiB com a última menor, numeradas de 1', () => {
    expect(fatiasDoEnvio(1)).toEqual([{ n: 1, inicio: 0, fim: 1 }]);
    expect(fatiasDoEnvio(PARTE_ENVIO_BYTES)).toEqual([{ n: 1, inicio: 0, fim: PARTE_ENVIO_BYTES }]);
    expect(fatiasDoEnvio(PARTE_ENVIO_BYTES + 5)).toEqual([
      { n: 1, inicio: 0, fim: PARTE_ENVIO_BYTES },
      { n: 2, inicio: PARTE_ENVIO_BYTES, fim: PARTE_ENVIO_BYTES + 5 },
    ]);
  });
  it('RN-CAT-14: manda as partes em ordem, informa o progresso e termina ok', async () => {
    const enviadas: number[] = [];
    const progresso: number[] = [];
    const r = await enviarPartes({ tamanho: 2 * PARTE_ENVIO_BYTES + 10, enviarParte: async (f) => void enviadas.push(f.n), aoProgredir: (b) => progresso.push(b) });
    expect(r).toEqual({ ok: true });
    expect(enviadas).toEqual([1, 2, 3]);
    expect(progresso.at(-1)).toBe(2 * PARTE_ENVIO_BYTES + 10);
  });
  it('RN-CAT-14: parte que falha é repetida até 3 vezes; falhando as 3, para e diz de qual parte recomeçar', async () => {
    const chamadas: number[] = [];
    const r = await enviarPartes({
      tamanho: 3 * PARTE_ENVIO_BYTES,
      enviarParte: async (f) => {
        chamadas.push(f.n);
        if (f.n === 2) throw new Error('rede');
      },
      aoProgredir: () => undefined,
    });
    expect(chamadas).toEqual([1, 2, 2, 2]);
    expect(r).toEqual({ ok: false, recomecarEm: 2 });
  });
  it('RN-CAT-14: uma falha passageira não para o envio, e "tentar de novo" recomeça da parte pedida', async () => {
    let falhou = false;
    const chamadas: number[] = [];
    const r = await enviarPartes({
      tamanho: 2 * PARTE_ENVIO_BYTES,
      enviarParte: async (f) => {
        chamadas.push(f.n);
        if (f.n === 1 && !falhou) {
          falhou = true;
          throw new Error('rede');
        }
      },
      aoProgredir: () => undefined,
    });
    expect(r).toEqual({ ok: true });
    expect(chamadas).toEqual([1, 1, 2]);
    const de = vi.fn(async () => undefined);
    await enviarPartes({ tamanho: 3 * PARTE_ENVIO_BYTES, partes: [3], enviarParte: de, aoProgredir: () => undefined });
    expect(de).toHaveBeenCalledTimes(1);
  });
  it('RN-CAT-14: cancelar para antes da próxima parte', async () => {
    const c = new AbortController();
    const chamadas: number[] = [];
    const r = await enviarPartes({
      tamanho: 3 * PARTE_ENVIO_BYTES,
      sinal: c.signal,
      enviarParte: async (f) => {
        chamadas.push(f.n);
        c.abort();
      },
      aoProgredir: () => undefined,
    });
    expect(chamadas).toEqual([1]);
    expect(r).toEqual({ ok: false, cancelado: true });
  });
});
