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
import { Badge, Banner, Button, Card, Chip, colors, Empty, Loading, ProgressBar, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ROTULO_CONFORMIDADE, CONFORMIDADES, type Conformidade } from '../../domain';
import { montarGondola, montarPreco, montarResposta, montarRuptura, montarShare, montarTarefa } from '../lib/loja';
import { useLoja, type UsoLoja } from '../state/use-loja';

const feito = (l: UsoLoja, chave: string) => l.registros.find((r) => r.chave === chave);

function Aviso({ msg, tom = 'danger' }: { msg: string | null; tom?: 'danger' | 'success' | 'warning' }) {
  if (!msg) return null;
  return (
    <Banner tone={tom} icon={tom === 'success' ? 'check' : 'alert'}>
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
function Checklist({ l }: { l: UsoLoja }) {
  const [erro, setErro] = useState<string | null>(null);
  if (!l.checklist || !l.visita) return null;
  const v = l.visita;
  return (
    <Card testID="loja.checklist">
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
                <Badge label="Feito" tone="success" />
              ) : (
                <Button
                  label="Feito"
                  variant="outline"
                  testID={`loja.etapa.${i.id}`}
                  onPress={() =>
                    void l
                      .registrar('checklist_resposta', montarResposta({ id: l.novoId(), visita_loja_id: v.id, checklist_item_id: i.id, obrigatoria: i.obrigatoria, concluida: true, agora: l.agora() }), `etapa:${i.id}`, i.rotulo)
                      .then(setErro)
                  }
                />
              )}
            </View>
          );
        })}
      <Text style={t.small}>* obrigatória para encerrar a visita</Text>
      <Aviso msg={erro} />
    </Card>
  );
}

/** Share de gôndola (RF-PRO-04, RN-PRO-03): % e atingimento na hora. */
function Share({ l, categoria, setCategoria }: { l: UsoLoja; categoria: string | null; setCategoria: (id: string) => void }) {
  const [nossas, setNossas] = useState('');
  const [total, setTotal] = useState('');
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' | 'success' } | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const salvar = async () => {
    if (!categoria) return setMsg({ texto: 'Escolha a categoria da gôndola.', tom: 'danger' });
    const meta = l.metaDa(categoria);
    const r = montarShare({ id: l.novoId(), visita_loja_id: v.id, categoria_gondola_id: categoria, frentes_nossas: nossas, frentes_total: total, meta: meta ? { id: meta.id, meta_pct: meta.meta_pct } : null, agora: l.agora() });
    if (!r.ok) return setMsg({ texto: r.erro, tom: 'danger' });
    const resumo = r.coleta.share_pct === null ? 'sem frentes' : `${r.coleta.share_pct}%${r.coleta.atingimento_pct === null ? '' : ` · ${r.coleta.atingimento_pct}% da meta`}`;
    const erro = await l.registrar('medicao_share', r.coleta, `share:${categoria}`, `Share ${resumo}`);
    setMsg(erro ? { texto: erro, tom: 'danger' } : { texto: `Share registrado: ${resumo}.`, tom: 'success' });
    if (!erro) {
      setNossas('');
      setTotal('');
    }
  };
  return (
    <Card testID="loja.share">
      <SectionHeader title="Share de gôndola" />
      {l.categorias.length === 0 ? (
        <Empty text="Nenhuma categoria de gôndola cadastrada. O cadastro é feito no BKO de trade." />
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
          <Button label="Salvar share" onPress={() => void salvar()} testID="loja.share.salvar" />
        </>
      )}
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
    </Card>
  );
}

/** Presença e ruptura do mix obrigatório (RF-PRO-06, RN-PRO-05). */
function Ruptura({ l }: { l: UsoLoja }) {
  const [erro, setErro] = useState<string | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const marcar = async (m: UsoLoja['mix'][number], na_gondola: boolean, no_deposito: boolean | null) => {
    const r = montarRuptura({ id: l.novoId(), visita_loja_id: v.id, produto_id: m.mix.produto_id, mix_obrigatorio_id: m.mix.id, na_gondola, no_deposito, agora: l.agora() });
    if (!r.ok) return setErro(r.erro);
    setErro(await l.registrar('ruptura_item', r.coleta, `ruptura:${m.mix.id}`, r.coleta.status === 'presente' ? 'Presente' : r.coleta.status === 'ruptura_gondola' ? 'Falta na gôndola' : 'Sem estoque'));
  };
  return (
    <Card testID="loja.ruptura">
      <SectionHeader title="Mix obrigatório" />
      {l.mix.length === 0 ? (
        <Empty text="Nenhum mix obrigatório vigente para esta loja." />
      ) : (
        l.mix.map((m) => {
          const r = feito(l, `ruptura:${m.mix.id}`);
          return (
            <View key={m.mix.id} style={s.bloco}>
              <View style={s.linha}>
                <Text style={[t.bodyStrong, s.flex]}>{m.nome}</Text>
                {r && <Badge label={r.rotulo} tone={r.rotulo === 'Presente' ? 'success' : 'danger'} />}
              </View>
              <View style={s.chips}>
                <Chip label="Na gôndola" active={r?.rotulo === 'Presente'} onPress={() => void marcar(m, true, null)} testID={`loja.mix.${m.mix.id}.presente`} />
                <Chip label="Falta (tem no depósito)" active={r?.rotulo === 'Falta na gôndola'} onPress={() => void marcar(m, false, true)} testID={`loja.mix.${m.mix.id}.reposicao`} />
                <Chip label="Sem estoque" active={r?.rotulo === 'Sem estoque'} onPress={() => void marcar(m, false, false)} testID={`loja.mix.${m.mix.id}.ruptura`} />
              </View>
            </View>
          );
        })
      )}
      <Aviso msg={erro} />
    </Card>
  );
}

/** Preço de prateleira do nosso item (RF-PRO-05); variação grande pede confirmação (RN-PRO-04). */
function Preco({ l }: { l: UsoLoja }) {
  const [produto, setProduto] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' | 'success' | 'warning' } | null>(null);
  if (!l.visita || !l.loja) return null;
  const v = l.visita;
  const lojaId = l.loja.id;
  const salvar = async () => {
    if (!produto) return setMsg({ texto: 'Escolha o produto.', tom: 'danger' });
    const r = montarPreco({ id: l.novoId(), visita_loja_id: v.id, produto_id: produto, preco: valor, anterior_cents: l.precos[`${lojaId}:${produto}`] ?? null, confirmar_variacao: confirmar, limite_pct: l.parametros.variacao_preco_max_pct, agora: l.agora() });
    if (!r.ok) {
      if ('precisa_confirmar' in r) setConfirmar(true);
      return setMsg({ texto: r.erro, tom: 'warning' });
    }
    const erro = await l.registrar('coleta_preco', r.coleta, `preco:${produto}`, `Preço ${formatBRL(r.coleta.preco_cents / 100)}`);
    if (erro) return setMsg({ texto: erro, tom: 'danger' });
    await l.guardarPreco(produto, r.coleta.preco_cents);
    setMsg({ texto: `Preço registrado: ${formatBRL(r.coleta.preco_cents / 100)}.`, tom: 'success' });
    setValor('');
    setConfirmar(false);
  };
  return (
    <Card testID="loja.preco">
      <SectionHeader title="Preço de prateleira" />
      {l.mix.length === 0 ? (
        <Empty text="Sem produtos do mix para pesquisar preço nesta loja." />
      ) : (
        <>
          <View style={s.chips}>
            {l.mix.map((m) => (
              <Chip
                key={m.mix.id}
                label={feito(l, `preco:${m.mix.produto_id}`) ? `${m.nome} ✓` : m.nome}
                active={produto === m.mix.produto_id}
                onPress={() => {
                  setProduto(m.mix.produto_id);
                  setConfirmar(false);
                }}
              />
            ))}
          </View>
          <Campo rotulo="Preço (R$)" valor={valor} onChange={(x) => (setValor(x), setConfirmar(false))} teclado="decimal-pad" testID="loja.preco.valor" />
          <Button label={confirmar ? 'Confirmar preço' : 'Salvar preço'} variant={confirmar ? 'dark' : 'accent'} onPress={() => void salvar()} testID="loja.preco.salvar" />
        </>
      )}
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
    </Card>
  );
}

/** Gôndola antes/depois com conformidade (RF-PRO-03). */
function Gondola({ l, categoria }: { l: UsoLoja; categoria: string | null }) {
  const [antes, setAntes] = useState<string | null>(null);
  const [depois, setDepois] = useState<string | null>(null);
  const [conf, setConf] = useState<Conformidade>('conforme');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<{ texto: string; tom: 'danger' | 'success' } | null>(null);
  if (!l.visita) return null;
  const v = l.visita;
  const foto = async (tipo: 'gondola_antes' | 'gondola_depois') => {
    const r = await l.tirarFoto(tipo, tipo === 'gondola_antes' ? 'Foto da gôndola (antes)' : 'Foto da gôndola (depois)');
    if ('erro' in r) return setMsg({ texto: r.erro, tom: 'danger' });
    (tipo === 'gondola_antes' ? setAntes : setDepois)(r.id);
  };
  const salvar = async () => {
    if (!categoria) return setMsg({ texto: 'Escolha a categoria da gôndola (no share, acima).', tom: 'danger' });
    const r = montarGondola({ id: l.novoId(), visita_loja_id: v.id, categoria_gondola_id: categoria, foto_antes_id: antes, foto_depois_id: depois, foto_referencia_id: null, conformidade: conf, motivo, agora: l.agora() });
    if (!r.ok) return setMsg({ texto: r.erro, tom: 'danger' });
    const erro = await l.registrar('gondola_registro', r.coleta, `gondola:${categoria}`, `Gôndola ${ROTULO_CONFORMIDADE[conf].toLowerCase()}`);
    if (erro) return setMsg({ texto: erro, tom: 'danger' });
    setMsg({ texto: 'Gôndola registrada.', tom: 'success' });
    setAntes(null);
    setDepois(null);
    setMotivo('');
  };
  return (
    <Card testID="loja.gondola">
      <SectionHeader title="Arrumação da gôndola" />
      <View style={s.linha}>
        <Button label={antes ? 'Antes ✓' : 'Foto antes'} variant="outline" onPress={() => void foto('gondola_antes')} testID="loja.gondola.antes" style={s.flex} />
        <Button label={depois ? 'Depois ✓' : 'Foto depois'} variant="outline" onPress={() => void foto('gondola_depois')} testID="loja.gondola.depois" style={s.flex} />
      </View>
      <View style={s.chips}>
        {CONFORMIDADES.map((c) => (
          <Chip key={c} label={ROTULO_CONFORMIDADE[c]} active={conf === c} onPress={() => setConf(c)} testID={`loja.gondola.${c}`} />
        ))}
      </View>
      {conf !== 'conforme' && <Campo rotulo={conf === 'nao_conforme' ? 'Motivo (obrigatório)' : 'Motivo (opcional)'} valor={motivo} onChange={setMotivo} teclado="default" testID="loja.gondola.motivo" />}
      <Button label="Salvar gôndola" onPress={() => void salvar()} testID="loja.gondola.salvar" />
      <Aviso msg={msg?.texto ?? null} tom={msg?.tom} />
    </Card>
  );
}

/** Tarefas de campanha da loja (RF-PRO-10): concluir com foto. */
function Tarefas({ l }: { l: UsoLoja }) {
  const [erro, setErro] = useState<string | null>(null);
  if (!l.visita || !l.loja || l.tarefas.length === 0) return null;
  const v = l.visita;
  const lojaId = l.loja.id;
  const concluir = async (tarefaId: string, titulo: string) => {
    const f = await l.tirarFoto('tarefa', `Foto da tarefa · ${titulo}`);
    if ('erro' in f) return setErro(f.erro);
    const r = montarTarefa({ id: l.novoId(), tarefa_trade_id: tarefaId, visita_loja_id: v.id, cliente_id: lojaId, foto_ids: [f.id], agora: l.agora() });
    if (!r.ok) return setErro(r.erro);
    setErro(await l.registrar('tarefa_execucao', r.coleta, `tarefa:${tarefaId}`, titulo));
  };
  return (
    <Card testID="loja.tarefas">
      <SectionHeader title="Tarefas da campanha" />
      {l.tarefas.map((x) => (
        <View key={x.id} style={s.linha}>
          <Text style={[t.body, s.flex]}>{x.titulo}</Text>
          {feito(l, `tarefa:${x.id}`) ? <Badge label="Concluída" tone="success" /> : <Button label="Concluir com foto" variant="outline" onPress={() => void concluir(x.id, x.titulo)} testID={`loja.tarefa.${x.id}`} />}
        </View>
      ))}
      <Aviso msg={erro} />
    </Card>
  );
}

export function TelaLoja() {
  const l = useLoja();
  const podeColetar = usePode('coleta.registrar');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const acao = useCallback(async (fn: () => Promise<string | null>) => {
    setOcupado(true);
    setMsg(await fn());
    setOcupado(false);
  }, []);

  if (!podeColetar) {
    return (
      <Screen testID="loja.tela">
        <Empty text="As coletas de loja são feitas pelo promotor." />
      </Screen>
    );
  }
  if (!l.carregado) return <Loading />;

  return (
    <Screen testID="loja.tela" onRefresh={() => void l.recarregar()}>
      <Text style={t.h1}>Loja</Text>
      {l.offline && <Banner>Sem sinal: as coletas ficam guardadas no aparelho e vão sozinhas quando a conexão voltar.</Banner>}
      {!l.checkin || !l.loja ? (
        <Empty text="Faça o check-in na loja (aba Rota ou Clientes) para começar as coletas." />
      ) : !l.visita ? (
        <Card testID="loja.iniciar">
          <Text style={t.h2}>{l.loja.nome}</Text>
          <Text style={t.sub}>Check-in às {formatHHMM(l.checkin.checkin_em, l.fuso)}</Text>
          <Button label="Iniciar coletas nesta loja" loading={ocupado} onPress={() => void acao(l.iniciar)} testID="loja.iniciar.botao" />
        </Card>
      ) : l.visita.checkout_em ? (
        <Card testID="loja.encerrada">
          <Text style={t.h2}>{l.loja.nome}</Text>
          <Text style={t.sub}>Coletas encerradas às {formatHHMM(l.visita.checkout_em, l.fuso)}. Faça o checkout da visita para seguir a rota.</Text>
        </Card>
      ) : (
        <>
          <Card>
            <Text style={t.h2}>{l.loja.nome}</Text>
            <Text style={t.sub}>
              Coletando desde {formatHHMM(l.visita.checkin_em, l.fuso)} · {l.registros.filter((r) => r.entidade !== 'foto_coleta').length} registro(s)
            </Text>
          </Card>
          <Checklist l={l} />
          <Share l={l} categoria={categoria} setCategoria={setCategoria} />
          <Gondola l={l} categoria={categoria} />
          <Ruptura l={l} />
          <Preco l={l} />
          <Tarefas l={l} />
          <Button label="Encerrar coletas da loja" variant="dark" loading={ocupado} onPress={() => void acao(l.encerrar)} testID="loja.encerrar" />
        </>
      )}
      <Aviso msg={msg} />
    </Screen>
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
