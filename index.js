require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { default: OpenAI } = require('openai');

const client = new OpenAI();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const admin = require('firebase-admin');


const app = express();
const fbApp = admin.initializeApp({
    credential: admin.credential.cert('./.secrets/nutrobo-service-account.json')
});

app.use(bodyParser.json());
app.use(function(req, res, next) {
    res.setTimeout(30000, async function() {
        console.log('Request has timed out.');
        res.send(408);
    });

    next();
});
app.use(async function(req, res, next) {
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
        var token = req.headers.authorization.split(' ')[1];
        admin.auth()
            .verifyIdToken(token)
            .then((decodedToken) => {
                const uid = decodedToken.uid;
                console.log(decodedToken.uid);
                next();
            })
            .catch((error) => {
                console.log(error);
                res.status(401).json({
                    code: 401,
                    error: error.message,
                });
            });
    } else {
        res.status(401).json({
            code: 401,
            error: "Missing 'Bearer' Authorization header"
        });
    }
});

const foodSearchPath = '/v1/foods/search';

const nutrientKeyMap = {
    203: "protein",
    204: "fat",
    205: "carbohydrate",
    208: "energy",
    269: "totalSugar",
    291: "fiber",
    301: "calcium",
    303: "iron",
    306: "potassium",
    307: "sodium",
    539: "addedSugar",
    601: "cholesterol",
    605: "transFat",
    606: "saturatedFat"
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.get('/', (req, res) => {
    res.send('Welcome to the Nutrobo API!');
});

app.post('/v1/assistant/create-thread', async (req, res) => {
    var threadId = (await client.beta.threads.create()).id;

    await client.beta.threads.messages.create(
        threadId,
        {
            role: 'assistant',
            content: 'How may I help you today?'
        }
    );

    await _getResponse(threadId, res, 201);
});

app.post('/v1/assistant/send-message/:threadId', async (req, res) => {
    const body = req.body;
    const params = req.params;
    
    await _runThread({
        threadId: params.threadId, 
        res: res,
        content: body.content, 
        data: body.data
    });
});

app.post('/v1/assistant/send-barcode/:threadId', async (req, res) => {
    const body = req.body;
    const params = req.params;
    var barcode = body.content
    var content = ''

    var food = await _getFood(barcode);
    if (!food) {
        content = `Unable to find product for barcode ${barcode}`;
    } else {
        content = await _getFoodMessage(food);
    } 

    await _runThread({
        threadId: params.threadId, 
        res: res, 
        content: content,
        data: body.data, 
        isAssistant: food != null
    });
});

app.post('/v1/assistant/send-nutrition-info/:threadId', async (req, res) => {
    const body = req.body;
    const params = req.params;
    var info = body.content;

    console.log("AVAIS: " + params.threadId);

    await _runThread({
        threadId: params.threadId, 
        res: res, 
        content: _getNutritionInfoMessage(info),
        data: body.data
    });
});

app.get('/v1/assistant/get-barcode-message/:barcode', async (req, res) => {
    const params = req.params;

    var food = await _getFoos(params.barcode);
    if (!food) {
        res.status(404).json({
            "code": 404,
            "error": "Barcode not found."
        });
    } else {
        var message = await _getFoodMessage(food);
        res.status(200).json({
            id: crypto.randomUUID(),
            content: message,
            sentBy: 'user',
            createdAt: Math.floor(Date.now() / 1000)
        });
    }
    
});

app.get('/v1/assistant/get-thread/:threadId', async (req, res) => {
    const params = req.params;

    await client.beta.threads.messages.list(
        params.threadId
    );

    await _getResponse(params.threadId, res, 200);
});

app.get('/v1/food/get-by-barcode/:barcode', async (req, res) => {
    var params = req.params;

    var food = await _getFood(params.barcode);
    
    if (!food) {
        res.status(404).json({
            "code": 404,
            "error": "Barcode not found."
        });
    } else {
        res.status(200).json(food);
    }
    
});


function _mapFdcFoodData(food) {
    var nutrs = {};
    food.foodNutrients.forEach((n) => {
        try {
            var number = parseInt(n.nutrientNumber);
            nutrs[nutrientKeyMap[number]] = {
                id: number,
                name: n.nutrientName,
                unit: n.unitName.toLowerCase(),
                value: n.value
            };
        } catch (e) {
            console.log(e);
        }
    });

    console.log(food);

    var normalizedFood = {
        id: food.fdcId,
        foodName: food.description,
        brandName: food.brandName,
        source: 'fdc',
        barcode: food.gtinUpc,
        servingSize: {
            value: food.servingSize,
            unit: food.servingSizeUnit
        },
        nutrients: nutrs
    }

    return normalizedFood;
}

function _mapNtrxFoodData(food, barcode) {
    var nutrs = {};
    food.full_nutrients.forEach((n) => {
        nutrs[nutrientKeyMap[n.attr_id]] = {
            id: n.attr_id,
            name: n.nutrientName,
            unit: 'g',
            value: n.value
        };
    });

    console.log(food);

    var normalizedFood = {
        id: food.nix_item_id,
        foodName: food.food_name,
        brandName: food.brand_name,
        source: 'ntrx',
        barcode: barcode,
        servingSize: {
            value: food.serving_weight_grams,
            unit: 'g'
        },
        nutrients: nutrs
    }

    return normalizedFood;
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

async function _getFood(barcode) {
    console.log(`Barcode for product: ${barcode}`);

    var foods = await _getFoodsFromFdc(barcode);
    if (foods && foods.length > 0) {
        return _mapFdcFoodData(foods[0]);
    }

    foods = await _getFoodsFromNutritionix(barcode)
    if (foods && foods.length > 0) {
        return _mapNtrxFoodData(foods[0], barcode);
    }

    return null;
}

async function _getFoodsFromFdc(barcode) {
    const baseUrl = process.env['FDC_BASE_URL'];
    const apiKey = process.env['FDC_API_KEY'];
    const url = `${baseUrl}/v1/foods/search?api_key=${apiKey}`;

    console.log(url);

    var response = await fetch(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: barcode,
                dataType: ['Branded'],
                numberOfResultsPerPage: 1
            })
        }
    );

    return (await response.json()).foods;
}

async function _getFoodsFromNutritionix(barcode) {
    const baseUrl = process.env['NTRX_BASE_URL'];
    const apiKey = process.env['NTRX_API_KEY'];
    const appId = process.env['NTRX_APP_ID'];

    const url = `${baseUrl}/v2/search/item?upc=${barcode}`;

    console.log(url);

    var response = await fetch(
        url,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-app-id': appId,
                'x-app-key': apiKey
            }
        }
    );

    return (await response.json()).foods;
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
                        await _addNutrientData(threadId, run.id, args, tool);
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

async function _addNutrientData(threadId, runId, args, tool) {
    var url = `${process.env['FDC_BASE_URL']}${foodSearchPath}?api_key=${process.env['FDC_API_KEY']}&query=${args.foodName}`;
    var response = await fetch(url);
    var firstFood = (await response.json()).foods[0];
    var output = {
        food_name: args.foodName,
        nutrients: firstFood.foodNutrients.map((n) => {
            console.log(`${n.value} ${n.unit} ${n.nutrientName}`)
            return `${n.value} ${n.unitName} ${n.nutrientName}`
        })
    }
    var run = await client.beta.threads.runs.submitToolOutputs(
        threadId,
        runId,
        {
            tool_outputs: [
                {
                    tool_call_id: tool.id,
                    output: JSON.stringify(output),
                }
            ]
        }
    );
    return run;
}

function _getToken(req) {
    if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
        return req.headers.authorization.split(' ')[1];
    } else {
        return null;
    }
}