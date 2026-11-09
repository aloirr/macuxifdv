/**
 * Endereço de entrega do Novo pedido (RN-VEN-17, T-0141 C; spec docs/design/pedido-v3.md §C): o cartão da aba Entrega, a folha com
 * os endereços do ERP e o formulário "Endereço deste pedido". Os textos e as regras vêm de `lib/endereco-pedido` e do domain
 * (`validarEnderecoEditado`); aqui só o desenho. Funciona offline: o formulário é preenchido à mão, sem consulta de CEP.
 */
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import {
  Botao,
  colors,
  Dialogo,
  Folha,
  fonts,
  ListaSuspensa,
  OpcaoFolha,
  Pressionavel,
  RotuloSecao,
  Selo,
  type as t,
} from '@macuxi/ui/mobile';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { LIMITES_ENDERECO, type CampoDoEndereco } from '../../domain/endereco-pedido';
import {
  cartaoDoEndereco,
  errosDoFormulario,
  formularioAlterado,
  formularioDoEndereco,
  mascaraDoCep,
  opcoesDaFolhaDeEnderecos,
  TEXTOS_ENDERECO,
  type EnderecoParaTexto,
  type RascunhoDoEndereco,
  type ValoresDoFormulario,
} from '../lib/endereco-pedido';
import type { EnderecoDaTela } from '../lib/novo-pedido';

/** C.1: cartão no topo da aba Entrega, com o selo de origem e a ação à direita do rótulo (Alterar ou Editar). */
export function CartaoEndereco({
  rascunho,
  lista,
  onAcao,
}: {
  rascunho: RascunhoDoEndereco;
  lista: readonly EnderecoDaTela[];
  onAcao: (abre: 'folha' | 'formulario') => void;
}) {
  const c = cartaoDoEndereco({ rascunho, lista });
  return (
    <View style={{ gap: 8 }} testID="entrega-endereco-bloco">
      <RotuloSecao texto={TEXTOS_ENDERECO.rotuloSecao} acao={{ rotulo: c.acao.rotulo, onPress: () => onAcao(c.acao.abre), testID: 'entrega-alterar' }} />
      <View style={s.cartao} testID="entrega-endereco">
        {c.selo ? <Selo texto={c.selo.texto} tom={c.selo.tom} tamanho="p" testID="entrega-endereco-selo" /> : null}
        {c.linhas.length > 0 ? c.linhas.map((l, i) => (
          <Text key={i} style={s.linhaEndereco} testID={`entrega-endereco-linha-${i + 1}`}>
            {l}
          </Text>
        )) : (
          <Text style={s.linhaEndereco}>{c.texto}</Text>
        )}
      </View>
    </View>
  );
}

/** C.2: folha com os endereços do ERP (escolha única, sem confirmar) e, no fim, "Editar endereço deste pedido". */
export function FolhaEnderecos({
  visivel,
  rascunho,
  lista,
  onEscolher,
  onEditar,
  onFechar,
}: {
  visivel: boolean;
  rascunho: RascunhoDoEndereco;
  lista: readonly EnderecoDaTela[];
  onEscolher: (e: EnderecoDaTela) => void;
  onEditar: () => void;
  onFechar: () => void;
}) {
  const opcoes = opcoesDaFolhaDeEnderecos({ rascunho, lista });
  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar="Fechar" titulo={TEXTOS_ENDERECO.tituloFolha} rolavel testID="folha-entrega" rodape={{ rotulo: TEXTOS_ENDERECO.voltar, onPress: onFechar }}>
      {opcoes.map((o) => (
        <OpcaoFolha
          key={o.id}
          testID={`endereco-${o.id}`}
          icone={o.marcada ? 'check' : 'pin'}
          tom={o.marcada ? 'destaque' : 'neutro'}
          titulo={o.titulo}
          subtitulo={o.subtitulo}
          onPress={() => {
            const e = lista.find((x) => x.id === o.id);
            if (e) onEscolher(e);
            else onFechar();
          }}
        />
      ))}
      <View style={s.divisor} />
      <OpcaoFolha testID="endereco-editar-neste-pedido" icone="edit" tom="destaque" titulo={TEXTOS_ENDERECO.editarNestePedido} onPress={onEditar} />
    </Folha>
  );
}

const ORDEM: CampoDoEndereco[] = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

/**
 * C.3: formulário "Endereço deste pedido". Abre preenchido com a base (o endereço que vale hoje); "Usar neste pedido" valida (mesma
 * regra da API) e, com erro, marca o campo e leva o foco ao primeiro; Voltar com algo digitado pergunta "Descartar a edição?".
 */
export function FormularioEndereco({
  visivel,
  base,
  onUsar,
  onFechar,
}: {
  visivel: boolean;
  /** o endereço que vale no pedido agora (ponto de partida); `null` = cliente sem endereço */
  base: EnderecoParaTexto | null;
  onUsar: (v: ValoresDoFormulario) => void;
  onFechar: () => void;
}) {
  const [v, setV] = useState<ValoresDoFormulario>(() => formularioDoEndereco(base));
  const [inicial, setInicial] = useState<ValoresDoFormulario>(() => formularioDoEndereco(base));
  const [tentou, setTentou] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const refs = useRef<Partial<Record<CampoDoEndereco, TextInput | null>>>({});
  const { fontScale } = useWindowDimensions();
  const empilhar = fontScale > 1.3;

  // cada abertura recomeça da base atual
  useEffect(() => {
    if (!visivel) return;
    const f = formularioDoEndereco(base);
    setV(f);
    setInicial(f);
    setTentou(false);
    setDescartando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir
  }, [visivel]);

  const erros = tentou ? errosDoFormulario(v) : {};
  const set = (campo: keyof ValoresDoFormulario, valor: string) => setV((d) => ({ ...d, [campo]: valor }));
  const usar = () => {
    const e = errosDoFormulario(v);
    const primeiro = ORDEM.find((c) => e[c]);
    if (primeiro) {
      setTentou(true);
      if (primeiro !== 'uf') refs.current[primeiro]?.focus();
      return;
    }
    onUsar(v);
  };
  const voltar = () => (formularioAlterado(v, inicial) ? setDescartando(true) : onFechar());

  const campo = (c: Exclude<CampoDoEndereco, 'uf'>, rotulo: string, extra?: { teclado?: 'number-pad'; capitaliza?: 'words' | 'characters' | 'none'; max: number; onChange?: (x: string) => void }) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <TextInput
        ref={(r) => {
          refs.current[c] = r;
        }}
        testID={`endereco-${c}`}
        value={v[c]}
        onChangeText={(x) => (extra?.onChange ? extra.onChange(x) : set(c, x))}
        keyboardType={extra?.teclado}
        autoCapitalize={extra?.capitaliza ?? 'sentences'}
        autoCorrect={false}
        maxLength={extra?.max}
        accessibilityLabel={rotulo}
        style={[s.campo, erros[c] ? s.campoErro : null]}
      />
      {erros[c] ? (
        <Text style={s.erro} accessibilityLiveRegion="polite" testID={`endereco-${c}-erro`}>
          {erros[c]}
        </Text>
      ) : null}
    </View>
  );
  const par = (a: ReactNode, b: ReactNode, pesoA: number, pesoB: number) =>
    empilhar ? (
      <>
        {a}
        {b}
      </>
    ) : (
      <View style={s.par}>
        <View style={{ flex: pesoA }}>{a}</View>
        <View style={{ flex: pesoB }}>{b}</View>
      </View>
    );

  return (
    <>
      <Folha visivel={visivel} onFechar={voltar} rotuloFechar="Fechar" titulo={TEXTOS_ENDERECO.tituloFormulario} evitarTeclado testID="folha-endereco-pedido">
        <View style={{ gap: 12 }}>
          <Text style={s.aviso} testID="endereco-aviso">
            {TEXTOS_ENDERECO.aviso}
          </Text>
          {campo('cep', 'CEP', { teclado: 'number-pad', max: 9, onChange: (x) => set('cep', mascaraDoCep(x)) })}
          {campo('logradouro', 'Rua', { max: LIMITES_ENDERECO.logradouro })}
          {par(campo('numero', 'Número', { max: LIMITES_ENDERECO.numero, capitaliza: 'characters' }), campo('complemento', 'Complemento', { max: LIMITES_ENDERECO.complemento }), 1, 2)}
          {campo('bairro', 'Bairro', { max: LIMITES_ENDERECO.bairro })}
          {par(
            campo('cidade', 'Cidade', { max: LIMITES_ENDERECO.cidade }),
            <View style={{ gap: 4 }}>
              <ListaSuspensa
                testID="endereco-uf"
                rotulo="UF"
                opcoes={UFS_BRASIL.map((u) => ({ id: u, rotulo: u }))}
                valor={(UFS_BRASIL as readonly string[]).includes(v.uf.toUpperCase()) ? (v.uf.toUpperCase() as (typeof UFS_BRASIL)[number]) : null}
                placeholder="UF"
                rotuloFechar="Fechar a lista"
                erro={Boolean(erros.uf)}
                onChange={(u) => set('uf', u)}
              />
              {erros.uf ? (
                <Text style={s.erro} accessibilityLiveRegion="polite" testID="endereco-uf-erro">
                  {erros.uf}
                </Text>
              ) : null}
            </View>,
            2,
            1,
          )}
          <Botao rotulo={TEXTOS_ENDERECO.usar} nivel="principal" onPress={usar} testID="endereco-usar" />
          <Pressionavel testID="endereco-voltar" accessibilityRole="button" accessibilityLabel={TEXTOS_ENDERECO.voltar} onPress={voltar} style={s.voltar}>
            <Text style={[t.bodyStrong, { color: colors.ink2 }]}>{TEXTOS_ENDERECO.voltar}</Text>
          </Pressionavel>
        </View>
      </Folha>
      <Dialogo
        visivel={descartando}
        titulo={TEXTOS_ENDERECO.descartar.titulo}
        cancelar={{ rotulo: TEXTOS_ENDERECO.descartar.continuar, onPress: () => setDescartando(false), testID: 'endereco-continuar' }}
        confirmar={{ rotulo: TEXTOS_ENDERECO.descartar.confirmar, onPress: () => { setDescartando(false); onFechar(); }, testID: 'endereco-descartar' }}
        perigo
        testID="dialogo-descartar-endereco"
      />
    </>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, gap: 4 },
  linhaEndereco: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  divisor: { height: 1, backgroundColor: colors.lineSoft },
  aviso: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  rotulo: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  campo: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  campoErro: { borderColor: colors.danger, borderWidth: 2 },
  erro: { fontFamily: fonts.body, fontSize: 12, color: colors.danger },
  par: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  voltar: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
