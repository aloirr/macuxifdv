// react-native → react-native-web, mais as APIs só de Android que o web não exporta (sem efeito no print).
export * from 'react-native-web';
export const ToastAndroid = { show() {}, SHORT: 0, LONG: 1 };
