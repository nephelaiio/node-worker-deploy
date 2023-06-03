import path from 'path';
import { fileURLToPath } from 'url';
import WebpackShellPluginNext from 'webpack-shell-plugin-next';
import webpack from 'webpack';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = 'dist';
const outputFile = 'deploy.cjs';
const outputPath = `${outputDir}/${outputFile}`;
const project = JSON.parse(readFileSync(resolve('./package.json'), 'utf-8'));

export default {
  entry: './src/deploy.ts',
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
    minimizer: []
  },
  plugins: [
    new webpack.DefinePlugin({
      __VERSION__: JSON.stringify(project.version)
    }),
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
