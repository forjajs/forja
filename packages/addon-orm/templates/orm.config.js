/**
 * Per-environment storage config for @forjajs/orm. Selected via NODE_ENV
 * (defaults to "development"). Keeps dev/test/prod data files completely
 * separate — running tests (TI) can never corrupt dev or prod data.
 */
module.exports = {
  development: {
    path: "data/dev",
  },
  test: {
    path: "data/test",
  },
  production: {
    path: "data/prod",
  },
};
