const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const sveltePreprocess = require('svelte-preprocess');
const {
  LocalNerAssetsPlugin,
  getNerAssetCopyPatterns,
} = require('./scripts/extension-packaging');

module.exports = (_env = {}) => {
  const requirePreparedModel =
    process.env.NER_MODEL_ASSETS_REQUIRED === '1' || _env.requireNerModelAssets === true;

  const browser = process.env.BROWSER || 'chrome';
  const isFirefox = browser === 'firefox';
  const outputDir = isFirefox ? 'dist-firefox' : 'dist';
  const manifestSource = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  const chromeOnlyEntries = {
    'offscreen/offscreen': './src/offscreen/offscreen.ts',
    'system-check/system-check-offscreen': './src/system-check/system-check-offscreen.ts',
  };

  return {
    entry: {
      ...(isFirefox
        ? { 'background/background': './src/background/background.firefox.ts' }
        : { 'background/service-worker': './src/background/service-worker.ts', ...chromeOnlyEntries }
      ),
      'content/content-script': './src/content/content-script.ts',
      'content/clipboard-interceptor-page': './src/content/clipboard-interceptor-page.ts',
      ...(isFirefox
        ? { 'content/clipboard-interceptor-injector': './src/content/clipboard-interceptor-injector.ts' }
        : {}
      ),
      'popup/popup': './src/popup/popup.ts',
      'options/options': './src/options/options.ts',
    },

    output: {
      path: path.resolve(__dirname, outputDir),
      filename: '[name].js',
      // Firefox MV2 background pages can't auto-detect the public path from
      // document.currentScript, so we pin it to the extension root explicitly.
      publicPath: isFirefox ? '/' : 'auto',
      clean: true,
    },

    resolve: {
      extensions: ['.svelte', '.ts', '.js', '.wasm'],
      conditionNames: ['svelte', 'browser', 'import', 'module', 'default'],
      mainFields: ['svelte', 'browser', 'module', 'main'],
    },

    module: {
      rules: [
        {
          test: /\.svelte$/,
          use: {
            loader: 'svelte-loader',
            options: {
              emitCss: true,
              compilerOptions: { runes: true },
              preprocess: sveltePreprocess({ typescript: true }),
            },
          },
        },
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          oneOf: [
            {
              // Overlay stylesheet is injected as a raw string into the
              // closed Shadow Root attached by the review overlay.
              include: path.resolve(__dirname, 'src/ui/overlay/overlay-styles.css'),
              use: [
                {
                  loader: 'css-loader',
                  options: { url: false, exportType: 'string' },
                },
              ],
            },
            {
              use: [MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { url: false } }],
            },
          ],
        },
      ],
    },

    plugins: [
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),

      new LocalNerAssetsPlugin({
        rootDir: __dirname,
        requirePreparedModel,
      }),

      // Copy static files to dist/
      new CopyPlugin({
        patterns: [
          { from: manifestSource, to: 'manifest.json' },
          { from: 'src/assets', to: 'assets' },
          { from: 'src/assets/fonts', to: 'fonts' },
          { from: 'src/ui/banner/de-anon-banner.css', to: 'ui/banner/' },
          // Copy the generated wasm-bindgen binary asset for runtime loading.
          {
            from: 'crate/pkg/privacy_guardrail_wasm_bg.wasm',
            to: 'wasm/[name][ext]',
            noErrorOnMissing: true,
          },
          ...getNerAssetCopyPatterns(__dirname),
        ],
      }),

      // Popup HTML
      new HtmlWebpackPlugin({
        template: 'src/popup/popup.html',
        filename: 'popup/popup.html',
        chunks: ['popup/popup'],
      }),

      // Options page HTML
      new HtmlWebpackPlugin({
        template: 'src/options/options.html',
        filename: 'options/options.html',
        chunks: ['options/options'],
      }),

      // Offscreen HTML — Chrome only (Firefox has no offscreen API)
      ...(!isFirefox ? [
        new HtmlWebpackPlugin({
          template: 'src/offscreen/offscreen.html',
          filename: 'offscreen/offscreen.html',
          chunks: ['offscreen/offscreen'],
        }),
        new HtmlWebpackPlugin({
          template: 'src/system-check/system-check-offscreen.html',
          filename: 'system-check/system-check-offscreen.html',
          chunks: ['system-check/system-check-offscreen'],
        }),
      ] : []),
    ],

    // Chrome extensions require specific settings
    optimization: {
      splitChunks: false, // Don't split — each entry must be self-contained
    },

    devtool: 'cheap-module-source-map',

    experiments: {
      asyncWebAssembly: true,
    },
  };
};
