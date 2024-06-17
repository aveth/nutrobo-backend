const { default: OpenAI } = require('openai');
const client = new OpenAI();
const fbAdmin = require('firebase-admin');
const foodService = require('../services/food');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = {
    create: function() {
        return async (req, res) => {
            const threadId = (await client.beta.threads.create()).id;

            if (res.locals.uid) {
                const docRef = fbAdmin.firestore().collection('users').doc(res.locals.uid);
                const data = (await docRef.get()).data();
                const threads = [threadId];
                if (data.threads) {
                    threads.push(...data.threads);
                }
                await docRef.set({
                    threads: threads
                });
            }
        
            await client.beta.threads.messages.create(
                threadId,
                {
                    role: 'assistant',
                    content: 'How may I help you today?'
                }
            );
        
            await _getResponse(threadId, res, 201);
        }
    },

    get: function() {
        return async (req, res) => {
            const params = req.params;
            if (!await _validateThread(params.threadId, res)) return;
        
            await client.beta.threads.messages.list(
                params.threadId
            );
        
            await _getResponse(params.threadId, res, 200);
        }
    },

    sendMessage: function() {
        return async (req, res) => {
            const body = req.body;
            const params = req.params;
            if (!await _validateThread(params.threadId, res)) return;
            
            await _runThread({
                threadId: params.threadId, 
                res: res,
                content: body.content, 
                data: body.data
            });
        }
    },

    sendBarcode: function() {
        return async (req, res) => {
            const { body, params } = req;

            if (!await _validateThread(params.threadId, res)) return;

            const barcode = body.content;
        
            var food = await foodService.getByBarcode(barcode);
            if (!food) {
                res.status(404).json({
                    code: 404,
                    message: 'Barcode not found'
                });
                return;
            } 
            
            const content = await _getFoodMessage(food);
        
            await _runThread({
                threadId: params.threadId, 
                res: res, 
                content: content,
                data: body.data, 
                isAssistant: food != null
            });
        }
    },

    sendNutritionInfo: function() {
        return async (req, res) => {
            const { body, params } = req;
            
            _validateThread(params.threadId, res);

            const info = body.content;
            
            await _runThread({
                threadId: params.threadId, 
                res: res, 
                content: _getNutritionInfoMessage(info),
                data: body.data
            });
        }
    }
    
}


async function _getFoodMessage(food) {
    var content = 'Calculating insulin dose for:';
    content += `\nFood name: ${food.brandName} ${food.foodName}`;
    content += `\nServing size: ${food.servingSize.value} ${food.servingSize.unit}`;
    content += `\nNutrition info:`;
    content += `\n - Carbohydrate: ${food.nutrients.carbohydrate.value}${food.nutrients.carbohydrate.unit}`;
    content += `\n - Fiber: ${food.nutrients.fiber.value}${food.nutrients.fiber.unit}`;
    content += `\n - Protein: ${food.nutrients.protein.value}${food.nutrients.protein.unit}`;
    
    return content;
}

function _getNutritionInfoMessage(info) {
    var content = 'Calculating insulin dose for:';
    console.log(info);

    var servingMatch = info.match(/(Per \d .* \(\d+ g\))/);
    var carbMatch = info.match(/(Carbohydrate\s*?\/\s*?Glucides\s*?\d+\s*?[g|9])/);
    var fiberMatch = info.match(/(Fibre\s*?\/\s*?Fibres\s*?\d+\s*?[g|9])/);
    var proteinMatch = info.match(/(Protein\s*?\/\s*?Protéines\s*?\d+[s*?g|9])/);
    
    if (servingMatch) content += `\nServing size: ${servingMatch[0]}`;
    if (carbMatch) content += `\n - ${carbMatch[0]}`;
    if (fiberMatch) content += `\n - ${fiberMatch[0]}`;
    if (proteinMatch) content += `\n - ${proteinMatch[0]}`;
    
    return content;
}

async function _cancelRuns(threadId) {
    var runs = await client.beta.threads.runs.list(threadId);
    for (const run of runs.data) {
        if (run.status == 'requires_action') {
            await client.beta.threads.runs.cancel(
                threadId,
                run.id
            );
        }
    }
}

async function _runThread(options) {
    var threadId = options.threadId;
    var content = options.content;
    var data = options.data;
    var isAssistant = options.isAssistant ?? false;
    var res = options.res;

    if (!content) {
        res.status(400).json({
            code: 400,
            error: "Required `content` parameter is missing."
        });
        return;
    }   

    await _cancelRuns(threadId);

    console.log(`Creating message ${content}`);

    await client.beta.threads.messages.create(
        threadId,
        {
            role: isAssistant ? 'assistant' : 'user',
            content: content
        }
    );

    console.log(`Running thread ${threadId} with data ${data}`);
    

    var run = await client.beta.threads.runs.create(
        threadId,
        { 
            assistant_id: process.env['NUTROBO_ASST_ID'],
            additional_instructions: data ? data.join(' ') : ''
        }
    );

    var done = false;
    while (!done) {
        await delay(1000);
        run = await client.beta.threads.runs.retrieve(
            threadId,
            run.id
        );
        console.log(`Thread status ${run.status} for thread ${threadId}`)
        switch (run.status) {
            case 'completed':
                done = true;
                break;
            case 'requires_action':
                var tool = run.required_action.submit_tool_outputs.tool_calls[0];
                var args = JSON.parse(tool.function.arguments);
                switch (tool.function.name) {
                    case 'getNutrientData':
                        //await _addNutrientData(threadId, run.id, args, tool);
                        break;
                        
                }
                break;
        }
    }

    await _getResponse(threadId, res, 201);
}

async function _getResponse(threadId, res, status) {
    var messages = await client.beta.threads.messages.list(threadId)
    var thread = await client.beta.threads.retrieve(threadId)
    
    var mapped = messages.body.data.map(function (m) { 
        return {
            id: m.id,
            content: m.content.length > 0 ? m.content[0].text.value : '',
            createdAt: m.created_at,
            sentBy: m.role
        }
    });

    var response = {
        id: threadId,
        createdAt: thread.created_at,
        messages: mapped
    }

    if (res && status) {
        res.status(status).json(response)
    }    

    return response;
}

async function _validateThread(threadId, res) {
    if (!threadId || !res.locals.uid) {
        res.status(401).json({
            code: 400,
            error: "Unable to get thread ID or user ID"
        }); 
        return false;
    } else {
        const id = res.locals.uid;
        const doc = await fbAdmin.firestore().collection('users').doc(id).get();
        const found = doc.data().threads.find((thread) => thread == threadId);
        if (doc.exists && !found) {
            res.status(401).json({
                code: 401,
                error: "The provided threadId does not belong to this user"
            });
            return false;
        } else {
            return true;
        }
    }
}