import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { definirConsumidor, definirModuloApi, definirTrabalho, problemasTrabalho, type TrabalhoSobDemanda } from './api';
import { definirEvento } from './eventos';
import { defineModule } from './manifesto';

const ENFILEIRADO = definirEvento('catalogo.foto_lote.enfileirado@1', z.object({ lote_id: z.string().uuid() }).strict());
const OUTRO = definirEvento('catalogo.produto.alterado@1', z.object({ id: z.string() }));

const catalogo = (consome: string[], publica: string[]) =>
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['analista'], consome, publica, acoes: {} });

const trabalho = (t: Partial<TrabalhoSobDemanda> = {}): TrabalhoSobDemanda =>
  definirTrabalho({
    nome: 'processar_foto_lote',
    disparadoPor: ENFILEIRADO,
    alvo: (p) => p.lote_id,
    executarFatia: async () => 'concluido',
    aoFalhar: async () => undefined,
    ...t,
  } as TrabalhoSobDemanda<typeof ENFILEIRADO.schema>);

describe('ADR 0058 §2: trabalho sob demanda (ModuloApi.trabalhos)', () => {
  it('aceita o trabalho disparado por evento do próprio módulo, em `publica` e em `consome`', () => {
    const api = definirModuloApi({ manifesto: catalogo([ENFILEIRADO.nome], [ENFILEIRADO.nome]), trabalhos: [trabalho()] });
    expect(api.trabalhos).toHaveLength(1);
  });

  it('nome em snake_case', () => {
    expect(problemasTrabalho({ nome: 'Processar-Lote' })).toEqual(['trabalho Processar-Lote: nome inválido (minúsculas, dígitos e _)']);
    expect(() => trabalho({ nome: '1x' })).toThrow(/nome inválido/);
  });

  it('evento fora de `consome` ou de `publica`, ou de outro módulo, derruba a subida', () => {
    expect(() => definirModuloApi({ manifesto: catalogo([], [ENFILEIRADO.nome]), trabalhos: [trabalho()] })).toThrow(/não está em "consome"/);
    expect(() => definirModuloApi({ manifesto: catalogo([ENFILEIRADO.nome], []), trabalhos: [trabalho()] })).toThrow(/não está em "publica"/);
    const deOutro = definirEvento('core.produto.alterado@1', z.object({ id: z.string() }));
    expect(() =>
      definirModuloApi({ manifesto: catalogo([deOutro.nome], []), trabalhos: [trabalho({ disparadoPor: deOutro as never })] }),
    ).toThrow(/evento de outro módulo/);
  });

  it('nome repetido e consumidor no mesmo evento são recusados (um consumo por evento e módulo)', () => {
    const m = catalogo([ENFILEIRADO.nome, OUTRO.nome], [ENFILEIRADO.nome, OUTRO.nome]);
    expect(() => definirModuloApi({ manifesto: m, trabalhos: [trabalho(), trabalho()] })).toThrow(/repetido/);
    expect(() =>
      definirModuloApi({ manifesto: m, trabalhos: [trabalho()], consumidores: [definirConsumidor({ evento: ENFILEIRADO, executar: async () => undefined })] }),
    ).toThrow(/já tem consumidor/);
  });
});
