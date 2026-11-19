/**
 * Visor de PDF do shell (T-0186, P15 e P17: só ver, sem compartilhar nem salvar). O app ainda não tem biblioteca que
 * desenhe PDF na tela: o `Linking` do Android abre a URI de conteúdo sem a permissão de leitura, e a impressão e o
 * compartilhamento do sistema oferecem "Salvar". Enquanto a dependência não é aprovada, fica `null` e a rota `/arquivo`
 * mostra a mensagem sem gravar o PDF. Quando entrar, recebe o `file://` temporário do cache e só o desenha; o fechar e a
 * limpeza do temporário continuam na rota.
 */
import type { ComponentType } from 'react';

export const VisorDePdf: ComponentType<{ uri: string; aoFechar: () => void; titulo: string; subtitulo?: string }> | null = null;
