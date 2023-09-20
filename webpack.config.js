module.exports = {
  entry: './src/KhanPJS.js',
  mode: "production",
  output: {
    filename: './build/KhanPJS.min.js',
    path: __dirname,
  },
  optimization: {
    usedExports: true,
  },
};