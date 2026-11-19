export const isImeComposing = (e: { nativeEvent: KeyboardEvent; keyCode: number }) =>
  e.nativeEvent.isComposing || e.keyCode === 229;
