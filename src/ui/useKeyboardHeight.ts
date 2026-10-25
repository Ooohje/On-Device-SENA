import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// 키보드 높이(dp). Android 15+ edge-to-edge에서는 키보드가 창 크기를 줄여 주지 않고,
// 화면 아래에 절대 위치로 붙인 입력창은 KeyboardAvoidingView의 padding도 받지 않으므로 이 값만큼 직접 올린다.
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}
