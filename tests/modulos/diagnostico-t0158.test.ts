/**
 * T-0158 — "Enviar diagnóstico" (v1.0.4) de ponta a ponta sem banco: app (`montarEnvio`, fila e `drenarFila`) → contrato do SDK
 * (`DiagnosticoEnvioSchema`, `.strict()`) → API (`mascararDiagnostico`, `detalheDoDiagnostico`, a mesma máscara revalidada) →
 * portal (`DiagnosticoDetalheSchema`). Decisões: R-20261110-192152-alexandre (5 últimas saídas do Android + último erro; sem
 * "Vai junto"); desenho docs/desenho/T-0158.md; ADR 0043. A função `sa_*` do portal (só super-admin) e o CHECK da 0058 rodam no CI
 * (db/testes/diagnostico.test.ts; apps/api/test/diagnosticos-portal.test.ts); aqui só a fronteira entre as peças.
 *
 * DG-1 o pacote leva as 5 últimas saídas (mais nova primeiro, a que motivou o envio sempre dentro) e o último erro, e o portal
 *      devolve as mesmas 5 na mesma ordem;
 * DG-2 LGPD: nenhum e-mail, telefone, CPF/CNPJ no pacote que sai do aparelho nem no que a API grava; o corpo não aceita campo
 *      de pessoa (nome, e-mail, tenant, usuário, cliente, valor);
 * DG-3 protocolo "Enviado · nº 0042" (folha e "Últimos envios"), sem cortar acima de 9999;
 * DG-4 fila sem sinal: fica "Na fila · sem sinal", vai sozinho na volta do sinal, uma vez só (idempotente), na sessão do dono;
 * DG-5 a chave de ligar: desligada por padrão; ligada pela constante da versão ou `EXPO_PUBLIC_DIAGNOSTICO_NUVEM=1`; desligada,
 *      o Perfil não mostra o botão e o shell não liga a fila (nenhuma chamada nova à API).
 * DG-6 RD-0124 (v1.0.4): uma tabela só dos 17 motivos do Android (`MOTIVOS_SAIDA_ANDROID`, SDK); o app manda o código dela e
 *      escreve o rótulo dela; o portal mostra ao suporte o MESMO rótulo (rótulo × valor), sem tabela própria.
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto com recado ao dono (o agente testes volta para `it` na correção).
 * Matriz: docs/testes/T-0158.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  codigoDoMotivoAndroid,
  DiagnosticoDetalheSchema,
  DiagnosticoEnvioSchema,
  MAX_SAIDAS_DIAGNOSTICO,
  MOTIVOS_ERRO_DE_TELA,
  MOTIVOS_SAIDA_ANDROID,
  rotuloDoMotivoDiagnostico,
  SaudeRespostaSchema,
  SERVICO_API_MACUXI,
  type DiagnosticoEnvio,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { diagnosticosAppLigados } from '../../apps/api/src/config';
import { detalheDoDiagnostico, mascararDiagnostico } from '../../apps/api/src/diagnosticos';
import { planoAutomatico } from '../../apps/mobile/src/lib/diagnostico-envio';
import { descricaoDaSaida } from '../../apps/mobile/src/lib/saida-android';
import { MOTIVOS_DO_FILTRO, motivoDaSaida, rotuloDoMotivo } from '../../apps/web/lib/portal-diagnosticos';
import {
  adicionarNaFila,
  DIAGNOSTICO_NUVEM_LIGADO,
  diagnosticoNoServidor,
  diagnosticoNuvemLigado,
  drenarFila,
  historicoDoUsuario,
  linhaDoHistorico,
  montarEnvio,
  novoRegistro,
  QUEDA_AUTOMATICA_LIGADA,
  tituloDaSituacao,
  type ContextoDiagnostico,
  type EntradaDiagnostico,
  type RegistroDiagnostico,
} from '../../apps/mobile/src/lib/diagnostico-envio';
import type { SaidaAndroid } from '../../apps/mobile/src/lib/saida-android';

const RAIZ = join(__dirname, '..', '..');
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const CONTEXTO: ContextoDiagnostico = {
  app: 'campo',
  versao_app: '1.0.4',
  build: 'Campo-Demo-v1.0.4',
  aparelho: { fabricante: 'samsung', modelo: 'SM-A155M', android: '14', api: 34 },
  sync: { pendentes: 2, ultimo_sync_em: '2026-11-10T13:00:00.000Z' },
};
const BASE = Date.parse('2026-11-10T12:00:00.000Z');
/** 7 saídas do Android, uma por minuto; a 0 é a mais antiga. */
const saida = (i: number, extra: Partial<SaidaAndroid> = {}): SaidaAndroid => ({
  motivo: i % 2 === 0 ? 4 : 10,
  status: 0,
  importancia: 100,
  quando: BASE + i * 60_000,
  pss_kb: 100_000 + i,
  rss_kb: 200_000 + i,
  descricao: `saída ${i}`,
  processo: 'br.com.macuxi.campo',
  pilha: `at com.macuxi.Tela.salvar(index.bundle:12${i}:34)`,
  ...extra,
});
const SAIDAS = [0, 1, 2, 3, 4, 5, 6].map((i) => saida(i));
const ERRO = { quando: '2026-11-10T12:30:00.000Z', origem: 'tela' as const, onde: '/m/novo-pedido', mensagem: "TypeError: Cannot read property 'total' of undefined", pilha: 'at resumo (index.bundle:1234:56789)' };

const ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
function entrada(over: Partial<EntradaDiagnostico> = {}): EntradaDiagnostico {
  return {
    id: ID,
    origem: 'botao',
    ocorridoEm: '2026-11-10T13:05:00.000Z',
    contexto: CONTEXTO,
    tela: '/m/novo-pedido?q=padaria',
    motivo: null,
    descricao: 'O app fechou ao salvar o pedido.',
    erro: ERRO as EntradaDiagnostico['erro'],
    saida: null,
    ultimasSaidas: SAIDAS,
    printId: null,
    ...over,
  };
}

/** O que a API grava e o portal devolve: a linha da 0058 lida pelo contrato do portal. */
function noPortal(envio: DiagnosticoEnvio) {
  const d = mascararDiagnostico(DiagnosticoEnvioSchema.parse(envio));
  const detalhe = detalheDoDiagnostico(d);
  return DiagnosticoDetalheSchema.parse({
    id: d.id,
    protocolo: 42,
    recebido_em: '2026-11-10T13:05:02.000Z',
    ocorrido_em: d.ocorrido_em,
    origem: d.origem,
    app: d.app,
    versao_app: d.versao_app,
    aparelho_modelo: d.aparelho.modelo,
    android: d.aparelho.android,
    motivo: d.motivo,
    tenant_id: '0a000000-0000-4000-8000-000000000001',
    tenant_nome: 'Distribuidora Exemplo Norte',
    tem_print: false,
    build: d.build,
    aparelho_fabricante: d.aparelho.fabricante,
    android_api: d.aparelho.api,
    tela: d.tela,
    descricao: d.descricao,
    ...detalhe,
    usuario_id: '0b000000-0000-4000-8000-000000000001',
    perfil: 'vendedor',
    alerta: { situacao: 'desligado', recado_id: null, em: null },
  });
}

describe('T-0158 DG-1 — 5 últimas saídas do Android e o último erro', () => {
  it('DG-1: de 7 saídas vão as 5 mais novas, da mais nova para a mais antiga, com horário UTC e o ponto da falha', () => {
    const e = montarEnvio(entrada());
    expect(MAX_SAIDAS_DIAGNOSTICO).toBe(5);
    expect(e.ultimas_saidas).toHaveLength(5);
    expect(e.ultimas_saidas!.map((s) => s.quando)).toEqual([6, 5, 4, 3, 2].map((i) => new Date(BASE + i * 60_000).toISOString()));
    expect(e.ultimas_saidas![0]!.pilha).toContain('index.bundle:126:34');
  });

  it('DG-1: a saída que motivou o envio (queda antiga) fica sempre na lista, no lugar da mais velha', () => {
    const e = montarEnvio(entrada({ origem: 'queda', saida: SAIDAS[0]!, motivo: 'crash_java' }));
    expect(e.ultimas_saidas).toHaveLength(5);
    expect(e.ultimas_saidas!.map((s) => s.descricao)).toEqual(['saída 6', 'saída 5', 'saída 4', 'saída 3', 'saída 0']);
  });

  it('DG-1: o último erro do app vai no pacote (mensagem, pilha e origem); a tela vai sem a busca', () => {
    const e = montarEnvio(entrada());
    expect(e.erro).toEqual({ mensagem: ERRO.mensagem, pilha: ERRO.pilha, origem: 'tela' });
    expect(e.tela).toBe('/m/novo-pedido');
  });

  it('DG-1: APK sem o macuxi-saida (lista nula) e menos de 5 saídas não quebram o contrato', () => {
    expect(montarEnvio(entrada({ ultimasSaidas: null })).ultimas_saidas).toBeNull();
    expect(montarEnvio(entrada({ ultimasSaidas: SAIDAS.slice(0, 2) })).ultimas_saidas).toHaveLength(2);
  });

  it('DG-1: o portal devolve as mesmas 5 saídas, na mesma ordem, e o último erro (app → API → portal)', () => {
    const e = montarEnvio(entrada());
    const p = noPortal(e);
    expect(p.ultimas_saidas.map((s) => s.quando)).toEqual(e.ultimas_saidas!.map((s) => s.quando));
    expect(p.erro?.mensagem).toBe(ERRO.mensagem);
    expect(noPortal(montarEnvio(entrada({ ultimasSaidas: null }))).ultimas_saidas).toEqual([]);
  });
});

describe('T-0158 DG-2 — só dado técnico (LGPD)', () => {
  const SUJO = 'Cliente ligou do (95) 99123-4567 e do 3224-1000, e-mail joao.silva@padaria.com.br, CNPJ 23.456.789/0001-95, CPF 123.456.789-09';
  const PROIBIDOS = ['99123-4567', '3224-1000', 'joao.silva', 'padaria.com.br', '23.456.789/0001-95', '123.456.789-09'];
  const sujo = () =>
    entrada({
      descricao: SUJO,
      erro: { ...ERRO, mensagem: `Falha ao enviar: ${SUJO}`, pilha: `at x (index.bundle:1:2) ${SUJO}` } as EntradaDiagnostico['erro'],
      saida: saida(9, { descricao: SUJO, pilha: SUJO }),
      ultimasSaidas: [...SAIDAS, saida(8, { descricao: SUJO, pilha: SUJO })],
    });

  it('DG-2: o pacote que sai do aparelho não tem e-mail, telefone, CNPJ nem CPF em nenhum texto livre', () => {
    const json = JSON.stringify(montarEnvio(sujo()));
    for (const p of PROIBIDOS) expect(json).not.toContain(p);
    expect(json).toContain('[telefone]');
    expect(json).toContain('[e-mail]');
  });

  it('DG-2: a API mascara de novo (aparelho antigo/adulterado manda sem máscara) — nada pessoal no que grava', () => {
    const cru = { ...montarEnvio(entrada()), descricao: SUJO, erro: { mensagem: SUJO, pilha: SUJO, origem: 'tela' } };
    const gravado = mascararDiagnostico(DiagnosticoEnvioSchema.parse(cru));
    const json = JSON.stringify({ ...gravado, detalhe: detalheDoDiagnostico(gravado) });
    for (const p of PROIBIDOS) expect(json).not.toContain(p);
  });

  it('DG-2: a máscara não apaga o que o suporte precisa (UUID, pilha com linha:coluna, data ISO, número curto de pedido)', () => {
    const texto = `pedido 000014 id ${ID} em 2026-11-10T13:05:00.000Z at f (index.bundle:1234:56789)`;
    const e = montarEnvio(entrada({ descricao: texto }));
    expect(e.descricao).toBe(texto);
  });

  it('DG-2: o corpo recusa qualquer campo de pessoa/empresa (tenant e usuário vêm do token)', () => {
    const ok = montarEnvio(entrada());
    for (const extra of [{ tenant_id: ID }, { usuario_id: ID }, { email: 'a@b.com' }, { nome: 'Lucas' }, { cliente: 'Padaria' }, { valor_cents: 53_083 }, { telefone: '95991234567' }])
      expect(DiagnosticoEnvioSchema.safeParse({ ...ok, ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(DiagnosticoEnvioSchema.safeParse({ ...ok, aparelho: { ...ok.aparelho, dono: 'Lucas' } }).success).toBe(false);
  });

  // D-T0158-1 corrigido (R-20261111-004133-engenheiro-software; era it.fails): a máscara única troca "R$ n,nn" por [valor], no
  // aparelho e na API. (Nome de cliente em texto livre não tem como ser detectado por regra: fica o aviso da folha e o roteiro manual.)
  it('DG-2 D-T0158-1 corrigido: valor em reais no texto livre (erro e descrição) não sai do aparelho nem fica gravado', () => {
    const comValor = entrada({ descricao: 'Pedido de R$ 1.234,56 travou', erro: { ...ERRO, mensagem: 'Total R$ 530,83 acima do crédito' } as EntradaDiagnostico['erro'] });
    const doAparelho = montarEnvio(comValor);
    const json = JSON.stringify(mascararDiagnostico(doAparelho));
    expect(json).not.toContain('1.234,56');
    expect(json).not.toContain('530,83');
    expect(JSON.stringify(doAparelho)).toContain('[valor]');
    // a API revalida o corpo cru (aparelho antigo, sem a máscara de valor)
    const cru = { ...doAparelho, descricao: 'Pedido de R$ 1.234,56 travou' };
    expect(JSON.stringify(mascararDiagnostico(DiagnosticoEnvioSchema.parse(cru)))).not.toContain('1.234,56');
  });
});

// ---------- servidor de mentira com a semântica da rota (201 na 1ª vez, 200 com o mesmo protocolo na repetição) ----------
function servidor() {
  const gravados = new Map<string, number>();
  let proximo = 41;
  let chamadas = 0;
  return {
    gravados,
    get chamadas() {
      return chamadas;
    },
    postar(envio: DiagnosticoEnvio, perderResposta = false) {
      chamadas++;
      const d = DiagnosticoEnvioSchema.parse(envio);
      let protocolo = gravados.get(d.id);
      const criado = protocolo === undefined;
      if (protocolo === undefined) gravados.set(d.id, (protocolo = ++proximo));
      if (perderResposta) throw Object.assign(new Error('Network request failed'), { name: 'NetworkError' });
      return { status: criado ? 201 : 200, data: { id: d.id, protocolo, criado } };
    },
  };
}

const LUCAS = { usuarioId: '0b000000-0000-4000-8000-000000000001', tenantId: '0a000000-0000-4000-8000-000000000001' };
const OUTRO_TENANT = { usuarioId: '0b000000-0000-4000-8000-000000000001', tenantId: '0a000000-0000-4000-8000-000000000002' };

function aparelho(dono = LUCAS) {
  let lista: RegistroDiagnostico[] = [];
  let online = false;
  let perderResposta = false;
  let erroHttp: { status: number; code?: string } | null = null;
  const srv = servidor();
  const portas = {
    ler: async () => lista,
    mudar: async (f: (a: readonly RegistroDiagnostico[]) => RegistroDiagnostico[]) => {
      lista = f(lista);
    },
    dono: () => dono,
    online: () => online,
    postar: async (envio: DiagnosticoEnvio) => {
      if (erroHttp) throw Object.assign(new Error('http'), erroHttp);
      return srv.postar(envio, perderResposta);
    },
    enfileirarPrint: async () => true,
    agora: () => new Date('2026-11-10T13:06:00.000Z'),
  };
  return {
    srv,
    portas,
    get lista() {
      return lista;
    },
    enfileirar(envio: DiagnosticoEnvio, d = dono) {
      lista = adicionarNaFila(lista, novoRegistro(envio, d, new Date('2026-11-10T13:05:00.000Z')));
    },
    sinal(v: boolean) {
      online = v;
    },
    perderResposta(v: boolean) {
      perderResposta = v;
    },
    erro(e: { status: number; code?: string } | null) {
      erroHttp = e;
    },
  };
}
const linha = (r: RegistroDiagnostico) => linhaDoHistorico(r, () => 'Hoje, 09:05');

describe('T-0158 DG-3/DG-4 — protocolo e fila sem sinal', () => {
  it('DG-3: aceito → "Enviado · nº 0042" na folha e "nº 0042" em destaque em Últimos envios', async () => {
    const a = aparelho();
    a.enfileirar(montarEnvio(entrada()));
    a.sinal(true);
    expect(await drenarFila(a.portas)).toBe(1);
    const r = a.lista[0]!;
    expect(tituloDaSituacao(r)).toBe('Enviado · nº 0042');
    expect(linha(r)).toMatchObject({ selo: 'Enviado', principal: 'nº 0042', destaque: true });
    expect(linha(r).leitura).toBe('Enviado, número 0042, Hoje, 09:05');
  });

  it('DG-3: protocolo acima de 9999 não é cortado', () => {
    expect(tituloDaSituacao({ situacao: 'enviado', protocolo: 123_456 })).toBe('Enviado · nº 123456');
  });

  it('DG-4: sem sinal → fica "Na fila · sem sinal" e nada vai ao servidor', async () => {
    const a = aparelho();
    a.enfileirar(montarEnvio(entrada()));
    expect(await drenarFila(a.portas)).toBe(0);
    expect(a.srv.chamadas).toBe(0);
    expect(tituloDaSituacao(a.lista[0]!)).toBe('Na fila');
    expect(linha(a.lista[0]!)).toMatchObject({ selo: 'Na fila', principal: 'sem sinal' });
  });

  it('DG-4: queda do sinal no meio (NetworkError), 5xx, 404 da API antiga → continua na fila; volta o sinal → vai sozinho', async () => {
    const a = aparelho();
    a.enfileirar(montarEnvio(entrada()));
    a.sinal(true);
    for (const e of [{ status: 503 }, { status: 404 }]) {
      a.erro(e);
      expect(await drenarFila(a.portas)).toBe(0);
      expect(a.lista[0]!.situacao).toBe('na_fila');
    }
    a.erro(null);
    expect(await drenarFila(a.portas)).toBe(1);
    expect(tituloDaSituacao(a.lista[0]!)).toBe('Enviado · nº 0042');
  });

  it('DG-4: idempotente — o servidor gravou mas a resposta se perdeu: o reenvio recebe 200 com o MESMO protocolo e grava uma vez só', async () => {
    const a = aparelho();
    a.enfileirar(montarEnvio(entrada()));
    a.sinal(true);
    a.perderResposta(true);
    expect(await drenarFila(a.portas)).toBe(0);
    expect(a.lista[0]!.situacao).toBe('na_fila');
    a.perderResposta(false);
    expect(await drenarFila(a.portas)).toBe(1);
    expect(a.srv.gravados.size).toBe(1);
    expect(a.lista[0]!.protocolo).toBe(42);
    // depois de enviado, outra passada não reenvia
    const antes = a.srv.chamadas;
    await drenarFila(a.portas);
    expect(a.srv.chamadas).toBe(antes);
  });

  it('DG-4: o mesmo id enfileirado duas vezes (toque duplo) entra uma vez só', () => {
    const a = aparelho();
    const e = montarEnvio(entrada());
    a.enfileirar(e);
    a.enfileirar(e);
    expect(a.lista).toHaveLength(1);
  });

  it('DG-4: limite da hora (429) → "Não enviado · limite da hora", sem repetir sozinho', async () => {
    const a = aparelho();
    a.enfileirar(montarEnvio(entrada()));
    a.sinal(true);
    a.erro({ status: 429, code: 'DIAGNOSTICO_LIMITE' });
    await drenarFila(a.portas);
    expect(tituloDaSituacao(a.lista[0]!)).toBe('Não enviado');
    expect(linha(a.lista[0]!).principal).toBe('limite da hora');
    a.erro(null);
    expect(await drenarFila(a.portas)).toBe(0);
  });

  it('DG-4: tenant errado — o diagnóstico de outra empresa (mesmo aparelho) não sai com esta sessão nem aparece no histórico', async () => {
    const a = aparelho(LUCAS);
    a.enfileirar(montarEnvio(entrada({ id: '9f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b' })), OUTRO_TENANT);
    a.sinal(true);
    expect(await drenarFila(a.portas)).toBe(0);
    expect(a.srv.chamadas).toBe(0);
    expect(historicoDoUsuario(a.lista, LUCAS)).toHaveLength(0);
  });
});

describe('T-0158 DG-5 — a chave de ligar', () => {
  it('DG-5: liga pela constante da versão ou por EXPO_PUBLIC_DIAGNOSTICO_NUVEM=1; qualquer outro valor deixa desligado', () => {
    expect(diagnosticoNuvemLigado(false, undefined)).toBe(false);
    expect(diagnosticoNuvemLigado(false, '0')).toBe(false);
    expect(diagnosticoNuvemLigado(false, 'true')).toBe(false);
    expect(diagnosticoNuvemLigado(false, '1')).toBe(true);
    expect(diagnosticoNuvemLigado(true, undefined)).toBe(true);
  });

  it('DG-5: a queda automática (v1.0.5) nunca liga sem o botão (v1.0.4): QUEDA_AUTOMATICA_LIGADA implica DIAGNOSTICO_NUVEM_LIGADO', () => {
    expect(!QUEDA_AUTOMATICA_LIGADA || DIAGNOSTICO_NUVEM_LIGADO).toBe(true);
  });

  it('DG-5: chave remota (recursos.diagnosticos do GET /v1/saude, R-20261111-004627-engenheiro-apps): só true liga; sem o campo = false; resposta estranha = null (vale a guardada)', () => {
    expect(diagnosticoNoServidor({ recursos: { diagnosticos: true } })).toBe(true);
    expect(diagnosticoNoServidor({ recursos: { diagnosticos: 'true' } })).toBe(false);
    expect(diagnosticoNoServidor({ recursos: { diagnosticos: 1 } })).toBe(false);
    expect(diagnosticoNoServidor({ recursos: {} })).toBe(false);
    expect(diagnosticoNoServidor({ ok: true })).toBe(false);
    for (const estranho of [null, undefined, 'ok', 42]) expect(diagnosticoNoServidor(estranho)).toBeNull();
  });

  it('DG-5: desligado (constante, variável e chave remota), o Perfil não mostra o botão e o shell não liga a fila', () => {
    const servico = fonte('apps/mobile/src/services/diagnostico.ts');
    expect(servico).toContain('export const DIAGNOSTICO_NUVEM = diagnosticoNuvemLigado(DIAGNOSTICO_NUVEM_LIGADO, process.env.EXPO_PUBLIC_DIAGNOSTICO_NUVEM);');
    // a única porta: constante/variável do build OU a chave remota === true
    expect(servico).toMatch(/export function useDiagnosticoNuvem\(\): boolean \{[\s\S]*?return DIAGNOSTICO_NUVEM \|\| r === true;\s*\}/);
    const perfil = fonte('apps/mobile/src/app/profile.tsx');
    expect(perfil).toMatch(/const (\w+) = useDiagnosticoNuvem\(\);[\s\S]*\{\1 \? <EnviarDiagnostico\b/);
    expect(perfil.match(/<EnviarDiagnostico\b/g)).toHaveLength(1);
    const shell = fonte('apps/mobile/src/state/plataforma.tsx');
    expect(shell).toMatch(/const (\w+) = useDiagnosticoNuvem\(\);[\s\S]*?if \(!motor \|\| !\1\) return;\s*return ligarEnvioDeDiagnosticos\(/);
    expect(shell.match(/ligarEnvioDeDiagnosticos\(/g)).toHaveLength(1);
  });

  // Decisão do gerente (R-20261111-011107): a chave remota tem flag próprio na API, `MACUXI_DIAGNOSTICOS_APP`, desligado e fora da
  // demo; só liga junto com o portal (`MACUXI_DIAGNOSTICOS`); a constante do build fica false.
  it('DG-5 chave remota na API: MACUXI_DIAGNOSTICOS_APP só liga com MACUXI_DIAGNOSTICOS; só 1/true/sim; o resto = desligado', () => {
    const env = (portal?: string, app?: string) => ({ MACUXI_DIAGNOSTICOS: portal, MACUXI_DIAGNOSTICOS_APP: app }) as unknown as NodeJS.ProcessEnv;
    expect(diagnosticosAppLigados(env())).toBe(false);
    expect(diagnosticosAppLigados(env('1'))).toBe(false); // a demo liga o portal; o botão continua desligado
    expect(diagnosticosAppLigados(env(undefined, '1'))).toBe(false); // sem portal ninguém lê: o app não envia
    for (const v of ['1', 'true', ' SIM ', 'True']) expect(diagnosticosAppLigados(env('1', v))).toBe(true);
    for (const v of ['0', 'false', 'yes', 'on', '']) expect(diagnosticosAppLigados(env('1', v))).toBe(false);
  });

  it('DG-5 chave remota de ponta: o /v1/saude manda portal E app; o app lê só true; nenhum compose liga o botão; constantes do build false', () => {
    // a API monta `recursos.diagnosticos` com as duas chaves (app.ts) e o servidor lê o flag próprio (servidor.ts)
    expect(fonte('apps/api/src/app.ts')).toMatch(/recursos: \{ diagnosticos: op\.diagnosticosPortal === true && op\.diagnosticosApp === true \}/);
    expect(fonte('apps/api/src/servidor.ts')).toMatch(/diagnosticosApp: diagnosticosAppLigados\(process\.env\)/);
    for (const [portal, app] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const corpo = SaudeRespostaSchema.parse({ ok: true, servico: SERVICO_API_MACUXI, versao: '1.0.4', modulos: ['core'], recursos: { diagnosticos: portal && app } });
      expect(diagnosticoNoServidor(corpo)).toBe(portal && app);
    }
    for (const c of ['scripts/deploy/demo/compose.yml', 'scripts/deploy/producao/compose.yml', 'scripts/deploy/stack-isolado/compose.ci.yml', 'scripts/deploy/stack-isolado/compose.producao.ci.yml']) {
      expect(fonte(c)).not.toContain('MACUXI_DIAGNOSTICOS_APP');
    }
    expect(DIAGNOSTICO_NUVEM_LIGADO).toBe(false);
    expect(QUEDA_AUTOMATICA_LIGADA).toBe(false);
  });
});

describe('T-0158 DG-6 — RD-0124: motivos de saída do Android numa tabela só (SDK)', () => {
  const NUMEROS = Array.from({ length: 17 }, (_, i) => i);
  /** Códigos que o app da v1.0.3 já manda (CODIGO_DO_MOTIVO do commit da v1.0.3): o portal continua lendo os diagnósticos antigos. */
  const CODIGOS_V103 = ['desconhecido', 'saida_propria', 'sinal', 'memoria', 'crash_java', 'crash_nativo', 'anr', 'falha_inicio', 'permissao', 'recursos', 'fechado_usuario', 'parado_usuario', 'dependencia', 'outro', 'congelado', 'pacote', 'atualizado'];

  it('DG-6: a tabela do SDK tem os 17 REASON_* (0..16), um código e um rótulo por número, códigos iguais aos da v1.0.3', () => {
    expect(Object.keys(MOTIVOS_SAIDA_ANDROID).map(Number).sort((a, b) => a - b)).toEqual(NUMEROS);
    expect(NUMEROS.map((n) => MOTIVOS_SAIDA_ANDROID[n]!.codigo)).toEqual(CODIGOS_V103);
    const rotulos = NUMEROS.map((n) => MOTIVOS_SAIDA_ANDROID[n]!.rotulo);
    expect(new Set(rotulos).size).toBe(17); // dois números nunca viram o mesmo texto
    for (const r of rotulos) expect(r).toMatch(/^[A-ZÀ-Ú]/);
    for (const n of NUMEROS) expect(MOTIVOS_SAIDA_ANDROID[n]!.nome).toMatch(/^REASON_[A-Z_]+$/);
  });

  it('DG-6: a queda que o app manda leva no `motivo` o código da tabela do SDK (sem tabela própria no app)', () => {
    for (const n of [3, 4, 5, 6, 7, 9, 12]) {
      const s = saida(0, { motivo: n, quando: BASE });
      const { envios } = planoAutomatico([s], null, null, BASE + 60_000);
      expect(envios.map((e) => e.motivo)).toEqual([MOTIVOS_SAIDA_ANDROID[n]!.codigo]);
    }
    expect(codigoDoMotivoAndroid(99)).toBe('motivo_99');
    expect(fonte('apps/mobile/src/lib/diagnostico-envio.ts')).not.toMatch(/CODIGO_DO_MOTIVO\s*[:=]/);
  });

  it('DG-6: o texto da saída no app começa pelo rótulo do SDK (o que o vendedor vê é o que o suporte lê)', () => {
    for (const n of NUMEROS) {
      const d = descricaoDaSaida(saida(0, { motivo: n, status: 0, pss_kb: 0, rss_kb: 0, descricao: '' }));
      expect(d).toBe(MOTIVOS_SAIDA_ANDROID[n]!.rotulo);
    }
    const app = fonte('apps/mobile/src/lib/saida-android.ts');
    expect(app).not.toMatch(/texto:\s*'/); // sem segunda tabela de textos
  });

  // RD-0124 no portal: antes `ROTULO_MOTIVO` e `CODIGO_DO_REASON` eram tabelas próprias (7 códigos saíam crus ao suporte e `outro`
  // saía "Encerrado pelo sistema"); o engenheiro-apps passou o portal a ler o SDK (v1.0.4).
  it('DG-6 RD-0124: o portal mostra o MESMO rótulo do SDK para os 17 códigos e os 3 do erro de tela (rótulo × valor)', () => {
    for (const n of NUMEROS) expect(rotuloDoMotivo(MOTIVOS_SAIDA_ANDROID[n]!.codigo)).toBe(MOTIVOS_SAIDA_ANDROID[n]!.rotulo);
    for (const [codigo, rotulo] of Object.entries(MOTIVOS_ERRO_DE_TELA)) expect(rotuloDoMotivo(codigo)).toBe(rotulo);
  });

  it('DG-6 RD-0124: o portal não tem tabela própria de motivos (lê a do SDK)', () => {
    const portal = fonte('apps/web/lib/portal-diagnosticos.ts');
    expect(portal).not.toMatch(/crash_nativo:\s*'/);
    expect(portal).not.toMatch(/\{\s*codigo:\s*'desconhecido'/);
  });

  it('DG-6: o portal mantém o que não muda — vazio = "—", código desconhecido aparece como veio, filtro só com código que tem rótulo no SDK', () => {
    expect(rotuloDoMotivo(null)).toBe('—');
    expect(rotuloDoMotivo('motivo_99')).toBe('motivo_99');
    expect(rotuloDoMotivoDiagnostico('motivo_99')).toBe('motivo_99');
    for (const c of MOTIVOS_DO_FILTRO) expect(rotuloDoMotivoDiagnostico(c)).not.toBe(c);
    for (const n of NUMEROS) expect(motivoDaSaida(n)).toBe(`${MOTIVOS_SAIDA_ANDROID[n]!.codigo}  (${MOTIVOS_SAIDA_ANDROID[n]!.nome} = ${n})`);
  });
});
