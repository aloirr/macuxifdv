/**
 * Aba Loja do Macuxi Campo (promotor; T-0056). Offline-first: tudo vem do aparelho (check-in do Core, cadastros de
 * trade do pull e o estado do Promotor) e cada coleta vai para a fila de sync. Sem regra de negócio aqui: share,
 * atingimento, presença, variação de preço e conformidade são montados por `lib/loja.ts` com o domain.
 * Fluxo: check-in (Core) → "Iniciar coletas" → checklist, share, ruptura, preço, gôndola e tarefas → "Encerrar".
 * RN-PRO-01: nenhuma ação de pedido nesta tela.
 */
import { formatBRL } from '@macuxi/comum';
import { formatHHMM } from '@macuxi/comum/fuso';
import { usePode } from '@macuxi/platform-sdk/react';
import { AvisoRodape, Banner, Botao, Cartao, Chip, ChipEstado, colors, EstadoVazio, Folha, Loading, OpcaoFolha, ProgressBar, Screen, SectionHeader, type as t, useAvisoRodape } from '@macuxi/ui/mobile';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ROTULO_CONFORMIDADE, CONFORMIDADES, type Conformidade } from '../../domain';
import { montarGondola, montarPreco, montarResposta, montarRuptura, montarShare, montarTarefa } from '../lib/loja';
import { useLoja, type UsoLoja } from '../state/use-loja';

const feito = (l: UsoLoja, chave: string) => l.registros.find((r) => r.chave === chave);

/** Sucesso vira aviso no rodapé (curto, some sozinho); erro e atenção ficam na tela até corrigir. */
type Avisar = (texto: string) => void;

function Aviso({ msg, tom = 'danger' }: { msg: string | null; tom?: 'danger' | 'warning' }) {
  if (!msg) return null;
  return (
    <Banner tone={tom} icon="alert">
      {msg}
    </Banner>
  );
}

function Campo({ rotulo, valor, onChange, teclado = 'number-pad', testID }: { rotulo: string; valor: string; onChange: (s: string) => void; teclado?: 'number-pad' | 'decimal-pad' | 'default'; testID?: string }) {
  return (
    <View style={s.campo}>
      <Text style={t.label}>{rotulo}</Text>
      <TextInput testID={testID} accessibilityLabel={rotulo} value={valor} onChangeText={onChange} keyboardType={teclado} style={s.input} />
    </View>
  );
}

/** Checklist do dia (RF-PRO-02): marcar etapa feita; obrigatórias bloqueiam o encerramento (RN-PRO-06). */
function Checklist({ l, avisar }: { l: UsoLoja; avisar: Avisar }) {
  const [erro, setErro] = useState<string | null>(null);
  if (!l.checklist || !l.visita) return null;
  const v = l.visita;
  return (
    <Cartao testID="loja.checklist" gap={10}>
      <SectionHeader title={`Checklist · ${l.checklist.nome}`} />
      {l.progresso && <ProgressBar pct={l.progresso.pct_concluido} />}
      {[...l.checklist.itens]
        .sort((a, b) => a.ordem - b.ordem)
        .map((i) => {
          const ok = Boolean(feito(l, `etapa:${i.id}`));
          return (
            <View key={i.id} style={s.linha}>
              <Text style={[t.body, s.flex]}>
                {i.rotulo}
                {i.obrigatoria ? ' *' : ''}
              </Text>
              {ok ? (
                <ChipEstado texto="Feito" tom="sucesso" icone="check" pequeno />
              ) : (
                <Botao
                  rotulo="Feito"
                  testID={`loja.etapa.${i.id}`}
                  onPress={() =>
                    void l
                      .registrar('checklist_resposta', montarResposta({ id: l.novoId(), visita_loja_id: v.id, checklist_item_id: i.id, obrigatoria: i.obrigatoria, concluida: true, agora: l.agora() }), `etapa:${i.id}`, i.rotulo)
                      .then((e) => {
                        setErro(e);
                        if (!e) avisar(`${i.rotulo} feita`);
                      })
                  }
                />
              )}
            </View>
          );
        })}
      <Text style={t.small}>* obrigatória para encerrar</Text>
      <Aviso msg={erro} />
    </Cartao>
  );
}

/** Share de gôndola (RF-PRO-04, RN-PRO-03): % e atingimento na hora. */
function Share({ l, categoria, setCategoria, avisar }: { l: UsoLoja; categoria: string | null; setCategoria: (id: string) => void; avisar: Avisar }) {
  const [nossas, setNossas] = useState('');
  const [total, setTotal] = useState('');
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' } | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const salvar = async () => {
    if (!categoria) return setMsg({ texto: 'Escolha a categoria.', tom: 'danger' });
    const meta = l.metaDa(categoria);
    const r = montarShare({ id: l.novoId(), visita_loja_id: v.id, categoria_gondola_id: categoria, frentes_nossas: nossas, frentes_total: total, meta: meta ? { id: meta.id, meta_pct: meta.meta_pct } : null, agora: l.agora() });
    if (!r.ok) return setMsg({ texto: r.erro, tom: 'danger' });
    const resumo = r.coleta.share_pct === null ? 'sem frentes' : `${r.coleta.share_pct}%${r.coleta.atingimento_pct === null ? '' : ` · ${r.coleta.atingimento_pct}% da meta`}`;
    const erro = await l.registrar('medicao_share', r.coleta, `share:${categoria}`, `Share ${resumo}`);
    setMsg(erro ? { texto: erro, tom: 'danger' } : null);
    if (!erro) {
      avisar(`Share ${resumo}`);
      setNossas('');
      setTotal('');
    }
  };
  return (
    <Cartao testID="loja.share" gap={10}>
      <SectionHeader title="Share de gôndola" />
      {l.categorias.length === 0 ? (
        <EstadoVazio testID="loja.share.vazio" titulo="Sem categorias" texto="O escritório cadastra as categorias de gôndola." />
      ) : (
        <>
          <View style={s.chips}>
            {l.categorias.map((c) => (
              <Chip key={c.id} label={feito(l, `share:${c.id}`) ? `${c.nome} ✓` : c.nome} active={categoria === c.id} onPress={() => setCategoria(c.id)} testID={`loja.categoria.${c.id}`} />
            ))}
          </View>
          <View style={s.linha}>
            <Campo rotulo="Frentes nossas" valor={nossas} onChange={setNossas} testID="loja.share.nossas" />
            <Campo rotulo="Frentes total" valor={total} onChange={setTotal} testID="loja.share.total" />
          </View>
          <Botao rotulo="Salvar share" onPress={() => void salvar()} testID="loja.share.salvar" />
        </>
      )}
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
    </Cartao>
  );
}

/** Presença e ruptura do mix obrigatório (RF-PRO-06, RN-PRO-05): o estado sai de uma folha de 3 opções. */
function Ruptura({ l, avisar }: { l: UsoLoja; avisar: Avisar }) {
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<UsoLoja['mix'][number] | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const marcar = async (m: UsoLoja['mix'][number], na_gondola: boolean, no_deposito: boolean | null) => {
    setAberto(null);
    const r = montarRuptura({ id: l.novoId(), visita_loja_id: v.id, produto_id: m.mix.produto_id, mix_obrigatorio_id: m.mix.id, na_gondola, no_deposito, agora: l.agora() });
    if (!r.ok) return setErro(r.erro);
    const e = await l.registrar('ruptura_item', r.coleta, `ruptura:${m.mix.id}`, r.coleta.status === 'presente' ? 'Presente' : r.coleta.status === 'ruptura_gondola' ? 'Falta na gôndola' : 'Sem estoque');
    setErro(e);
    if (!e) avisar(`${m.nome}: ${r.coleta.status === 'presente' ? 'presente' : r.coleta.status === 'ruptura_gondola' ? 'falta na gôndola' : 'sem estoque'}`);
  };
  return (
    <Cartao testID="loja.ruptura" gap={10}>
      <SectionHeader title="Mix obrigatório" />
      {l.mix.length === 0 ? (
        <EstadoVazio testID="loja.ruptura.vazio" titulo="Sem mix nesta loja" />
      ) : (
        l.mix.map((m) => {
          const r = feito(l, `ruptura:${m.mix.id}`);
          return (
            <View key={m.mix.id} style={s.bloco}>
              <View style={s.linha}>
                <Text style={[t.bodyStrong, s.flex]}>{m.nome}</Text>
                <ChipEstado texto={r ? r.rotulo : 'Pendente'} tom={!r ? 'neutro' : r.rotulo === 'Presente' ? 'sucesso' : r.rotulo === 'Falta na gôndola' ? 'aviso' : 'erro'} pequeno />
                <Botao rotulo={r ? 'Alterar' : 'Marcar'} nivel="neutro" onPress={() => setAberto(m)} testID={`loja.mix.${m.mix.id}.abrir`} />
              </View>
            </View>
          );
        })
      )}
      <Aviso msg={erro} />
      <Folha visivel={aberto !== null} onFechar={() => setAberto(null)} rotuloFechar="Fechar" titulo={aberto?.nome} testID="loja.mix.folha" rodape={{ rotulo: 'Voltar', onPress: () => setAberto(null) }}>
        {aberto && (
          <>
            <OpcaoFolha icone="check" titulo="Na gôndola" onPress={() => void marcar(aberto, true, null)} testID={`loja.mix.${aberto.mix.id}.presente`} />
            <OpcaoFolha icone="alert" tom="neutro" titulo="Falta na gôndola" subtitulo="Tem no depósito" onPress={() => void marcar(aberto, false, true)} testID={`loja.mix.${aberto.mix.id}.reposicao`} />
            <OpcaoFolha icone="x" tom="perigo" titulo="Sem estoque" onPress={() => void marcar(aberto, false, false)} testID={`loja.mix.${aberto.mix.id}.ruptura`} />
          </>
        )}
      </Folha>
    </Cartao>
  );
}

/** Preço de prateleira do nosso item (RF-PRO-05); variação grande pede confirmação (RN-PRO-04). */
function Preco({ l, avisar }: { l: UsoLoja; avisar: Avisar }) {
  const [produto, setProduto] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [valor, setValor] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' | 'warning' } | null>(null);
  if (!l.visita || !l.loja) return null;
  const v = l.visita;
  const lojaId = l.loja.id;
  const nomeEscolhido = l.mix.find((m) => m.mix.produto_id === produto)?.nome;
  const salvar = async () => {
    if (!produto) return setMsg({ texto: 'Escolha o produto.', tom: 'danger' });
    const r = montarPreco({ id: l.novoId(), visita_loja_id: v.id, produto_id: produto, preco: valor, anterior_cents: l.precos[`${lojaId}:${produto}`] ?? null, confirmar_variacao: confirmar, limite_pct: l.parametros.variacao_preco_max_pct, agora: l.agora() });
    if (!r.ok) {
      if ('precisa_confirmar' in r) setConfirmar(true);
      return setMsg({ texto: r.erro, tom: 'warning' });
    }
    const erro = await l.registrar('coleta_preco', r.coleta, `preco:${produto}`, `Preço ${formatBRL(r.coleta.preco_cents)}`);
    if (erro) return setMsg({ texto: erro, tom: 'danger' });
    await l.guardarPreco(produto, r.coleta.preco_cents);
    setMsg(null);
    avisar(`Preço ${formatBRL(r.coleta.preco_cents)} registrado`);
    setValor('');
    setConfirmar(false);
  };
  return (
    <Cartao testID="loja.preco" gap={10}>
      <SectionHeader title="Preço de prateleira" />
      {l.mix.length === 0 ? (
        <EstadoVazio testID="loja.preco.vazio" titulo="Sem produtos do mix" />
      ) : (
        <>
          <Botao rotulo={nomeEscolhido ?? 'Escolher produto'} nivel="neutro" onPress={() => setEscolhendo(true)} testID="loja.preco.produto" />
          <Campo rotulo="Preço (R$)" valor={valor} onChange={(x) => (setValor(x), setConfirmar(false))} teclado="decimal-pad" testID="loja.preco.valor" />
          <Botao rotulo={confirmar ? 'Confirmar preço' : 'Salvar preço'} onPress={() => void salvar()} testID="loja.preco.salvar" />
        </>
      )}
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
      <Folha visivel={escolhendo} onFechar={() => setEscolhendo(false)} rotuloFechar="Fechar" titulo="Produto" testID="loja.preco.folha" rodape={{ rotulo: 'Voltar', onPress: () => setEscolhendo(false) }}>
        {l.mix.map((m) => (
          <OpcaoFolha
            key={m.mix.id}
            icone={produto === m.mix.produto_id ? 'check' : 'file'}
            tom={produto === m.mix.produto_id ? 'destaque' : 'neutro'}
            titulo={m.nome}
            subtitulo={feito(l, `preco:${m.mix.produto_id}`) ? 'Preço já coletado' : undefined}
            testID={`loja.preco.produto.${m.mix.id}`}
            onPress={() => {
              setProduto(m.mix.produto_id);
              setConfirmar(false);
              setEscolhendo(false);
            }}
          />
        ))}
      </Folha>
    </Cartao>
  );
}

/** Gôndola antes/depois com conformidade (RF-PRO-03). */
function Gondola({ l, categoria, avisar }: { l: UsoLoja; categoria: string | null; avisar: Avisar }) {
  const [antes, setAntes] = useState<string | null>(null);
  const [depois, setDepois] = useState<string | null>(null);
  const [conf, setConf] = useState<Conformidade>('conforme');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' } | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const foto = async (tipo: 'gondola_antes' | 'gondola_depois') => {
    const r = await l.tirarFoto(tipo, tipo === 'gondola_antes' ? 'Foto da gôndola (antes)' : 'Foto da gôndola (depois)');
    if ('erro' in r) return setMsg({ texto: r.erro, tom: 'danger' });
    setMsg(null);
    (tipo === 'gondola_antes' ? setAntes : setDepois)(r.id);
  };
  const salvar = async () => {
    if (!categoria) return setMsg({ texto: 'Escolha a categoria no share.', tom: 'danger' });
    const r = montarGondola({ id: l.novoId(), visita_loja_id: v.id, categoria_gondola_id: categoria, foto_antes_id: antes, foto_depois_id: depois, foto_referencia_id: null, conformidade: conf, motivo, agora: l.agora() });
    if (!r.ok) return setMsg({ texto: r.erro, tom: 'danger' });
    const erro = await l.registrar('gondola_registro', r.coleta, `gondola:${categoria}`, `Gôndola ${ROTULO_CONFORMIDADE[conf].toLowerCase()}`);
    if (erro) return setMsg({ texto: erro, tom: 'danger' });
    setMsg(null);
    avisar('Gôndola registrada');
    setAntes(null);
    setDepois(null);
    setMotivo('');
  };
  return (
    <Cartao testID="loja.gondola" gap={10}>
      <SectionHeader title="Arrumação da gôndola" />
      <View style={s.linha}>
        <Botao rotulo="Foto antes" nivel="neutro" alto icone={antes ? 'check' : 'camera'} rotuloAcessivel={antes ? 'Foto antes tirada, tirar de novo' : undefined} onPress={() => void foto('gondola_antes')} testID="loja.gondola.antes" style={s.flex} />
        <Botao rotulo="Foto depois" nivel="neutro" alto icone={depois ? 'check' : 'camera'} rotuloAcessivel={depois ? 'Foto depois tirada, tirar de novo' : undefined} onPress={() => void foto('gondola_depois')} testID="loja.gondola.depois" style={s.flex} />
      </View>
      <View style={s.chips}>
        {CONFORMIDADES.map((c) => (
          <Chip key={c} label={ROTULO_CONFORMIDADE[c]} active={conf === c} onPress={() => setConf(c)} testID={`loja.gondola.${c}`} />
        ))}
      </View>
      {conf !== 'conforme' && <Campo rotulo={conf === 'nao_conforme' ? 'Motivo (obrigatório)' : 'Motivo (opcional)'} valor={motivo} onChange={setMotivo} teclado="default" testID="loja.gondola.motivo" />}
      <Botao rotulo="Salvar gôndola" onPress={() => void salvar()} testID="loja.gondola.salvar" />
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
    </Cartao>
  );
}

/** Tarefas de campanha da loja (RF-PRO-10): concluir com foto. */
function Tarefas({ l, avisar }: { l: UsoLoja; avisar: Avisar }) {
  const [erro, setErro] = useState<string | null>(null);
  if (!l.visita || !l.loja || l.tarefas.length === 0) return null;
  const v = l.visita;
  const lojaId = l.loja.id;
  const concluir = async (tarefaId: string, titulo: string) => {
    const f = await l.tirarFoto('tarefa', `Foto da tarefa · ${titulo}`);
    if ('erro' in f) return setErro(f.erro);
    const r = montarTarefa({ id: l.novoId(), tarefa_trade_id: tarefaId, visita_loja_id: v.id, cliente_id: lojaId, foto_ids: [f.id], agora: l.agora() });
    if (!r.ok) return setErro(r.erro);
    const e = await l.registrar('tarefa_execucao', r.coleta, `tarefa:${tarefaId}`, titulo);
    setErro(e);
    if (!e) avisar('Tarefa concluída');
  };
  return (
    <Cartao testID="loja.tarefas" gap={10}>
      <SectionHeader title="Tarefas da campanha" />
      {l.tarefas.map((x) => (
        <View key={x.id} style={s.linha}>
          <Text style={[t.body, s.flex]}>{x.titulo}</Text>
          {feito(l, `tarefa:${x.id}`) ? <ChipEstado texto="Concluída" tom="sucesso" icone="check" pequeno /> : <Botao rotulo="Concluir com foto" onPress={() => void concluir(x.id, x.titulo)} testID={`loja.tarefa.${x.id}`} />}
        </View>
      ))}
      <Aviso msg={erro} />
    </Cartao>
  );
}

export function TelaLoja() {
  const l = useLoja();
  const podeColetar = usePode('coleta.registrar');
  const aviso = useAvisoRodape();
  const [categoria, setCategoria] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const nRegistros = l.registros.filter((r) => r.entidade !== 'foto_coleta').length;
  const avisar = useCallback<Avisar>((texto) => aviso.mostrar({ texto, tom: 'sucesso' }), [aviso.mostrar]);
  const acao = useCallback(async (fn: () => Promise<string | null>) => {
    setOcupado(true);
    setMsg(await fn());
    setOcupado(false);
  }, []);

  if (!podeColetar) {
    return (
      <Screen testID="loja.tela">
        <EstadoVazio titulo="Só para o promotor" icone="pin" />
      </Screen>
    );
  }
  if (!l.carregado) return <Loading />;

  return (
    <>
      <Screen testID="loja.tela" onRefresh={() => void l.recarregar()}>
        <Text style={t.h1}>Loja</Text>
        {!l.checkin || !l.loja ? (
          <EstadoVazio testID="loja.sem-checkin" titulo="Sem check-in" texto="Faça o check-in na Rota ou em Clientes." icone="pin" />
        ) : !l.visita ? (
          <Cartao testID="loja.iniciar" gap={10}>
            <Text style={t.h2}>{l.loja.nome}</Text>
            <ChipEstado texto={`Check-in às ${formatHHMM(l.checkin.checkin_em, l.fuso)}`} tom="sucesso" icone="check" />
            <Botao rotulo="Iniciar coletas" nivel="principal" ocupado={ocupado} onPress={() => void acao(l.iniciar)} testID="loja.iniciar.botao" />
          </Cartao>
        ) : l.visita.checkout_em ? (
          <Cartao testID="loja.encerrada" gap={8}>
            <Text style={t.h2}>{l.loja.nome}</Text>
            <ChipEstado texto={`Encerrada às ${formatHHMM(l.visita.checkout_em, l.fuso)}`} tom="neutro" />
            <Text style={t.sub}>Falta o checkout da visita.</Text>
          </Cartao>
        ) : (
          <>
            <Cartao gap={6}>
              <Text style={t.h2}>{l.loja.nome}</Text>
              <Text style={t.sub}>
                Desde {formatHHMM(l.visita.checkin_em, l.fuso)} · {nRegistros} {nRegistros === 1 ? 'registro' : 'registros'}
              </Text>
            </Cartao>
            <Checklist l={l} avisar={avisar} />
            <Share l={l} categoria={categoria} setCategoria={setCategoria} avisar={avisar} />
            <Gondola l={l} categoria={categoria} avisar={avisar} />
            <Ruptura l={l} avisar={avisar} />
            <Preco l={l} avisar={avisar} />
            <Tarefas l={l} avisar={avisar} />
            <Botao rotulo="Encerrar coletas" nivel="principal" ocupado={ocupado} onPress={() => void acao(l.encerrar)} testID="loja.encerrar" />
          </>
        )}
        <Aviso msg={msg} />
      </Screen>
      <AvisoRodape {...aviso.props} testID="loja.aviso" />
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bloco: { gap: 6, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  campo: { flex: 1, gap: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.surface, color: colors.ink, fontSize: 16 },
});

export default TelaLoja;
