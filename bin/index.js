#!/usr/bin/env NODE_OPTIONS=--no-warnings node

import inquirer from "inquirer";
import { ask } from "../src/ask.js";
import { init } from "../src/init.js";
import figlet from "figlet";
import chalk from "chalk";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import dotenv from 'dotenv'
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename)


dotenv.config({path: `${__dirname}/../.env`})

process.env.NODE_NO_WARNINGS = 1
if (process.env.PROX) {
    // Corporate proxy uses CA not in undici's certificate store
    //process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const dispatcher = new ProxyAgent({
        uri: new URL(process.env.PROX).toString() ,
        token: `Basic ${Buffer.from(`${process.env.AGENT_USER}:${process.env.AGENT_PWD}`).toString('base64')}`
    });
    setGlobalDispatcher(dispatcher);
}
const examples = {
  "ask": ask,
  "ingest knowledge": init,
};
console.log(
  chalk.yellow(figlet.textSync("ABAP Refactor", { horizontalLayout: "full" }))
);
let stdin = process.stdin;
stdin.on("data", (key) => {
    if (key == "\u0003") {
        console.log(chalk.green("Bye!"));
        process.exit();
    }
});
inquirer
  .prompt([
    {
      type: "list",
      name: "selectedFunction",
      message: "Choose a menu",
      choices: Object.keys(examples),
    },
  ])
  .then((answers) => {
    const fx = examples[answers.selectedFunction];
    if (fx) {
      fx();
    } else {
      console.error("Invalid selection");
    }
  });