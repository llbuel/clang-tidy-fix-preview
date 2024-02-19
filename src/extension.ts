import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export function activate(context: vscode.ExtensionContext) {
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
                vscode.workspace.openTextDocument({ content: fixedCode, language: 'cpp' }).then(doc => {vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);});
            }
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

function checkFileType(fileExtension: string) {
    if (!['.c', '.cpp', '.cc', '.cxx', '.m', '.mm'].includes(fileExtension)) {
        return false;
    } else {
        return true;
    }
}

function parseYAMLOutput(clangTidyYAML: string) {
    // Define the YAML interfaces
    interface Replacements {
        FilePath: string;
        Offset: number;
        Length: number;
        ReplacementText: string;
    }
    
    interface DiagnosticMessage {
        Message: string;
        FilePath: string;
        FileOffset: number;
        Replacements: Replacements[];
    }
    
    interface Notes {
        Message: string;
        FilePath: string;
        FileOffset: number;
        Replacements: Replacements[];
    }
    
    interface Diagnostics {
        DiagnosticName: string;
        DiagnosticMessage: DiagnosticMessage;
        Notes?: Notes[];
    }

    interface ClangTidyOutput {
        MainSourceFile: string;
        Diagnostics: Diagnostics[];
    }
    
    // Load in the YAML clang-tidy output
    const data = yaml.load(clangTidyYAML) as ClangTidyOutput;
    const parsedOutput: Array<{Comment: {Check: string, Message: string, FileOffset: number}, Fixes: Array<{ReplacementText: string, Offset: number, Length: number}>}> = [];

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

function applyFixes(originalCode: string, suggestedFixes: Array<{Comment: {Check: string, Message: string, FileOffset: number}, Fixes: Array<{ReplacementText: string, Offset: number, Length: number}>}>, filename: string): string {
    let fixedStrOut = originalCode;

    // Group the fixes by line number
    const fixesByLine: { [key: number]: Array<{Comment: {Check: string, Message: string, FileOffset: number}, Fixes: Array<{ReplacementText: string, Offset: number, Length: number}>}> } = {};
    for (const fix of suggestedFixes) {
        const lineNum = originalCode.substring(0, fix.Comment.FileOffset).split('\n').length-1;
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
        for (let i=0; i < fixes.length; i++) {
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
            } else {
                fixedStrOut = comment + fixedStrOut;
            }
        }
    }

    const headerStr = '// Preview of fixes suggested by clang-tidy on ' + filename + '\n// The fixes applied are based on the local clang-tidy configuration\n// The fixes do not apply semantic checks, e.g. variable name checks\n';

    fixedStrOut = headerStr + fixedStrOut;

    return fixedStrOut;
}

function isOffsetInLastLineAndEqualToBrace(originalCode: string, offset: number): boolean {
    const charAtOffset = originalCode.charAt(offset);
    const newlineAfterOffset = originalCode.indexOf('\n', offset);

    return newlineAfterOffset === -1 && charAtOffset === '}';
}