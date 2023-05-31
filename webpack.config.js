import path from 'path';
import { fileURLToPath } from 'url';
import TerserPlugin from 'terser-webpack-plugin';
import JavaScriptObfuscator from 'webpack-obfuscator';
import WebpackShellPluginNext from 'webpack-shell-plugin-next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = 'dist';
const outputFile = 'deploy.cjs';
const outputPath = `${outputDir}/${outputFile}`;

export default {
  entry: './src/deploy.ts',
  devtool: 'none',
  target: 'node',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  output: {
    filename: outputFile,
    path: path.resolve(__dirname, outputDir)
  },
  optimization: {
    minimizer: [new TerserPlugin()]
  },
  plugins: [
    new JavaScriptObfuscator(),
    new WebpackShellPluginNext({
      onBuildEnd: {
        scripts: [
          `echo "#!/usr/bin/env node" | cat - ${outputPath} > temp && mv temp ${outputPath}`,
          `chmod +x ${outputPath}`
        ],
        blocking: true,
        parallel: false
      }
    })
  ]
};
