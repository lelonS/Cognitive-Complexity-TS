import * as path from "path";
import * as process from "process";
import { ProgramOutput } from "../shared/types";
import { js_beautify } from "js-beautify";
import { getFileOrFolderOutput } from "./cognitive-complexity/file-or-folder-output";

main();

async function main() {
    const args = process.argv.slice(2);

    try {
        var filePath = args[0][0] === "/"
            ? args[0]
            : process.cwd() + "/" + args[0];

    } catch (ignore) {
        throw new Error("Usage: arg1: target file path");
    }

    await printCognitiveComplexityJson(filePath);
}

async function printCognitiveComplexityJson(fullPath: string) {
    const cwd = process.cwd();

    const filePath = path.relative(cwd, fullPath);
    const fileName = path.parse(fullPath).base;

    const resultForAllFiles: ProgramOutput = {
        [fileName]: await getFileOrFolderOutput(filePath)
    };

    const outputStructure = JSON.stringify(resultForAllFiles, (key, value) => {
        // don't show empty inner
        if (key === "inner" && value.length === 0) {
            return undefined;
        }

        return value;
    });
    console.log(js_beautify(outputStructure));
}
