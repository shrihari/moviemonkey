var webpack = require("webpack");
module.exports={
  entry:{
    renderer: './renderer.js',
    unidentified: './unidentified.js',
    main: './main.js'
  },
  target: 'electron',
  output:{
    filename:'./[name]-bundle.js'
  },
  module: {
    loaders: [
      {
        test: /\.(js)$/,
        exclude: /(node_modules|bower_components)/,
        loader: 'babel',
        query:{
          presets:['react','es2015']
        }
      },
      { test: /\.json$/, loader: "json-loader" }
    ]
  },
  plugins: [new webpack.ContextReplacementPlugin(/formidable/, /^$/)]
}
