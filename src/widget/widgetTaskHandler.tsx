import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { DailyWidget } from './DailyWidget';

// 위젯을 놓을 때, 주기적으로(30분, app.json updatePeriodMillis), 크기를 바꿀 때 다시 그린다. 날짜가 바뀌면 문장도 바뀐다.
// 누르기는 clickAction OPEN_URI로 앱이 바로 열리므로 여기서 처리할 것이 없다
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== 'DailySentence') return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<DailyWidget />);
      break;
    default:
      break;
  }
}
