// Expo's default preset plus one plugin — see babel/inlineDynamicImports.js
// for why the native app turns import() into require().
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['./babel/inlineDynamicImports'],
  };
};
