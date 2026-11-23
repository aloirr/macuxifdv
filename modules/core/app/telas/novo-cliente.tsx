/**
 * Novo cliente / Corrigir cliente (v1.0.28; RF-CORE-10, RN-CORE-78 e RN-CORE-79; docs/design/telas/campo-cliente-pre-cadastro.md).
 * Offline: obrigatórios vindos do parâmetro sincronizado, UUID gerado no aparelho, escrita na fila do sync (`cliente_pre_cadastro`).
 * Quem aprova é o ERP; o Core só pré-cadastra. A API revalida os obrigatórios. A página `novo-cliente` do `moduloApp` só existe para o vendedor.
 */
import { AvisoRodape, Botao, CabecalhoTela, CampoEscolha, CampoTexto, colors, Folha, Icon, RotuloSecao, faltaVisivel, type as t, useAvisoRodape, type FaltaDoCampo } from '@macuxi/ui/mobile';
import { somenteDigitos } from '@macuxi/comum';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { useBloquearSaida, useMotorSync } from '@macuxi/platform-sdk/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, Text, View } from 'react-native';

import type { ClienteSync, ParametroSync } from '../../contracts';
import { ROTULOS_CAMPOS_PRE_CADASTRO } from '../../contracts';
import { FALTA_OBRIGATORIO_PRE_CADASTRO, podePreCadastrarCliente, situacaoDoPreCadastro, validarPreCadastro } from '../../domain';
import { abrirCliente, PARAM_CLIENTE_ID, ROTA_CLIENTES } from '../lib/navegacao';
import {
  avisarClienteSalvo,
  clienteComDocumento,
  COLUNAS_FORMULARIO,
  ENTIDADE_PRE_CADASTRO,
  obrigatoriosDasLinhas,
  salvarPreCadastro,
  sobreporPreCadastros,
  valoresDoCliente,
  type ValoresPreCadastro,
} from '../lib/pre-cadastro-local';

type Coluna = (typeof COLUNAS_FORMULARIO)[number];

export interface PropsTelaNovoClientePreCadastro {
  /** "Corrigir e reenviar": abre o formulário preenchido e reenvia com o mesmo id. */
  clienteId?: string;
}

/** Coluna do formulário que cada campo obrigatório do parâmetro cobre (para marcar "(opcional)" no que a empresa não exige). */
const CAMPO_DA_COLUNA: Record<Coluna, keyof typeof ROTULOS_CAMPOS_PRE_CADASTRO> = {
  documento: 'documento',
  razao_social: 'razao_social',
  nome_fantasia: 'nome_fantasia',
  telefone: 'telefone',
  email: 'email',
  cep: 'endereco',
  logradouro: 'endereco',
  numero: 'endereco',
  bairro: 'endereco',
  cidade: 'endereco',
  uf: 'endereco',
  inscricao_estadual: 'inscricao_estadual',
};

const vazioDoFormulario = (): ValoresPreCadastro => Object.fromEntries(COLUNAS_FORMULARIO.map((c) => [c, ''])) as ValoresPreCadastro;
const novoUuid = (): string => globalThis.crypto.randomUUID();

/** A página do shell (`/m/novo-cliente`): lê `clienteId` da query (a correção do recusado) e monta a tela. */
export function PaginaNovoCliente() {
  const params = useLocalSearchParams<{ [K in typeof PARAM_CLIENTE_ID]?: string }>();
  return <TelaNovoClientePreCadastro clienteId={params[PARAM_CLIENTE_ID] || undefined} />;
}

export function TelaNovoClientePreCadastro({ clienteId }: PropsTelaNovoClientePreCadastro) {
  const { motor } = useMotorSync();
  const perfil = motor?.ambiente.usuario()?.perfil;
  // RN-CORE-78: sem usuário, ou com perfil que não pré-cadastra, a tela não abre (a página já é só do vendedor; a API revalida)
  if (!perfil || !podePreCadastrarCliente(perfil)) return null;
  return <Formulario clienteId={clienteId} />;
}

function Formulario({ clienteId }: PropsTelaNovoClientePreCadastro) {
  const { motor } = useMotorSync();
  const aviso = useAvisoRodape();
  // o UUID nasce no aparelho uma vez; a correção reaproveita o id do cliente recusado
  const id = useRef(clienteId ?? novoUuid()).current;
  const [valores, setValores] = useState<ValoresPreCadastro>(vazioDoFormulario);
  const [alterado, setAlterado] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [saiu, setSaiu] = useState<ReadonlySet<string>>(new Set());
  const [folhaDescartar, setFolhaDescartar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [obrigatorios, setObrigatorios] = useState(() => obrigatoriosDasLinhas([]));
  const [carteira, setCarteira] = useState<readonly ClienteSync[]>([]);
  const [motivo, setMotivo] = useState<string | null>(null);
  // faltas que só o schema do contrato pega ao salvar (a tela não volta em silêncio)
  const [errosSalvar, setErrosSalvar] = useState<Record<string, string>>({});
  const rolagem = useRef<ScrollView>(null);
  const posicoes = useRef<Partial<Record<Coluna, number>>>({});

  // parâmetro e carteira lidos do aparelho (offline); a correção preenche o formulário uma vez
  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [parametros, clientes] = await Promise.all([motor.linhas<ParametroSync>('parametro'), motor.linhas<ClienteSync>('cliente')]);
      if (!ativo) return;
      setObrigatorios(obrigatoriosDasLinhas(parametros));
      setCarteira(clientes);
      const atual = clienteId ? sobreporPreCadastros(clientes, motor.sobreposicao([ENTIDADE_PRE_CADASTRO]), new Date().toISOString()).find((c) => c.id === clienteId) : undefined;
      if (atual) {
        setValores(valoresDoCliente(atual));
        setMotivo(situacaoDoPreCadastro(atual).motivo);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [motor, clienteId]);

  const duplicado = useMemo(() => clienteComDocumento(carteira, valores.documento ?? '', id), [carteira, valores.documento, id]);
  const faltas = useMemo(() => {
    const r = validarPreCadastro(valores, obrigatorios).erros;
    if (duplicado) r.documento = 'Já é cliente';
    return { ...errosSalvar, ...r };
  }, [valores, obrigatorios, duplicado, errosSalvar]);

  const falta = (c: Coluna): string | null => {
    const texto = faltas[c];
    if (!texto) return null;
    const f: FaltaDoCampo = { texto, quando: texto === FALTA_OBRIGATORIO_PRE_CADASTRO ? 'vazio' : 'invalido' };
    return faltaVisivel(f, { tentou, saiu: saiu.has(c) });
  };
  const exigido = (c: Coluna) => obrigatorios.includes(CAMPO_DA_COLUNA[c]);
  const mudar = (c: Coluna) => (texto: string) => {
    setAlterado(true);
    setErrosSalvar({});
    setValores((v) => ({ ...v, [c]: texto }));
  };
  const sair = () => (router.canGoBack() ? router.back() : router.replace(ROTA_CLIENTES as never));
  // RN-VEN-38: a folha "Descartar o cadastro?" vale no Voltar do cabeçalho, no Voltar do Android e na barra inferior;
  // `destino` é o que acontece se o usuário descartar (sair da tela, ou seguir para o cliente existente)
  const destino = useRef<() => void>(sair);
  const salvo = useRef(false);
  const pedirSaida = (prosseguir: () => void) => {
    if (salvo.current || !alterado) return prosseguir();
    destino.current = prosseguir;
    setFolhaDescartar(true);
  };
  useBloquearSaida(alterado, pedirSaida);
  const aoVoltar = () => pedirSaida(sair);
  const marcarSaida = (c: Coluna) => () => setSaiu((s) => new Set(s).add(c));

  const cpf = somenteDigitos(valores.documento).length <= 11;
  const campoTexto = (c: Coluna, rotulo: string, extra: Partial<React.ComponentProps<typeof CampoTexto>> = {}) => (
    <View key={c} onLayout={(e) => (posicoes.current[c] = e.nativeEvent.layout.y)}>
      <CampoTexto
        testID={`novo-cliente-${c}`}
        rotulo={rotulo}
        valor={valores[c] ?? ''}
        aoMudar={mudar(c)}
        onBlur={marcarSaida(c)}
        opcional={!exigido(c)}
        falta={falta(c)}
        returnKeyType="next"
        {...extra}
      />
    </View>
  );

  /** Rola até o primeiro campo com erro; devolve se achou algum. */
  function rolarAtePrimeira(erros: Partial<Record<Coluna, unknown>>): boolean {
    const primeira = COLUNAS_FORMULARIO.find((c) => erros[c]);
    if (primeira) rolagem.current?.scrollTo({ y: Math.max(0, (posicoes.current[primeira] ?? 0) - 12), animated: true });
    return primeira !== undefined;
  }

  async function salvar() {
    setTentou(true);
    if (rolarAtePrimeira(faltas) || !motor) return;
    setSalvando(true);
    const r = await salvarPreCadastro(motor, { id, valores, obrigatorios, online: motor.ambiente.online() }).catch(() => null);
    setSalvando(false);
    if (!r) return aviso.mostrar({ texto: 'Não foi possível salvar. Toque em Salvar de novo.', tom: 'erro' });
    if (!r.ok) {
      setErrosSalvar(r.erros);
      // com campo marcado, o próprio campo diz o que corrigir; o aviso só entra quando o erro não aponta campo
      if (rolarAtePrimeira(r.erros)) return;
      return aviso.mostrar({ texto: 'Confira os campos marcados e toque em Salvar de novo.', tom: 'erro' });
    }
    // desmarca o formulário antes de sair: o bloqueio de saída não pergunta depois de salvar
    salvo.current = true;
    setAlterado(false);
    avisarClienteSalvo();
    sair();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID="tela-novo-cliente">
      <CabecalhoTela titulo={clienteId ? 'Corrigir cliente' : 'Novo cliente'} voltar={{ label: 'Clientes', fallback: ROTA_CLIENTES, aoVoltar }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}>
      <ScrollView ref={rolagem} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 24 }}>
        {motivo ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }} testID="novo-cliente-motivo" accessibilityRole="alert">
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={[t.sub, { flex: 1, color: colors.danger }]}>{motivo}</Text>
          </View>
        ) : null}
        {campoTexto('documento', ROTULOS_CAMPOS_PRE_CADASTRO.documento, { mascara: 'documento' })}
        {duplicado ? (
          <Pressable testID="novo-cliente-abrir-existente" accessibilityRole="link" onPress={() => pedirSaida(() => abrirCliente(duplicado.id, 'Clientes'))} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={[t.bodyStrong, { color: colors.accent }]}>Abrir</Text>
          </Pressable>
        ) : null}
        {campoTexto('razao_social', cpf ? 'Nome' : ROTULOS_CAMPOS_PRE_CADASTRO.razao_social, { autoCapitalize: 'words' })}
        {campoTexto('nome_fantasia', ROTULOS_CAMPOS_PRE_CADASTRO.nome_fantasia, { autoCapitalize: 'words' })}
        <RotuloSecao texto="Contato" />
        {campoTexto('telefone', ROTULOS_CAMPOS_PRE_CADASTRO.telefone, { mascara: 'telefone' })}
        {campoTexto('email', ROTULOS_CAMPOS_PRE_CADASTRO.email, { keyboardType: 'email-address', autoCapitalize: 'none' })}
        <RotuloSecao texto="Endereço" />
        {campoTexto('cep', 'CEP', { mascara: 'cep' })}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 2 }}>{campoTexto('logradouro', 'Logradouro', { autoCapitalize: 'words' })}</View>
          <View style={{ flex: 1 }}>{campoTexto('numero', 'Número', { keyboardType: 'number-pad' })}</View>
        </View>
        {campoTexto('bairro', 'Bairro', { autoCapitalize: 'words' })}
        {/* cadeia do "Próximo": ... Bairro > Cidade; a Cidade fecha o teclado ("Concluir"), a UF abre por toque e a Inscrição é o último campo */}
        {campoTexto('cidade', 'Cidade', { autoCapitalize: 'words', returnKeyType: 'done' })}
        <CampoEscolha
          testID="novo-cliente-uf"
          rotulo="UF"
          titulo="UF"
          opcoes={UFS_BRASIL.map((uf) => ({ id: uf, rotulo: uf }))}
          valor={valores.uf ?? null}
          onEscolher={(o: { id: string }) => {
            mudar('uf')(o.id);
            marcarSaida('uf')();
          }}
          placeholder="Escolher"
          placeholderBusca="Buscar"
          rotuloFechar="Fechar"
          falta={falta('uf')}
        />
        <RotuloSecao texto="Outros" />
        {campoTexto('inscricao_estadual', ROTULOS_CAMPOS_PRE_CADASTRO.inscricao_estadual, { returnKeyType: 'done' })}
      </ScrollView>
      <View style={{ padding: 20, paddingTop: 8, backgroundColor: colors.ground }}>
        <Botao testID="novo-cliente-salvar" rotulo="Salvar" nivel="principal" alto ocupado={salvando} onPress={() => void salvar()} />
      </View>
      </KeyboardAvoidingView>
      <Folha
        visivel={folhaDescartar}
        onFechar={() => setFolhaDescartar(false)}
        rotuloFechar="Continuar"
        titulo="Descartar o cadastro?"
        rodapeFixo={
          <View style={{ gap: 8 }}>
            <Botao testID="novo-cliente-descartar" rotulo="Descartar" nivel="perigo" alto onPress={() => { setFolhaDescartar(false); destino.current(); }} />
            <Botao testID="novo-cliente-continuar" rotulo="Continuar" alto onPress={() => setFolhaDescartar(false)} />
          </View>
        }
        testID="novo-cliente-folha-descartar">
        <View />
      </Folha>
      <AvisoRodape {...aviso.props} />
    </View>
  );
}
