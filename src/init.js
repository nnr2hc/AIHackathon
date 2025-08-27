import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { llmService } from "./llm.js";
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename)

marked.use(markedTerminal());


function splitTextIntoChunks(text, chunkSize = 512){
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}
async function getVector(text) {
  const response = await fetch('https://ews-emea.api.bosch.com/knowledge/insight-and-analytics/llms/d/v/embeddings',
    {  
      method: "POST",
      headers: {
          "api-key": process.env.API_KEY,
          "Content-Type": "application/json"
      },
      body: JSON.stringify({model: process.env.EMBED, input: text})
    }
  )
  const result = await response.json();
  return result.data?.data[0]?.embedding;
}

export const init = async () => {

  inquirer
    .prompt([
      {
        type: "input",
        name: "prompt",
        message: "Input knowledge file path",
      },
    ])
    .then( (answers) => {
      const spinner = ora(`...`).start();
      try {
        let docs = ""
        docs = fs.readFileSync(path.resolve(answers.prompt), { encoding: 'utf8', flag: 'r' });
        const chunks = splitTextIntoChunks(docs);
        chunks.forEach(async (chunk, index) => {
          const vector = await getVector(chunk);
          if(vector){
            // TODO
            spinner.succeed(chalk.green(`Indexed chunk ${index}!`));
          } else {
            spinner.fail(chalk.red(`Cannot ingest!`));
          }
        })
      } catch (err) {
          spinner.fail(chalk.red(`${JSON.stringify(err)}!`));
      }
    });
};