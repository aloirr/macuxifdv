/**
 * Aba Documentação da ficha (T-0186, spec §5): tabela Documento · Data · Abrir, uma faixa por grupo. Só visualizar (P15): o arquivo
 * vem do servidor ao tocar, sem baixar e sem cópia no aparelho; sem internet, "Sem internet" e "Tentar de novo". O tipo que o perfil
 * não vê não chega; a exceção por documento vem com cadeado e "Sem permissão para abrir" (P10). Vencido só na linha (P16).
 * "Fotos do PDV" (RN-CORE-38) lê as linhas do aparelho: câmera em toda linha quando o perfil envia.
 */
import { Banner, BotaoCelula, CelulaTexto, colors, Folha, Icon, Loading, TabelaDados, type as t, type LinhaTabela } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';

import type { Cliente360Local } from '../lib/cliente360-local';
import { linhaDaFotoDoPdv } from '../lib/foto-fachada';
import { acaoDoDocumento, agruparDocumentos, dataDoDocumento, leituraDoDocumento, segundaLinhaDoDocumento } from '../lib/ficha-v2';
import type { AberturaDeDocumento, DocumentosDoCliente } from '../lib/usar-ficha-online';
import { ErroOnline } from './erro-online';

const GRUPO_FOTOS = 'Fotos do PDV';

export function AbaDocumentacao({
  documentos,
  abertura,
  fotos,
  verFotoPdv,
  adicionarFotoPdv,
  tz,
  aviso,
}: {
  documentos: DocumentosDoCliente;
  abertura: AberturaDeDocumento;
  /** Fotos do PDV do aparelho (RN-CORE-38); `null` = sem tipo cadastrado. */
  fotos: Cliente360Local['fotos_pdv'] | undefined;
  /** Abre a foto mais recente do tipo no visualizador do shell. */
  verFotoPdv?: (tipoId: string) => void;
  /** Abre a captura do shell (câmera em toda linha quando o perfil envia); sem ela, não há câmera. */
  adicionarFotoPdv?: (tipoId: string) => void;
  /** Fuso do tenant (a data da linha é a da foto mais recente). */
  tz: string;
  /** Erro ao guardar a foto (junto da linha). */
  aviso?: string | null;
}) {
  const linhasFotos: LinhaTabela[] = (fotos?.itens ?? []).flatMap<LinhaTabela>((i) => {
    const l = linhaDaFotoDoPdv(i, { tz, podeAbrir: Boolean(verFotoPdv), podeEnviar: Boolean(adicionarFotoPdv) });
    return [
      {
        tipo: 'linha',
        key: `foto-${i.tipo_id}`,
        testID: `cliente-foto-${i.tipo_id}`,
        rotulo: `${i.nome}, ${l.segunda}`,
        onPress: l.ver.ligado ? () => verFotoPdv?.(i.tipo_id) : undefined,
        celulas: [
          <CelulaTexto key="n" principal={i.nome} segunda={l.segunda} perigoSegunda={l.perigo} />,
          <CelulaTexto key="d" principal={l.data} mudo />,
          <View key="a" style={{ flexDirection: 'row', justifyContent: 'center' }}>
            {l.trancada ? (
              <BotaoCelula icone="lock" rotulo={`${i.nome}: sem permissão para abrir`} desligado />
            ) : (
              <BotaoCelula icone="olho" rotulo={l.ver.rotulo} desligado={!l.ver.ligado} onPress={() => verFotoPdv?.(i.tipo_id)} testID={`cliente-foto-ver-${i.tipo_id}`} />
            )}
            {l.adicionar ? <BotaoCelula icone="camera" rotulo={l.adicionar.rotulo} onPress={() => adicionarFotoPdv?.(i.tipo_id)} testID={`cliente-foto-adicionar-${i.tipo_id}`} /> : <View style={{ width: 48 }} />}
          </View>,
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
      {aviso ? <Banner tone="danger" icon="alert" testID="cliente-foto-erro" anunciar>{aviso}</Banner> : null}
      {linhas.length > 0 ? (
        <TabelaDados
          testID="tabela-documentos"
          colunas={[
            { id: 'doc', titulo: 'Documento' },
            { id: 'data', titulo: 'Data', largura: 76 },
            { id: 'abrir', titulo: 'Ações', largura: 96, alinhar: 'centro' },
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
