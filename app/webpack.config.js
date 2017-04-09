var webpack = require("webpack");
module.exports={
  entry:'./renderer.js',
  target: 'electron',
  output:{
    filename:'./renderer-bundle.js'
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
