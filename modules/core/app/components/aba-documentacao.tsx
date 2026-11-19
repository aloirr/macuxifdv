/**
 * Aba Documentação da ficha (T-0186, spec §5): tabela Documento · Data · Abrir, uma faixa por grupo. Só visualizar (P15): o arquivo
 * vem do servidor ao tocar, sem baixar e sem cópia no aparelho; sem internet, "Sem internet" e "Tentar de novo". O tipo que o perfil
 * não vê não chega; a exceção por documento vem com cadeado e "Sem permissão para abrir" (P10). Vencido só na linha (P16).
 * "Fotos do PDV" (RN-CORE-38) lê as linhas do aparelho: "Falta" em vermelho com a câmera quando o perfil envia.
 */
import { BotaoCelula, CelulaTexto, colors, Folha, Icon, Loading, TabelaDados, type as t, type LinhaTabela } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';

import type { Cliente360Local } from '../lib/cliente360-local';
import { fotoPdvTrancada } from '../lib/foto-fachada';
import { acaoDoDocumento, agruparDocumentos, dataBr, dataDoDocumento, leituraDoDocumento, segundaLinhaDoDocumento } from '../lib/ficha-v2';
import type { AberturaDeDocumento, DocumentosDoCliente } from '../lib/usar-ficha-online';
import { ErroOnline } from './erro-online';

const GRUPO_FOTOS = 'Fotos do PDV';

export function AbaDocumentacao({
  documentos,
  abertura,
  fotos,
  verFotoPdv,
  adicionarFotoPdv,
  tirada,
}: {
  documentos: DocumentosDoCliente;
  abertura: AberturaDeDocumento;
  /** Fotos do PDV do aparelho (RN-CORE-38); `null` = sem tipo cadastrado. */
  fotos: Cliente360Local['fotos_pdv'] | undefined;
  verFotoPdv?: () => void;
  /** Tipo que falta: abre a captura do shell; sem ela, não há câmera. */
  adicionarFotoPdv?: (tipoId: string) => void;
  /** Data da fachada (AAAA-MM-DD, fuso do tenant). */
  tirada: string | null;
}) {
  const linhasFotos: LinhaTabela[] = (fotos?.itens ?? []).flatMap<LinhaTabela>((i) => {
    const tem = i.situacao === 'tem';
    const segunda = i.na_fila ? 'Na fila' : tem ? 'Foto' : i.obrigatorio ? 'Falta' : 'Opcional';
    const podeAbrir = tem && i.fachada && Boolean(verFotoPdv);
    return [
      {
        tipo: 'linha',
        key: `foto-${i.tipo_id}`,
        testID: `cliente-foto-${i.tipo_id}`,
        rotulo: `${i.nome}, ${segunda}`,
        onPress: podeAbrir ? verFotoPdv : undefined,
        celulas: [
          <CelulaTexto key="n" principal={i.nome} segunda={segunda} perigoSegunda={!tem && i.obrigatorio} />,
          <CelulaTexto key="d" principal={i.fachada && tem && tirada ? dataBr(tirada) : '—'} mudo />,
          tem && !i.fachada && fotoPdvTrancada(i) ? (
            <BotaoCelula key="a" icone="lock" rotulo={`${i.nome}: sem permissão para abrir`} desligado />
          ) : tem ? (
            <BotaoCelula key="a" icone="chevron" rotulo={`Ver ${i.nome}`} desligado={!podeAbrir} onPress={verFotoPdv} testID="cliente-foto-pdv" />
          ) : adicionarFotoPdv ? (
            <BotaoCelula key="a" icone="camera" rotulo={`Adicionar foto: ${i.nome}`} onPress={() => adicionarFotoPdv(i.tipo_id)} testID={`cliente-foto-adicionar-${i.tipo_id}`} />
          ) : (
            <View key="a" />
          ),
        ],
      },
    ];
  });

  const docs = documentos.itens.filter((d) => d.grupo !== GRUPO_FOTOS);
  const grupos = agruparDocumentos(docs);
  const linhasDocs: LinhaTabela[] = grupos.flatMap((g) => [
    { tipo: 'faixa' as const, key: `faixa-${g.grupo}`, texto: g.grupo.toUpperCase() },
    ...g.documentos.map<LinhaTabela>((d) => {
      const bloqueado = d.acesso === 'bloqueado';
      const seg = segundaLinhaDoDocumento(d);
      const acao = acaoDoDocumento(d);
      return {
        tipo: 'linha',
        key: d.id,
        testID: `documento-${d.id}`,
        rotulo: acao === 'nenhuma' ? d.nome : leituraDoDocumento(d),
        onPress: acao === 'abrir' ? () => abertura.abrir(d) : undefined,
        celulas: [
          <CelulaTexto key="n" principal={d.nome} segunda={seg.texto} perigoSegunda={seg.perigo} mudo={bloqueado} />,
          <CelulaTexto key="d" principal={dataDoDocumento(d)} mudo />,
          acao === 'nenhuma' ? <CelulaTexto key="a" principal="" /> : bloqueado ? <BotaoCelula key="a" icone="lock" rotulo={`${d.nome}: sem permissão para abrir`} desligado /> : <BotaoCelula key="a" icone="chevron" rotulo={`Abrir ${d.nome}`} desligado={abertura.abrindo === d.id} onPress={() => abertura.abrir(d)} />,
        ],
      };
    }),
  ]);
  const linhas: LinhaTabela[] = [...(linhasFotos.length > 0 ? [{ tipo: 'faixa' as const, key: 'faixa-fotos', texto: GRUPO_FOTOS.toUpperCase() }, ...linhasFotos] : []), ...linhasDocs];
  const vazio = documentos.estado === 'ok' && linhas.length === 0;

  return (
    <View style={{ gap: 12 }} testID="cliente-documentacao">
      {linhas.length > 0 ? (
        <TabelaDados
          testID="tabela-documentos"
          colunas={[
            { id: 'doc', titulo: 'Documento' },
            { id: 'data', titulo: 'Data', largura: 76 },
            { id: 'abrir', titulo: 'Abrir', largura: 48, alinhar: 'centro' },
          ]}
          linhas={linhas}
        />
      ) : null}
      {documentos.estado === 'carregando' || documentos.estado === 'ocioso' ? <Loading embutido testID="documentos-carregando" /> : null}
      {documentos.estado === 'erro' ? <ErroOnline falha={documentos.falha} titulo="Documentos" onTentar={documentos.recarregar} testID="documentos-erro" /> : null}
      {vazio ? (
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 48 }} testID="documentos-vazio">
          <Icon name="file" size={32} color={colors.ink3} />
          <Text style={t.bodyStrong}>Nenhum documento deste cliente</Text>
        </View>
      ) : null}

      <Folha visivel={Boolean(abertura.falhou)} onFechar={abertura.fechar} rotuloFechar="Fechar" titulo={abertura.falhou?.nome ?? ''} fechar={{ rotulo: 'Fechar' }} testID="folha-documento-erro">
        {abertura.falhou ? <ErroOnline falha={abertura.falhou.falha} titulo={abertura.falhou.nome} onTentar={abertura.tentarDeNovo} testID="documento-erro" /> : null}
      </Folha>
    </View>
  );
}
