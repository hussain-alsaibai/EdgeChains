const path = require("path");

module.exports = {
    mode: "production",
    target: "web",
    experiments: {
        outputModule: true,
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "final.js",
        module: true,
        library: { type: "module" },
    },
    resolve: {
        extensions: [".ts", ".js"],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: "ts-loader",
                options: { configFile: path.resolve(__dirname, "tsconfig.json") },
            },
        ],
    },
};