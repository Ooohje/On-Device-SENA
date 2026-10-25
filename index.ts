// 앱 시작 파일: 홈 화면 위젯(오늘의 한 문장)의 처리기를 등록한 뒤 Expo Router 앱을 시작한다.
// 위젯은 앱이 꺼져 있어도 런처가 부르므로, 화면보다 먼저 등록해야 한다
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/widgetTaskHandler';
import 'expo-router/entry';

registerWidgetTaskHandler(widgetTaskHandler);
