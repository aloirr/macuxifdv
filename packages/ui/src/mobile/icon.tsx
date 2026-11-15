/**
 * Ícones em traço (mesmos desenhos dos mockups), via react-native-svg. Sem emoji.
 */
import { Platform } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from './theme';

export type IconName =
  | 'home'
  | 'pin'
  | 'users'
  | 'clipboard'
  | 'target'
  | 'sync'
  | 'check'
  | 'navigate'
  | 'clock'
  | 'alert'
  | 'back'
  | 'chevron'
  | 'phone'
  | 'chat'
  | 'plus'
  | 'minus'
  | 'wifiOff'
  | 'search'
  | 'close'
  | 'logout'
  | 'server'
  | 'send'
  | 'user'
  | 'lock'
  | 'copy'
  | 'edit'
  | 'trash'
  | 'file'
  | 'menu'
  | 'swap'
  | 'x'
  | 'bell'
  | 'sun'
  | 'map'
  | 'camera'
  | 'inbox'
  | 'filtro'
  | 'abaixo'
  | 'subir'
  | 'mais'
  | 'galeria'
  | 'config'
  | 'nuvem'
  | 'olho'
  | 'olhoRiscado';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, color = colors.ink, strokeWidth = 2 }: Props) {
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...hiddenFromScreenReaders}>
      {render(name, common)}
    </Svg>
  );
}

/**
 * Ícone é decorativo: escondido do leitor de tela.
 * No navegador o react-native-svg repassa as props direto para o <svg>, então lá usamos aria-hidden
 * (as props nativas geravam o aviso "React does not recognize the importantForAccessibility prop").
 */
const hiddenFromScreenReaders =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as object)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as object);

type Common = { stroke: string; strokeWidth: number; strokeLinecap: 'round'; strokeLinejoin: 'round'; fill: string };

function render(name: IconName, c: Common) {
  switch (name) {
    case 'home':
      return <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" {...c} />;
    case 'pin':
      return (
        <>
          <Path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" {...c} />
          <Circle cx={12} cy={9.5} r={2.5} {...c} />
        </>
      );
    case 'users':
      return (
        <>
          <Circle cx={9} cy={8} r={3.5} {...c} />
          <Path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" {...c} />
          <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2" {...c} />
        </>
      );
    case 'clipboard':
      return (
        <>
          <Rect x={5} y={4} width={14} height={17} rx={2} {...c} />
          <Path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" {...c} />
        </>
      );
    case 'target':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...c} />
          <Circle cx={12} cy={12} r={5} {...c} />
          <Circle cx={12} cy={12} r={1.5} {...c} />
        </>
      );
    case 'sync':
      return <Path d="M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5" {...c} />;
    case 'check':
      return <Path d="m5 12.5 4.5 4.5L19 7.5" {...c} />;
    case 'navigate':
      return <Path d="M3 11 21 3l-8 18-2-8z" {...c} />;
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...c} />
          <Path d="M12 7v5l3 2" {...c} />
        </>
      );
    case 'alert':
      return (
        <>
          <Path d="M12 3 2 20h20z" {...c} />
          <Path d="M12 10v4M12 17h.01" {...c} />
        </>
      );
    case 'back':
      return <Path d="m15 6-6 6 6 6" {...c} />;
    case 'abaixo':
      return <Path d="m6 9 6 6 6-6" {...c} />;
    case 'filtro':
      return <Path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" {...c} />;
    case 'subir':
      return <Path d="M12 20V6M6 11l6-6 6 6M5 3h14" {...c} />;
    case 'chevron':
      return <Path d="m9 6 6 6-6 6" {...c} />;
    case 'phone':
      return <Path d="M5 4h4l1.5 4.5-2.3 1.4a11 11 0 0 0 5.9 5.9l1.4-2.3L20 15v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" {...c} />;
    case 'chat':
      return <Path d="M4 5h16v11H9l-5 4z" {...c} />;
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...c} />;
    case 'minus':
      return <Path d="M5 12h14" {...c} />;
    case 'wifiOff':
      return (
        <>
          <Path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M14.4 10.3A10 10 0 0 1 19 12.9M2 9.3a15 15 0 0 1 4.3-2.8M10.5 5.1A15 15 0 0 1 22 9.3" {...c} />
          <Circle cx={12} cy={19.5} r={0.8} {...c} />
        </>
      );
    case 'search':
      return (
        <>
          <Circle cx={11} cy={11} r={7} {...c} />
          <Path d="m20 20-3.5-3.5" {...c} />
        </>
      );
    case 'close':
    case 'x':
      return <Path d="M6 6l12 12M18 6 6 18" {...c} />;
    case 'logout':
      return <Path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" {...c} />;
    case 'server':
      return (
        <>
          <Rect x={3} y={4} width={18} height={7} rx={2} {...c} />
          <Rect x={3} y={13} width={18} height={7} rx={2} {...c} />
          <Path d="M7 7.5h.01M7 16.5h.01" {...c} />
        </>
      );
    case 'send':
      return <Path d="M12 19V5M5 12l7-7 7 7" {...c} />;
    case 'lock':
      return (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...c} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...c} />
        </>
      );
    case 'copy':
      return (
        <>
          <Rect x={8} y={8} width={12} height={13} rx={2} {...c} />
          <Path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" {...c} />
        </>
      );
    case 'edit':
      return <Path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" {...c} />;
    case 'trash':
      return <Path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" {...c} />;
    case 'file':
      return (
        <>
          <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" {...c} />
          <Path d="M14 3v5h5M9 13h6M9 17h4" {...c} />
        </>
      );
    case 'swap':
      return <Path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" {...c} />;
    case 'menu':
      return <Path d="M4 6h16M4 12h16M4 18h16" {...c} />;
    case 'user':
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...c} />
          <Path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" {...c} />
        </>
      );
    case 'bell':
      return (
        <>
          <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" {...c} />
          <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" {...c} />
        </>
      );
    case 'sun':
      return (
        <>
          <Circle cx={12} cy={12} r={4} {...c} />
          <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...c} />
        </>
      );
    case 'map':
      return (
        <>
          <Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" {...c} />
          <Path d="M9 4v14M15 6v14" {...c} />
        </>
      );
    case 'camera':
      // foto (check-in, gôndola, fachada, pergunta com foto)
      return (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...c} />
          <Circle cx={12} cy={13.5} r={3.5} {...c} />
        </>
      );
    case 'inbox':
      // caixa de entrada (notificações, recebidos)
      return (
        <>
          <Path d="M5.5 5h13l2.5 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" {...c} />
          <Path d="M3 13h5l1.5 3h5l1.5-3h5" {...c} />
        </>
      );
    case 'galeria':
      // galeria de fotos do aparelho (permissão "Fotos e galeria", T-0145; escolher foto do PDV, T-0147)
      return (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={2} {...c} />
          <Circle cx={9} cy={9.5} r={1.6} {...c} />
          <Path d="M20.5 16l-5-5-8.5 8.5" {...c} />
        </>
      );
    case 'config':
      // configurações do sistema ("Abrir configurações", T-0145)
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...c} />
          <Path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" {...c} />
        </>
      );
    case 'olho':
      // campo de senha (R-20261115-071000): botão "Mostrar senha", com a senha oculta; mesmo desenho do IconEye do kit web
      return (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...c} />
          <Circle cx={12} cy={12} r={3} {...c} />
        </>
      );
    case 'olhoRiscado':
      // campo de senha: botão "Ocultar senha", com a senha visível; mesmo desenho do IconEyeOff do kit web
      return (
        <>
          <Path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.8 3.7" {...c} />
          <Path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" {...c} />
          <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" {...c} />
          <Path d="m3 3 18 18" {...c} />
        </>
      );
    case 'nuvem':
      // foto ainda não baixada / guardada no servidor (fotos do PDV, T-0147)
      return <Path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 8.5a4.8 4.8 0 0 1-.5 9.5z" {...c} />;
    case 'mais':
      // ⋮ (menu de mais ações no cabeçalho do detalhe: Cancelar orçamento, T-0133)
      return (
        <>
          <Circle cx={12} cy={5} r={1.2} {...c} />
          <Circle cx={12} cy={12} r={1.2} {...c} />
          <Circle cx={12} cy={19} r={1.2} {...c} />
        </>
      );
  }
}
