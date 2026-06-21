const { handleRequest } = require('../src/index');

module.exports = async function addonHandler(req, res) {
  return handleRequest(req, res);
};
