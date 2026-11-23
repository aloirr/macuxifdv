/**
 * Novo cliente / Corrigir cliente (v1.0.28; RF-CORE-10, RN-CORE-78 e RN-CORE-79; docs/design/telas/campo-cliente-pre-cadastro.md).
 * Offline: obrigatórios vindos do parâmetro sincronizado, UUID gerado no aparelho, escrita na fila do sync (`cliente_pre_cadastro`).
 * Quem aprova é o ERP; o Core só pré-cadastra. A API revalida os obrigatórios. Só o vendedor vê esta tela (o promotor e a gestão não).
 */
import { AvisoRodape, Botao, CabecalhoTela, CampoEscolha, CampoTexto, colors, Folha, Icon, RotuloSecao, faltaVisivel, type as t, useAvisoRodape, type FaltaDoCampo } from '@macuxi/ui/mobile';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';

import type { ClienteSync, ParametroSync } from '../../contracts';
import { ROTULOS_CAMPOS_PRE_CADASTRO } from '../../contracts';
import { ehSempreObrigatorio, podePreCadastrarCliente, situacaoDoPreCadastro, validarPreCadastro } from '../../domain';
import { abrirCliente } from '../lib/navegacao';
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
  /** Chamada depois de salvar ou de descartar; sem ela, volta à lista de clientes. */
  aoConcluir?: () => void;
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

export function TelaNovoClientePreCadastro({ aoConcluir, clienteId }: PropsTelaNovoClientePreCadastro) {
  const { motor } = useMotorSync();
  const perfil = motor?.ambiente.usuario()?.perfil ?? 'vendedor';
  // RN-CORE-78: revalida o perfil na tela (o botão da lista já não aparece para o promotor)
  if (!podePreCadastrarCliente(perfil)) return <SemPermissao aoVoltar={aoConcluir} />;
  return <Formulario aoConcluir={aoConcluir} clienteId={clienteId} />;
}

function SemPermissao({ aoVoltar }: { aoVoltar?: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID="novo-cliente-sem-permissao">
      <CabecalhoTela titulo="Novo cliente" voltar={{ label: 'Clientes', fallback: '/m/clientes', aoVoltar }} />
      <Text style={[t.body, { padding: 20 }]}>Seu perfil não pré-cadastra clientes. Peça ao seu gestor.</Text>
    </View>
  );
}

function Formulario({ aoConcluir, clienteId }: PropsTelaNovoClientePreCadastro) {
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
    return r;
  }, [valores, obrigatorios, duplicado]);

  const falta = (c: Coluna): string | null => {
    const texto = faltas[c];
    if (!texto) return null;
    const f: FaltaDoCampo = { texto, quando: texto === 'Obrigatório' ? 'vazio' : 'invalido' };
    return faltaVisivel(f, { tentou, saiu: saiu.has(c) });
  };
  const exigido = (c: Coluna) => obrigatorios.includes(CAMPO_DA_COLUNA[c]);
  const mudar = (c: Coluna) => (texto: string) => {
    setAlterado(true);
    setValores((v) => ({ ...v, [c]: texto }));
  };
  const sair = () => (aoConcluir ? aoConcluir() : router.canGoBack() ? router.back() : router.replace('/m/clientes' as never));
  const aoVoltar = () => (alterado ? setFolhaDescartar(true) : sair());
  const marcarSaida = (c: Coluna) => () => setSaiu((s) => new Set(s).add(c));

  const cpf = (valores.documento ?? '').replace(/\D/g, '').length <= 11;
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

  async function salvar() {
    setTentou(true);
    const primeira = COLUNAS_FORMULARIO.find((c) => faltas[c]);
    if (primeira || !motor) {
      if (primeira) rolagem.current?.scrollTo({ y: Math.max(0, (posicoes.current[primeira] ?? 0) - 12), animated: true });
      return;
    }
    setSalvando(true);
    const r = await salvarPreCadastro(motor, { id, valores, obrigatorios, online: motor.ambiente.online() }).catch(() => null);
    setSalvando(false);
    if (!r) return aviso.mostrar({ texto: 'Não foi possível salvar. Toque em Salvar de novo.', tom: 'erro' });
    if (!r.ok) return;
    avisarClienteSalvo();
    sair();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID="tela-novo-cliente">
      <CabecalhoTela titulo={clienteId ? 'Corrigir cliente' : 'Novo cliente'} voltar={{ label: 'Clientes', fallback: '/m/clientes', aoVoltar }} />
      <ScrollView ref={rolagem} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 24 }}>
        {motivo ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }} testID="novo-cliente-motivo" accessibilityRole="alert">
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={[t.sub, { flex: 1, color: colors.danger }]}>{motivo}</Text>
          </View>
        ) : null}
        {campoTexto('documento', ehSempreObrigatorio('documento') ? 'CNPJ ou CPF' : ROTULOS_CAMPOS_PRE_CADASTRO.documento, { mascara: 'documento' })}
        {duplicado ? (
          <Pressable testID="novo-cliente-abrir-existente" accessibilityRole="link" onPress={() => abrirCliente(duplicado.id, 'Clientes')} style={{ minHeight: 48, justifyContent: 'center' }}>
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
        {campoTexto('cidade', 'Cidade', { autoCapitalize: 'words' })}
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
        {campoTexto('inscricao_estadual', ROTULOS_CAMPOS_PRE_CADASTRO.inscricao_estadual)}
      </ScrollView>
      <View style={{ padding: 20, paddingTop: 8, backgroundColor: colors.ground }}>
        <Botao testID="novo-cliente-salvar" rotulo="Salvar" nivel="principal" alto ocupado={salvando} onPress={() => void salvar()} />
      </View>
      <Folha
        visivel={folhaDescartar}
        onFechar={() => setFolhaDescartar(false)}
        rotuloFechar="Continuar"
        titulo="Descartar o cadastro?"
        rodapeFixo={
          <View style={{ gap: 8 }}>
            <Botao testID="novo-cliente-descartar" rotulo="Descartar" nivel="perigo" alto onPress={() => { setFolhaDescartar(false); sair(); }} />
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
