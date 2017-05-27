var webpack = require("webpack");
module.exports={
  entry:{
    renderer: './app/renderer.js',
    unidentified: './app/unidentified.js',
    main: './app/main.js'
  },
  target: 'electron',
  output:{
    filename:'./app/[name]-bundle.js'
  },
  module: {
    loaders: [
      {
        test: /\.(js)$/,
        exclude: /node_modules/,
        loader: 'babel',
        query:{
          presets:['react','es2015']
        }
      },
      { test: /\.json$/, loader: "json-loader" }
    ]
  }
}
