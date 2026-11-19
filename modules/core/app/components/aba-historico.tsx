/**
 * Aba Histórico da ficha (T-0186, spec §4): só a contagem, o botão de filtro (com a busca pelo Nº da NF dentro, P14) e a tabela de notas
 * (Data · Nº NF e forma de pagamento · Valor · Status). "Em atraso" sem data, a linha em destaque. O toque na linha pede a autorização
 * "Baixar a NF …?" e busca a NF no servidor (P17); a NF e o PDF não ficam guardados. Sem internet: "Sem internet" e "Tentar de novo".
 */
import { Badge, Botao, BotaoFiltro, CampoBusca, CampoTexto, Chip, EtiquetaFiltro, Folha, Loading, colors, type as t } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { LinhaHistoricoNfContrato } from '../../contracts';
import { rotuloStatusNf, STATUS_NF, tomStatusNf, type StatusNf } from '../../domain';
import { abrirDocumentoRegistrado } from '../lib/ficha-online';
import {
  agruparNotasPorMes,
  chipsDoFiltro,
  dataBr,
  contarFiltros,
  dataCurta,
  devolucaoNaCelula,
  FILTRO_PADRAO,
  filtroDeNotas,
  filtroPrecisaDoServidor,
  leituraDaNota,
  lerDataBr,
  mascararData,
  periodoEscolhido,
  linhasDoDetalheDaNota,
  removerChip,
  resumoDosItens,
  rotuloPeriodo,
  statusDaParcela,
  subtituloDaNota,
  textoContagemNotas,
  valorSemMoeda,
  type FiltroDaFicha,
} from '../lib/ficha-v2';
import { filtrarNotas } from '../../domain';
import type { DetalheDaNota, NotasDoCliente } from '../lib/usar-ficha-online';
import { ErroOnline } from './erro-online';
import { CelulaTexto, TabelaFicha, TabelaRotuloValor, type LinhaFicha } from './tabelas-ficha';

export function AbaHistorico({ notas, filtro, onFiltro, detalhe, hoje }: { notas: NotasDoCliente; filtro: FiltroDaFicha; onFiltro: (f: FiltroDaFicha) => void; detalhe: DetalheDaNota; hoje: string }) {
  const [filtrando, setFiltrando] = useState(false);
  const chips = chipsDoFiltro(filtro);
  const grupos = agruparNotasPorMes(notas.linhas);
  const linhas: LinhaFicha[] = grupos.flatMap((g) => [
    { tipo: 'faixa' as const, key: `faixa-${g.faixa}`, texto: g.faixa },
    ...g.notas.map<LinhaFicha>((n) => ({
      tipo: 'linha',
      key: n.id,
      testID: `nota-${n.numero_nf}`,
      rotulo: leituraDaNota(n),
      perigo: n.status === 'em_atraso',
      onPress: () => detalhe.abrir(n),
      celulas: [
        <CelulaTexto key="d" principal={dataCurta(n.data)} mudo />,
        <CelulaTexto key="n" principal={n.numero_nf} segunda={n.forma_pagamento} mono sublinhado />,
        <CelulaTexto key="v" principal={valorSemMoeda(n.valor_cents)} segunda={n.devolvido_cents ? devolucaoNaCelula(n.devolvido_cents) : null} dir />,
        <View key="s" style={{ alignItems: 'flex-start' }}>
          <Badge label={rotuloStatusNf(n.status)} tone={tomStatusNf(n.status)} />
        </View>,
      ],
    })),
  ]);

  return (
    <View style={{ gap: 10 }} testID="cliente-historico">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[t.sub, { flex: 1 }]} testID="historico-contagem">
          {notas.estado === 'ok' ? textoContagemNotas(notas.linhas.length, filtro) : ' '}
        </Text>
        <BotaoFiltro contagem={contarFiltros(filtro)} onPress={() => setFiltrando(true)} rotulo="Filtrar" testID="historico-filtro" />
      </View>

      {chips.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((c) => (
            <EtiquetaFiltro key={c.id} texto={c.texto} rotuloRemover={`Tirar o filtro ${c.texto}`} onRemover={() => onFiltro(removerChip(filtro, c.id))} testID={`chip-${c.id}`} />
          ))}
        </View>
      ) : null}

      {notas.estado === 'carregando' || notas.estado === 'ocioso' ? <Loading embutido testID="historico-carregando" /> : null}
      {notas.estado === 'erro' ? <ErroOnline falha={notas.falha} titulo="Notas" onTentar={notas.recarregar} testID="historico-erro" /> : null}
      {notas.estado === 'ok' && linhas.length === 0 ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }} testID="historico-vazio">
          <Text style={t.sub}>{contarFiltros(filtro) > 0 ? 'Nenhuma nota' : `Nenhuma nota nos últimos ${rotuloPeriodo('90d')}`}</Text>
          {contarFiltros(filtro) === 0 ? <Botao rotulo="Ver 12 meses" nivel="secundario" onPress={() => onFiltro({ ...filtro, periodo: '12m' })} testID="historico-ver-12m" /> : null}
        </View>
      ) : null}
      {notas.estado === 'ok' && linhas.length > 0 ? (
        <TabelaFicha
          testID="tabela-notas"
          colunas={[
            { id: 'data', titulo: 'Data', largura: 36 },
            { id: 'nf', titulo: 'Nº NF' },
            { id: 'valor', titulo: 'Valor (R$)', largura: 64, alinhar: 'dir' },
            { id: 'status', titulo: 'Status', largura: 92 },
          ]}
          linhas={linhas}
        />
      ) : null}

      <FolhaFiltrar visivel={filtrando} onFechar={() => setFiltrando(false)} filtro={filtro} onAplicar={(f) => onFiltro(f)} base={notas.linhas} formas={notas.formas} hoje={hoje} />
      <FolhaDaNota detalhe={detalhe} />
    </View>
  );
}

const ORDEM_PERIODO = ['30d', '90d', '12m'] as const;

/** Folha "Filtrar": Nº da NF no topo (P14), Período, Status e Forma de pagamento, com a contagem ao vivo no botão. */
function FolhaFiltrar({ visivel, onFechar, filtro, onAplicar, base, formas, hoje }: { visivel: boolean; onFechar: () => void; filtro: FiltroDaFicha; onAplicar: (f: FiltroDaFicha) => void; base: readonly LinhaHistoricoNfContrato[]; formas: readonly string[]; hoje: string }) {
  const [rascunho, setRascunho] = useState<FiltroDaFicha>(filtro);
  const [abriu, setAbriu] = useState(false);
  const [deTxt, setDeTxt] = useState('');
  const [ateTxt, setAteTxt] = useState('');
  if (visivel && !abriu) {
    setAbriu(true);
    setRascunho(filtro);
    setDeTxt(filtro.periodo === 'datas' && filtro.de ? dataBr(filtro.de) : '');
    setAteTxt(filtro.periodo === 'datas' && filtro.ate ? dataBr(filtro.ate) : '');
  }
  if (!visivel && abriu) setAbriu(false);

  // "Escolher datas": o rascunho só vale com datas certas; com erro, o botão fica desligado e o campo diz o que corrigir
  const escolha = rascunho.periodo === 'datas' ? periodoEscolhido(deTxt, ateTxt, hoje) : null;
  const efetivo: FiltroDaFicha = escolha?.ok ? { ...rascunho, de: escolha.de, ate: escolha.ate } : { ...rascunho, de: undefined, ate: undefined };
  const datasComErro = escolha !== null && !escolha.ok;
  const precisaServidor = !datasComErro && filtroPrecisaDoServidor(efetivo, hoje);
  const total = filtrarNotas(base, filtroDeNotas(efetivo, hoje)).length;
  const alternar = <T,>(lista: readonly T[], v: T): T[] => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const rotuloVer = precisaServidor ? 'Ver notas' : total === 0 ? 'Nenhuma nota' : `Ver ${total} ${total === 1 ? 'nota' : 'notas'}`;
  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar="Fechar o filtro" titulo="Filtrar" fechar={{ rotulo: 'Fechar o filtro' }} rolavel evitarTeclado testID="folha-filtrar-notas">
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <View style={{ gap: 6 }}>
          <Text style={t.label}>Nº da NF</Text>
          <CampoBusca valor={rascunho.numero} onChange={(numero) => setRascunho({ ...rascunho, numero })} onLimpar={() => setRascunho({ ...rascunho, numero: '' })} rotuloLimpar="Limpar o número" placeholder="Buscar pelo número" testID="filtro-numero-nf" />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={t.label}>Período</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ORDEM_PERIODO.map((p) => (
              <Chip key={p} label={rotuloPeriodo(p)} active={rascunho.periodo === p} onPress={() => setRascunho({ ...rascunho, periodo: p, de: undefined, ate: undefined })} testID={`filtro-periodo-${p}`} />
            ))}
            <Chip label="Escolher datas" active={rascunho.periodo === 'datas'} onPress={() => setRascunho({ ...rascunho, periodo: 'datas' })} testID="filtro-periodo-datas" />
          </View>
          {rascunho.periodo === 'datas' ? (
            <View style={{ flexDirection: 'row', gap: 10 }} testID="filtro-datas">
              <View style={{ flex: 1 }}>
                <CampoTexto rotulo="De" valor={deTxt} aoMudar={(x) => setDeTxt(mascararData(x))} placeholder="dd/mm/aaaa" keyboardType="number-pad" maxLength={10} erro={deTxt.length === 10 && lerDataBr(deTxt) === null} />
              </View>
              <View style={{ flex: 1 }}>
                <CampoTexto rotulo="Até" valor={ateTxt} aoMudar={(x) => setAteTxt(mascararData(x))} placeholder="hoje" keyboardType="number-pad" maxLength={10} erro={ateTxt.length === 10 && lerDataBr(ateTxt) === null} />
              </View>
            </View>
          ) : null}
          {escolha && !escolha.ok && (deTxt !== '' || ateTxt !== '') ? (
            <Text style={[t.sub, { color: colors.danger }]} accessibilityLiveRegion="polite" testID="filtro-datas-erro">
              {escolha.erro}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: 6 }}>
          <Text style={t.label}>Status</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STATUS_NF.map((s: StatusNf) => (
              <Chip key={s} label={rotuloStatusNf(s)} active={rascunho.status.includes(s)} onPress={() => setRascunho({ ...rascunho, status: alternar(rascunho.status, s) })} testID={`filtro-status-${s}`} />
            ))}
          </View>
        </View>
        {formas.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={t.label}>Forma de pagamento</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {formas.map((f) => (
                <Chip key={f} label={f} active={rascunho.formas.includes(f)} onPress={() => setRascunho({ ...rascunho, formas: alternar(rascunho.formas, f) })} testID={`filtro-forma-${f}`} />
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Botao rotulo="Limpar" nivel="secundario" alto onPress={() => setRascunho(FILTRO_PADRAO)} testID="filtro-limpar" />
          </View>
          <View style={{ flex: 1.4 }}>
            <Botao
              rotulo={rotuloVer}
              nivel="principal"
              desligado={datasComErro || (!precisaServidor && total === 0)}
              onPress={() => {
                onAplicar(efetivo);
                onFechar();
              }}
              testID="filtro-ver"
            />
          </View>
        </View>
      </View>
    </Folha>
  );
}

/** Autorização, busca online e detalhe da NF (P17). Fechar descarta tudo. */
function FolhaDaNota({ detalhe }: { detalhe: DetalheDaNota }) {
  const [itens, setItens] = useState(false);
  const { linha, estado, falha, nota } = detalhe;
  const visualizador = abrirDocumentoRegistrado();
  const fechar = () => {
    setItens(false);
    detalhe.fechar();
  };
  const numero = linha?.numero_nf ?? '';

  if (itens && nota) {
    return (
      <Folha visivel onFechar={() => setItens(false)} rotuloFechar="Voltar para a NF" titulo={`Itens da NF ${nota.numero_nf}`} fechar={{ rotulo: 'Voltar para a NF' }} rolavel testID="folha-itens-nf">
        <Text style={[t.sub, { marginBottom: 8 }]}>{resumoDosItens(nota.itens)}</Text>
        <TabelaFicha
          colunas={[
            { id: 'produto', titulo: 'Produto' },
            { id: 'emb', titulo: 'Emb.', largura: 52, alinhar: 'dir' },
            { id: 'qtd', titulo: 'Qtd', largura: 40, alinhar: 'dir' },
            { id: 'total', titulo: 'Total (R$)', largura: 72, alinhar: 'dir' },
          ]}
          linhas={nota.itens.map<LinhaFicha>((i, n) => ({
            tipo: 'linha',
            key: `${i.produto_codigo}-${n}`,
            celulas: [
              <CelulaTexto key="p" principal={i.produto_nome} segunda={i.produto_codigo} segundaCodigo />,
              <CelulaTexto key="e" principal={i.unidade ?? '—'} segunda={i.fator ? `c/ ${i.fator}` : null} dir />,
              <CelulaTexto key="q" principal={String(i.quantidade)} dir />,
              <CelulaTexto key="t" principal={valorSemMoeda(i.total_cents)} dir />,
            ],
          }))}
        />
      </Folha>
    );
  }

  return (
    <Folha visivel={Boolean(linha)} onFechar={fechar} rotuloFechar="Fechar a NF" titulo={estado === 'ocioso' ? `Baixar a NF ${numero}?` : `NF ${numero}`} fechar={{ rotulo: 'Fechar a NF' }} rolavel testID="folha-nota">
      {estado === 'ocioso' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Botao rotulo="Agora não" nivel="secundario" alto onPress={fechar} testID="nota-agora-nao" />
          </View>
          <View style={{ flex: 1 }}>
            <Botao rotulo="Baixar" nivel="principal" onPress={detalhe.baixar} testID="nota-baixar" />
          </View>
        </View>
      ) : null}
      {estado === 'carregando' ? <Botao rotulo="Baixando…" nivel="principal" desligado ocupado onPress={() => undefined} testID="nota-baixando" /> : null}
      {estado === 'erro' ? <ErroOnline falha={falha} titulo={`NF ${numero}`} onTentar={detalhe.tentarDeNovo} testID="nota-erro" /> : null}
      {estado === 'ok' && nota ? (
        <View style={{ gap: 12 }} testID="nota-detalhe">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[t.sub, { flex: 1 }]}>{subtituloDaNota(nota)}</Text>
            <Badge label={rotuloStatusNf(nota.status)} tone={tomStatusNf(nota.status)} />
          </View>
          <TabelaRotuloValor linhas={linhasDoDetalheDaNota(nota)} larguraRotulo={136} />
          {nota.parcelas.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={[t.bodyStrong, { fontSize: 18 }]}>Parcelas</Text>
              <TabelaFicha
                testID="tabela-parcelas"
                colunas={[
                  { id: 'parcela', titulo: 'Parcela', largura: 56 },
                  { id: 'venc', titulo: 'Vencimento' },
                  { id: 'valor', titulo: 'Valor (R$)', largura: 68, alinhar: 'dir' },
                  { id: 'status', titulo: 'Status', largura: 84 },
                ]}
                linhas={nota.parcelas.map<LinhaFicha>((p, i) => {
                  const st = statusDaParcela(p);
                  return {
                    tipo: 'linha',
                    key: `${p.parcela ?? i}`,
                    perigo: p.em_atraso,
                    celulas: [
                      <CelulaTexto key="p" principal={p.parcela ?? String(i + 1)} />,
                      <CelulaTexto key="v" principal={dataCurta(p.vencimento)} segunda={p.situacao === 'liquidado' && p.liquidado_em ? `paga em ${dataCurta(p.liquidado_em.slice(0, 10))}` : null} />,
                      <CelulaTexto key="$" principal={valorSemMoeda(p.valor_cents)} dir />,
                      <Badge key="s" label={st.rotulo} tone={st.tom} />,
                    ],
                  };
                })}
              />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Botao rotulo={`Ver itens (${nota.itens.length})`} nivel="secundario" alto desligado={nota.itens.length === 0} onPress={() => setItens(true)} testID="nota-ver-itens" />
            </View>
            <View style={{ flex: 1 }}>
              <Botao
                rotulo="Ver PDF"
                nivel="secundario"
                alto
                desligado={!nota.pdf_arquivo_id || !visualizador}
                onPress={() => nota.pdf_arquivo_id && visualizador?.({ arquivo_id: nota.pdf_arquivo_id, titulo: `NF ${nota.numero_nf}`, formato: 'pdf' })}
                testID="nota-ver-pdf"
              />
            </View>
          </View>
        </View>
      ) : null}
    </Folha>
  );
}
