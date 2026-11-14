// react-native-web com a fonte do sistema escalada (?f=1.15) e com `adjustsFontSizeToFit` (o RN-web não implementa):
// multiplica fontSize e lineHeight de todo Text e, nos de 1 linha com adjustsFontSizeToFit, encolhe até minimumFontScale.
import * as RNW from 'react-native-web';
import { createElement, useLayoutEffect, useRef, useState } from 'react';

export * from 'react-native-web';
const F = Number(new URLSearchParams(location.search).get('f') ?? '1');
const Base: any = (RNW as any).Text;
const flat = (s: any): any => (Array.isArray(s) ? s.reduce((a, x) => ({ ...a, ...flat(x) }), {}) : s || {});
export const Text = (props: any) => {
  const { adjustsFontSizeToFit, minimumFontScale = 0, ...resto } = props;
  const ref = useRef<any>(null);
  const [, setEsc] = useState(1);
  const st = flat(props.style);
  const fs = (st.fontSize ?? 14) * F;
  useLayoutEffect(() => {
    const el = ref.current as HTMLElement | null;
    if (!adjustsFontSizeToFit || !el) return;
    let e = 1;
    el.style.zoom = '1';
    while (el.scrollWidth > el.clientWidth + 0.5 && e > minimumFontScale) {
      e = Math.max(minimumFontScale, e - 0.02);
      el.style.zoom = String(e);
    }
    el.dataset.escala = String(Math.round(e * 100) / 100);
    setEsc(e);
  }, [adjustsFontSizeToFit, minimumFontScale, fs, props.children]);
  const novo = { ...st, fontSize: fs, ...(st.lineHeight ? { lineHeight: st.lineHeight * F } : {}) };
  return createElement(Base, { ...resto, ref, style: novo });
};
