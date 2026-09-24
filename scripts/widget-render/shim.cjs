// The widget library's JSX primitives and its tree builder, without its
// native entry point (which pulls in React Native). check-widget-render.mjs
// aliases 'react-native-android-widget' to this file; the paths are static so
// esbuild bundles them.
module.exports = {
  FlexWidget: require('../../apps/mobile/node_modules/react-native-android-widget/lib/commonjs/widgets/FlexWidget.js').FlexWidget,
  TextWidget: require('../../apps/mobile/node_modules/react-native-android-widget/lib/commonjs/widgets/TextWidget.js').TextWidget,
  ImageWidget: require('../../apps/mobile/node_modules/react-native-android-widget/lib/commonjs/widgets/ImageWidget.js').ImageWidget,
  ListWidget: require('../../apps/mobile/node_modules/react-native-android-widget/lib/commonjs/widgets/ListWidget.js').ListWidget,
  buildWidgetTree: require('../../apps/mobile/node_modules/react-native-android-widget/lib/commonjs/api/build-widget-tree.js').buildWidgetTree,
};
