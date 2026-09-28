module.exports = function buildBabelConfig(api) {
  const isDevelopment = api.env('development');

  return {
    presets: [
      [
        'next/babel',
        {
          // Match Next 16's browser baseline rather than rewriting native Unicode regexes.
          'preset-env': {
            targets: { chrome: '111', edge: '111', firefox: '111', safari: '16.4' },
          },
          'preset-react': {
            development: isDevelopment,
          },
        },
      ],
    ],
    plugins: isDevelopment ? ['@react-dev-inspector/babel-plugin'] : [],
  };
};
