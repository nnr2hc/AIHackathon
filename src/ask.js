import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { llmService } from "./llm.js"; // Your LLM service
import { Marked, marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import path from 'node:path';
import fs from 'node:fs/promises'; // Use promises-based fs for async operations
import stripAnsi from 'strip-ansi'; // Make sure this import is correct

marked.use(markedTerminal());
/**
 * Basic HTML template for the combined report.
 * @param {string} title - The title for the HTML page.
 * @param {string} bodyContent - The HTML content generated from markdown.
 * @returns {string} The complete HTML string.
 */
function createHtmlReport(title, bodyContent) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; margin: 20px; background-color: #f4f4f4; color: #333; }
        .container { max-width: 1000px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        h1, h2, h3, h4, h5, h6 { color: #0056b3; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 20px; }
        pre { background-color: #eee; padding: 10px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
        code { font-family: monospace; background-color: #e0e0e0; padding: 2px 4px; border-radius: 3px; }
        blockquote { border-left: 4px solid #ccc; padding-left: 10px; color: #666; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${title}</h1>
        ${bodyContent}
    </div>
</body>
</html>`;
}
/**
 * Prompts the user for the R3 source code folder path.
 * @returns {Promise<string>} The absolute path to the R3 source code folder.
 */
async function promptR3FolderPath() {
    const answers = await inquirer.prompt([
        {
            type: "input",
            name: "r3FolderPath",
            message: chalk.blue("Enter the absolute path to the R3 source code folder:"),
            validate: async (input) => {
                try {
                    const stats = await fs.stat(input);
                    if (stats.isDirectory()) {
                        return true;
                    }
                    return "Path is not a directory. Please enter a valid folder path.";
                } catch (error) {
                    return `Invalid path or directory not found: ${error.message}`;
                }
            }
        },
        {
            type: "input",
            name: "outputFolderPath",
            message: chalk.blue("Enter the absolute path for the S4 converted code output folder (will be created if it doesn't exist):"),
            default: (answers) => path.join(answers.r3FolderPath, 's4_converted_code') // Default to a subfolder
        },
        {
            type: "input",
            name: "additionalRequirements",
            message: chalk.blue("Enter any specific requirements for the S4 conversion. Leave blank if none:"),
            default: ""
        }
    ]);
    return { 
      r3FolderPath: path.resolve(answers.r3FolderPath), 
      outputFolderPath: path.resolve(answers.outputFolderPath),
      additionalRequirements: answers.additionalRequirements.trim() };
}
/**
 * Main function to orchestrate the R3 to S4 conversion process.
 */
export async function ask() {
    console.log(chalk.green("\n--- R3 to S4 ABAP Code Converter ---"));
    console.log(chalk.yellow("This tool will convert ABAP files from a specified R3 folder to S4 ABAP 7.5+.\n"));

    const { r3FolderPath, outputFolderPath, additionalRequirements } = await promptR3FolderPath();

    let spinner = ora(`Reading files from ${chalk.cyan(r3FolderPath)}`).start();

    try {
        await fs.mkdir(outputFolderPath, { recursive: true }); // Ensure output folder exists
        spinner.succeed(chalk.green(`Output folder created/ensured: ${chalk.cyan(outputFolderPath)}`));

        const files = await fs.readdir(r3FolderPath);
        const abapFiles = files.filter(file => file.endsWith('.abap') || file.endsWith('.txt') || file.endsWith('.prog') || file.endsWith('.incl')); // Filter for common ABAP extensions

        if (abapFiles.length === 0) {
            spinner.info(chalk.yellow(`No ABAP source code files found in ${r3FolderPath}. Looking for .abap, .txt, .prog, .incl extensions.`));
            return;
        }

        console.log(chalk.blue(`Found ${abapFiles.length} ABAP file(s) for conversion.`));

        for (const file of abapFiles) {
            const fullPath = path.join(r3FolderPath, file);
            let fileSpinner = ora(`Processing ${chalk.magenta(file)}`).start();

            try {
                const r3SourceCode = await fs.readFile(fullPath, 'utf8');
                fileSpinner.text = `Converting ${chalk.magenta(file)} to S4...`;

                // Initialize history for each file conversion to keep it focused
                // For a true "agentic" workflow with history, you might pass an empty array initially
                // and let llmService manage its internal history.
                // Or, if you want LLM to learn across files, you could pass a cumulative history,
                // but that's more complex and requires careful prompt engineering.
                const llmResponse = await llmService(r3SourceCode,additionalRequirements, []);

                if (llmResponse.error) {
                    fileSpinner.fail(chalk.red(`Failed to convert ${file}: ${llmResponse.error.message}`));
                    console.error(llmResponse.error); // Log full error details
                    continue; // Move to the next file
                }

                const { finalS4Code, finalReviewReport, specification, warning } = llmResponse.result;
                const outputFileName = `${path.basename(file, path.extname(file))}_S4${path.extname(file)}`;
                const outputFilePath = path.join(outputFolderPath, outputFileName);
                const specFileName = `${path.basename(file, path.extname(file))}_S4_Spec.md`;
                const specFilePath = path.join(outputFolderPath, specFileName);
                const reviewReportFileName = `${path.basename(file, path.extname(file))}_S4_Review.md`;
                const reviewReportFilePath = path.join(outputFolderPath, reviewReportFileName);


                await fs.writeFile(outputFilePath, finalS4Code, 'utf8');
                await fs.writeFile(specFilePath, specification, 'utf8');
                await fs.writeFile(reviewReportFilePath, finalReviewReport, 'utf8');

                fileSpinner.succeed(chalk.green(`Converted ${file} and saved to ${chalk.cyan(outputFilePath)}`));
                if (warning) {
                    console.warn(chalk.yellow(`  Warning for ${file}: ${warning}`));
                }
                // Optional: Print parsed review report or final code snippet for immediate feedback
                // console.log(chalk.gray("\n--- S4 Code Snippet ---"));
                // console.log(marked.parse(`\`\`\`abap\n${finalS4Code.substring(0, 500)}...\n\`\`\``)); // Show first 500 chars
                // console.log(chalk.gray("--- End Snippet ---\n"));
                // --- New HTML Report Generation ---
                const baseFileName = path.basename(file, path.extname(file));
                const combinedReportFileName = `${baseFileName}_S4_Report.html`;
                const combinedReportFilePath = path.join(outputFolderPath, combinedReportFileName);

                const combinedMarkdown = `

## Original R3 Source Code
\`\`\`abap
${stripAnsi(r3SourceCode)}
\`\`\`

---

## S4 Technical Specification
${stripAnsi(specification)}

---

## Generated S4 ABAP Code
\`\`\`abap
${stripAnsi(finalS4Code)}
\`\`\`

---

## S4 Code Review Report
${stripAnsi(finalReviewReport)}

---

**Generated on:** ${new Date().toLocaleString()}
${additionalRequirements ? `**Additional Requirements Applied:**\n\`\`\`\n${stripAnsi(additionalRequirements)}\n\`\`\`` : ''}
                `;
                const localMarked = new Marked();
                const htmlContent = localMarked.parse(combinedMarkdown);
                const fullHtml = createHtmlReport(`S4 Conversion Report for ${baseFileName}`, htmlContent);

                await fs.writeFile(combinedReportFilePath, fullHtml, 'utf8');
                // --- End New HTML Report Generation ---

                // Still save the converted code as a separate .abap file
                const reportFileName = `${baseFileName}_S4${path.extname(file)}`;
                const reportFilePath = path.join(outputFolderPath, reportFileName);
                await fs.writeFile(reportFilePath, finalS4Code, 'utf8');


                fileSpinner.succeed(chalk.green(`Converted ${file} and saved report to ${chalk.cyan(combinedReportFilePath)}`));
                if (warning) {
                    console.warn(chalk.yellow(`  Warning for ${file}: ${warning}`));
                }

            } catch (error) {
                fileSpinner.fail(chalk.red(`Error processing ${file}: ${error.message}`));
                console.error(error); // Log detailed error
            }
        }
        console.log(chalk.green("\n--- All selected files processed! ---"));
        console.log(chalk.green(`Converted S4 code and reports are saved in: ${chalk.cyan(outputFolderPath)}`));

    } catch (error) {
        spinner.fail(chalk.red(`An error occurred during file operations: ${error.message}`));
        console.error(error); // Log detailed error
    } finally {
        if (spinner.isSpinning) { // Ensure spinner is stopped even on unhandled errors
            spinner.stop();
        }
    }
}
