/**
 * v1.0.34 — DEFEITO A do teste de campo do APK v1.0.32 (R-20261124-093521; empresa AM2808): Campo › Cliente › aba Documentação,
 * linha "Fachada — Falta" com a câmera. Depois de tirar a foto a linha continua "Falta" e a Data "—".
 * Decisão do Alexandre (mesmo recado; desenho docs/design/telas/cliente-documentacao-v1034.md): cada tipo de foto tem dois botões,
 * olho (ver a foto enviada; desligado sem foto) e câmera (adicionar foto nova, câmera ou galeria); a foto NUNCA é excluída nem
 * trocada, só adicionada; o histórico fica; a mais recente vale para a situação e a data da linha (RN-CORE-38).
 *
 * Cadeia real do aparelho, sem aparelho: `enviarFotoPdv` → MOTOR DE SYNC REAL (fila de itens e de arquivos, armazenamento em memória,
 * entidade `cliente_foto` do Core) → transporte que faz o papel da API com a regra REAL do servidor (`podeEnviarFoto`, a mesma que
 * modules/core/api/foto-pdv-push.ts chama) → ficha REAL (`montarFichaLocal`, a mesma da tela; `dataLocal` no fuso do tenant).
 *
 * Grupo 1 (guarda): com a foto só na fila, a ficha já diz que há foto, com a data no fuso de Manaus (inclusive na virada do dia).
 * Grupo 2: a foto tirada quando o servidor já tem uma foto viva do tipo é aceita (antes, 422 RN-CORE-38 "Esta foto já foi enviada."
 *   e a fila presa); o servidor guarda o histórico e a mais recente vale para a situação, a data e o olho (`fotosComPendentes`).
 * Grupo 3: a linha da foto do PDV é a função pura `linhaDaFotoDoPdv` (modules/core/app/lib/foto-fachada.ts), com o olho e a câmera.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClienteFotoPushSchema, type ClienteFotoPush, type ClienteFotoSync, type ClienteSync, type FotoTipoSync } from '../../modules/core/contracts';
import { podeEnviarFoto, type FotoPdvPush } from '../../modules/core/domain';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';
import { enviarFotoPdv } from '../../modules/core/app/lib/enviar-foto-pdv';
import { definirCapturaFotoPdv, linhaDaFotoDoPdv, type CapturaFotoPdv, type ItemLinhaFotoPdv } from '../../modules/core/app/lib/foto-fachada';
import { montarFichaLocal, type ClientesLocais } from '../../modules/core/app/lib/usar-clientes-locais';

const U = (n: number) => `0f034000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TZ = 'America/Manaus';
/** 24/11/2026 23:30 em Manaus = 25/11/2026 03:30 UTC (virada do dia: a data exibida é a do fuso do tenant). */
const AGORA = '2026-11-25T03:30:00.000Z';
const HOJE_MANAUS = '2026-11-24';
/** A mesma data como a linha exibe (dd/mm/aaaa). */
const DATA_HOJE = '24/11/2026';
const CLIENTE = U(1);
const FOTO_ANTIGA = U(21);
const FOTO_NOVA = U(22);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

const tipo = (o: Partial<FotoTipoSync> & Pick<FotoTipoSync, 'id' | 'nome'>): FotoTipoSync => ({ updated_at: AGORA, deleted_at: null, external_id: null, obrigatorio: false, sensivel: false, fachada: false, ordem: 0, ativo: true, ...o });
const FACHADA = tipo({ id: U(3), nome: 'Fachada', fachada: true, obrigatorio: true });
const TIPOS = [FACHADA];

const CLIENTE_LINHA = {
  id: CLIENTE,
  updated_at: AGORA,
  deleted_at: null,
  external_id: null,
  documento: '00000000000191',
  razao_social: 'Mercado Boto Ltda',
  nome_fantasia: 'Mercado Boto',
  segmento: 'Mercearia',
  telefone: null,
  email: null,
  logradouro: 'Rua A',
  numero: '10',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: null,
  latitude: '-3.100000',
  longitude: '-60.000000',
  ativo: true,
} as unknown as ClienteSync;

/** As linhas do aparelho que `useClientesLocais` entrega à tela (só o que a ficha da Documentação usa). */
function locais(clienteFotos: readonly ClienteFotoSync[], fotosPendentes: readonly FotoPdvPush[]): ClientesLocais {
  return {
    clientes: [CLIENTE_LINHA],
    financeiros: [],
    titulos: [],
    historico: [],
    contatos: [],
    enderecos: [],
    filiais: [],
    fotoTipos: TIPOS,
    clienteFotos,
    fotosPendentes,
    pronto: true,
    carregado: true,
    verPedidos: true,
    perfil: 'vendedor',
    faixasCurva: {} as ClientesLocais['faixasCurva'],
    pedidos: [],
    pedidoItens: [],
    visitasSync: [],
    resumosVisita: [],
  };
}

/** O que a linha "Fachada" da aba Documentação mostra (aba-documentacao.tsx chama `linhaDaFotoDoPdv` com o item da ficha REAL). */
function linhaFachada(l: ClientesLocais) {
  const ficha = montarFichaLocal(l, CLIENTE, HOJE_MANAUS);
  const item = ficha?.fotos_pdv?.itens.find((i) => i.tipo_id === FACHADA.id);
  const linha = item ? linhaDaFotoDoPdv(item, { tz: TZ, podeAbrir: true, podeEnviar: true }) : null;
  return { situacao: linha?.segunda ?? null, data: linha?.data ?? null, arquivo: item?.arquivo_id ?? null };
}

function capturaDoShell(arquivos: Map<string, Uint8Array>, fila: Array<{ id: string; origem: 'camera' | 'galeria' } | null>): CapturaFotoPdv {
  return {
    escolher: async () => {
      const f = fila.shift() ?? null;
      if (f) arquivos.set(`fotos/${f.id}.jpg`, JPEG);
      return f ? { ...f, largura_px: 1600, altura_px: 1200 } : null;
    },
    camera: async () => null,
    galeria: async () => null,
  };
}

type LinhaServidor = ClienteFotoPush & { deleted_at: string | null; updated_at: string };

/** Aparelho do vendedor (motor real) + "servidor" com a regra REAL de envio (`podeEnviarFoto`, a mesma de foto-pdv-push.ts). */
function montar(o: { servidorJaTem?: LinhaServidor } = {}) {
  let sinal = true;
  let seq = 100;
  let relogio = Date.parse('2026-11-25T03:31:00.000Z');
  const tique = () => new Date((relogio += 1000)).toISOString();
  const arquivos = new Map<string, Uint8Array>();
  const servidor = { linhas: new Map<string, LinhaServidor>(), rejeicoes: [] as string[] };
  if (o.servidorJaTem) servidor.linhas.set(o.servidorJaTem.id, o.servidorJaTem);
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
      usuario: () => ({ id: U(9), nome: 'Lucas', perfil: 'vendedor', fuso: TZ }),
    },
    arquivos: { ler: async (c) => arquivos.get(c) ?? null, remover: async () => undefined },
    transporte: {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        return itens.map((i): ResultadoItemPush => {
          const p = ClienteFotoPushSchema.parse(i.payload);
          if (servidor.linhas.has(p.id)) return { id: i.id, status: 'aceito', em: tique() };
          const vigente = [...servidor.linhas.values()].some((l) => !l.deleted_at && l.cliente_id === p.cliente_id && l.foto_tipo_id === p.foto_tipo_id);
          const pode = podeEnviarFoto('vendedor', vigente); // a mesma regra que a API aplica (foto-pdv-push.ts)
          if (!pode.ok) {
            servidor.rejeicoes.push(`${pode.codigo}: ${pode.mensagem}`);
            return { id: i.id, status: 'rejeitado', codigo: pode.codigo, mensagem: pode.mensagem };
          }
          // decisão de 24/11: nada se apaga; a nova entra no histórico ao lado das anteriores
          servidor.linhas.set(p.id, { ...p, deleted_at: null, updated_at: tique() });
          return { id: i.id, status: 'aceito', em: tique() };
        });
      },
      async pull(entidade: string) {
        const itens =
          entidade === 'cliente_foto'
            ? [...servidor.linhas.values()].map((l) => ({ id: l.id, updated_at: l.updated_at, deleted_at: l.deleted_at, external_id: null, cliente_id: l.cliente_id, foto_tipo_id: l.foto_tipo_id, arquivo_id: l.arquivo_id, origem: l.origem, tirada_em: l.tirada_em }) as LinhaSync)
            : entidade === 'foto_tipo'
              ? (TIPOS as unknown as LinhaSync[])
              : [];
        return { itens, proximo_cursor: null, horizonte: tique() };
      },
      async enviarArquivo(a: EnvioArquivo): Promise<ResultadoEnvioArquivo> {
        const ref = [...servidor.linhas.values()].some((l) => l.arquivo_id === a.id);
        return ref ? { status: 'aceito' } : { status: 'rejeitado', codigo: 'ARQUIVO_SEM_REFERENCIA', mensagem: 'O registro da foto ainda não chegou.' };
      },
    },
  });
  /** O que a tela lê: linhas do pull + sobreposição da fila (usar-clientes-locais.ts:61-89), na ficha REAL. */
  const tela = async () => {
    const pendentes = motor.sobreposicao(['cliente_foto']).map((i) => i.payload as FotoPdvPush);
    const linhas = (await motor.linhas<ClienteFotoSync & LinhaSync>('cliente_foto')) as ClienteFotoSync[];
    return linhaFachada(locais(linhas, pendentes));
  };
  return { motor, arquivos, servidor, tela, ligarSinal: (v: boolean) => (sinal = v) };
}

afterEach(() => definirCapturaFotoPdv(null));

// A captura usa o relógio do aparelho (`new Date()` em enviar-foto-pdv.ts): o teste fixa a virada do dia em Manaus (AGORA).
// Só `Date`, para não travar promises e timers do motor.
function fixarRelogioNoAgora(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AGORA));
  });
  afterEach(() => vi.useRealTimers());
}

const antiga = (o: Partial<LinhaServidor> = {}): LinhaServidor => ({ id: FOTO_ANTIGA, cliente_id: CLIENTE, foto_tipo_id: FACHADA.id, arquivo_id: U(31), origem: 'camera', tirada_em: '2026-10-01T15:00:00.000Z', deleted_at: null, updated_at: '2026-10-01T15:00:01.000Z', ...o });

describe('v1.0.34 A — guarda: foto tirada e ainda na fila (ficha REAL, fuso do tenant)', () => {
  fixarRelogioNoAgora();

  it('sem sinal: a Fachada sai de "Falta" para "Na fila" e a Data é a da captura no fuso de Manaus (23h30 de 24/11 = 24/11, não 25/11)', async () => {
    const t = montar();
    t.ligarSinal(false);
    await t.motor.aplicarModulosAtivos(['core']);
    expect(await t.tela()).toEqual({ situacao: 'Falta', data: '—', arquivo: null });
    definirCapturaFotoPdv(capturaDoShell(t.arquivos, [{ id: FOTO_NOVA, origem: 'camera' }]));
    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).toEqual({ kind: 'enviada' });
    expect(await t.tela()).toEqual({ situacao: 'Na fila', data: DATA_HOJE, arquivo: FOTO_NOVA });
  });

  it('com sinal e servidor sem foto do tipo: aceita, puxa e a linha fica com foto e data (o caminho que o teste de campo esperava)', async () => {
    const t = montar();
    await t.motor.aplicarModulosAtivos(['core']);
    definirCapturaFotoPdv(capturaDoShell(t.arquivos, [{ id: FOTO_NOVA, origem: 'camera' }]));
    await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA });
    expect(await t.motor.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(await t.tela()).toEqual({ situacao: 'Enviada', data: DATA_HOJE, arquivo: FOTO_NOVA });
  });
});

describe('v1.0.34 A — foto tirada com foto viva do tipo no servidor (RN-CORE-38 × decisão "só adicionar")', () => {
  fixarRelogioNoAgora();

  it('servidor já tem a fachada que o aparelho ainda não puxou → a foto tirada é aceita e a linha fica "Na fila" com a data dela', async () => {
    const t = montar({ servidorJaTem: antiga() });
    await t.motor.aplicarModulosAtivos(['core']);
    // a tela ainda não tem a linha do servidor (pull ainda não rodou): "Fachada — Falta" com a câmera
    expect(await t.tela()).toEqual({ situacao: 'Falta', data: '—', arquivo: null });
    definirCapturaFotoPdv(capturaDoShell(t.arquivos, [{ id: FOTO_NOVA, origem: 'camera' }]));
    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).toEqual({ kind: 'enviada' });
    await t.motor.enviar();
    // a linha mostra a foto que o vendedor acabou de tirar, com a data dela no fuso do tenant (o item recusado fica `falhou` e sobreposto)
    expect(await t.tela()).toEqual({ situacao: 'Na fila', data: DATA_HOJE, arquivo: FOTO_NOVA });
    // o push da foto não pode ser recusado: foto nunca é trocada, só adicionada
    expect(t.servidor.rejeicoes, 'o servidor recusou a foto nova').toEqual([]);
  });

  it('adicionar com foto antiga no aparelho: na fila, a mais recente (a nova) já vale para a Data; depois do sync, a nova é a vigente e a antiga fica no histórico', async () => {
    const t = montar({ servidorJaTem: antiga() });
    await t.motor.aplicarModulosAtivos(['core']);
    expect(await t.motor.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(await t.tela()).toEqual({ situacao: 'Enviada', data: '01/10/2026', arquivo: U(31) });

    t.ligarSinal(false);
    definirCapturaFotoPdv(capturaDoShell(t.arquivos, [{ id: FOTO_NOVA, origem: 'galeria' }]));
    expect(await enviarFotoPdv(t, { clienteId: CLIENTE, nomeCliente: 'Mercado Boto', tipo: FACHADA })).toEqual({ kind: 'enviada' });
    // a mais recente (a da fila) vale para a Data e o olho, não a antiga do pull
    expect(await t.tela()).toEqual({ situacao: 'Na fila', data: DATA_HOJE, arquivo: FOTO_NOVA });

    t.ligarSinal(true);
    expect(await t.motor.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.servidor.rejeicoes, 'o servidor recusou a foto nova').toEqual([]);
    // o id da linha é o do aparelho (novoId); o id da foto vai em arquivo_id
    expect([...t.servidor.linhas.values()].filter((l) => !l.deleted_at).map((l) => l.arquivo_id).sort(), 'histórico: as duas fotos ficam').toEqual([U(31), FOTO_NOVA].sort());
    expect(await t.tela()).toEqual({ situacao: 'Enviada', data: DATA_HOJE, arquivo: FOTO_NOVA });
  });
});

describe('v1.0.34 A — função pura da linha da foto do PDV (olho + câmera; desenho §2–§4)', () => {
  const item = (o: Partial<ItemLinhaFotoPdv> = {}): ItemLinhaFotoPdv => ({ tipo_id: FACHADA.id, nome: 'Fachada', obrigatorio: true, sensivel: false, fachada: true, situacao: 'falta', na_fila: false, tirada_em: null, arquivo_id: null, ...o });

  it('sem foto: "Falta" em perigo, Data "—", olho DESLIGADO e câmera ligada', () => {
    expect(linhaDaFotoDoPdv(item(), { tz: TZ, podeAbrir: true, podeEnviar: true })).toEqual({ segunda: 'Falta', perigo: true, data: '—', trancada: false, ver: { ligado: false, rotulo: 'Ver foto da fachada' }, adicionar: { rotulo: 'Adicionar foto da fachada' } });
  });

  it('foto tirada agora (na fila, 23h30 de Manaus): "Na fila", Data 24/11/2026, olho ligado, câmera CONTINUA ligada', () => {
    expect(linhaDaFotoDoPdv(item({ situacao: 'tem', na_fila: true, tirada_em: AGORA, arquivo_id: U(41) }), { tz: TZ, podeAbrir: true, podeEnviar: true })).toEqual({ segunda: 'Na fila', perigo: false, data: '24/11/2026', trancada: false, ver: { ligado: true, rotulo: 'Ver foto da fachada' }, adicionar: { rotulo: 'Adicionar foto da fachada' } });
  });

  it('foto enviada: "Enviada" (não "Foto"), Data dela; outro tipo usa "Ver foto: <Nome>" e fica trancado (cadeado, olho desligado); perfil sem envio não ganha câmera', () => {
    expect(linhaDaFotoDoPdv(item({ situacao: 'tem', tirada_em: '2026-11-01T12:00:00.000Z', arquivo_id: U(42) }), { tz: TZ, podeAbrir: true, podeEnviar: true })).toMatchObject({ segunda: 'Enviada', data: '01/11/2026', ver: { ligado: true } });
    expect(linhaDaFotoDoPdv(item({ tipo_id: U(4), nome: 'Contrato social', fachada: false, obrigatorio: false, situacao: 'tem', tirada_em: '2026-11-01T12:00:00.000Z', arquivo_id: U(43) }), { tz: TZ, podeAbrir: true, podeEnviar: false })).toMatchObject({ segunda: 'Enviada', trancada: true, ver: { ligado: false, rotulo: 'Ver foto: Contrato social' }, adicionar: null });
  });
});
