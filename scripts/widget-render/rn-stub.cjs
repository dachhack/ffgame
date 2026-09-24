// ImageWidget.js reaches for React Native only to resolve a bundled asset
// number; the widgets pass URLs, so a stub answers.
module.exports = { Image: { resolveAssetSource: (x) => ({ uri: String(x) }) }, Platform: { OS: 'android' } };
