// Same as replaceloader.cjs but resolves files relative to the example
// directory rather than the working directory. Used during webpack bundling.
module.exports = require("path").resolve(__dirname, "dist/lib/generateResponse.js");