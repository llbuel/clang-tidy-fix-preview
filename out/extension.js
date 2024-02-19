"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const childProcess = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
function activate(context) {
    let disposable = vscode.commands.registerCommand('clang-tidy-fix-preview.previewFixes', async () => {
        // Get the path of the currently active file
        let activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        // Get the active editor window
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            // Get the active file
            let activeFile = activeEditor.document.fileName;
            // Check that the file is supported by clang-tidy checking
            if (!checkFileType(path.parse(activeFile).ext)) {
                throw new Error('This file type is not supported by clang-tidy.');
            }
            // Parse the file and get just the filename and extension
            let activeFileNameWithoutExtension = path.parse(activeFile).name;
            let activeFileExt = path.parse(activeFile).ext;
            let fullFilename = activeFileNameWithoutExtension + activeFileExt;
            if (activeFilePath && activeFileNameWithoutExtension) {
                // Run clang-tidy on the active file and capture the YAML output
                let clangTidyOutFile = 'clang-tidy-' + activeFileNameWithoutExtension + '-fixesapplied';
                // Make sure clang-tidy is installed
                childProcess.exec('clang-tidy --version', (error, stdout, stderr) => {
                    if (error) {
                        throw new Error('clang-tidy is not installed.');
                    }
                });
                childProcess.execSync(`clang-tidy --export-fixes=${clangTidyOutFile} ${activeFilePath} --`);
                let clangTidyYAMLOutput = fs.readFileSync(clangTidyOutFile, 'utf8');
                // Parse the YAML output to get the suggested fixes
                let suggestedFixes = parseYAMLOutput(clangTidyYAMLOutput);
                // Read the original code file
                let originalCode = fs.readFileSync(activeFile, 'utf8');
                // Apply the suggested fixes to the original code to generate the fixed code
                let fixedCode = applyFixes(originalCode, suggestedFixes, fullFilename);
                // Open the fixed code file in a new split editor
                vscode.workspace.openTextDocument({ content: fixedCode, language: 'cpp' }).then(doc => { vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside); });
            }
        }
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
function checkFileType(fileExtension) {
    if (!['.c', '.cpp', '.cc', '.cxx', '.m', '.mm'].includes(fileExtension)) {
        return false;
    }
    else {
        return true;
    }
}
function parseYAMLOutput(clangTidyYAML) {
    // Load in the YAML clang-tidy output
    const data = yaml.load(clangTidyYAML);
    const parsedOutput = [];
    // Iterate over the diagnostics
    for (const diagnostic of data.Diagnostics) {
        // Extract the required fields
        const clangTidyCheck = diagnostic.DiagnosticName;
        const message = diagnostic.DiagnosticMessage.Message;
        const fileOffset = diagnostic.DiagnosticMessage.FileOffset;
        const comment = {
            Check: clangTidyCheck,
            Message: message,
            FileOffset: fileOffset
        };
        const fixes = [];
        for (const replacement of diagnostic.DiagnosticMessage.Replacements) {
            const replacementText = replacement.ReplacementText;
            const replacementStartOffset = replacement.Offset;
            const replacementLength = replacement.Length;
            // Append the extracted values to an array
            fixes.push({
                ReplacementText: replacementText,
                Offset: replacementStartOffset,
                Length: replacementLength,
            });
        }
        parsedOutput.push({
            Comment: comment,
            Fixes: fixes
        });
    }
    return parsedOutput;
}
function applyFixes(originalCode, suggestedFixes, filename) {
    let fixedStrOut = originalCode;
    // Group the fixes by line number
    const fixesByLine = {};
    for (const fix of suggestedFixes) {
        const lineNum = originalCode.substring(0, fix.Comment.FileOffset).split('\n').length - 1;
        if (!fixesByLine[lineNum]) {
            fixesByLine[lineNum] = [];
        }
        fixesByLine[lineNum].push(fix);
    }
    const sortedLineNums = Object.keys(fixesByLine).map(Number).sort((a, b) => b - a);
    // Apply the fixes and inject the comments
    for (const lineNum of sortedLineNums) {
        const fixes = fixesByLine[lineNum];
        let comment = '';
        for (let i = 0; i < fixes.length; i++) {
            const fix = fixes[i];
            const sortedReplacements = fix.Fixes.sort((a, b) => b.Offset - a.Offset);
            for (const replacement of sortedReplacements) {
                const before = fixedStrOut.substring(0, replacement.Offset);
                const after = fixedStrOut.substring(replacement.Offset + replacement.Length);
                fixedStrOut = before + replacement.ReplacementText + after;
            }
            comment += '// clang-tidy> ' + fix.Comment.Check + ': ' + fix.Comment.Message;
            if (i < fixes.length - 1) {
                comment += '\n';
            }
        }
        if (fixes[0].Fixes.length > 0) {
            const commentPos = fixedStrOut.substring(0, fixes[0].Comment.FileOffset).lastIndexOf('\n');
            if (commentPos !== -1) {
                const lineStart = commentPos + 1;
                const match = fixedStrOut.substring(lineStart).match(/^\s*/);
                const indentation = match ? match[0] : '';
                fixedStrOut = fixedStrOut.substring(0, commentPos) + '\n' + indentation + comment + fixedStrOut.substring(commentPos);
            }
            else {
                fixedStrOut = comment + fixedStrOut;
            }
        }
    }
    const headerStr = '// Preview of fixes suggested by clang-tidy on ' + filename + '\n// The fixes applied are based on the local clang-tidy configuration\n// The fixes do not apply semantic checks, e.g. variable name checks\n';
    fixedStrOut = headerStr + fixedStrOut;
    return fixedStrOut;
}
function isOffsetInLastLineAndEqualToBrace(originalCode, offset) {
    const charAtOffset = originalCode.charAt(offset);
    const newlineAfterOffset = originalCode.indexOf('\n', offset);
    return newlineAfterOffset === -1 && charAtOffset === '}';
}
//# sourceMappingURL=extension.js.map