import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename)

var docs = ""
try {
    docs = fs.readFileSync(path.resolve(`${__dirname}/../docs/index.txt`));
} catch (err) {
    console.error(err);
}

export async function llmService(query, history) {
    try{
        const systemMsg = `
            You are a SAP technical expert. Here are some technical knowledge where you refer:
            ${docs}.
        `;
        const model = process.env.MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
        if(history.length === 0){
            history = [
                {"role": "system", "content": systemMsg},
                {"role": "user", "content":  query }
            ] 
        } else {
            if(history.length > 10){
                history.splice(1, history.length - 10)
            }
            history.push({"role": "user", "content":  query })
        }
        const response = await fetch(process.env.LLM_4OMINI_CHAT,
            {  
                method: "POST",
                headers: {
                    "genaiplatform-farm-subscription-key": process.env.API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({model, messages: history}),
                redirect: "follow"
            }
        )
        if(response.status === 200){
            const chat = await response.json();
            history.push(chat?.choices[0].message);
            return{result: chat?.choices[0].message, history};
        } else{
            console.log(await response.text())
            return {error: {
                message: response.statusText
            }}
        }
    } catch(error){
        return {error}
    }
}