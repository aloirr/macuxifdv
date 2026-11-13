/**
 * T-0158 (ADR 0043): partes puras do Portal › Diagnósticos — rótulos de origem e motivo, filtros ↔ endereço (com o período
 * padrão de 7 dias e as datas em Manaus), o filtro do contrato e os blocos técnicos do detalhe (as 5 saídas do Android).
 */
import { DiagnosticoDetalheSchema, DiagnosticoFiltroSchema } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { itemAtivoDoMenu, MENU_TIME_MACUXI } from '@/components/portal/base';
import {
  caminhoDoDiagnostico,
  dataDaLista,
  dataDoDetalhe,
  enderecoDosFiltros,
  FILTROS_VAZIOS,
  filtroDaApi,
  filtrosComPeriodo,
  filtrosDoEndereco,
  idCurto,
  linhaDoCabecalho,
  linhasDaSaida,
  linkDoRecado,
  mostrarOcorrido,
  motivoDaSaida,
  numeroDoDiagnostico,
  periodoDosFiltros,
  pilhaCurta,
  queryDoFiltro,
  ROTULO_ORIGEM,
  rotuloDoMotivo,
  saidasDoDetalhe,
  situacaoDoRecado,
  temFiltro,
  textoDaFila,
  textoDasSaidas,
  textoDoErro,
} from './portal-diagnosticos';
import { ROTAS_PORTAL } from './portal-rotas';

/** 11/11/2026 15:30 em Manaus (UTC−4). */
const AGORA = new Date('2026-11-11T19:30:00.000Z');
const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const TENANT = '3b9e0000-1111-4222-8333-44445555a71c';

const busca = (q: string) => new URLSearchParams(q);

const saida = (n: number, o: Record<string, unknown> = {}) => ({
  quando: new Date(Date.parse('2026-11-11T18:01:37.000Z') - n * 60_000).toISOString(),
  motivo: 5,
  status: 11,
  importancia: 100,
  pss_kb: 212_408,
  rss_kb: 301_772,
  descricao: 'Fatal signal 11 (SIGSEGV), code 1, fault addr 0x0',
  pilha: '#00 pc 0004a1f8  libhermes.so\n#01 pc 000b31c4  libexpo-sqlite.so (sqlite3_step+88)\n#02 pc 000b2f60  libexpo-sqlite.so\n#03 a\n#04 b',
  ...o,
});

const detalhe = (o: Record<string, unknown> = {}) =>
  DiagnosticoDetalheSchema.parse({
    id: ID,
    protocolo: 41,
    recebido_em: '2026-11-11T18:02:10.000Z',
    ocorrido_em: '2026-11-11T18:01:37.000Z',
    origem: 'queda',
    app: 'campo',
    versao_app: '1.0.4',
    aparelho_modelo: 'moto g54',
    android: '14',
    motivo: 'crash_nativo',
    tenant_id: TENANT,
    tenant_nome: 'Distribuidora Norte Ltda',
    tem_print: false,
    build: 'versionCode 14',
    aparelho_fabricante: 'Motorola',
    android_api: 34,
    tela: '/m/novo-pedido',
    descricao: null,
    erro: { mensagem: "TypeError: Cannot read property 'itens' of undefined", pilha: 'at ResumoPedido\nat renderWithHooks', origem: 'tela' },
    saida_android: null,
    ultimas_saidas: [0, 1, 2, 3, 4].map((n) => saida(n)),
    sync: { pendentes: 3, ultimo_sync_em: '2026-11-11T17:48:00.000Z' },
    usuario_id: '81d20000-1111-4222-8333-4444555504ff',
    perfil: 'vendedor',
    alerta: { situacao: 'enviado', recado_id: 'R-20261111-140312-diagnostico', em: '2026-11-11T18:03:00.000Z' },
    ...o,
  });

describe('rótulos', () => {
  it('origem com texto e tom; motivo em português, código só no detalhe', () => {
    expect(ROTULO_ORIGEM.botao).toEqual({ rotulo: 'Botão', tom: 'neutral' });
    expect(ROTULO_ORIGEM.queda).toEqual({ rotulo: 'Queda', tom: 'danger' });
    expect(ROTULO_ORIGEM.erro_tela).toEqual({ rotulo: 'Erro de tela', tom: 'warning' });
    expect(rotuloDoMotivo('crash_nativo')).toBe('Falha nativa');
    expect(rotuloDoMotivo('anr')).toBe('App travou (ANR)');
    expect(rotuloDoMotivo('memoria')).toBe('Sem memória');
    expect(rotuloDoMotivo('tela')).toBe('Erro de renderização');
    expect(rotuloDoMotivo('codigo_novo')).toBe('codigo_novo');
    expect(rotuloDoMotivo(null)).toBe('—');
    expect(motivoDaSaida(5)).toBe('crash_nativo  (REASON_CRASH_NATIVE = 5)');
    expect(motivoDaSaida(99)).toBe('motivo 99');
  });

  it('protocolo, datas em Manaus e o id curto', () => {
    expect(numeroDoDiagnostico(41)).toBe('nº 0041');
    expect(dataDaLista('2026-11-11T19:30:00.000Z')).toBe('11/11 15:30');
    expect(dataDoDetalhe('2026-11-11T18:02:10.000Z')).toBe('11/11 às 14:02');
    expect(dataDaLista(null)).toBe('—');
    expect(idCurto(TENANT)).toBe('3b9e…a71c');
    expect(caminhoDoDiagnostico(ID)).toBe(`/diagnosticos/${ID}`);
    expect(ROTAS_PORTAL.printDoDiagnostico(ID)).toBe(`/plataforma/diagnosticos/${ID}/print`);
  });
});

describe('filtros ↔ endereço', () => {
  it('lê o endereço e descarta valor estranho', () => {
    expect(filtrosDoEndereco(busca(`versao=1.0.4&modelo=SM-A155M&empresa=${TENANT.toUpperCase()}&motivo=anr&origem=queda&de=2026-11-01&ate=2026-11-10`))).toEqual({
      versao: '1.0.4',
      modelo: 'SM-A155M',
      empresa: TENANT,
      motivo: 'anr',
      origem: 'queda',
      de: '2026-11-01',
      ate: '2026-11-10',
    });
    expect(filtrosDoEndereco(busca('empresa=x&origem=outra&de=ontem'))).toEqual(FILTROS_VAZIOS);
  });

  it('volta ao endereço só com os filtros preenchidos (para colar o link no recado)', () => {
    expect(enderecoDosFiltros(FILTROS_VAZIOS)).toBe('');
    expect(enderecoDosFiltros({ ...FILTROS_VAZIOS, versao: '1.0.4', origem: 'botao' })).toBe('?versao=1.0.4&origem=botao');
    expect(temFiltro(FILTROS_VAZIOS)).toBe(false);
    expect(temFiltro({ ...FILTROS_VAZIOS, modelo: 'g54' })).toBe(true);
  });

  it('período: padrão 7 dias sem datas no endereço; Hoje e 30 dias viram "de"; datas soltas = personalizado', () => {
    expect(periodoDosFiltros(FILTROS_VAZIOS, AGORA)).toBe('7');
    const hoje = filtrosComPeriodo(FILTROS_VAZIOS, '1', AGORA);
    expect(hoje.de).toBe('2026-11-11');
    expect(periodoDosFiltros(hoje, AGORA)).toBe('1');
    const trinta = filtrosComPeriodo(FILTROS_VAZIOS, '30', AGORA);
    expect(trinta.de).toBe('2026-10-13');
    expect(periodoDosFiltros(trinta, AGORA)).toBe('30');
    expect(filtrosComPeriodo(trinta, '7', AGORA)).toEqual(FILTROS_VAZIOS);
    expect(periodoDosFiltros({ ...FILTROS_VAZIOS, de: '2026-11-02', ate: '2026-11-05' }, AGORA)).toBe('personalizado');
  });

  it('filtro do contrato: dias em Manaus em UTC, empresa vira tenant_id, cursor da página seguinte', () => {
    const f = filtroDaApi({ ...FILTROS_VAZIOS, versao: '1.0.4', empresa: TENANT, origem: 'queda' }, AGORA, 'c2');
    expect(DiagnosticoFiltroSchema.safeParse(f).success).toBe(true);
    expect(f).toEqual({ versao: '1.0.4', tenant_id: TENANT, origem: 'queda', de: '2026-11-05T04:00:00.000Z', cursor: 'c2' });
    expect(filtroDaApi({ ...FILTROS_VAZIOS, de: '2026-11-01', ate: '2026-11-10' }, AGORA)).toEqual({ de: '2026-11-01T04:00:00.000Z', ate: '2026-11-11T03:59:59.999Z' });
    expect(queryDoFiltro(f)).toEqual({ versao: '1.0.4', tenant_id: TENANT, origem: 'queda', de: '2026-11-05T04:00:00.000Z', cursor: 'c2' });
  });
});

describe('detalhe', () => {
  it('cabeçalho: app, aparelho, Android e o recebido', () => {
    expect(linhaDoCabecalho(detalhe())).toBe('Campo 1.0.4 · Motorola moto g54 · Android 14 (API 34) · recebido 11/11 às 14:02');
  });

  it('Saída do Android: as 5 últimas; diagnóstico antigo mostra a única; o Copiar leva o bloco inteiro', () => {
    const d = detalhe();
    expect(saidasDoDetalhe(d)).toHaveLength(5);
    expect(linhasDaSaida(saidasDoDetalhe(d)[0]!)).toEqual([
      ['Motivo', 'crash_nativo  (REASON_CRASH_NATIVE = 5)'],
      ['Status', '11 · importância 100 (primeiro plano)'],
      ['Memória', 'PSS 212.408 KB · RSS 301.772 KB'],
      ['Quando', '11/11 14:01:37'],
      ['Descrição', 'Fatal signal 11 (SIGSEGV), code 1, fault addr 0x0'],
    ]);
    const texto = textoDasSaidas(saidasDoDetalhe(d));
    expect(texto.split('\n\n')).toHaveLength(5);
    expect(texto).toContain('#04 b');
    const antigo = detalhe({ ultimas_saidas: undefined, saida_android: { motivo: 6, status: 0, importancia: 100, pss_kb: 0, rss_kb: 0, descricao: 'anr', pilha: null } });
    expect(saidasDoDetalhe(antigo)).toEqual([expect.objectContaining({ motivo: 6, quando: antigo.ocorrido_em })]);
    expect(saidasDoDetalhe(detalhe({ ultimas_saidas: [] }))).toEqual([]);
  });

  it('pilha: 3 linhas e o "mais N linhas"', () => {
    expect(pilhaCurta(saida(0).pilha)).toEqual({ inicio: ['#00 pc 0004a1f8  libhermes.so', '#01 pc 000b31c4  libexpo-sqlite.so (sqlite3_step+88)', '#02 pc 000b2f60  libexpo-sqlite.so'], resto: ['#03 a', '#04 b'] });
    expect(pilhaCurta(null)).toEqual({ inicio: [], resto: [] });
  });

  it('último erro, fila, "Ocorrido" só no botão que ficou na fila', () => {
    const d = detalhe();
    expect(textoDoErro(d.erro!, d.ocorrido_em)).toBe("11/11 14:01:37 · origem: tela\nTypeError: Cannot read property 'itens' of undefined\nat ResumoPedido\nat renderWithHooks");
    expect(textoDaFila(d.sync)).toBe('3 itens · última sync 11/11 13:48');
    expect(textoDaFila(null)).toBe('—');
    expect(mostrarOcorrido(d)).toBe(false);
    expect(mostrarOcorrido(detalhe({ origem: 'botao', ocorrido_em: '2026-11-11T12:00:00.000Z' }))).toBe(true);
    expect(mostrarOcorrido(detalhe({ origem: 'botao' }))).toBe(false);
  });

  it('recado automático: situação com texto e o link do recado', () => {
    expect(situacaoDoRecado(detalhe().alerta)).toEqual({ rotulo: 'Enviado', tom: 'success', nota: '11/11 14:03 · a alexandre e engenheiro-apps' });
    expect(situacaoDoRecado({ situacao: 'desligado', recado_id: null, em: null })).toMatchObject({ rotulo: 'Desligado', nota: 'servidor sem o token de recados' });
    expect(situacaoDoRecado({ situacao: 'falhou', recado_id: null, em: null })).toMatchObject({ rotulo: 'Falhou', tom: 'danger' });
    expect(linkDoRecado('R-20261111-140312-diagnostico')).toContain('macuxifdv-recados');
  });
});

describe('cabeçalho do portal', () => {
  it('Empresas e Diagnósticos; o item ativo pelo caminho, com ou sem o prefixo /config', () => {
    expect(MENU_TIME_MACUXI.map((i) => i.rotulo)).toEqual(['Empresas', 'Diagnósticos']);
    expect(itemAtivoDoMenu('/diagnosticos')).toBe('/diagnosticos');
    expect(itemAtivoDoMenu(`/config/diagnosticos/${ID}`)).toBe('/diagnosticos');
    expect(itemAtivoDoMenu('/empresas/nova')).toBe('/empresas');
    expect(itemAtivoDoMenu('/entrar')).toBeNull();
  });
});
