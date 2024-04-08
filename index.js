require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { default: OpenAI } = require('openai');
const app = express();
const client = new OpenAI();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const https = require('https');

app.use(bodyParser.json());

const foodSearchPath = '/v1/foods/search';

const nutrientKeyMap = {
    "1003": "protein",
    "1004": "fat",
    "1005": "carbohydrate",
    "1008": "energy",
    "1079": "fiber",
    "1087": "calcium",
    "1089": "iron",
    "1092": "potassium",
    "1093": "sodium",
    "1095": "zinc",
    "1104": "vitaminA",
    "1110": "vitaminD",
    "1165": "thiamin",
    "1166": "riboflavin",
    "1157": "niacin",
    "1175": "vitaminB6",
    "1235": "addedSugar",
    "1253": "cholesterol",
    "1257": "transFat",
    "1258": "saturatedFat",
    "2000": "totalSugar"
}

app.use(function(req, res, next) {
    res.setTimeout(20000, async function() {
        console.log('Request has timed out.');
        res.send(408);
    });

    next();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.get('/', (req, res) => {
    res.send('Welcome to the Nutrobo API!');
});

app.post('/v1/create-thread', async (req, res) => {
    var threadId = (await client.beta.threads.create()).id;

    await client.beta.threads.messages.create(
        threadId,
        {
            role: 'assistant',
            content: 'How may I help you today?'
        }
    );

    await _getResponse(threadId, res);
});

app.post('/v1/send-message', async (req, res) => {
    const body = req.body;

    await _cancelRuns(body.threadId);

    await client.beta.threads.messages.create(
        body.threadId,
        {
            role: 'user',
            content: body.content
        }
    );

    await _runThread(body.threadId, res, body.data);
});

app.get('/v1/get-thread/:threadId', async (req, res) => {
    const params = req.params;

    await client.beta.threads.messages.list(
        params.threadId
    );

    await _getResponse(params.threadId, res);
});

app.get('/v1/get-by-barcode/:barcode', async (req, res) => {
    const params = req.params
    const baseUrl = process.env['FDC_BASE_URL'];
    const apiKey = process.env['FDC_API_KEY'];
    const url = `${baseUrl}/v1/foods/search?api_key=${apiKey}`;

    var response = await fetch(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: params.barcode,
                dataType: ['Branded'],
                numberOfResultsPerPage: 1
            })
        }
    );

    var foods = (await response.json()).foods;
    if (foods.length == 0) {
        res.status(404).json({
            "code": 404,
            "error": "Barcode not found."
        });
    } else {
        var food = foods[0];
        var nutrs = {};
        food.foodNutrients.forEach((n) => {
            nutrs[nutrientKeyMap[n.nutrientId]] = {
                code: n.nutrientId,
                name: n.nutrientName,
                unit: n.unitName.toLowerCase(),
                value: n.value
            };
        });

        res.status(200).json({
            name: food.brandName,
            description: food.description,
            barcode: food.gtinUpc,
            servingSize: {
                value: food.servingSize,
                unit: food.servingSizeUnit
            },
            totalSize: {
                value: 100,
                unit: 'g'
            },
            nutrients: nutrs
        });
    }
    
})


async function _runThread(threadId, res, data) {
    console.log(`'Running thread ${threadId}'`)

    var run = await client.beta.threads.runs.create(
        threadId,
        { 
            assistant_id: process.env['NUTROBO_ASST_ID'],
            additional_instructions: data ? data.join('. ') : ''
        }
    );

    console.log(run);

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
                console.log(tool.function);
                switch (tool.function.name) {
                    case 'getNutrientData':
                        await _addNutrientData(threadId, run.id, args, tool);
                        break;
                        
                }
                break;
        }
    }

    await _getResponse(threadId, res);
}

async function _getResponse(threadId, res) {
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

    if (res) {
        res.status(200).json(response)
    }    

    return response;
}

async function _cancelRuns(threadId) {
    var runs = await client.beta.threads.runs.list(threadId);
    for (const run of runs.data) {
        console.log(`Cancelling run ${run.id}`)
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
    console.log(url);
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