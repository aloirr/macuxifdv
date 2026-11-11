/**
 * T-0158 (ADR 0043): pacote técnico do diagnóstico, fila offline idempotente com o protocolo (contra um fake da rota
 * `POST /v1/diagnosticos` que segue o contrato do SDK) e o plano da queda automática da v1.0.5 (UUID v5 estável).
 */
import { createHash } from 'node:crypto';

import { DiagnosticoEnvioSchema, DiagnosticoRespostaSchema, type DiagnosticoEnvio } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import {
  adicionarNaFila,
  CAMINHO_DIAGNOSTICOS,
  codigoDoMotivo,
  diagnosticoNuvemLigado,
  drenarFila,
  filaValida,
  HISTORICO_DIAGNOSTICOS,
  historicoDoUsuario,
  idDaQueda,
  montarEnvio,
  NAMESPACE_DIAGNOSTICO,
  novoRegistro,
  paraEnviar,
  planoAutomatico,
  podarFila,
  resultadoDaResposta,
  resultadoDoErro,
  resumoDoEnvio,
  sha1,
  telaDoHistorico,
  textoDaSituacao,
  uuidV5,
  type ContextoDiagnostico,
  type DonoDiagnostico,
  type EntradaDiagnostico,
  type RegistroDiagnostico,
} from './diagnostico-envio';
import type { ErroRegistrado } from './erro-de-tela';
import { HISTORICO_VAZIO } from './historico-telas';
import { JANELA_PRIMEIRA_LEITURA_MS, type SaidaAndroid } from './saida-android';

const AGORA = new Date('2026-11-11T15:30:00.000Z');
const CTX: ContextoDiagnostico = {
  app: 'campo',
  versao_app: '1.0.4',
  build: '1.0.4+12',
  aparelho: { fabricante: 'samsung', modelo: 'SM-A155M', android: '14', api: 34 },
  sync: { pendentes: 2, ultimo_sync_em: '2026-11-11T15:00:00.000Z' },
};
const EU: DonoDiagnostico = { usuarioId: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222' };
const OUTRO: DonoDiagnostico = { usuarioId: '33333333-3333-4333-8333-333333333333', tenantId: EU.tenantId };
let seq = 0;
const novoId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

const entrada = (o: Partial<EntradaDiagnostico> = {}): EntradaDiagnostico => ({
  id: novoId(),
  origem: 'botao',
  ocorridoEm: AGORA,
  contexto: CTX,
  tela: '/m/novo-pedido',
  motivo: null,
  descricao: 'Fechou ao salvar o pedido',
  erro: null,
  saida: null,
  printId: null,
  ...o,
});

const saida = (o: Partial<SaidaAndroid> = {}): SaidaAndroid => ({
  motivo: 5,
  status: 11,
  importancia: 100,
  quando: AGORA.getTime() - 60_000,
  pss_kb: 412_000,
  rss_kb: 0,
  descricao: 'crash',
  processo: 'br.com.macuxi.campo',
  ...o,
});

const erroTela = (o: Partial<ErroRegistrado> = {}): ErroRegistrado => ({
  quando: new Date(AGORA.getTime() - 120_000).toISOString(),
  origem: 'tela',
  onde: '/m/novo-pedido',
  mensagem: 'TypeError: x is undefined',
  pilha: 'at render (bundle:1:2)',
  ...o,
});

describe('pacote técnico (DiagnosticoEnvioSchema)', () => {
  it('monta o corpo dentro do contrato, sem empresa nem usuário no corpo', () => {
    const e = montarEnvio(entrada({ erro: erroTela(), saida: saida(), printId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB' }));
    expect(DiagnosticoEnvioSchema.safeParse(e).success).toBe(true);
    expect(Object.keys(e)).not.toContain('tenant_id');
    expect(Object.keys(e)).not.toContain('usuario_id');
    expect(e.print_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(e.saida_android).toMatchObject({ motivo: 5, status: 11, pss_kb: 412_000 });
    expect(e.sync).toEqual({ pendentes: 2, ultimo_sync_em: '2026-11-11T15:00:00.000Z' });
  });

  it('mascara e-mail, telefone e CPF no "O que aconteceu?" e no erro (LGPD; a API mascara de novo)', () => {
    const e = montarEnvio(
      entrada({
        descricao: 'Cliente joao@exemplo.com.br ligou de (92) 99123-4567, CPF 123.456.789-09',
        erro: erroTela({ mensagem: 'falhou para maria@exemplo.com' }),
      }),
    );
    expect(e.descricao).not.toMatch(/joao@exemplo|99123-4567|123\.456\.789-09/);
    expect(e.erro?.mensagem).not.toMatch(/maria@exemplo/);
  });

  it('corta nos limites do contrato e tira a query da tela', () => {
    const e = montarEnvio(
      entrada({
        descricao: 'a'.repeat(5000),
        tela: '/m/catalogo?q=texto da busca',
        erro: erroTela({ mensagem: 'm'.repeat(900), pilha: 'p'.repeat(9000) }),
        saida: saida({ descricao: 'd'.repeat(900), pilha: 'q'.repeat(9000) }),
        contexto: { ...CTX, versao_app: '1.0.4-uma-versao-muito-longa', aparelho: { ...CTX.aparelho, modelo: 'x'.repeat(200) } },
      }),
    );
    expect(e.descricao).toHaveLength(1000);
    expect(e.erro?.mensagem.length).toBeLessThanOrEqual(300);
    expect(e.erro?.pilha?.length).toBeLessThanOrEqual(2000);
    expect(e.saida_android?.pilha?.length).toBeLessThanOrEqual(4000);
    expect(e.versao_app.length).toBeLessThanOrEqual(20);
    expect(e.tela).toBe('/m/catalogo');
    expect(JSON.stringify(e).length).toBeLessThan(32 * 1024);
  });

  it('descrição vazia vira nulo; sem motor, sem sync', () => {
    const e = montarEnvio(entrada({ descricao: '   ', contexto: { ...CTX, sync: null } }));
    expect(e.descricao).toBeNull();
    expect(e.sync).toBeNull();
  });

  it('a tela é a última da aba de módulo em uso', () => {
    expect(telaDoHistorico(HISTORICO_VAZIO)).toBeNull();
    const h = { ...HISTORICO_VAZIO, aba: '/m/pedidos', pilhas: { '/m/pedidos': [{ chave: 'pedidos', href: '/m/pedidos', params: {} }, { chave: 'pedido?id=1', href: '/m/pedido?id=1', params: {} }] } };
    expect(telaDoHistorico(h)).toBe('/m/pedido');
  });

  it('"Vai junto" resume versão, aparelho, tela, último erro, fila e print', () => {
    const e = montarEnvio(entrada({ erro: erroTela(), saida: saida(), printId: novoId() }));
    const r = resumoDoEnvio(e, () => 'hoje 11:30');
    expect(r).toEqual([
      'Versão: Macuxi Campo 1.0.4 (1.0.4+12)',
      'Aparelho: samsung SM-A155M · Android 14 (API 34)',
      'Tela: /m/novo-pedido',
      'Horário: hoje 11:30',
      'Último erro do app: TypeError: x is undefined',
      'Saída do Android: crash_nativo',
      'Fila do aparelho: 2 itens',
      'Print: anexado',
    ]);
  });

  it('caminho relativo ao endereço da API (que já termina em /v1)', () => {
    expect(CAMINHO_DIAGNOSTICOS).toBe('/diagnosticos');
  });
});

describe('resposta e erros da rota', () => {
  it('classifica: sem rede, 5xx, 401, 408, 429 e rota ausente (404) ficam na fila; 400 e 409 viram falha', () => {
    expect(resultadoDoErro(new Error('Sem conexão')).tipo).toBe('retentar');
    for (const status of [500, 503, 401, 408, 429, 404, 405, 501]) expect(resultadoDoErro({ status, code: `http_${status}` }).tipo).toBe('retentar');
    expect(resultadoDoErro({ status: 400, code: 'PAYLOAD_INVALIDO' }).tipo).toBe('recusado');
    expect(resultadoDoErro({ status: 409, code: 'DIAGNOSTICO_JA_EXISTE' })).toMatchObject({ tipo: 'recusado', codigo: 'DIAGNOSTICO_JA_EXISTE' });
  });

  it('aceita só a resposta do contrato e do mesmo id', () => {
    const id = novoId();
    expect(resultadoDaResposta(id, { id, protocolo: 42, criado: true })).toEqual({ tipo: 'aceito', resposta: { id, protocolo: 42, criado: true } });
    expect(resultadoDaResposta(id, { id: novoId(), protocolo: 42, criado: true }).tipo).toBe('retentar');
    expect(resultadoDaResposta(id, { ok: true }).tipo).toBe('retentar');
  });
});

/** Fake da rota: idempotente pelo id (201 novo, 200 repetido, 409 de outro usuário), protocolo global crescente. */
function criarApiFake() {
  const guardados = new Map<string, { protocolo: number; usuario: string }>();
  let proximo = 41;
  const chamadas: DiagnosticoEnvio[] = [];
  let falha: unknown = null;
  return {
    chamadas,
    falharCom(e: unknown) {
      falha = e;
    },
    async postar(envio: DiagnosticoEnvio, usuario: string) {
      chamadas.push(envio);
      if (falha) throw falha;
      DiagnosticoEnvioSchema.parse(envio);
      const ja = guardados.get(envio.id);
      if (ja && ja.usuario !== usuario) throw { status: 409, code: 'DIAGNOSTICO_JA_EXISTE' };
      if (ja) return { status: 200, data: DiagnosticoRespostaSchema.parse({ id: envio.id, protocolo: ja.protocolo, criado: false }) };
      guardados.set(envio.id, { protocolo: ++proximo, usuario });
      return { status: 201, data: { id: envio.id, protocolo: proximo, criado: true } };
    },
  };
}

function criarAparelho(api = criarApiFake()) {
  let lista: RegistroDiagnostico[] = [];
  const prints: string[] = [];
  const estado = { online: true, dono: EU as DonoDiagnostico | null, motor: true };
  const portas = {
    ler: async () => lista,
    mudar: async (f: (a: readonly RegistroDiagnostico[]) => RegistroDiagnostico[]) => {
      lista = f(lista);
    },
    dono: () => estado.dono,
    online: () => estado.online,
    postar: (e: DiagnosticoEnvio) => api.postar(e, estado.dono!.usuarioId),
    enfileirarPrint: async (id: string) => {
      if (!estado.motor) return false;
      prints.push(id);
      return true;
    },
    agora: () => AGORA,
  };
  return {
    api,
    estado,
    prints,
    lista: () => lista,
    adicionar: (e: DiagnosticoEnvio, dono = EU) => {
      lista = adicionarNaFila(lista, novoRegistro(e, dono, AGORA));
    },
    drenar: () => drenarFila(portas),
  };
}

describe('fila do aparelho (offline, idempotente, protocolo)', () => {
  it('com sinal: vai na hora e mostra "Enviado · nº 0042"', async () => {
    const a = criarAparelho();
    const e = montarEnvio(entrada());
    a.adicionar(e);
    expect(await a.drenar()).toBe(1);
    const r = a.lista()[0]!;
    expect(r).toMatchObject({ situacao: 'enviado', protocolo: 42, tentativas: 1 });
    expect(textoDaSituacao(r)).toBe('Enviado · nº 0042');
  });

  it('sem sinal: fica "Na fila" e vai quando o sinal volta, com o mesmo id', async () => {
    const a = criarAparelho();
    a.estado.online = false;
    const e = montarEnvio(entrada());
    a.adicionar(e);
    expect(await a.drenar()).toBe(0);
    expect(a.api.chamadas).toHaveLength(0);
    expect(textoDaSituacao(a.lista()[0]!)).toBe('Na fila. Envia quando tiver sinal.');
    a.estado.online = true;
    await a.drenar();
    expect(a.api.chamadas.map((c) => c.id)).toEqual([e.id]);
    expect(a.lista()[0]!.situacao).toBe('enviado');
  });

  it('sem sessão a fila espera o próximo login; só sai com a sessão do dono', async () => {
    const a = criarAparelho();
    a.adicionar(montarEnvio(entrada()), EU);
    a.estado.dono = null;
    expect(await a.drenar()).toBe(0);
    a.estado.dono = OUTRO;
    expect(await a.drenar()).toBe(0);
    expect(a.api.chamadas).toHaveLength(0);
    a.estado.dono = EU;
    expect(await a.drenar()).toBe(1);
  });

  it('falha de transporte conta a tentativa, para a passada e mantém na fila', async () => {
    const a = criarAparelho();
    a.adicionar(montarEnvio(entrada()));
    a.adicionar(montarEnvio(entrada()));
    a.api.falharCom(new Error('Sem conexão com o servidor.'));
    await a.drenar();
    expect(a.api.chamadas).toHaveLength(1);
    expect(a.lista().map((r) => [r.situacao, r.tentativas])).toEqual([
      ['na_fila', 1],
      ['na_fila', 0],
    ]);
  });

  it('rota ainda não publicada (404) fica na fila; recusa (400) vira falha e não repete', async () => {
    const a = criarAparelho();
    a.adicionar(montarEnvio(entrada()));
    a.api.falharCom({ status: 404, code: 'http_404' });
    await a.drenar();
    expect(a.lista()[0]!.situacao).toBe('na_fila');
    a.api.falharCom({ status: 400, code: 'PAYLOAD_INVALIDO' });
    await a.drenar();
    expect(a.lista()[0]!.situacao).toBe('falhou');
    expect(textoDaSituacao(a.lista()[0]!)).toMatch(/^Não enviado: /);
    a.api.falharCom(null);
    await a.drenar();
    expect(a.api.chamadas).toHaveLength(2);
  });

  it('repetir o mesmo id (resposta perdida) devolve o mesmo protocolo; o mesmo id não entra duas vezes na fila', async () => {
    const api = criarApiFake();
    const e = montarEnvio(entrada());
    await api.postar(e, EU.usuarioId); // o servidor gravou e a resposta se perdeu
    const a = criarAparelho(api);
    a.adicionar(e);
    a.adicionar(e);
    expect(a.lista()).toHaveLength(1);
    await a.drenar();
    expect(a.lista()[0]).toMatchObject({ situacao: 'enviado', protocolo: 42 });
  });

  it('o print entra na fila de arquivos só DEPOIS do POST aceito; sem motor, tenta na próxima passada', async () => {
    const a = criarAparelho();
    const printId = novoId();
    a.estado.online = false;
    a.adicionar(montarEnvio(entrada({ printId })));
    await a.drenar();
    expect(a.prints).toEqual([]);
    a.estado.online = true;
    a.estado.motor = false;
    await a.drenar();
    expect(a.lista()[0]).toMatchObject({ situacao: 'enviado', print_na_fila: false });
    a.estado.motor = true;
    await a.drenar();
    expect(a.prints).toEqual([printId]);
    expect(a.lista()[0]!.print_na_fila).toBe(true);
    await a.drenar();
    expect(a.prints).toEqual([printId]);
  });

  it('histórico: os últimos 10 do usuário, mais novo primeiro; a fila nunca é podada', () => {
    let lista: RegistroDiagnostico[] = [];
    for (let i = 0; i < 15; i++) {
      const r = novoRegistro(montarEnvio(entrada()), EU, new Date(AGORA.getTime() + i * 1000));
      lista = adicionarNaFila(lista, { ...r, situacao: i < 3 ? 'na_fila' : 'enviado', protocolo: i + 1 });
    }
    lista = adicionarNaFila(lista, novoRegistro(montarEnvio(entrada()), OUTRO, AGORA));
    expect(lista.filter((r) => r.situacao === 'na_fila' && r.usuario_id === EU.usuarioId)).toHaveLength(3);
    expect(lista.filter((r) => r.usuario_id === EU.usuarioId && r.situacao === 'enviado')).toHaveLength(HISTORICO_DIAGNOSTICOS);
    const h = historicoDoUsuario(lista, EU);
    expect(h).toHaveLength(HISTORICO_DIAGNOSTICOS);
    expect(h[0]!.protocolo).toBe(15);
    expect(historicoDoUsuario(lista, OUTRO)).toHaveLength(1);
    expect(paraEnviar(lista, EU)).toHaveLength(3);
    expect(podarFila(lista)).toHaveLength(lista.length);
  });

  it('lista do armazenamento com lixo ou corpo fora do contrato: só os válidos', () => {
    const bom = novoRegistro(montarEnvio(entrada()), EU, AGORA);
    expect(filaValida(null)).toEqual([]);
    expect(filaValida([bom, { id: 'x' }, { ...bom, id: 'y', envio: { ...bom.envio, email: 'a@b.c' } }, 3])).toEqual([bom]);
  });
});

describe('v1.0.5: queda automática na abertura seguinte', () => {
  it('SHA-1 e UUID v5 conferem com a referência (RFC 4122)', () => {
    for (const t of ['', 'abc', 'x'.repeat(200)]) {
      const dados = new TextEncoder().encode(t);
      expect(Buffer.from(sha1(dados)).toString('hex')).toBe(createHash('sha1').update(dados).digest('hex'));
    }
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5('a', NAMESPACE_DIAGNOSTICO)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('a queda nova vira origem "queda" com id estável; a 2ª abertura com o marcador não repete', () => {
    const s = saida();
    const p1 = planoAutomatico([s, saida({ motivo: 10, quando: s.quando - 5000 })], null, null, AGORA.getTime());
    expect(p1.envios).toEqual([expect.objectContaining({ id: idDaQueda(s), origem: 'queda', motivo: 'crash_nativo', saida: s })]);
    expect(planoAutomatico([s], null, null, AGORA.getTime()).envios[0]!.id).toBe(p1.envios[0]!.id);
    const corpo = montarEnvio({ ...p1.envios[0]!, contexto: CTX, descricao: null, printId: null });
    expect(corpo).toMatchObject({ origem: 'queda', motivo: 'crash_nativo', descricao: null, ocorrido_em: new Date(s.quando).toISOString() });
    expect(planoAutomatico([s], null, p1.marcador, AGORA.getTime() + 60_000).envios).toEqual([]);
  });

  it('1ª leitura: só os últimos 7 dias; no máximo 3 quedas por abertura, as mais novas', () => {
    const velha = saida({ quando: AGORA.getTime() - JANELA_PRIMEIRA_LEITURA_MS - 1 });
    const novas = [1, 2, 3, 4].map((i) => saida({ quando: AGORA.getTime() - i * 60_000 }));
    const p = planoAutomatico([velha, ...novas], null, null, AGORA.getTime());
    expect(p.envios.map((e) => e.ocorridoEm)).toEqual(novas.slice(0, 3).map((s) => new Date(s.quando).toISOString()));
  });

  it('erro de tela vira "erro_tela"; não fatal e o registro vindo do Android ficam de fora', () => {
    expect(planoAutomatico([], erroTela(), null, AGORA.getTime()).envios).toEqual([
      expect.objectContaining({ origem: 'erro_tela', motivo: 'tela', tela: '/m/novo-pedido' }),
    ]);
    expect(planoAutomatico([], erroTela({ origem: 'nao-fatal' }), null, AGORA.getTime()).envios).toEqual([]);
    expect(planoAutomatico([], erroTela({ origem: 'fatal', onde: 'Android' }), null, AGORA.getTime()).envios).toEqual([]);
    const p = planoAutomatico([], erroTela(), null, AGORA.getTime());
    expect(planoAutomatico([], erroTela(), p.marcador, AGORA.getTime()).envios).toEqual([]);
  });

  it('fatal do JS e queda do mesmo fechamento: vai um só, o erro_tela, com a saída junto', () => {
    const s = saida({ motivo: 4, quando: AGORA.getTime() - 60_000 });
    const fatal = erroTela({ origem: 'fatal', quando: new Date(s.quando - 3000).toISOString() });
    const p = planoAutomatico([s], fatal, null, AGORA.getTime());
    expect(p.envios).toHaveLength(1);
    expect(p.envios[0]).toMatchObject({ origem: 'erro_tela', motivo: 'fatal', saida: s });
  });

  it('códigos dos motivos do Android', () => {
    expect([3, 5, 6, 99].map(codigoDoMotivo)).toEqual(['memoria', 'crash_nativo', 'anr', 'motivo_99']);
  });
});

describe('chave da versão', () => {
  it('liga pela constante da versão ou pela variável do build de teste', () => {
    expect(diagnosticoNuvemLigado(false, undefined)).toBe(false);
    expect(diagnosticoNuvemLigado(false, '0')).toBe(false);
    expect(diagnosticoNuvemLigado(false, '1')).toBe(true);
    expect(diagnosticoNuvemLigado(true, undefined)).toBe(true);
  });
});
