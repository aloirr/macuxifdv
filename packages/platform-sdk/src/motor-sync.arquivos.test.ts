/**
 * Fila de arquivos do motor (ADR 0010 §4; desenho T-0016 §1 E4): enviada depois do push dos itens, um por vez;
 * 409 ARQUIVO_SEM_REFERENCIA mantém pendente; aceito → enviado e o local some depois de 7 dias; sobrevive a reinício;
 * RN-CORE-02 (módulo desativado) igual à fila de itens.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CODIGOS_ARQUIVO, type EnvioArquivo, type ResultadoEnvioArquivo } from './arquivos';
import { defineModule } from './manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync, rotuloDoArquivo, type ArmazenamentoSync, type TransporteSync } from './motor-sync';
import { criarRegistroSync, definirEntidadeSync, type ItemPush } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['visita'] }),
  defineModule({ id: 'promotor', versao: '1.0.0', depende: ['core'], perfis: ['promotor'], sync: [] }),
];
const FOTO = '0f000000-0000-4000-8000-0000000000a1';
const FOTO2 = '0f000000-0000-4000-8000-0000000000a2';
const VISITA = '0e000000-0000-4000-8000-000000000001';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function montar(o: { armazenamento?: ArmazenamentoSync; agora?: () => Date; online?: () => boolean } = {}) {
  const registro = criarRegistroSync(manifestos);
  registro.registrar(
    definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({ foto_fachada_id: z.string() }) }),
  );
  const ordem: string[] = [];
  const recebidos = new Set<string>();
  const locais = new Map<string, Uint8Array>([[`fotos/${FOTO}.jpg`, JPEG]]);
  const removidos: string[] = [];
  let respostaArquivo: ((a: EnvioArquivo) => ResultadoEnvioArquivo) | null = null;
  let quebrarArquivo = false;
  const transporte: TransporteSync = {
    async push(itens: ItemPush[]) {
      ordem.push(`push:${itens.map((i) => i.id).join(',')}`);
      for (const i of itens) recebidos.add((i.payload as { foto_fachada_id: string }).foto_fachada_id);
      return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
    },
    async pull() {
      return { itens: [], proximo_cursor: null };
    },
    async enviarArquivo(a) {
      ordem.push(`arquivo:${a.id}`);
      if (quebrarArquivo) throw new Error('Sem conexão com o servidor.');
      if (respostaArquivo) return respostaArquivo(a);
      // como a API: só aceita depois que o comando que referencia chegou (linha aguardando)
      return recebidos.has(a.id)
        ? { status: 'aceito' }
        : { status: 'rejeitado', codigo: CODIGOS_ARQUIVO.semReferencia, mensagem: 'O registro da foto ainda não chegou.' };
    },
  };
  const armazenamento = o.armazenamento ?? criarArmazenamentoEmMemoria();
  const motor = criarMotorSync({
    registro,
    armazenamento,
    transporte,
    agora: o.agora ?? (() => new Date('2026-10-31T12:00:00Z')),
    online: o.online,
    arquivos: {
      ler: async (c) => locais.get(c) ?? null,
      remover: async (c) => {
        removidos.push(c);
        locais.delete(c);
      },
    },
  });
  return {
    motor,
    armazenamento,
    ordem,
    locais,
    removidos,
    responder: (f: typeof respostaArquivo) => (respostaArquivo = f),
    quebrar: (v: boolean) => (quebrarArquivo = v),
  };
}

describe('motor: fila de arquivos (ADR 0010 §4)', () => {
  it('o arquivo vai DEPOIS do push dos itens e é aceito; sai da contagem de pendentes', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    await t.motor.enfileirar({ id: VISITA, entidade: 'visita', payload: { foto_fachada_id: FOTO } });
    const a = await t.motor.enfileirarArquivo({ id: FOTO.toUpperCase(), modulo: 'core', rotulo: 'Foto da fachada' });
    expect(a).toMatchObject({ id: FOTO, caminho: `fotos/${FOTO}.jpg`, tipo: 'image/jpeg', situacao: 'pendente' });
    expect(t.motor.arquivosPendentes()).toHaveLength(1);
    await t.motor.enviar();
    expect(t.ordem).toEqual([`push:${VISITA}`, `arquivo:${FOTO}`]);
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'enviado', enviado_em: '2026-10-31T12:00:00.000Z', tentativas: 1 });
    expect(t.motor.arquivosPendentes()).toHaveLength(0);
    expect(rotuloDoArquivo(t.motor.estado().arquivos[0]!)).toBe('enviado');
  });

  it('mesmo id não entra duas vezes; id que não é UUID é erro de programação', async () => {
    const t = montar();
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    expect(t.motor.estado().arquivos).toHaveLength(1);
    await expect(t.motor.enfileirarArquivo({ id: 'foto-1', modulo: 'core' })).rejects.toThrow(/UUID/);
  });

  it('409 ARQUIVO_SEM_REFERENCIA (comando ainda não chegou): continua pendente e o próximo da fila segue', async () => {
    const t = montar();
    t.locais.set(`fotos/${FOTO2}.jpg`, JPEG);
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.enfileirarArquivo({ id: FOTO2, modulo: 'core' });
    t.responder((a) => (a.id === FOTO ? { status: 'rejeitado', codigo: CODIGOS_ARQUIVO.semReferencia, mensagem: 'ainda não' } : { status: 'aceito' }));
    await t.motor.enviar();
    const [a1, a2] = t.motor.estado().arquivos;
    expect(a1).toMatchObject({ situacao: 'pendente', codigo: 'ARQUIVO_SEM_REFERENCIA', tentativas: 1 });
    expect(rotuloDoArquivo(a1!)).toMatch(/aguardando o registro/);
    expect(a2).toMatchObject({ situacao: 'enviado' });
    // o comando chegou: no envio seguinte, aceito
    t.responder(null);
    await t.motor.enfileirar({ id: VISITA, entidade: 'visita', payload: { foto_fachada_id: FOTO } });
    await t.motor.enviar();
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'enviado', tentativas: 2 });
  });

  it('409 ARQUIVO_DIVERGENTE vira falhou; reenviar com incluirFalhos tenta de novo; descartar apaga o local', async () => {
    const t = montar();
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    t.responder(() => ({ status: 'rejeitado', codigo: CODIGOS_ARQUIVO.divergente, mensagem: 'outro conteúdo' }));
    await t.motor.enviar();
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'falhou', codigo: 'ARQUIVO_DIVERGENTE' });
    await t.motor.enviar();
    expect(t.ordem.filter((x) => x.startsWith('arquivo:'))).toHaveLength(1); // falhou não vai sozinho
    await t.motor.enviar({ incluirFalhos: true });
    expect(t.ordem.filter((x) => x.startsWith('arquivo:'))).toHaveLength(2);
    await t.motor.descartarArquivo(FOTO);
    expect(t.motor.estado().arquivos).toEqual([]);
    expect(t.removidos).toEqual([`fotos/${FOTO}.jpg`]);
  });

  it('falha de transporte conta a tentativa e para; sem sinal nada sai', async () => {
    let sinal = false;
    const t = montar({ online: () => sinal });
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.enviar();
    expect(t.ordem).toEqual([]);
    sinal = true;
    t.quebrar(true);
    await t.motor.enviar();
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'pendente', tentativas: 1, ultimo_erro: 'Sem conexão com o servidor.' });
  });

  it('arquivo local sumiu: falhou com ARQUIVO_AUSENTE_NO_APARELHO (não trava a fila)', async () => {
    const t = montar();
    t.locais.clear();
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.enviar();
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'falhou', codigo: 'ARQUIVO_AUSENTE_NO_APARELHO' });
  });

  it('a fila de arquivos sobrevive a reinício do app (persistida em sync:arquivos)', async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const t1 = montar({ armazenamento });
    await t1.motor.enfileirarArquivo({ id: FOTO, modulo: 'core', rotulo: 'Foto da fachada' });
    expect(armazenamento.conteudo()['sync:arquivos']).toHaveLength(1);
    const t2 = montar({ armazenamento });
    await t2.motor.carregar();
    expect(t2.motor.arquivosPendentes()).toMatchObject([{ id: FOTO, rotulo: 'Foto da fachada', situacao: 'pendente' }]);
  });

  it('aceito há 7 dias: o arquivo local é apagado e sai da fila (antes disso continua para a tela offline)', async () => {
    let agora = new Date('2026-10-31T12:00:00Z');
    const t = montar({ agora: () => agora });
    t.responder(() => ({ status: 'aceito' }));
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.enviar();
    agora = new Date('2026-11-07T11:59:59Z');
    await t.motor.enviar();
    expect(t.removidos).toEqual([]);
    agora = new Date('2026-11-07T12:00:00Z');
    await t.motor.enviar();
    expect(t.removidos).toEqual([`fotos/${FOTO}.jpg`]);
    expect(t.motor.estado().arquivos).toEqual([]);
  });

  it('RN-CORE-02: MODULO_INATIVO marca o arquivo; módulo desativado com arquivo pendente espera a confirmação', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core', 'promotor']);
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'promotor' });
    t.responder(() => ({ status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: 'O módulo promotor não está ativo.' }));
    await t.motor.aplicarModulosAtivos(['core']);
    expect(t.motor.estado().limpezaPendente).toEqual(['promotor']);
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'modulo_inativo' });
    expect(rotuloDoArquivo(t.motor.estado().arquivos[0]!)).toBe('não enviado — módulo desativado');
    // voltou: o arquivo volta para a fila
    t.responder(() => ({ status: 'aceito' }));
    await t.motor.aplicarModulosAtivos(['core', 'promotor']);
    expect(t.motor.estado().arquivos[0]).toMatchObject({ situacao: 'pendente' });
    // saiu de novo e o usuário confirmou: arquivo sai da fila e do aparelho
    t.responder(() => ({ status: 'rejeitado', codigo: 'MODULO_INATIVO', mensagem: 'inativo' }));
    await t.motor.aplicarModulosAtivos(['core']);
    await t.motor.confirmarLimpeza('promotor');
    expect(t.motor.estado().arquivos).toEqual([]);
    expect(t.removidos).toEqual([`fotos/${FOTO}.jpg`]);
  });

  it('RN-CORE-15: limparAparelho apaga filas, linhas, cursores, chaves dos módulos e os arquivos locais da fila', async () => {
    const armazenamento = criarArmazenamentoEmMemoria({
      'ent:visita': { [VISITA]: { id: VISITA, updated_at: '2026-10-31T10:00:00.000Z', deleted_at: null } },
      'sync:cursor:visita': 'c',
      'sync:escopo:visita': 'v',
      'mod:core:me': { nome: 'x' },
    });
    const t = montar({ armazenamento });
    await t.motor.aplicarModulosAtivos(['core']);
    await t.motor.enfileirar({ id: VISITA, entidade: 'visita', payload: { foto_fachada_id: FOTO } });
    await t.motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await t.motor.limparAparelho();
    expect(armazenamento.conteudo()).toEqual({});
    expect(t.motor.estado()).toMatchObject({ fila: [], arquivos: [], modulosAtivos: [], sincronizado_em: null });
    expect(t.removidos).toEqual([`fotos/${FOTO}.jpg`]);
  });

  it('sem enviarArquivo no transporte (servidor da Fase M) os arquivos ficam na fila, sem erro', async () => {
    const registro = criarRegistroSync(manifestos);
    const motor = criarMotorSync({
      registro,
      armazenamento: criarArmazenamentoEmMemoria(),
      transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
      arquivos: { ler: async () => JPEG },
    });
    await motor.enfileirarArquivo({ id: FOTO, modulo: 'core' });
    await motor.enviar();
    expect(motor.arquivosPendentes()).toHaveLength(1);
  });
});
