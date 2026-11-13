/**
 * T-0147 critério 2 (RN-CORE-38; ADR 0010 §4 e ADR 0041) — envio da foto do PDV OFFLINE → fila → push, sem banco (local e CI).
 * Cadeia real do aparelho: `enviarFotoPdv` (app do Core) → MOTOR DE SYNC REAL do SDK (fila de itens + fila de arquivos, armazenamento
 * em memória) com a entidade `cliente_foto` que o Core registra no app (`entidadesProduto`) → transporte que faz o papel da API
 * (push idempotente pelo UUID, `PUT /v1/arquivos/:id` só depois do comando, 409 ARQUIVO_SEM_REFERENCIA antes) → ficha
 * (`fotosComPendentes` + `resumoDeFotosDoPdv`, a mesma composição de `montarFichaLocal`).
 * A revalidação do servidor (carteira, perfil, tipo, `perfis_leitura`) é do dono: modules/core/api/foto-pdv-push.test.ts e
 * apps/api/test/arquivos.banco.test.ts (CI). Matriz: docs/testes/T-0149-T-0147.md.
 * ORÁCULOS do texto da RN-CORE-38 e do critério 2 da T-0147 ("tira a foto ou anexa da galeria offline, e ela chega ao bucket quando
 * há sinal: fila de arquivos, idempotente, UUID do aparelho"; "documento sensível não fica no aparelho depois do envio").
 */
import { manifest as manifestCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoEmMemoria,
  criarClienteHttp,
  criarMotorSync,
  criarRegistroSync,
  ErroSemConexao,
  type EnvioArquivo,
  type ItemPush,
  type LinhaSync,
  type ResultadoEnvioArquivo,
  type ResultadoItemPush,
} from '@macuxi/platform-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { ClienteFotoPushSchema, type ClienteFotoPush, type ClienteFotoSync, type FotoTipoSync } from '../../modules/core/contracts';
import { fotosComPendentes, type FotoPdvPush } from '../../modules/core/domain';
import { resumoDeFotosDoPdv } from '../../modules/core/app/lib/cliente360-local';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { enviarFotoPdv } from '../../modules/core/app/lib/enviar-foto-pdv';
import { definirCapturaFotoPdv, type CapturaFotoPdv } from '../../modules/core/app/lib/foto-fachada';

const U = (n: number) => `0f147000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = '2026-11-10T14:00:00.000Z';
const CLIENTE = U(1);
const FOTO_FACHADA = U(11);
const FOTO_CNH = U(12);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

const tipo = (o: Partial<FotoTipoSync> & Pick<FotoTipoSync, 'id' | 'nome'>): FotoTipoSync => ({ updated_at: AGORA, deleted_at: null, external_id: null, obrigatorio: false, sensivel: false, fachada: false, ordem: 0, ativo: true, ...o });
const FACHADA = tipo({ id: U(3), nome: 'Fachada', fachada: true, obrigatorio: true });
const CNH = tipo({ id: U(4), nome: 'CNH do sócio', sensivel: true, obrigatorio: true, ordem: 1 });
const TIPOS = [FACHADA, CNH];

/** A porta de captura que o shell registra (`definirCapturaFotoPdv`): a câmera/galeria grava `fotos/<id>.jpg` e devolve a foto. */
function capturaDoShell(locais: Map<string, Uint8Array>, fila: Array<{ id: string; origem: 'camera' | 'galeria' } | null>): CapturaFotoPdv {
  return {
    escolher: async () => {
      const f = fila.shift() ?? null;
      if (f) locais.set(`fotos/${f.id}.jpg`, JPEG);
      return f ? { ...f, largura_px: 1600, altura_px: 1200 } : null;
    },
    camera: async () => null,
    galeria: async () => null,
  };
}

/** Aparelho do vendedor (motor real) + o "servidor" que o transporte simula. */
function montar() {
  let sinal = false;
  let seq = 100;
  const locais = new Map<string, Uint8Array>();
  const removidos: string[] = [];
  const ordem: string[] = [];
  const servidor = { comandos: new Map<string, ClienteFotoPush>(), recebimentos: 0, arquivos: new Map<string, EnvioArquivo>(), cairDepoisDeGravar: false };
  const relogioServidor = '2026-11-10T14:00:01.000Z';
  const registro = criarRegistroSync([manifestCore]);
  for (const e of entidadesProduto) registro.registrar(e);
  const motor = criarMotorSync({
    registro,
    armazenamento: criarArmazenamentoEmMemoria(),
    agora: () => new Date(AGORA),
    online: () => sinal,
    ambiente: {
      http: criarClienteHttp(async () => {
        throw new ErroSemConexao('sem http no teste');
      }),
      online: () => sinal,
      novoId: () => U((seq += 1)),
      usuario: () => ({ id: U(9), nome: 'Lucas', perfil: 'vendedor', fuso: 'America/Manaus' }),
    },
    arquivos: {
      ler: async (c) => locais.get(c) ?? null,
      remover: async (c) => {
        removidos.push(c);
        locais.delete(c);
      },
    },
    transporte: {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        ordem.push(`push:${itens.map((i) => `${i.entidade}`).join(',')}`);
        const r = itens.map((i): ResultadoItemPush => {
          servidor.recebimentos += 1;
          const p = ClienteFotoPushSchema.parse(i.payload); // o servidor recebe o contrato estrito
          if (i.id !== p.id) return { id: i.id, status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO', mensagem: 'id' };
          if (!servidor.comandos.has(p.id)) servidor.comandos.set(p.id, p); // idempotente pelo UUID do aparelho
          return { id: i.id, status: 'aceito', em: relogioServidor };
        });
        if (servidor.cairDepoisDeGravar) {
          servidor.cairDepoisDeGravar = false;
          throw new Error('Tempo esgotado: o servidor gravou e a resposta não chegou.');
        }
        return r;
      },
      async pull(entidade: string) {
        // o pull de cliente_foto como o do Core (api/sync.ts): arquivo_id só na fachada
        const itens =
          entidade === 'cliente_foto'
            ? [...servidor.comandos.values()].map((p) => ({ id: p.id, updated_at: relogioServidor, deleted_at: null, external_id: null, cliente_id: p.cliente_id, foto_tipo_id: p.foto_tipo_id, arquivo_id: p.foto_tipo_id === FACHADA.id ? p.arquivo_id : null, origem: p.origem, tirada_em: p.tirada_em }) as LinhaSync)
            : entidade === 'foto_tipo'
              ? (TIPOS as unknown as LinhaSync[])
              : [];
        return { itens, proximo_cursor: null, horizonte: '2026-11-10T14:00:05.000Z' };
      },
      async enviarArquivo(a: EnvioArquivo): Promise<ResultadoEnvioArquivo> {
        ordem.push(`arquivo:${a.id}`);
        const referenciado = [...servidor.comandos.values()].some((c) => c.arquivo_id === a.id);
        if (!referenciado) return { status: 'rejeitado', codigo: 'ARQUIVO_SEM_REFERENCIA', mensagem: 'O registro da foto ainda não chegou.' };
        servidor.arquivos.set(a.id, a);
        return { status: 'aceito' };
      },
    },
  });
  /** O que a ficha mostra (mesma composição de `montarFichaLocal`, usar-clientes-locais.ts): linhas do pull + a fila sobreposta. */
  const ficha = async () => {
    const pendentes = motor.sobreposicao(['cliente_foto']).map((i) => i.payload as FotoPdvPush);
    const linhas = (await motor.linhas<ClienteFotoSync & LinhaSync>('cliente_foto')).filter((l) => l.cliente_id === CLIENTE);
    const r = resumoDeFotosDoPdv({ tipos: TIPOS, fotos: fotosComPendentes(linhas, pendentes, TIPOS) as ClienteFotoSync[], na_fila: pendentes.map((p) => p.foto_tipo_id) })!;
    return { itens: Object.fromEntries(r.itens.map((i) => [i.nome, { situacao: i.situacao, na_fila: i.na_fila }])), fachada: r.fachada_foto, faltam: r.faltam_obrigatorias };
  };
  return { motor, locais, removidos, ordem, servidor, ficha, ligarSinal: (v: boolean) => (sinal = v) };
}

afterEach(() => definirCapturaFotoPdv(null));

describe('T-0147 critério 2 — foto do PDV offline → fila → push (motor real; RN-CORE-38, ADR 0010 §4, ADR 0041)', () => {
  it('sem sinal: câmera (fachada) e galeria (CNH) entram nas DUAS filas com o UUID do aparelho, nada sai, e a ficha mostra "Tem" + "Na fila" na hora', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    definirCapturaFotoPdv(capturaDoShell(t.locais, [{ id: FOTO_FACHADA, origem: 'camera' }, { id: FOTO_CNH, origem: 'galeria' }]));
    expect(await t.ficha()).toMatchObject({ faltam: 2, fachada: null });

    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).toEqual({ kind: 'enviada' });
    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: CNH })).toEqual({ kind: 'enviada' });

    // fila de itens: os 2 comandos cliente_foto, no contrato estrito, com o UUID gerado no aparelho (id do item = id do payload)
    const fila = t.motor.estado().fila;
    expect(fila.map((i) => [i.entidade, i.situacao])).toEqual([['cliente_foto', 'pendente'], ['cliente_foto', 'pendente']]);
    for (const i of fila) {
      const p = ClienteFotoPushSchema.parse(i.payload);
      expect(p.id).toBe(i.id);
      expect(p.cliente_id).toBe(CLIENTE);
    }
    expect(fila.map((i) => (i.payload as ClienteFotoPush).arquivo_id)).toEqual([FOTO_FACHADA, FOTO_CNH]);
    expect(fila.map((i) => (i.payload as ClienteFotoPush).origem)).toEqual(['camera', 'galeria']);
    // fila de arquivos: JPEG; o sensível marcado para sair do aparelho assim que o servidor aceitar (ADR 0041)
    expect(t.motor.arquivosPendentes().map((a) => [a.id, a.tipo, a.apagar_ao_enviar === true])).toEqual([
      [FOTO_FACHADA, 'image/jpeg', false],
      [FOTO_CNH, 'image/jpeg', true],
    ]);
    // nada saiu do aparelho sem sinal
    expect(t.ordem).toEqual([]);
    // ficha (offline primeiro): as duas "Tem", marcadas "Na fila" (imagem aprovada); obrigatórias completas; "Ver foto do PDV" já liga com o arquivo local
    expect(await t.ficha()).toEqual({
      itens: { Fachada: { situacao: 'tem', na_fila: true }, 'CNH do sócio': { situacao: 'tem', na_fila: true } },
      fachada: { arquivo_id: FOTO_FACHADA, tirada_em: expect.any(String) }, // tirada_em = relógio do aparelho na captura
      faltam: 0,
    });
  });

  it('o sinal volta: o comando sobe ANTES do arquivo, os 2 JPEG chegam ao "bucket", a CNH some do aparelho na hora e a fachada fica (7 dias); depois do pull a ficha deixa de dizer "Na fila"', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    definirCapturaFotoPdv(capturaDoShell(t.locais, [{ id: FOTO_FACHADA, origem: 'camera' }, { id: FOTO_CNH, origem: 'galeria' }]));
    await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA });
    await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: CNH });

    t.ligarSinal(true);
    expect(await t.motor.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    // ordem do ADR 0010 §4: push dos itens, depois os arquivos (nunca 409 sem referência no caminho feliz)
    const iPush = t.ordem.findIndex((x) => x.startsWith('push:'));
    expect(iPush).toBeGreaterThanOrEqual(0);
    expect(t.ordem.slice(iPush + 1).filter((x) => x.startsWith('arquivo:'))).toEqual([`arquivo:${FOTO_FACHADA}`, `arquivo:${FOTO_CNH}`]);
    expect([...t.servidor.arquivos.keys()].sort()).toEqual([FOTO_FACHADA, FOTO_CNH].sort());
    for (const a of t.servidor.arquivos.values()) expect([a.tipo, a.bytes[0], a.bytes[1]]).toEqual(['image/jpeg', 0xff, 0xd8]);
    expect(t.servidor.comandos.size).toBe(2);
    // filas vazias; RN-CORE-38/ADR 0041: o documento sensível não fica no aparelho; a fachada fica para a ficha offline
    expect(t.motor.estado().fila.filter((i) => i.situacao === 'pendente')).toEqual([]);
    expect(t.motor.arquivosPendentes()).toEqual([]);
    expect(t.removidos).toEqual([`fotos/${FOTO_CNH}.jpg`]);
    expect(t.locais.has(`fotos/${FOTO_FACHADA}.jpg`)).toBe(true);
    // rótulo × valor: enviada e coberta pelo pull, a foto é "Tem" SEM "Na fila"; a CNH volta do pull sem arquivo_id (o vendedor não reabre)
    expect(await t.ficha()).toEqual({
      itens: { Fachada: { situacao: 'tem', na_fila: false }, 'CNH do sócio': { situacao: 'tem', na_fila: false } },
      fachada: { arquivo_id: FOTO_FACHADA, tirada_em: expect.any(String) }, // tirada_em = relógio do aparelho na captura
      faltam: 0,
    });
    const doPull = await t.motor.linhas<ClienteFotoSync & LinhaSync>('cliente_foto');
    expect(doPull.find((l) => l.foto_tipo_id === CNH.id)?.arquivo_id).toBeNull();
  });

  it('idempotência: o servidor grava e a resposta se perde (timeout) → o reenvio leva o MESMO UUID e não duplica; o arquivo só sobe depois do aceite', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    definirCapturaFotoPdv(capturaDoShell(t.locais, [{ id: FOTO_FACHADA, origem: 'camera' }]));
    await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA });
    const comando = t.motor.estado().fila[0]!.id;

    t.ligarSinal(true);
    t.servidor.cairDepoisDeGravar = true;
    await t.motor.enviar();
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[comando, 'pendente']]);
    await t.motor.enviar();
    expect(t.servidor.recebimentos).toBe(2); // o mesmo comando chegou duas vezes...
    expect([...t.servidor.comandos.keys()]).toEqual([comando]); // ...e virou UM registro
    expect(t.servidor.arquivos.size).toBe(1);
    expect(t.motor.arquivosPendentes()).toEqual([]);
  });

  it('captura cancelada não grava nada; sem a porta do shell (navegador) a tela recebe a mensagem e nada entra na fila', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    definirCapturaFotoPdv(capturaDoShell(t.locais, [null]));
    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).toEqual({ kind: 'cancelada' });
    definirCapturaFotoPdv(null);
    expect((await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).kind).toBe('erro');
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.motor.estado().arquivos).toEqual([]);
    expect((await t.ficha()).itens.Fachada).toEqual({ situacao: 'falta', na_fila: false });
  });
});
