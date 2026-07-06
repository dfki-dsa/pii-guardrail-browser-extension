const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const sveltePreprocess = require('svelte-preprocess');
const {
  LocalNerAssetsPlugin,
  getNerAssetCopyPatterns,
} = require('./scripts/extension-packaging');
const { renderTermsHtml } = require('./scripts/terms-html');

class TermsHtmlPlugin {
  constructor(options = {}) {
    this.rootDir = options.rootDir || __dirname;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('TermsHtmlPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'TermsHtmlPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          const sourcePath = path.join(this.rootDir, 'TERMS.md');
          const markdown = compiler.inputFileSystem.readFileSync(sourcePath, 'utf8');
          const html = renderTermsHtml(markdown);
          compilation.emitAsset('TERMS.html', new compiler.webpack.sources.RawSource(html));
          compilation.fileDependencies.add(sourcePath);
        }
      );
    });
  }
}

module.exports = (_env = {}) => {
  const requirePreparedModel =
    process.env.NER_MODEL_ASSETS_REQUIRED === '1' || _env.requireNerModelAssets === true;

  return {
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'content/content-script': './src/content/content-script.ts',
      'content/clipboard-interceptor-page': './src/content/clipboard-interceptor-page.ts',
      'offscreen/offscreen': './src/offscreen/offscreen.ts',
      'system-check/system-check-offscreen': './src/system-check/system-check-offscreen.ts',
      'popup/popup': './src/popup/popup.ts',
      'options/options': './src/options/options.ts',
    },

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
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

      new TermsHtmlPlugin({ rootDir: __dirname }),

      // Copy static files to dist/
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: '.' },
          { from: 'LICENSE', to: '.' },
          { from: 'NOTICE', to: '.' },
          { from: 'TERMS.md', to: '.' },
          { from: 'THIRD_PARTY_NOTICES.md', to: '.' },
          { from: 'docs/assets/logo-privacy-guardrail-black.png', to: 'legal/logo-privacy-guardrail-black.png' },
          { from: 'src/assets', to: 'assets', globOptions: { ignore: ['**/.DS_Store'] } },
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

      // Offscreen HTML
      new HtmlWebpackPlugin({
        template: 'src/offscreen/offscreen.html',
        filename: 'offscreen/offscreen.html',
        chunks: ['offscreen/offscreen'],
      }),

      // Lightweight passive system-check offscreen HTML
      new HtmlWebpackPlugin({
        template: 'src/system-check/system-check-offscreen.html',
        filename: 'system-check/system-check-offscreen.html',
        chunks: ['system-check/system-check-offscreen'],
      }),
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
