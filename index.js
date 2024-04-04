require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { default: OpenAI } = require('openai');
const app = express();
const client = new OpenAI();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

app.use(bodyParser.json());

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
    //console.log(`'AVAIS: Created thread ${threadId}'`)

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

    await _runThread(body.threadId, res);
});

app.get('/v1/get-thread/:threadId', async (req, res) => {
    const params = req.params;

    await client.beta.threads.messages.list(
        params.threadId
    );

    await _getResponse(params.threadId, res);
});

async function _runThread(threadId, res) {
    console.log(`'Running thread ${threadId}'`)

    var run = await client.beta.threads.runs.create(
        threadId,
        { 
            assistant_id: process.env['NUTROBO_ASST_ID'] 
        }
    );

    var done = false;
    while (!done) {
        await delay(1000);
        run = await client.beta.threads.runs.retrieve(
            threadId,
            run.id
        );
        console.log(`'Thread status ${run.status} for thread ${threadId}'`)
        switch (run.status) {
            case 'completed':
                done = true;
                break;
            case 'requires_action':
                var messages = await client.beta.threads.messages.list(threadId)
                console.log(messages);
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
            content: m.content[0].text.value,
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
        console.log(`'Cancelling run ${run.id}'`)
        if (run.status == 'requires_action') {
            await client.beta.threads.runs.cancel(
                threadId,
                run.id
            );
        }
    }
}