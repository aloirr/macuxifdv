import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// a tela importa react-native e não roda no Node: confere no fonte (mesmo padrão das telas do vendedor)
const tela = readFileSync(join(__dirname, 'pesquisas-screen.tsx'), 'utf8').replace(/\r\n/g, '\n');
const trecho = (de: string, ate: string) => tela.slice(tela.indexOf(de), tela.indexOf(ate));

describe('T-0171 RD-0212 (RF-PES-03, RN-PES-02): uma informação por linha na aba Pesquisas', () => {
  it('disponível: título e nº de perguntas, sem a descrição (ela fica na tela de responder)', () => {
    const disponivel = trecho('disponiveis.map(', 'respondidas.length > 0');
    expect(disponivel).toContain('{d.titulo}');
    expect(disponivel).toContain('{perguntas(n)}');
    expect(disponivel).not.toContain('descricao');
  });

  it('respondida: título e "Volta em", sem a tag "Respondida" (o título da seção já diz)', () => {
    const respondida = trecho('respondidas.map(', 'doCliente.length > 0');
    expect(respondida).toContain('Volta em {dataBr(d.liberada_em)}');
    expect(respondida).not.toContain('ChipEstado');
    expect(tela).not.toContain('texto="Respondida"');
  });

  it('na ficha do cliente: só o título, sem a tag "Por cliente"', () => {
    const naFicha = trecho('doCliente.map(', 'auto.rodape');
    expect(naFicha).toContain('{d.titulo}');
    expect(naFicha).not.toContain('ChipEstado');
    expect(tela).not.toContain('Por cliente');
  });
});
