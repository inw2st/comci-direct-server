const { getApp } = require("../app");

module.exports = async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
};
