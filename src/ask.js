import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { llmService } from "./llm.js";
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal());

var messages = []
export const ask = () => {
  inquirer
    .prompt([
      {
        type: "input",
        name: "prompt",
        message: "",
      },
    ])
    .then((answers) => {
      const spinner = ora(`...`).start();
      llmService(answers.prompt, messages).then(({result, error, history}) => {
        if(error){
          spinner.fail(chalk.red(error?.message || "Error happened"));
        }else{
          messages = history;
          spinner.succeed("Buddy's response:");
          console.log(marked.parse(result.content))
          spinner.stop();
          //spinner.succeed(console.log(marked.parse(result.content)));
        }
        ask()
      }); 
    });
};