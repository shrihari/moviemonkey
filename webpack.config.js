var path = require("path");
var webpack = require("webpack");

module.exports=[
  // Main process
  {
    mode: 'development',
    entry: {
      main: './app/main.js'
    },
    target: 'electron-main',
    output: {
      path: path.resolve(__dirname, 'app'),
      filename: '[name]-bundle.js'
    },
    module: {
      rules: [
        {
          test: /\.(js)$/,
          exclude: /node_modules/,
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      ]
    }
  },
  // Renderer processes
  {
    mode: 'development',
    entry: {
      renderer: './app/renderer.js',
      unidentified: './app/unidentified.js'
    },
    target: 'electron-renderer',
    output: {
      path: path.resolve(__dirname, 'app'),
      filename: '[name]-bundle.js'
    },
    module: {
      rules: [
        {
          test: /\.(js)$/,
          exclude: /node_modules/,
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react', '@babel/preset-env']
          }
        }
      ]
    }
  }
];
