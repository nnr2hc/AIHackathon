import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

var docs = "";
try {
    docs = fs.readFileSync(path.resolve(`${__dirname}/../docs/index.txt`), 'utf8');
} catch (err) {
    console.error(`Error reading documentation file: ${err.message}`);
}

async function callLLM(systemMessage, userMessage, history = []) {
    const model = process.env.MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
    const currentHistory = [...history];

    if (!currentHistory.some(msg => msg.role === 'system')) {
        currentHistory.unshift({"role": "system", "content": systemMessage});
    }

    currentHistory.push({"role": "user", "content": userMessage});

    if (currentHistory.length > 20) {
        currentHistory.splice(1, currentHistory.length - 20);
    }

    try {
        const response = await fetch(process.env.LLM_4OMINI_CHAT,
            {
                method: "POST",
                headers: {
                    "genaiplatform-farm-subscription-key": process.env.API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ model, messages: currentHistory }),
                redirect: "follow"
            }
        );

        if (response.status === 200) {
            const chat = await response.json();
            const assistantMessage = chat?.choices[0].message;
            if (assistantMessage) {
                return { result: assistantMessage, history: currentHistory };
            } else {
                return { error: { message: "LLM response was empty or malformed." } };
            }
        } else {
            const errorText = await response.text();
            console.error(`LLM API Error ${response.status}: ${errorText}`);
            return { error: { message: `LLM API Error: ${response.statusText} - ${errorText}` } };
        }
    } catch (error) {
        console.error(`Network or parsing error during LLM call: ${error.message}`);
        return { error: { message: `Network or parsing error during LLM call: ${error.message}` } };
    }
}

/**
 * Phase 1: LLM reads R3 source code and creates a detailed S4 specification.
 * @param {string} r3SourceCode - The R3 ABAP source code.
 * @param {string} [additionalRequirement=""] - User-specified additional requirements.
 * @returns {Promise<string>} - The generated S4 specification.
 */
async function generateSpecification(r3SourceCode, additionalRequirement = "") {
    const systemMessage = `
        You are an expert SAP ABAP consultant specializing in R3 to S4 HANA conversions.
        Your task is to analyze the provided R3 ABAP source code and generate a comprehensive
        technical specification for its equivalent functionality in S4 HANA (ABAP 7.5+).
        This specification will be used to guide the code conversion and review.
        Refer to the following SAP technical knowledge for context:
        ${docs}

        The specification should include:
        1.  **Program Purpose:** A clear, concise description of what the R3 program does.
        2.  **Input/Output Parameters:** Details of all selection screen fields, import/export parameters, internal tables, and their data types.
        3.  **Core Logic/Business Rules:** Step-by-step description of the program's main functionality, including calculations, data processing, and conditional logic.
        4.  **Data Objects & Interfaces:** Identify all tables, function modules, BAPIs, classes, or other SAP objects used in R3, and propose their S4 HANA equivalents (e.g., replaced FMs, new CDS views, simplified data models).
        5.  **Performance Considerations:** Any areas in R3 code that might be inefficient in S4 or opportunities for optimization (e.g., parallel processing, better data access patterns).
        6.  **Error Handling:** How errors are currently handled and how they should be handled in S4.
        7.  **ABAP 7.5+ Specifics:** Highlight any areas where new ABAP 7.5+ syntax or features (e.g., inline declarations, new OPEN SQL, ABAP Objects, CDS views) can be leveraged for cleaner, more efficient S4 code.
        8.  **Assumptions/Notes:** Any necessary assumptions made during the analysis or important notes for the S4 developer.

        ${additionalRequirement ? `**User-specified additional requirements for this conversion:**\n${additionalRequirement}\n` : ''}
        Provide the specification in a structured, readable markdown format.
    `;
    const userMessage = `Analyze the following R3 ABAP source code and generate the S4 specification:\n\`\`\`abap\n${r3SourceCode}\n\`\`\``;

    console.log("Generating S4 Specification...");
    const { result, error } = await callLLM(systemMessage, userMessage);
    if (error) {
        throw new Error(`Failed to generate specification: ${error.message}`);
    }
    return result.content;
}

/**
 * Phase 2: LLM converts R3 code to S4 code based on the specification.
 * @param {string} r3SourceCode - The original R3 ABAP source code.
 * @param {string} s4Specification - The S4 technical specification.
 * @param {string} [additionalRequirement=""] - User-specified additional requirements.
 * @returns {Promise<string>} - The generated S4 ABAP code.
 */
async function convertCodeToS4(r3SourceCode, s4Specification, additionalRequirement = "") {
    const systemMessage = `
        You are a highly skilled SAP ABAP developer with expertise in S4 HANA and ABAP 7.5+.
        Your task is to convert the provided R3 ABAP source code into equivalent S4 HANA ABAP (ABAP 7.5+) code.
        Strictly adhere to the provided S4 technical specification.
        Refer to the following SAP technical knowledge for context:
        ${docs}

        Key considerations for conversion:
        *   Utilize modern ABAP 7.5+ syntax (e.g., inline data declarations, new \`FOR\` loops, \`VALUE\`, \`REDUCE\`, \`COND\`).
        *   Replace obsolete R3 constructs with S4 equivalents (e.g., \`OCCURS\` tables to standard tables, \`MOVE-CORRESPONDING\` to \`CORRESPONDING\` with \`BASE\`).
        *   Adopt new Open SQL syntax features where beneficial.
        *   Replace deprecated function modules or BAPIs with their S4 counterparts or equivalent class methods/CDS views.
        *   Ensure performance optimizations mentioned in the specification are considered.
        *   Maintain the core business logic and functionality as described in the specification.
        *   Add comments where necessary to explain significant changes or new logic.

        ${additionalRequirement ? `**User-specified additional requirements for this conversion:**\n${additionalRequirement}\n` : ''}
        Provide only the ABAP code, enclosed in a markdown code block (\`\`\`abap...\`\`\`). Do not include any explanations or conversational text outside the code block.
    `;
    const userMessage = `
        Here is the S4 technical specification:\n\`\`\`\n${s4Specification}\n\`\`\`

        Here is the R3 ABAP source code to convert:\n\`\`\`abap\n${r3SourceCode}\n\`\`\`

        Convert the R3 code to S4 ABAP 7.5+ based on the specification.
    `;

    console.log("Converting R3 Code to S4...");
    const { result, error } = await callLLM(systemMessage, userMessage);
    if (error) {
        throw new Error(`Failed to convert code: ${error.message}`);
    }
    const match = result.content.match(/```abap\n([\s\S]*?)\n```/);
 return match ? match[1] : result.content;
}

/**
 * Phase 3: LLM reviews the new S4 code based on the specification and provides corrections.
 * @param {string} s4GeneratedCode - The newly generated S4 ABAP code.
 * @param {string} s4Specification - The S4 technical specification.
 * @param {string} r3SourceCode - The original R3 ABAP source code (for full context during review).
 * @param {string} [additionalRequirement=""] - User-specified additional requirements.
 * @returns {Promise<{reviewReport: string, needsCorrection: boolean}>} - A review report and a flag indicating if corrections are needed.
 */
async function reviewAndCorrectCode(s4GeneratedCode, s4Specification, r3SourceCode, additionalRequirement = "") {
 const systemMessage = `
     You are a meticulous SAP ABAP Quality Assurance expert specializing in S4 HANA code reviews and R3 to S4 conversion validation.
     Your task is to rigorously review the provided S4 ABAP code against the original R3 source code and the S4 technical specification.
     Identify any logical errors, syntax issues (for ABAP 7.5+), performance bottlenecks, deviations from the specification,
     or missed opportunities for leveraging modern ABAP features.
     Refer to the following SAP technical knowledge for context:
     ${docs}

     ${additionalRequirement ? `**Consider the following user-specified requirements during your review:**\n${additionalRequirement}\n` : ''}
     Provide a detailed review report. For each identified issue, clearly state:
     *   **Issue Type:** (e.g., "Logical Error", "Syntax Error", "Performance Bottleneck", "Specification Mismatch", "Modern ABAP Opportunity")
     *   **Description:** Explain the problem concisely.
     *   **Line(s):** Indicate approximate line numbers or relevant code snippets.
     *   **Proposed Correction/Improvement:** Provide a precise suggestion for how to fix or improve the code. If it's a code change, provide the exact corrected code snippet.

     At the end of your report, include a "Summary" section indicating whether the code needs further correction ("YES" or "NO") and a brief justification.
     Example format:
     ---
     ## Code Review Report
     ...
     ---
     ## Summary
     Needs Correction: YES
     Justification: ...
     ---
 `;

 const userMessage = `
     Review the following S4 ABAP code against the original R3 code and the S4 specification.

     **Original R3 ABAP Code:**
     \`\`\`abap\n${r3SourceCode}\n\`\`\`

     **Generated S4 ABAP Code (for review):**
     \`\`\`abap\n${s4GeneratedCode}\n\`\`\`

     **S4 Technical Specification:**
     \`\`\`\n${s4Specification}\n\`\`\`

     Provide a detailed code review report as per your instructions.
 `;

 console.log("Reviewing S4 Code...");
 const { result, error } = await callLLM(systemMessage, userMessage);
 if (error) {
     throw new Error(`Failed to review code: ${error.message}`);
 }

 const reviewReport = result.content;
 const needsCorrectionMatch = reviewReport.match(/Needs Correction:\s*(YES|NO)/i);
 const needsCorrection = needsCorrectionMatch && needsCorrectionMatch[1].toUpperCase() === 'YES';

 return { reviewReport, needsCorrection };
}


/**
 * Orchestrates the R3 to S4 code conversion workflow using LLMs.
 * @param {string} r3SourceCode - The R3 ABAP source code to be converted.
 * @param {string} [additionalRequirement=""] - User-specified additional requirements for the conversion.
 * @param {Array<Object>} history - An array to maintain the overall conversation history (optional).
 * @returns {Promise<Object>} - An object containing the final S4 code, review report, and history.
 */
export async function llmService(r3SourceCode, additionalRequirement = "", history = []) { // Changed signature
 let currentHistory = [...history];

 try {
     currentHistory.push({"role": "user", "content": `Please start the R3 to S4 conversion process for the following R3 code:\n\`\`\`abap\n${r3SourceCode}\n\`\`\`\nAdditional requirements: ${additionalRequirement}`});

     // Phase 1: Generate Specification
     const specification = await generateSpecification(r3SourceCode, additionalRequirement); // Pass additionalRequirement
     currentHistory.push({"role": "assistant", "content": `**Generated S4 Specification:**\n${specification}`});
     console.log("Specification Generated successfully.");

     // Phase 2: Convert Code
     let s4Code = await convertCodeToS4(r3SourceCode, specification, additionalRequirement); // Pass additionalRequirement
     currentHistory.push({"role": "assistant", "content": `**Initial S4 Code Conversion:**\n\`\`\`abap\n${s4Code}\n\`\`\``});
     console.log("Initial S4 Code Converted successfully.");

     // Phase 3: Review and Correct (Iterative)
     let reviewIteration = 0;
     const MAX_REVIEW_ITERATIONS = 3;

     while (reviewIteration < MAX_REVIEW_ITERATIONS) {
         console.log(`Starting Code Review Iteration ${reviewIteration + 1}...`);
         const { reviewReport, needsCorrection } = await reviewAndCorrectCode(s4Code, specification, r3SourceCode, additionalRequirement); // Pass additionalRequirement
         currentHistory.push({"role": "assistant", "content": `**Code Review Report (Iteration ${reviewIteration + 1}):**\n${reviewReport}`});
         console.log(`Review Iteration ${reviewIteration + 1} complete. Needs Correction: ${needsCorrection}`);

         if (!needsCorrection) {
             console.log("Code approved by reviewer. Exiting review loop.");
             return {
                 result: {
                     finalS4Code: s4Code,
                     finalReviewReport: reviewReport,
                     specification: specification
                 },
                 history: currentHistory
             };
         } else {
             console.log("Corrections needed. Applying corrections...");
             const correctionSystemMessage = `
                 You are an expert SAP ABAP developer specifically tasked with correcting S4 HANA ABAP (ABAP 7.5+) code based on a provided review report.
                 You will receive the current S4 code, the original R3 code, the S4 specification, and a detailed review report.
                 Your goal is to apply the corrections and improvements suggested in the review report to the S4 code.
                 Maintain the core business logic and ensure the code now fully adheres to the S4 specification and ABAP 7.5+ best practices.
                 Refer to the following SAP technical knowledge for context:
                 ${docs}

                 ${additionalRequirement ? `**Also ensure the corrected code adheres to the following user-specified requirements:**\n${additionalRequirement}\n` : ''}
                 Provide only the corrected ABAP code, enclosed in a markdown code block (\`\`\`abap...\`\`\`). Do not include any explanations or conversational text outside the code block.
             `;
             const correctionUserMessage = `
                 Please apply the corrections from the following review report to the S4 code.

                 **Original R3 ABAP Code:**
                 \`\`\`abap\n${r3SourceCode}\n\`\`\`

                 **S4 Technical Specification:**
                 \`\`\`\n${specification}\n\`\`\`

                 **Current S4 ABAP Code (needs correction):**
                 \`\`\`abap\n${s4Code}\n\`\`\`

                 **Code Review Report (detailing necessary corrections):**
                 \`\`\`\n${reviewReport}\n\`\`\`

                 Provide the corrected S4 ABAP code.
             `;

             const { result: correctedResult, error: correctionError } = await callLLM(correctionSystemMessage, correctionUserMessage);
             if (correctionError) {
                 throw new Error(`Failed to apply corrections in iteration ${reviewIteration + 1}: ${correctionError.message}`);
             }
                const correctedCodeMatch = correctedResult.content.match(/```abap\n([\s\S]*?)\n```/);
                s4Code = correctedCodeMatch ? correctedCodeMatch[1] : correctedResult.content;
                currentHistory.push({"role": "assistant", "content": `**Corrected S4 Code (Iteration ${reviewIteration + 1}):**\n\`\`\`abap\n${s4Code}\n\`\`\``});

                reviewIteration++;
            }
        }

        console.warn(`Max review iterations (${MAX_REVIEW_ITERATIONS}) reached. Code may still require manual review.`);
        const finalReviewResult = await reviewAndCorrectCode(s4Code, specification, r3SourceCode, additionalRequirement); // Pass additionalRequirement
        currentHistory.push({"role": "assistant", "content": `**Final Review Report after ${MAX_REVIEW_ITERATIONS} iterations:**\n${finalReviewResult.reviewReport}`});
        return {
            result: {
                finalS4Code: s4Code,
                finalReviewReport: finalReviewResult.reviewReport,
                specification: specification,
                warning: `Max review iterations (${MAX_REVIEW_ITERATIONS}) reached. Manual review recommended.`
            },
            history: currentHistory
        };

    } catch (error) {
        console.error(`Error in R3 to S4 conversion workflow: ${error.message}`);
        currentHistory.push({"role": "assistant", "content": `Error during conversion: ${error.message}`});
        return { error: { message: `R3 to S4 conversion workflow failed: ${error.message}` }, history: currentHistory };
    }
}
